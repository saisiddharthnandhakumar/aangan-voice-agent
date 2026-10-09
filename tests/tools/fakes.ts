import { randomUUID } from "node:crypto";
import type { BookingRow, CallRow, ToolsRepo } from "@/lib/tools/repo";
import type { ToolDeps } from "@/lib/tools/service";
import { FAKE_PRICING, HOURS } from "../helpers";

/** In-memory ToolsRepo mirroring the unique constraints in src/db/schema.ts. */
export function memoryRepo() {
  const calls: CallRow[] = [];
  const bookings: BookingRow[] = [];
  const toolCalls: unknown[] = [];
  const blankCall = (): CallRow =>
    Object.fromEntries(Object.keys(sampleCallShape).map((k) => [k, null])) as unknown as CallRow;
  const repo: ToolsRepo = {
    async findCallByRef(ref) {
      return calls.find((c) => c.callRef === ref) ?? null;
    },
    async findRecentOpenCallByPhone(phone, since) {
      return [...calls].reverse().find((c) => c.fromNumber === phone && c.status === "in_call" && !c.vaaniCallId && c.createdAt >= since) ?? null;
    },
    async createCall(values) {
      if (values.callRef && calls.some((c) => c.callRef === values.callRef)) return null;
      const row = { ...blankCall(), flags: [], tierConflict: false, budgetTight: false, priceLeak: false, reviewState: "none", isTest: false, ...values, id: randomUUID(), createdAt: values.startedAt ?? new Date(), updatedAt: new Date() } as CallRow;
      calls.push(row);
      return row;
    },
    async updateCall(id, values) {
      Object.assign(calls.find((c) => c.id === id) as CallRow, values);
    },
    async getBookingForCall(callId) {
      return bookings.find((b) => b.callId === callId) ?? null;
    },
    async claimBooking(values) {
      const existing = bookings.find((b) => b.callId === values.callId);
      if (existing) return { booking: existing, created: false };
      const row = { calBookingUid: null, endAt: null, attendeeEmail: null, eventTypeId: null, emailIsPlaceholder: false, status: "pending", ...values, id: randomUUID(), createdAt: new Date(), updatedAt: new Date() } as BookingRow;
      bookings.push(row);
      return { booking: row, created: true };
    },
    async updateBooking(id, values) {
      Object.assign(bookings.find((b) => b.id === id) as BookingRow, values);
    },
    async logToolCall(values) {
      toolCalls.push(values);
    },
  };
  return { repo, calls, bookings, toolCalls };
}

const sampleCallShape = {
  id: 0, vaaniCallId: 0, vaaniAgentId: 0, callRef: 0, fromNumber: 0, toNumber: 0, callerName: 0, startedAt: 0, answeredAt: 0, endedAt: 0,
  durationSeconds: 0, calledAfterHours: 0, callCategory: 0, status: 0, reviewState: 0, endReason: 0, tier: 0, tierReasons: 0,
  tierConflict: 0, priority: 0, estimatedValueInr: 0, budgetLowInr: 0, budgetHighInr: 0, budgetFloorInr: 0, budgetTight: 0, priceLeak: 0,
  criteriaAgent: 0, criteriaGemini: 0, facts: 0, flags: 0, completionNeededBy: 0, siteReadyText: 0, consultType: 0, siteArea: 0,
  referralSource: 0, existingProjectDesigner: 0, repeatOfCallId: 0, transcript: 0, recordingUrl: 0, summary: 0, handoffNote: 0,
  openQuestions: 0, hubspotContactId: 0, hubspotCallId: 0, hubspotDealId: 0, telegramSentAt: 0, telegramChatId: 0, telegramMessageId: 0,
  vaaniCostInr: 0, geminiCostInr: 0, totalCostInr: 0, geminiTokensIn: 0, geminiTokensOut: 0, isTest: 0, rawWebhook: 0, createdAt: 0, updatedAt: 0,
};

export interface CalRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A scripted Cal.com: give it handlers per path, it records every request. */
export function mockCal(handlers: { slots?: (q: URLSearchParams) => Response | Promise<Response>; book?: (body: Record<string, unknown>) => Response | Promise<Response> }) {
  const requests: CalRequest[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method: init?.method ?? "GET", path: url.pathname, headers, body });
    if (url.pathname === "/v2/slots" && handlers.slots) return handlers.slots(url.searchParams);
    if (url.pathname === "/v2/bookings" && handlers.book) return handlers.book(body);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Slots response in the verified shape: { data: { "YYYY-MM-DD": [{start, end}] } } */
export function slotsResponse(starts: string[]) {
  const data: Record<string, Array<{ start: string; end: string }>> = {};
  for (const s of starts) {
    const day = s.slice(0, 10);
    (data[day] ??= []).push({ start: s, end: s });
  }
  return json({ status: "success", data });
}

export function deps(over: Partial<ToolDeps> & { fetchImpl?: typeof fetch; now?: () => Date } = {}): ToolDeps {
  const { fetchImpl, ...rest } = over;
  return {
    repo: memoryRepo().repo,
    now: () => new Date("2026-10-12T05:30:00Z"), // Monday 11:00 IST
    rules: { pricing: FAKE_PRICING, hours: HOURS, assumedDealValueInr: 1_100_000 },
    cal: { apiKey: "cal_test", baseUrl: "https://cal.test", versionSlots: "2024-09-04", versionBookings: "2026-02-25", eventTypeIds: { site_visit: 111, call: 222 }, fetchImpl },
    placeholderEmailDomain: "example.com",
    testAgentIds: [],
    ...rest,
  };
}
