import { describe, expect, it } from "vitest";
import { isTestMode, normaliseRef, submitAssessment, submitFallback } from "@/lib/tools/service";
import { HOURS } from "../helpers";
import { deps, memoryRepo } from "./fakes";

const body = (o: Record<string, unknown> = {}) => ({
  call_category: "enquiry",
  caller_name: "Priya",
  phone: "98765 43210",
  project_type: "home",
  scope_type: "full_home",
  bhk: 3,
  size_sqft: 1400,
  locality: "Kothrud",
  completion_needed_by: "2027-03-01",
  tier: "green",
  tier_reason: "all five criteria pass",
  criteria: {
    real_project: { status: "pass", evidence: "redo the whole thing" },
    service_area: { status: "pass", evidence: "Kothrud" },
    timeline: { status: "pass", evidence: "by March, no rush" },
    budget: { status: "pass", evidence: "not mentioned" },
    decision_maker: { status: "pass", evidence: "husband agrees" },
  },
  ...o,
});

describe("T1 submit_assessment", () => {
  it("creates a call, returns a short call_id and the action", async () => {
    const m = memoryRepo();
    const r = await submitAssessment(body(), deps({ repo: m.repo }));
    expect(r.body).toMatchObject({ tier: "green", action: "offer_booking", callback_phrase: null, say_reason: null });
    expect(r.body.call_id).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]).toMatchObject({ callRef: r.body.call_id, tier: "green", status: "in_call", fromNumber: "+919876543210", callerName: "Priya" });
    expect(r.callId).toBe(m.calls[0].id);
  });

  it("updates the same call when the agent passes call_id back (re-assessment)", async () => {
    const m = memoryRepo();
    const d = deps({ repo: m.repo });
    const first = await submitAssessment(body({ tier: "red", tier_reason: "needs it in 3 weeks", completion_needed_by: "2026-10-30" }), d);
    expect(first.body).toMatchObject({ tier: "red", action: "decline" });
    const second = await submitAssessment(body({ call_id: first.body.call_id?.toLowerCase(), tier: "amber", tier_reason: "date can move, will think", timeline_move_asked: true, completion_needed_by: null }), d);
    expect(second.body.call_id).toBe(first.body.call_id);
    expect(second.body).toMatchObject({ tier: "amber", action: "offer_booking" });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]).toMatchObject({ tier: "amber", tierReasons: ["date can move, will think"] });
  });

  it("stores the agent's tier as given; the rules engine never overrides it (decision 2026-10-10)", async () => {
    const m = memoryRepo();
    // The rules engine would call this Red (Nashik); the agent said Amber, so Amber is stored.
    const r = await submitAssessment(body({ tier: "amber", locality: "Nashik", criteria: { ...body().criteria, service_area: { status: "fail", evidence: "Nashik" } } }), deps({ repo: m.repo }));
    expect(r.body).toMatchObject({ tier: "amber", action: "offer_booking", callback_phrase: null });
    expect(m.calls[0].tier).toBe("amber");
  });

  it("Red gets the decline action and Nikhil's decline line; the agent explains the reason itself", async () => {
    const r = await submitAssessment(body({ tier: "RED", tier_reason: "site in Nashik" }), deps());
    expect(r.body).toMatchObject({ tier: "red", action: "decline", say_reason: null });
    expect(r.body.callback_phrase).toMatch(/may not be the right fit/);
  });

  it("an enquiry with no tier gets a callback and a note to resubmit", async () => {
    const m = memoryRepo();
    const r = await submitAssessment(body({ tier: undefined }), deps({ repo: m.repo }));
    expect(r.body).toMatchObject({ tier: null, action: "callback" });
    expect(r.body.agent_note).toMatch(/No tier was sent/);
    expect(m.calls[0].tier).toBeNull();
  });

  it("reuses the open call from the same number when call_id is missing", async () => {
    const m = memoryRepo();
    const d = deps({ repo: m.repo });
    const a = await submitAssessment(body(), d);
    const b = await submitAssessment(body({ call_id: "{{call_id}}" }), d);
    expect(b.body.call_id).toBe(a.body.call_id);
    expect(m.calls).toHaveLength(1);
  });

  it("creates separate calls for unknown callers with no number", async () => {
    const m = memoryRepo();
    const d = deps({ repo: m.repo });
    await submitAssessment(body({ phone: null }), d);
    await submitAssessment(body({ phone: null }), d);
    expect(m.calls).toHaveLength(2);
  });

  it("marks web test calls is_test from call_mode", async () => {
    const m = memoryRepo();
    await submitAssessment(body({ call_mode: "webrtc" }), deps({ repo: m.repo }));
    expect(m.calls[0].isTest).toBe(true);
    expect(isTestMode("phone")).toBe(false);
    expect(isTestMode(null)).toBe(false);
  });

  it("stores the volunteered budget, never a figure in the reply", async () => {
    const m = memoryRepo();
    const r = await submitAssessment(body({ tier: "red", volunteered_budget_low_inr: 1, volunteered_budget_high_inr: 1.5 }), deps({ repo: m.repo }));
    expect(r.body.tier).toBe("red");
    expect(m.calls[0]).toMatchObject({ budgetLowInr: 100_000, budgetHighInr: 150_000 });
    expect(JSON.stringify(r.body)).not.toMatch(/\d{4,}|lakh|₹/);
  });

  it("a complaint escalates with no tier, even if the agent sent one (T09)", async () => {
    const r = await submitAssessment(body({ call_category: "existing_client_complaint", tier: "green" }), deps());
    expect(r.body).toMatchObject({ tier: null, action: "escalate" });
  });

  it("an empty or malformed body gets a speakable answer and creates no call", async () => {
    const m = memoryRepo();
    const r = await submitAssessment({}, deps({ repo: m.repo }));
    expect(r.body).toMatchObject({ action: "callback", call_id: null });
    expect(r.body.callback_phrase).toMatch(/designer will call you back/);
    expect(m.calls).toHaveLength(0);
  });

  it("the fail-safe promises a callback and books nothing", () => {
    expect(submitFallback(new Date("2026-10-12T05:30:00Z"), HOURS)).toMatchObject({ tier: null, action: "callback", call_id: null });
  });

  it("normalises references", () => {
    expect(normaliseRef(" ab2-cd3 ")).toBe("AB2CD3");
    expect(normaliseRef("{{call_id}}")).toBeNull();
    expect(normaliseRef(12)).toBeNull();
  });
});
