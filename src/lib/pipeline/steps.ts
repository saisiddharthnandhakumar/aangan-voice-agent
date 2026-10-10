import { errorSummary } from "@/lib/http/retry";
import { normalisePhone } from "@/lib/phone";
import { agentTurns, detectPriceLeak, finalStatus, findRepeatOf, isWithinBusinessHours, RULES_CONFIG } from "@/lib/rules";
import { geminiCostInr } from "@/lib/gemini/client";
import { logCallToHubspot, syncDeal, type HubspotCtx } from "@/lib/hubspot/sync";
import { planAlerts, type PlannedAlert } from "@/lib/telegram/alerts";
import { TelegramError } from "@/lib/telegram/client";
import { istParts } from "@/lib/rules/time";
import { isTestMode } from "@/lib/tools/service";
import type { CallRow } from "@/lib/tools/repo";
import type { GeminiRecord, PipelineDeps, StepName } from "./types";

/**
 * The post-call steps. Each reads the call row fresh from the repo, so any step can be re-run on
 * its own from the dashboard. A step either returns (succeeded or skipped, with a note) or throws
 * (recorded as failed by the runner). No step ever writes a pricing figure anywhere.
 */

export interface StepOutcome {
  status: "succeeded" | "skipped";
  /** Short reason, stored in pipeline_steps.last_error for skipped steps (e.g. missing_config). */
  note?: string;
  /** Attempts made inside the step (an external client's own retries). Defaults to 1. */
  attempts?: number;
  /** Stop the rest of the pipeline (only `save` uses this). */
  halt?: boolean;
}

export type StepFn = (callId: string, deps: PipelineDeps) => Promise<StepOutcome>;

export const DROPPED_UNDER_SECONDS = 20;

const done = (note?: string, attempts?: number): StepOutcome => ({ status: "succeeded", note, attempts });
const skipped = (note: string): StepOutcome => ({ status: "skipped", note });

async function load(callId: string, deps: PipelineDeps): Promise<CallRow> {
  const call = await deps.repo.getCall(callId);
  if (!call) throw new Error("call not found");
  return call;
}

/** Pipeline extras live under facts.pipeline so the agent's recorded facts stay untouched. */
function withPipelineFacts(call: CallRow, patch: Record<string, unknown>): Record<string, unknown> {
  const facts = (call.facts && typeof call.facts === "object" ? call.facts : {}) as Record<string, unknown>;
  const pipeline = (facts.pipeline && typeof facts.pipeline === "object" ? facts.pipeline : {}) as Record<string, unknown>;
  return { ...facts, pipeline: { ...pipeline, ...patch } };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** True when the transcript has at least one caller turn with words in it. */
export function hasCallerSpeech(transcript: string | null): boolean {
  if (!transcript) return false;
  return transcript.split(/\r?\n/).some((l) => /^\s*(?:\[[^\]]*\]\s*)?(USER|CALLER|HUMAN)\s*:\s*\S/i.test(l));
}

// ------------------------------------------------------------------ save
/** The raw event is already stored by the route; this checks the row and fills derived fields. */
const save: StepFn = async (callId, deps) => {
  const call = await load(callId, deps);
  const started = call.startedAt ?? (call.endedAt && call.durationSeconds != null ? new Date(call.endedAt.getTime() - call.durationSeconds * 1000) : null);
  await deps.repo.updateCall(callId, {
    startedAt: started,
    calledAfterHours: call.calledAfterHours ?? (started ? !isWithinBusinessHours(started, deps.config.hours) : null),
    endReason: call.endReason ?? "completed",
    status: call.status === "in_call" ? "processing" : call.status,
  });
  return done();
};

