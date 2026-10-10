import { normalisePhone } from "@/lib/phone";
import type { CallInsert, CallRow } from "@/lib/tools/repo";
import { mapEndReason, parseVaaniEvent, type VaaniEvent } from "@/lib/vaani/events";
import { pickMergeCandidate, callWindow } from "./correlate";
import { runPipeline, type StepReport } from "./run";
import type { PipelineDeps } from "./types";

/**
 * Webhook handling (PRD P1), in two halves:
 * 1. recordWebhook: parse just enough to find the Vaani call ID, then store the raw event on the
 *    call row before anything else. Idempotent per (vaani_call_id, event type). Fast: the route
 *    answers 200 right after it.
 * 2. processEvent (in after()): apply the event to the row, link the row created by the tool
 *    calls, and on call_postprocessing run the pipeline.
 */

export type RecordResult =
  | { ok: true; callId: string; duplicate: boolean; event: VaaniEvent }
  | { ok: false; reason: "unparseable" | "no_call_id" };

export async function recordWebhook(raw: unknown, deps: Pick<PipelineDeps, "repo" | "now">): Promise<RecordResult> {
  const event = parseVaaniEvent(raw);
  if (!event) return { ok: false, reason: "unparseable" };
  if (!event.vaaniCallId) return { ok: false, reason: "no_call_id" };
  const { call, duplicate } = await deps.repo.recordEvent(
    event.vaaniCallId,
    { event: event.type, received_at: deps.now().toISOString(), payload: raw },
    event.isTest,
  );
  return { ok: true, callId: call.id, duplicate, event };
}

/** Field updates for one event. Never moves a time that is already set, never regresses status. */
export function eventPatch(call: CallRow, ev: VaaniEvent, now: Date): Partial<CallInsert> {
  const at = ev.occurredAt ?? now;
  const patch: Partial<CallInsert> = {};
  if (ev.agentId && !call.vaaniAgentId) patch.vaaniAgentId = ev.agentId;
  switch (ev.type) {
    case "call_started": {
      // A tool row's started_at is provisional (the first tool call); the real start is earlier.
      if (!call.startedAt || at < call.startedAt) patch.startedAt = at;
      const phone = normalisePhone(ev.phoneNumber);
      if (phone && !call.fromNumber) patch.fromNumber = phone;
      break;
    }
    case "user_picked_up_at":
      if (!call.answeredAt) patch.answeredAt = at;
      break;
    case "call_ended":
      patch.endedAt = call.endedAt ?? at;
      if (ev.durationSeconds != null) patch.durationSeconds = ev.durationSeconds;
      patch.endReason = mapEndReason(ev.endReason);
      if (call.status === "in_call") patch.status = "processing";
      break;
    case "call_postprocessing":
      if (ev.transcript) patch.transcript = ev.transcript;
      if (ev.recordingUrl) patch.recordingUrl = ev.recordingUrl;
      if (call.durationSeconds == null && ev.durationSeconds != null) patch.durationSeconds = ev.durationSeconds;
      if (!call.endedAt) patch.endedAt = at;
      if (!call.endReason) patch.endReason = mapEndReason(ev.endReason);
      if (call.status === "in_call") patch.status = "processing";
      break;
  }
  const ended = patch.endedAt ?? call.endedAt;
  const duration = patch.durationSeconds ?? call.durationSeconds;
  if (!call.startedAt && !patch.startedAt && ended && duration != null) patch.startedAt = new Date(ended.getTime() - duration * 1000);
  return patch;
}

/** Link the webhook row to the row the tool calls created, if exactly one fits. Returns the call ID to use. */
export async function correlate(callId: string, deps: Pick<PipelineDeps, "repo" | "now">): Promise<{ callId: string; result: "already_linked" | "merged" | "none" | "ambiguous" }> {
  const call = await deps.repo.getCall(callId);
  if (!call) throw new Error("call not found");
  if (call.callRef) return { callId, result: "already_linked" };
  const { from, to } = callWindow(call, deps.now());
  const decision = pickMergeCandidate(call, await deps.repo.findUnlinkedToolRows(from, to), deps.now());
  if (decision.kind === "merge") {
    const merged = await deps.repo.mergeStubIntoToolRow(callId, decision.toolRowId);
    return { callId: merged.id, result: "merged" };
  }
  if (decision.kind === "ambiguous" && !call.flags.includes("needs_manual_link")) {
    await deps.repo.updateCall(callId, { flags: [...call.flags, "needs_manual_link"] });
  }
  return { callId, result: decision.kind };
}

export interface ProcessResult {
  callId: string;
  link?: Awaited<ReturnType<typeof correlate>>["result"];
  pipeline?: StepReport[];
}

/** The row by ID, or, if a concurrent merge has just folded it into the tool row, by Vaani call ID. */
async function resolve(callId: string, ev: VaaniEvent, deps: Pick<PipelineDeps, "repo">): Promise<CallRow> {
  const call = (await deps.repo.getCall(callId)) ?? (ev.vaaniCallId ? await deps.repo.getCallByVaaniId(ev.vaaniCallId) : null);
  if (!call) throw new Error("call not found");
  return call;
}

async function applyEvent(callId: string, ev: VaaniEvent, deps: PipelineDeps): Promise<CallRow> {
  const call = await resolve(callId, ev, deps);
  const patch = eventPatch(call, ev, deps.now());
  if (Object.keys(patch).length) await deps.repo.updateCall(call.id, patch);
  return call;
}

export async function processEvent(callId: string, ev: VaaniEvent, deps: PipelineDeps): Promise<ProcessResult> {
  if (!ev.known) return { callId };
  const call = await applyEvent(callId, ev, deps);
  if (ev.type !== "call_ended" && ev.type !== "call_postprocessing") return { callId: call.id };
  const link = await correlate(call.id, deps);
  if (ev.type === "call_ended") return { callId: link.callId, link: link.result };
  // eventPatch only fills what is missing, so re-applying is safe; it recovers the transcript if
  // a concurrent merge (from call_ended) moved the row while this event was being applied.
  const final = await applyEvent(link.callId, ev, deps);
  const pipeline = await runPipeline(final.id, deps);
  return { callId: final.id, link: link.result, pipeline };
}
