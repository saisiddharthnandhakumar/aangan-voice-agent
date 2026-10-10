import { randomUUID } from "node:crypto";
import type { GeminiUsage } from "@/lib/gemini/client";
import type { PostCallResult } from "@/lib/gemini/postcall";
import type { PipelineRepo, StepRow, StoredEvent } from "@/lib/pipeline/repo";
import { HubspotError, type HubspotApi } from "@/lib/hubspot/client";
import type { HubspotIds } from "@/lib/hubspot/mapping";
import { TelegramError } from "@/lib/telegram/client";
import type { HubspotWiring, PipelineDeps, TelegramApi } from "@/lib/pipeline/types";
import type { CallRow } from "@/lib/tools/repo";
import { FAKE_PRICING, HOURS } from "../helpers";
import { memoryRepo } from "../tools/fakes";

/**
 * In-memory PipelineRepo over the same arrays as the tools fake, so a test can create a row via
 * submit_assessment and then post webhook events against it. Mirrors the Drizzle repo's rules:
 * unique vaani_call_id, one stored event per type, merge copies the stub then deletes it.
 */
export function memoryPipeline() {
  const tools = memoryRepo();
  const steps: StepRow[] = [];
  const events = (c: CallRow) => ((c.rawWebhook as { events?: StoredEvent[] } | null)?.events ?? []) as StoredEvent[];
  const find = (id: string) => tools.calls.find((c) => c.id === id) ?? null;

  const repo: PipelineRepo = {
    async recordEvent(vaaniCallId, event, isTest) {
      let call = tools.calls.find((c) => c.vaaniCallId === vaaniCallId);
      if (!call) {
        call = (await tools.repo.createCall({ vaaniCallId, status: "in_call", rawWebhook: { events: [] }, isTest })) as CallRow;
        call.createdAt = new Date();
      }
      if (events(call).some((e) => e.event === event.event)) return { call, duplicate: true };
      call.rawWebhook = { events: [...events(call), event] };
      call.isTest = call.isTest || isTest;
      return { call, duplicate: false };
    },
    async getCall(id) {
      return find(id);
    },
    async getCallByRef(ref) {
      return tools.calls.find((c) => c.callRef === ref) ?? null;
    },
    async getCallByVaaniId(vaaniCallId) {
      return tools.calls.find((c) => c.vaaniCallId === vaaniCallId) ?? null;
    },
    async updateCall(id, values) {
      await tools.repo.updateCall(id, values);
    },
    async findUnlinkedToolRows(from, to) {
      return tools.calls.filter((c) => !c.vaaniCallId && c.callRef && c.createdAt >= from && c.createdAt <= to);
    },
    async mergeStubIntoToolRow(stubId, toolRowId) {
      const s = find(stubId) as CallRow;
      const t = find(toolRowId) as CallRow;
      Object.assign(t, {
        startedAt: s.startedAt ?? t.startedAt,
        answeredAt: s.answeredAt ?? t.answeredAt,
        endedAt: s.endedAt ?? t.endedAt,
        durationSeconds: s.durationSeconds ?? t.durationSeconds,
        endReason: s.endReason ?? t.endReason,
        transcript: s.transcript ?? t.transcript,
        recordingUrl: s.recordingUrl ?? t.recordingUrl,
        vaaniAgentId: s.vaaniAgentId ?? t.vaaniAgentId,
        toNumber: t.toNumber ?? s.toNumber,
        fromNumber: t.fromNumber ?? s.fromNumber,
        rawWebhook: s.rawWebhook,
        isTest: t.isTest || s.isTest,
        status: s.status === "in_call" ? t.status : s.status,
      });
      for (let i = steps.length - 1; i >= 0; i--) if (steps[i].callId === stubId) steps.splice(i, 1);
      tools.calls.splice(tools.calls.indexOf(s), 1);
      t.vaaniCallId = s.vaaniCallId;
      return t;
    },
    async getBookingForCall(callId) {
      return tools.bookings.find((b) => b.callId === callId) ?? null;
    },
    async updateBooking(id, values) {
      await tools.repo.updateBooking(id, values);
    },
    async priorCallsFromNumber(fromNumber, since, before, excludeId) {
      return tools.calls
        .filter((c) => c.id !== excludeId && c.fromNumber === fromNumber && c.startedAt && c.startedAt >= since && c.startedAt < before)
        .map((c) => ({ id: c.id, fromNumber: c.fromNumber, startedAt: c.startedAt, repeatOfCallId: c.repeatOfCallId }));
    },
    async findContactIdByNumber(fromNumber, excludeId) {
      const hit = [...tools.calls].reverse().find((c) => c.id !== excludeId && c.fromNumber === fromNumber && c.hubspotContactId);
      return hit?.hubspotContactId ?? null;
    },
    async findDealIdByContact(contactId, excludeId) {
      const hit = [...tools.calls].reverse().find((c) => c.id !== excludeId && c.hubspotContactId === contactId && c.hubspotDealId);
      return hit?.hubspotDealId ?? null;
    },
    async countCallsFromNumber(fromNumber) {
      return tools.calls.filter((c) => c.fromNumber === fromNumber && !c.isTest).length;
    },
    async listPendingBookings(olderThan) {
      return tools.bookings.filter((b) => b.status === "pending" && b.createdAt < olderThan).map((b) => ({ callId: b.callId }));
    },
    async digestItems(now) {
      const dayAgo = now.getTime() - 24 * 3_600_000;
      return tools.calls
        .filter((c) => !c.isTest && c.reviewState === "none" && ((c.tier === "amber" && ["booked", "awaiting_designer"].includes(c.status)) || (c.tier === "red" && c.createdAt.getTime() >= dayAgo)))
        .map((c) => ({ id: c.id, tier: c.tier as "red" | "amber", name: c.callerName, locality: null, createdAt: c.createdAt }));
    },
    async getSteps(callId) {
      return steps.filter((s) => s.callId === callId);
    },
    async upsertStep(callId, step, values) {
      const existing = steps.find((s) => s.callId === callId && s.step === step);
      if (existing) Object.assign(existing, values, { updatedAt: new Date() });
      else steps.push({ id: randomUUID(), callId, step, ...values, updatedAt: new Date() });
    },
  };
  return { repo, tools, steps, calls: tools.calls, bookings: tools.bookings };
}

