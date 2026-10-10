import { describe, expect, it } from "vitest";
import { pickMergeCandidate } from "@/lib/pipeline/correlate";
import { actionForAgentTier, finalStatus, redactMoney } from "@/lib/rules";
import type { CallRow } from "@/lib/tools/repo";
import { mapEndReason, parseTime, parseVaaniEvent } from "@/lib/vaani/events";
import { mapHistoryItem } from "@/lib/vaani/history";

describe("Vaani event adapter", () => {
  it("reads call_ended duration in SECONDS and call_postprocessing duration in MILLISECONDS", () => {
    const ended = parseVaaniEvent({ event: "call_ended", room_name: "r1", call_duration: 125, end_reason: "AGENT_REQUESTED_DISCONNECT" });
    const post = parseVaaniEvent({ event: "call_postprocessing", call_id: "r1", timestamp: "2026-10-12T05:00:00Z", data: { room_name: "r1", call_duration: 125_400, transcript: "AGENT: hi" } });
    expect(ended).toMatchObject({ type: "call_ended", vaaniCallId: "r1", durationSeconds: 125, endReason: "AGENT_REQUESTED_DISCONNECT", known: true });
    expect(post).toMatchObject({ type: "call_postprocessing", vaaniCallId: "r1", durationSeconds: 125, transcript: "AGENT: hi" });
    expect(post?.occurredAt?.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("prefers explicit duration_ms / duration_seconds keys", () => {
    expect(parseVaaniEvent({ event: "call_ended", room_name: "r", duration_ms: 61_000 })?.durationSeconds).toBe(61);
    expect(parseVaaniEvent({ event: "call_postprocessing", call_id: "r", data: { duration_seconds: 42 } })?.durationSeconds).toBe(42);
  });

  it("finds the call ID in room_name, call_id or data, and keeps unknown events", () => {
    expect(parseVaaniEvent({ event: "call_started", room_name: "abc", phone_number: "+919876543210" })).toMatchObject({ vaaniCallId: "abc", phoneNumber: "+919876543210" });
    expect(parseVaaniEvent({ event: "call_postprocessing", data: { call_id: "inner" } })?.vaaniCallId).toBe("inner");
    expect(parseVaaniEvent({ event: "call_ringing", room_name: "x", extra: { nested: true } })).toMatchObject({ type: "call_ringing", known: false });
  });

  it("returns null for junk and tolerates missing fields", () => {
    expect(parseVaaniEvent(null)).toBeNull();
    expect(parseVaaniEvent([1, 2])).toBeNull();
    expect(parseVaaniEvent({ room_name: "x" })).toBeNull();
    expect(parseVaaniEvent({ event: "call_ended" })).toMatchObject({ vaaniCallId: null, durationSeconds: null });
  });

  it("parses ISO and epoch times", () => {
    expect(parseTime(1_760_245_200)?.toISOString()).toBe("2025-10-12T05:00:00.000Z");
    expect(parseTime("1760245200000")?.toISOString()).toBe("2025-10-12T05:00:00.000Z");
    expect(parseTime("not a date")).toBeNull();
  });

  it("maps end reasons", () => {
    expect(mapEndReason("AGENT_REQUESTED_DISCONNECT")).toBe("completed");
    expect(mapEndReason("SIP 404 failed")).toBe("failed");
    expect(mapEndReason(null)).toBe("completed");
  });

  it("maps a call-history item (docs field names, credits kept as credits)", () => {
    expect(
      mapHistoryItem({ call_id: "c1", agent_id: "a1", call_type: "Inbound", from_number: "+919876543210", to_number: "+912012345678", Start_time: "2026-10-12T05:00:00Z", user_picked_up_at: "2026-10-12T05:00:04Z", duration_ms: 90_500, call_cost: 3.2 }),
    ).toMatchObject({ callId: "c1", agentId: "a1", durationSeconds: 91, costCredits: 3.2, fromNumber: "+919876543210" });
    expect(mapHistoryItem({ nope: 1 })).toBeNull();
  });
});

describe("outcomes under the 2026-10-10 decision", () => {
  it("maps the agent's tier to an action", () => {
    expect(actionForAgentTier("enquiry", "green")).toBe("offer_booking");
    expect(actionForAgentTier("enquiry", "amber")).toBe("offer_booking");
    expect(actionForAgentTier("enquiry", "red")).toBe("decline");
    expect(actionForAgentTier("enquiry", null)).toBe("callback");
    expect(actionForAgentTier("existing_client_complaint", "green")).toBe("escalate");
    expect(actionForAgentTier("existing_client", null)).toBe("callback");
    expect(actionForAgentTier("vendor_or_sales", null)).toBe("close_non_enquiry");
  });

  it("sets the final status", () => {
    const s = (o: Partial<Parameters<typeof finalStatus>[0]>) => finalStatus({ category: "enquiry", tier: "green", hasAcceptedBooking: false, dropped: false, ...o });
    expect(s({ hasAcceptedBooking: true })).toBe("booked");
    expect(s({ tier: "amber", hasAcceptedBooking: true })).toBe("booked");
    expect(s({})).toBe("awaiting_designer");
    expect(s({ tier: "amber" })).toBe("awaiting_designer");
    expect(s({ tier: "red" })).toBe("unqualified_verified");
    expect(s({ tier: null })).toBe("awaiting_designer");
    expect(s({ category: "existing_client_complaint", tier: null })).toBe("escalated");
    expect(s({ category: "existing_client", tier: null })).toBe("awaiting_designer");
    expect(s({ category: "wrong_number", tier: null })).toBe("non_enquiry");
    expect(s({ category: null, tier: null })).toBe("awaiting_designer");
    expect(s({ category: null, tier: null, dropped: true })).toBe("dropped");
  });
});

describe("redactMoney", () => {
  it("masks amounts in model-written text", () => {
    expect(redactMoney("Caller volunteered ₹7.7 lakh and asked about 1,234 per sq ft; also 33 lakh, Rs 4321, 9 crore, 13 to 17 lakh, 777 rupees.")).toBe(
      "Caller volunteered [amount] and asked about [amount] per sq ft; also [amount], [amount], [amount], [amount], [amount].",
    );
    expect(redactMoney("3BHK, 1,150 sq ft, done by March 2027")).toBe("3BHK, 1,150 sq ft, done by March 2027");
  });
});

describe("pickMergeCandidate", () => {
  const now = new Date("2026-10-12T06:00:00Z");
  const stub = { id: "stub", fromNumber: null, startedAt: new Date("2026-10-12T05:50:00Z"), endedAt: new Date("2026-10-12T05:58:00Z"), durationSeconds: 480 };
  const tool = (id: string, created: string, o: Partial<CallRow> = {}) =>
    ({ id, callRef: `REF${id}`, vaaniCallId: null, status: "in_call", fromNumber: null, createdAt: new Date(created), ...o }) as CallRow;

  it("merges the single tool row inside the window", () => {
    expect(pickMergeCandidate(stub, [tool("a", "2026-10-12T05:53:00Z")], now)).toEqual({ kind: "merge", toolRowId: "a" });
  });
  it("ignores rows outside start − 2 min … end + 2 min", () => {
    expect(pickMergeCandidate(stub, [tool("a", "2026-10-12T05:47:00Z"), tool("b", "2026-10-12T06:01:00Z")], now)).toEqual({ kind: "none" });
    expect(pickMergeCandidate(stub, [tool("a", "2026-10-12T05:48:30Z")], now)).toEqual({ kind: "merge", toolRowId: "a" });
  });
  it("is ambiguous with two overlapping calls and no phone to tell them apart", () => {
    expect(pickMergeCandidate(stub, [tool("a", "2026-10-12T05:52:00Z"), tool("b", "2026-10-12T05:55:00Z")], now)).toEqual({ kind: "ambiguous", candidateIds: ["a", "b"] });
  });
  it("uses the phone number to break a tie and never merges a different number", () => {
    const withPhone = { ...stub, fromNumber: "+919876543210" };
    const rows = [tool("a", "2026-10-12T05:52:00Z", { fromNumber: "+919999999999" }), tool("b", "2026-10-12T05:55:00Z", { fromNumber: "+919876543210" }), tool("c", "2026-10-12T05:56:00Z")];
    expect(pickMergeCandidate(withPhone, rows, now)).toEqual({ kind: "merge", toolRowId: "b" });
    expect(pickMergeCandidate(withPhone, [rows[0]], now)).toEqual({ kind: "none" });
  });
  it("never adopts a row already linked or no longer in a call", () => {
    expect(pickMergeCandidate(stub, [tool("a", "2026-10-12T05:53:00Z", { vaaniCallId: "other" }), tool("b", "2026-10-12T05:53:00Z", { status: "booked" })], now)).toEqual({ kind: "none" });
  });
});