// ------------------------------------------------------------------ enrich
/** Vaani call history: numbers, pickup time, agent ID, credits. Tolerates Vaani's current 500. */
const enrich: StepFn = async (callId, deps) => {
  if (!deps.history) return skipped("missing_config");
  const call = await load(callId, deps);
  if (!call.vaaniCallId) return skipped("no_vaani_call_id");
  const item = await deps.history(call.vaaniCallId);
  if (!item) return skipped("not_in_history");
  const testAgent = !!item.agentId && deps.config.testAgentIds.includes(item.agentId);
  // UNVERIFIED: a WebRTC/browser test call's call_type; anything web-like is treated as a test.
  const webCall = isTestMode(item.callType) || isTestMode(item.direction);
  await deps.repo.updateCall(callId, {
    fromNumber: call.fromNumber ?? normalisePhone(item.fromNumber),
    toNumber: call.toNumber ?? normalisePhone(item.toNumber),
    answeredAt: call.answeredAt ?? item.pickedUpAt,
    startedAt: call.startedAt ?? item.startedAt,
    durationSeconds: call.durationSeconds ?? item.durationSeconds,
    vaaniAgentId: call.vaaniAgentId ?? item.agentId,
    isTest: call.isTest || testAgent || webCall,
    facts: withPipelineFacts(call, { vaani_cost_credits: item.costCredits, vaani_call_type: item.callType }),
  });
  return done();
};

// ------------------------------------------------------------------ booking (reconcile)
/**
 * A booking whose Cal.com create timed out is left pending (it may exist at Cal.com). After it has
 * had time to settle, look it up by attendee email and mark it accepted or failed.
 */
const booking: StepFn = async (callId, deps) => {
  const b = await deps.repo.getBookingForCall(callId);
  if (!b) return skipped("no_booking");
  if (b.status !== "pending") return done(`already ${b.status}`);
  if (!deps.calLookup) return skipped("missing_config");
  if (!b.attendeeEmail) throw new Error("pending booking has no attendee email");
  // Too recent to reconcile: the alert must not wait for it. The daily job (and a dashboard retry) settles it.
  if (deps.now().getTime() - b.createdAt.getTime() < deps.config.reconcileAfterMs) return skipped("too_recent");
  const call = await load(callId, deps);
  const listed = await deps.calLookup({
    attendeeEmail: b.attendeeEmail,
    eventTypeId: b.eventTypeId ?? undefined,
    afterCreatedAt: new Date(b.createdAt.getTime() - 10 * 60_000).toISOString(),
  });
  const match = listed.find(
    (x) =>
      !["cancelled", "rejected"].includes((x.status ?? "").toLowerCase()) &&
      (x.metadata.call_ref === call.callRef || Math.abs(Date.parse(x.start) - b.startAt.getTime()) < 60_000),
  );
  if (match) {
    await deps.repo.updateBooking(b.id, { status: "accepted", calBookingUid: match.uid, startAt: new Date(match.start), endAt: match.end ? new Date(match.end) : null });
    return done("reconciled: accepted");
  }
  await deps.repo.updateBooking(b.id, { status: "failed" });
  return done("reconciled: not found at Cal.com, marked failed");
};

// ------------------------------------------------------------------ gemini
const gemini: StepFn = async (callId, deps) => {
  if (!deps.analyse) return skipped("missing_config");
  const call = await load(callId, deps);
  if (!call.transcript?.trim()) return skipped("no_transcript");
  const today = istParts(call.startedAt ?? deps.now()).date;
  const { result, usage, model, attempts } = await deps.analyse(call.transcript, today);
  const record: GeminiRecord = {
    model,
    analysed_at: deps.now().toISOString(),
    has_project_details: result.hasProjectDetails,
    price_leak: result.priceLeak,
    extraction: result.extraction,
  };
  await deps.repo.updateCall(callId, {
    summary: result.summary,
    handoffNote: result.handoffNote,
    openQuestions: result.openQuestions,
    criteriaGemini: record,
    geminiTokensIn: usage.promptTokens,
    geminiTokensOut: usage.outputTokens,
    geminiCostInr: geminiCostInr(usage, deps.config.geminiPriceInPerMtokInr, deps.config.geminiPriceOutPerMtokInr),
  });
  return done(undefined, attempts);
};

// ------------------------------------------------------------------ tier (final status, dropped, repeat)
/**
 * The tier itself is the voice agent's (decision 2026-10-10) and is never changed here. This step
 * sets the final status from it, marks dropped calls, flags calls no tool call reached
 * (unclassified, Mode B) and links repeat callers (P6).
 */