export const USAGE: GeminiUsage = { promptTokens: 10_000, outputTokens: 2_000, thoughtsTokens: 500 };

export function postCall(over: Partial<PostCallResult> = {}): PostCallResult {
  return {
    summary: "Priya wants her 3BHK in Kothrud fully redone by March.",
    handoffNote: "Confirm the scope of the kitchen.",
    openQuestions: ["Exact carpet area?"],
    hasProjectDetails: true,
    priceLeak: { leaked: false, evidence: null },
    extraction: { call_category: "enquiry", criteria: {} },
    ...over,
  };
}

/** Records every Telegram send and edit; `failNext` makes the next N calls fail (after the client's own retries). */
export function fakeTelegram(o: { founderChatId?: string | null; failNext?: number; editStatus?: number } = {}) {
  const sent: Array<{ chatId: string; text: string; messageId: string; button?: { text: string; url: string } }> = [];
  const edits: Array<{ chatId: string; messageId: string; text: string }> = [];
  let failures = o.failNext ?? 0;
  let next = 100;
  const api: TelegramApi = {
    designersChatId: "-1001",
    founderChatId: o.founderChatId === undefined ? "-2002" : o.founderChatId,
    async send(m) {
      if (failures > 0) {
        failures--;
        throw new TelegramError("Telegram sendMessage 500: boom", 500, null);
      }
      const messageId = String(next++);
      sent.push({ chatId: m.chatId, text: m.text, messageId, button: m.button });
      return { chatId: m.chatId, messageId };
    },
    async edit(m) {
      if (o.editStatus) throw new TelegramError("Telegram editMessageText 400: message to edit not found", o.editStatus, null);
      edits.push({ chatId: m.chatId, messageId: m.messageId, text: m.text });
      return { chatId: m.chatId, messageId: m.messageId };
    },
  };
  return { api, sent, edits, failNext: (n: number) => (failures = n) };
}

export const HS_IDS: HubspotIds = { pipelineId: "default", stageBooked: "st_booked", stageAwaiting: "st_await", stageLost: "st_lost", portalId: "1234" };

/** An in-memory HubSpot: contacts keyed by phone, call records, deals, associations; counts every create. */
export function fakeHubspot(o: { down?: boolean; searchHit?: string; rejectDescription?: boolean } = {}) {
  const state = {
    down: o.down ?? false,
    contacts: new Map<string, Record<string, unknown>>(),
    calls: new Map<string, Record<string, unknown>>(),
    deals: new Map<string, Record<string, unknown>>(),
    associations: [] as string[],
    requests: 0,
  };
  let n = 1;
  const guard = () => {
    state.requests++;
    if (state.down) throw new HubspotError("HubSpot unreachable", 503, null, null, null);
  };
  const api: HubspotApi = {
    async findContactByPhone() {
      guard();
      return o.searchHit ?? null;
    },
    async createContact(props) {
      guard();
      const id = `c${n++}`;
      state.contacts.set(id, { ...props });
      return id;
    },
    async updateContact(id, props) {
      guard();
      state.contacts.set(id, { ...(state.contacts.get(id) ?? {}), ...props });
    },
    async createCall(props, contactId) {
      guard();
      const id = `k${n++}`;
      state.calls.set(id, { ...props, contactId });
      return id;
    },
    async createDeal(props) {
      guard();
      if (o.rejectDescription && "description" in props) throw new HubspotError("HubSpot POST deals 400: Property description does not exist", 400, null, null, null);
      const id = `d${n++}`;
      state.deals.set(id, { ...props });
      return id;
    },
    async updateDeal(id, props) {
      guard();
      state.deals.set(id, { ...(state.deals.get(id) ?? {}), ...props });
    },
    async associate(from, fromId, to, toId) {
      guard();
      state.associations.push(`${from}:${fromId}->${to}:${toId}`);
    },
    async listContactProperties() {
      guard();
      return [];
    },
    async createPropertyGroup() {
      guard();
    },
    async createContactProperty() {
      guard();
    },
    async listDealPipelines() {
      guard();
      return [];
    },
  };
  const wiring: HubspotWiring = { api, ids: HS_IDS };
  return { api, wiring, state };
}

export interface FakeDepsOptions {
  repo: PipelineRepo;
  now?: Date;
  telegram?: TelegramApi | null;
  hubspot?: HubspotWiring | null;
  analyse?: PipelineDeps["analyse"];
  history?: PipelineDeps["history"];
  calLookup?: PipelineDeps["calLookup"];
  config?: Partial<PipelineDeps["config"]>;
}

export function pipelineDeps(o: FakeDepsOptions): PipelineDeps & { slept: number[] } {
  const slept: number[] = [];
  let clock = (o.now ?? new Date("2026-10-12T06:00:00Z")).getTime();
  return {
    repo: o.repo,
    now: () => new Date(clock),
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    config: {
      pricing: FAKE_PRICING,
      hours: HOURS,
      vaaniCostPerMinInr: 6,
      testAgentIds: ["agent-test"],
      geminiPriceInPerMtokInr: 50,
      geminiPriceOutPerMtokInr: 300,
      reconcileAfterMs: 120_000,
      appBaseUrl: "https://aangan.example",
      ...o.config,
    },
    history: o.history ?? null,
    analyse: o.analyse === undefined ? async () => ({ result: postCall(), usage: USAGE, model: "gemini-test", attempts: 1 }) : o.analyse,
    calLookup: o.calLookup ?? null,
    telegram: o.telegram ?? null,
    hubspot: o.hubspot ?? null,
    slept,
  };
}

/** A realistic Vaani event sequence for one call (shapes from the Vaani docs). */
export function vaaniEvents(id: string, o: { start: Date; seconds: number; transcript?: string; phone?: string }) {
  const end = new Date(o.start.getTime() + o.seconds * 1000);
  return {
    started: { event: "call_started", room_name: id, status: "dialing", ...(o.phone ? { phone_number: o.phone } : {}), timestamp: o.start.toISOString() },
    pickedUp: { event: "user_picked_up_at", room_name: id, status: "active", timestamp: new Date(o.start.getTime() + 3000).toISOString() },
    ended: { event: "call_ended", room_name: id, call_duration: o.seconds, end_reason: "AGENT_REQUESTED_DISCONNECT", timestamp: end.toISOString() },
    post: {
      event: "call_postprocessing",
      call_id: id,
      timestamp: end.toISOString(),
      data: {
        room_name: id,
        call_id: id,
        call_duration: o.seconds * 1000,
        end_reason: "Call ended",
        summary: "vaani summary",
        entities: {},
        dispositions: {},
        recording_url: "https://recordings.example/x.mp3",
        transcript: o.transcript ?? GREEN_TRANSCRIPT,
      },
    },
  };
}

export const GREEN_TRANSCRIPT = `[10:00:01] AGENT: Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded.

[10:00:06] USER: Hi, I want my 3BHK in Kothrud fully redone by March.

[10:00:12] AGENT: Lovely. Would you like our studio to design the space and also carry out the work?

[10:00:18] USER: Yes, the whole thing. What would it cost roughly?

[10:00:22] AGENT: Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation.`;