const tier: StepFn = async (callId, deps) => {
  const call = await load(callId, deps);
  const hasAssessment = call.callCategory !== null;
  const b = await deps.repo.getBookingForCall(callId);
  const g = call.criteriaGemini as GeminiRecord | null;
  const noContent = g ? !g.has_project_details : !hasCallerSpeech(call.transcript);
  const dropped = !hasAssessment && ((call.durationSeconds ?? 0) < DROPPED_UNDER_SECONDS || noContent);
  const status = finalStatus({ category: call.callCategory, tier: call.tier, hasAcceptedBooking: b?.status === "accepted", dropped });

  const flags = new Set(call.flags);
  if (!hasAssessment && !dropped) flags.add("unclassified");
  else flags.delete("unclassified");

  let repeatOf = call.repeatOfCallId;
  if (call.fromNumber && call.startedAt) {
    const since = new Date(call.startedAt.getTime() - RULES_CONFIG.repeat.windowHours * 3_600_000);
    const prior = await deps.repo.priorCallsFromNumber(call.fromNumber, since, call.startedAt, callId);
    repeatOf = findRepeatOf(prior, call.fromNumber, call.startedAt);
  }
  await deps.repo.updateCall(callId, {
    status,
    endReason: dropped ? "dropped" : call.endReason === "dropped" ? "completed" : call.endReason,
    flags: [...flags],
    repeatOfCallId: repeatOf,
  });
  return done(status);
};

// ------------------------------------------------------------------ leak_check (P5)
const leakCheck: StepFn = async (callId, deps) => {
  const call = await load(callId, deps);
  if (!call.transcript?.trim()) return skipped("no_transcript");
  const scan = detectPriceLeak(agentTurns(call.transcript), deps.config.pricing);
  const g = call.criteriaGemini as GeminiRecord | null;
  const geminiLeak = g?.price_leak?.leaked === true;
  await deps.repo.updateCall(callId, {
    priceLeak: scan.leak || geminiLeak,
    // Kinds and turn numbers only; never the figure itself.
    facts: withPipelineFacts(call, {
      price_leak_check: { pattern_kinds: scan.kinds, agent_turns: scan.turns, gemini: g ? geminiLeak : null, gemini_evidence: g?.price_leak?.evidence ?? null },
    }),
  });
  return done(scan.leak || geminiLeak ? "leak" : "clean");
};

// ------------------------------------------------------------------ cost (P7)
/**
 * Vaani cost in INR = duration × VAANI_COST_PER_MIN_INR. Call history's call_cost is in Vaani
 * credits (docs), not INR, so it is kept in facts.pipeline for reference only.
 */
const cost: StepFn = async (callId, deps) => {
  const call = await load(callId, deps);
  const rate = deps.config.vaaniCostPerMinInr;
  const vaani = call.durationSeconds != null && rate != null ? round2((call.durationSeconds / 60) * rate) : null;
  const parts = [vaani, call.geminiCostInr].filter((v): v is number => v != null);
  await deps.repo.updateCall(callId, { vaaniCostInr: vaani, totalCostInr: parts.length ? round2(parts.reduce((a, b) => a + b, 0)) : null });
  return done();
};

// ------------------------------------------------------------------ telegram
type AlertsSent = Partial<Record<PlannedAlert["key"], boolean>>;

/**
 * Sends the alerts a call needs (see src/lib/telegram/alerts.ts). Each alert is sent once: a flag in
 * facts.pipeline.alerts_sent marks it, so a retry after a partial failure resends only what is missing.
 * A redial from the same number edits the first alert instead of sending a second one (AT15).
 */
const telegram: StepFn = async (callId, deps) => {
  const call = await load(callId, deps);
  if (call.isTest) return skipped("is_test"); // P8
  const tg = deps.telegram;
  if (!tg) return skipped("missing_config");
  const booking = await deps.repo.getBookingForCall(callId);
  const plan = planAlerts(call, { appBaseUrl: deps.config.appBaseUrl, booking, founderChatConfigured: tg.founderChatId !== null });
  if (!plan.length) return skipped("no_alert_for_this_call");

  const pipelineFacts = ((call.facts as { pipeline?: { alerts_sent?: AlertsSent } } | null)?.pipeline ?? {}) as { alerts_sent?: AlertsSent };
  const sent: AlertsSent = { ...(pipelineFacts.alerts_sent ?? {}) };
  const errors: string[] = [];
  let anySent = false;

  for (const alert of plan) {
    if (sent[alert.key]) continue;
    const chatId = alert.chat === "founder" ? (tg.founderChatId ?? tg.designersChatId) : tg.designersChatId;
    const text = alert.chat === "founder" && !tg.founderChatId ? `[Founder alert, no founder chat set]\n${alert.text}` : alert.text;
    try {
      if (alert.key === "lead") {
        const root = call.repeatOfCallId ? await deps.repo.getCall(call.repeatOfCallId) : null;
        const ids = await sendOrEditLead(tg, chatId, text, alert, root);
        await deps.repo.updateCall(callId, { telegramSentAt: deps.now(), telegramChatId: ids.chatId, telegramMessageId: ids.messageId });
      } else {
        await tg.send({ chatId, text, button: alert.button });
      }
      sent[alert.key] = true;
      anySent = true;
    } catch (err) {
      errors.push(`${alert.key}: ${errorSummary(err)}`);
    }
  }
  const fresh = await load(callId, deps);
  await deps.repo.updateCall(callId, { facts: withPipelineFacts(fresh, { alerts_sent: sent }) });
  if (errors.length) throw new Error(errors.join(" | "));
  return anySent ? done(plan.map((p) => p.key).join(",")) : done("already_sent");
};

async function sendOrEditLead(
  tg: NonNullable<PipelineDeps["telegram"]>,
  chatId: string,
  text: string,
  alert: PlannedAlert,
  root: CallRow | null,
): Promise<{ chatId: string; messageId: string }> {
  if (root?.telegramMessageId && root.telegramChatId === chatId) {
    try {
      return await tg.edit({ chatId, messageId: root.telegramMessageId, text, button: alert.button });
    } catch (err) {
      // Only a message that cannot be edited any more (gone, not the bot's) falls through to a fresh one.
      if (!(err instanceof TelegramError) || err.status !== 400) throw err;
    }
  }
  return tg.send({ chatId, text, button: alert.button });
}

// ------------------------------------------------------------------ hubspot_log, hubspot_deal
function hubspotCtx(deps: PipelineDeps): HubspotCtx | null {
  if (!deps.hubspot) return null;
  return { api: deps.hubspot.api, ids: deps.hubspot.ids, repo: deps.repo, appBaseUrl: deps.config.appBaseUrl };
}

/** Every non-test call is logged: a contact and a call record, in every category and tier. */
const hubspotLog: StepFn = async (callId, deps) => {
  const call = await load(callId, deps);
  if (call.isTest) return skipped("is_test"); // P8
  const ctx = hubspotCtx(deps);
  if (!ctx) return skipped("missing_config");
  const r = await logCallToHubspot(callId, ctx);
  return done(`${r.contactCreated ? "contact created" : "contact reused"}, ${r.callRecordCreated ? "call logged" : "call already logged"}`);
};

/** Deals: Green and Amber automatically, Red only on Rescue. */
const hubspotDeal: StepFn = async (callId, deps) => {
  const call = await load(callId, deps);
  if (call.isTest) return skipped("is_test");
  const ctx = hubspotCtx(deps);
  if (!ctx) return skipped("missing_config");
  const r = await syncDeal(callId, ctx);
  return r === "none" ? skipped("no_deal_for_this_call") : done(`deal ${r}`);
};

export const STEPS: Record<StepName, StepFn> = {
  save,
  enrich,
  booking,
  gemini,
  tier,
  leak_check: leakCheck,
  cost,
  telegram,
  hubspot_log: hubspotLog,
  hubspot_deal: hubspotDeal,
};
