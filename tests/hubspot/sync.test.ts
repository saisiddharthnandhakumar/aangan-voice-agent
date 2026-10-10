import { describe, expect, it } from "vitest";
import { callNote, contactProperties, dealName, wantsDeal } from "@/lib/hubspot/mapping";
import { syncReviewDecision } from "@/lib/hubspot/sync";
import { runPipeline } from "@/lib/pipeline/run";
import type { CallRow } from "@/lib/tools/repo";
import { fakeHubspot, fakeTelegram, HS_IDS, memoryPipeline, pipelineDeps, vaaniEvents } from "../pipeline/fakes";
import { assessment, fullCall, post, START, TOOL_TIME } from "../pipeline/helpers";
import { submitAssessment } from "@/lib/tools/service";
import { deps as toolDeps } from "../tools/fakes";

const setup = (hsOpts: Parameters<typeof fakeHubspot>[0] = {}) => {
  const m = memoryPipeline();
  const hs = fakeHubspot(hsOpts);
  const d = pipelineDeps({ repo: m.repo, hubspot: hs.wiring, telegram: fakeTelegram().api });
  return { m, hs, d };
};
const step = (m: ReturnType<typeof memoryPipeline>, name: string) => m.steps.find((s) => s.step === name);
const ctxFor = (m: ReturnType<typeof memoryPipeline>, hs: ReturnType<typeof fakeHubspot>) => ({ api: hs.api, ids: HS_IDS, repo: m.repo, appBaseUrl: "https://aangan.example" });

describe("a Green call: contact, call record and deal (AT1)", () => {
  it("creates a contact with the +91 number, a call record and a deal at the right stage", async () => {
    const { m, hs, d } = setup();
    const call = await fullCall(m, d, "g1");
    expect(hs.state.contacts.size).toBe(1);
    expect([...hs.state.contacts.values()][0]).toMatchObject({
      firstname: "Priya",
      lastname: "Sharma",
      phone: "+919876543210",
      aangan_tier: "green",
      aangan_status: "awaiting_designer",
      aangan_priority: "normal",
      aangan_locality: "Kothrud",
      aangan_call_count: 1,
      aangan_dashboard_url: expect.stringContaining("/dashboard/calls/"),
    });
    expect(hs.state.calls.size).toBe(1);
    const rec = [...hs.state.calls.values()][0];
    expect(rec).toMatchObject({ hs_call_direction: "INBOUND", hs_call_status: "COMPLETED", hs_call_duration: "360000", hs_call_from_number: "+919876543210" });
    expect(hs.state.deals.size).toBe(1);
    expect([...hs.state.deals.values()][0]).toMatchObject({ dealname: "Priya Sharma, home, Kothrud", dealstage: "st_await", pipeline: "default" });
    expect(call).toMatchObject({ hubspotContactId: expect.any(String), hubspotCallId: expect.any(String), hubspotDealId: expect.any(String) });
    expect(hs.state.associations).toEqual(expect.arrayContaining([expect.stringMatching(/^deals:d\d+->contacts:c1$/), expect.stringMatching(/^calls:k\d+->deals:d\d+$/)]));
  });

  it("a booked call puts the deal in the booked stage and sets the consultation time", async () => {
    const { m, hs, d } = setup();
    const sub = await submitAssessment(assessment(), toolDeps({ repo: m.tools.repo, now: TOOL_TIME }));
    await m.tools.repo.claimBooking({ callId: sub.callId as string, consultType: "call", startAt: new Date("2026-10-13T10:00:00Z"), eventTypeId: 222, attendeeEmail: "x@example.com", status: "accepted" });
    for (const e of Object.values(vaaniEvents("g-booked", { start: START, seconds: 300 }))) await post(e, d);
    expect([...hs.state.deals.values()][0]).toMatchObject({ dealstage: "st_booked" });
    expect([...hs.state.contacts.values()][0]).toMatchObject({ aangan_status: "booked", aangan_consult_at: "2026-10-13T10:00:00.000Z" });
  });
});

describe("Amber and Red (user decision 2026-10-10; AT2)", () => {
  it("Amber gets a deal automatically and the tier reads Amber", async () => {
    const { m, hs, d } = setup();
    await fullCall(m, d, "a1", { tier: "amber", tier_reason: "parents decide" });
    expect(hs.state.deals.size).toBe(1);
    expect([...hs.state.contacts.values()][0]).toMatchObject({ aangan_tier: "amber" });
    expect([...hs.state.calls.values()][0].hs_call_title).toContain("Amber");
  });

  it("Red gets a contact and a call record with status Unqualified verified, and no deal", async () => {
    const { m, hs, d } = setup();
    await fullCall(m, d, "r1", { tier: "red", tier_reason: "site in Nashik", locality: "Nashik" });
    expect(hs.state.contacts.size).toBe(1);
    expect(hs.state.calls.size).toBe(1);
    expect(hs.state.deals.size).toBe(0);
    expect([...hs.state.contacts.values()][0]).toMatchObject({ aangan_status: "unqualified_verified", aangan_tier: "red" });
    expect(step(m, "hubspot_deal")).toMatchObject({ status: "skipped", lastError: "no_deal_for_this_call" });
    expect([...hs.state.calls.values()][0].hs_call_body).toContain("Tier: Red");
  });

  it("the call record holds the summary, criteria and a dashboard link, but no budget words or figures", async () => {
    const { m, hs, d } = setup();
    await fullCall(m, d, "n1", { budget_status: "pass", budget_evidence: "I can spend 15 lakh", volunteered_budget_low_inr: 1500000, volunteered_budget_high_inr: 1500000, real_project_evidence: "redo the whole thing" });
    const body = String([...hs.state.calls.values()][0].hs_call_body);
    expect(body).toContain("Summary:");
    expect(body).toContain('Real project: pass: "redo the whole thing"');
    expect(body).toContain("Budget: pass");
    expect(body).toContain("/dashboard/calls/");
    expect(body).not.toMatch(/lakh|₹|15,?00,?000/);
    expect(JSON.stringify([...hs.state.contacts.values()])).not.toMatch(/1500000|lakh/);
  });
});

describe("every category is logged (AT18)", () => {
  it("a vendor, a wrong number and a dropped call each reach HubSpot with the right status", async () => {
    const { m, hs, d } = setup();
    await fullCall(m, d, "v1", { call_category: "vendor_or_sales", tier: undefined, phone: "98000 00001" });
    await fullCall(m, d, "w1", { call_category: "wrong_number", tier: undefined, phone: "98000 00002" });
    const first = vaaniEvents("x1", { start: START, seconds: 9, phone: "+919800000003", transcript: "[10:00:01] AGENT: Hello." });
    for (const e of [first.started, first.ended, first.post]) await post(e, d);
    const statuses = [...hs.state.contacts.values()].map((c) => c.aangan_status);
    expect(statuses).toEqual(["not_an_enquiry", "not_an_enquiry", "dropped"]);
    expect(hs.state.calls.size).toBe(3);
    expect(hs.state.deals.size).toBe(0);
    expect([...hs.state.calls.values()][1].hs_call_disposition).toBe("17b47fee-58de-441e-a44c-c6300d46f273"); // wrong number
  });
});

describe("one contact, one deal, no duplicates (AT9, AT15, AT20)", () => {
  it("a duplicate webhook makes one contact, one call record and one deal (AT9)", async () => {
    const { m, hs, d } = setup();
    await fullCall(m, d, "dup");
    const ev = vaaniEvents("dup", { start: START, seconds: 360 });
    await post(ev.post, d);
    await post(ev.ended, d);
    expect([hs.state.contacts.size, hs.state.calls.size, hs.state.deals.size]).toEqual([1, 1, 1]);
  });

  it("re-running the HubSpot steps does not create anything again", async () => {
    const { m, hs, d } = setup();
    const call = await fullCall(m, d, "rerun");
    await runPipeline(call.id, d, { from: "hubspot_log" });
    await runPipeline(call.id, d, { from: "hubspot_log" });
    expect([hs.state.contacts.size, hs.state.calls.size, hs.state.deals.size]).toEqual([1, 1, 1]);
  });

  it("a redial shares the contact and the deal but gets its own call record (AT15)", async () => {
    const { m, hs, d } = setup();
    const first = vaaniEvents("rd-first", { start: START, seconds: 10, phone: "+919876543210", transcript: "[10:00:01] AGENT: Hello." });
    for (const e of [first.started, first.ended, first.post]) await post(e, d);
    const later = new Date(START.getTime() + 140_000);
    await submitAssessment(assessment(), toolDeps({ repo: m.tools.repo, now: () => new Date(later.getTime() + 60_000) }));
    const second = vaaniEvents("rd-second", { start: later, seconds: 300, phone: "+919876543210" });
    for (const e of [second.started, second.ended, second.post]) await post(e, d);
    expect(hs.state.contacts.size).toBe(1);
    expect(hs.state.calls.size).toBe(2);
    expect(hs.state.deals.size).toBe(1);
    expect([...hs.state.contacts.values()][0]).toMatchObject({ aangan_call_count: 2, aangan_tier: "green" });
  });

  it("a returning caller from an earlier day reuses the contact found in our own database", async () => {
    const { m, hs, d } = setup();
    await fullCall(m, d, "day1", {}, { start: new Date("2026-10-10T05:28:00Z") });
    await fullCall(m, d, "day3", {}, { start: new Date("2026-10-13T05:28:00Z") });
    expect(hs.state.contacts.size).toBe(1);
    expect(hs.state.calls.size).toBe(2);
    expect(hs.state.deals.size).toBe(1);
  });

  it("finds a contact that already exists in HubSpot by phone, instead of creating one", async () => {
    const { m, hs, d } = setup({ searchHit: "existing-7" });
    const call = await fullCall(m, d, "found");
    expect(call.hubspotContactId).toBe("existing-7");
    expect(hs.state.contacts.get("existing-7")).toMatchObject({ aangan_tier: "green" });
    expect([...hs.state.contacts.keys()]).toEqual(["existing-7"]);
  });

  it("an unknown caller gets an Unknown caller contact that is never merged (AT20)", async () => {
    const { hs, d } = setup();
    const a = vaaniEvents("u1", { start: START, seconds: 120 });
    const b = vaaniEvents("u2", { start: new Date(START.getTime() + 3_600_000), seconds: 120 });
    for (const e of [a.started, a.ended, a.post, b.started, b.ended, b.post]) await post(e, d);
    const contacts = [...hs.state.contacts.values()];
    expect(contacts).toHaveLength(2);
    expect(contacts.every((c) => c.firstname === "Unknown caller" && !("phone" in c))).toBe(true);
    expect(new Set(contacts.map((c) => c.lastname)).size).toBe(2);
  });
});

describe("test calls and missing config", () => {
  it("test calls never reach HubSpot (AT11)", async () => {
    const { m, hs, d } = setup();
    await fullCall(m, d, "t1", { call_mode: "webrtc" });
    expect(hs.state.requests).toBe(0);
  });
  it("without a token the steps are skipped, not failed", async () => {
    const m = memoryPipeline();
    await fullCall(m, pipelineDeps({ repo: m.repo }), "nocfg");
    expect(step(m, "hubspot_log")).toMatchObject({ status: "skipped", lastError: "missing_config" });
  });
  it("a deal needs the stage IDs: without them the step fails clearly and succeeds once they are set", async () => {
    const m = memoryPipeline();
    const hs = fakeHubspot();
    const noStages = { api: hs.api, ids: { ...HS_IDS, stageBooked: null, stageAwaiting: null } };
    const call = await fullCall(m, pipelineDeps({ repo: m.repo, hubspot: noStages }), "nostage");
    expect(step(m, "hubspot_deal")).toMatchObject({ status: "failed", lastError: expect.stringContaining("hubspot:setup") });
    expect(hs.state.deals.size).toBe(0);
    await runPipeline(call.id, pipelineDeps({ repo: m.repo, hubspot: hs.wiring }), { only: "hubspot_deal" });
    expect(hs.state.deals.size).toBe(1);
  });
  it("falls back to labelling the deal name when HubSpot rejects the description property", async () => {
    const { m, hs, d } = setup({ rejectDescription: true });
    await fullCall(m, d, "nodesc");
    expect([...hs.state.deals.values()][0].dealname).toBe("Priya Sharma, home, Kothrud (estimate)");
  });
});

describe("designer decisions synced to HubSpot (AT19)", () => {
  it("Approve on an unrated lead creates the deal and sets status Approved", async () => {
    const { m, hs, d } = setup();
    const call = await fullCall(m, d, "ap1", { call_category: "enquiry", tier: undefined });
    expect(hs.state.deals.size).toBe(0);
    call.reviewState = "approved";
    const r = await syncReviewDecision(call.id, ctxFor(m, hs));
    expect(r.deal).toBe("created");
    expect(hs.state.deals.size).toBe(1);
    expect([...hs.state.contacts.values()][0]).toMatchObject({ aangan_status: "approved" });
  });

  it("Rescue on a Red lead creates the deal; the tier stays Red", async () => {
    const { m, hs, d } = setup();
    const call = await fullCall(m, d, "rs1", { tier: "red", tier_reason: "budget" });
    expect(hs.state.deals.size).toBe(0);
    call.reviewState = "rescued";
    await syncReviewDecision(call.id, ctxFor(m, hs));
    expect(hs.state.deals.size).toBe(1);
    expect([...hs.state.contacts.values()][0]).toMatchObject({ aangan_status: "rescued", aangan_tier: "red" });
  });

  it("Discard moves the deal to Lost and never creates one", async () => {
    const { m, hs, d } = setup();
    const amber = await fullCall(m, d, "ds1", { tier: "amber", tier_reason: "x" });
    amber.reviewState = "discarded";
    await syncReviewDecision(amber.id, ctxFor(m, hs));
    expect([...hs.state.deals.values()][0]).toMatchObject({ dealstage: "st_lost" });
    expect([...hs.state.contacts.values()][0]).toMatchObject({ aangan_status: "discarded" });

    const red = await fullCall(m, d, "ds2", { tier: "red", tier_reason: "x", phone: "98222 33344" });
    red.reviewState = "discarded";
    await syncReviewDecision(red.id, ctxFor(m, hs));
    expect(hs.state.deals.size).toBe(1);
  });

  it("is a no-op for test calls", async () => {
    const { m, hs, d } = setup();
    const call = await fullCall(m, d, "tt", { call_mode: "webrtc" });
    call.reviewState = "approved";
    expect(await syncReviewDecision(call.id, ctxFor(m, hs))).toEqual({ deal: "none" });
    expect(hs.state.requests).toBe(0);
  });
});

describe("mapping rules", () => {
  const base = { isTest: false, callCategory: "enquiry", tier: "green", reviewState: "none" } as const;
  it("deal rules", () => {
    expect(wantsDeal(base)).toBe(true);
    expect(wantsDeal({ ...base, tier: "amber" })).toBe(true);
    expect(wantsDeal({ ...base, tier: "red" })).toBe(false);
    expect(wantsDeal({ ...base, tier: "red", reviewState: "rescued" })).toBe(true);
    expect(wantsDeal({ ...base, tier: null, reviewState: "approved" })).toBe(true);
    expect(wantsDeal({ ...base, reviewState: "discarded" })).toBe(false);
    expect(wantsDeal({ ...base, isTest: true })).toBe(false);
    expect(wantsDeal({ ...base, callCategory: "wrong_number", tier: null })).toBe(false);
  });
  it("deal names follow the PRD pattern", () => {
    expect(dealName({ callerName: "Priya", facts: { project_type: "home", locality: "Kothrud" } } as unknown as CallRow)).toBe("Priya, home, Kothrud");
    expect(dealName({ callerName: null, facts: { project_type: "other" } } as unknown as CallRow)).toBe("Unknown caller");
  });
  it("only the 8 Free-plan properties are written by default", () => {
    const props = contactProperties({ id: "x", status: "booked", reviewState: "none", tier: "amber", priority: "high", createdAt: new Date(), startedAt: null, facts: { locality: "Baner", project_type: "home" }, summary: "s", flags: [] } as unknown as CallRow, null, { callCount: 3 }, "https://a.example");
    expect(Object.keys(props).sort()).toEqual(["aangan_call_count", "aangan_dashboard_url", "aangan_last_call_at", "aangan_locality", "aangan_priority", "aangan_status", "aangan_tier"]);
    expect(props).toMatchObject({ aangan_tier: "amber", aangan_priority: "high", aangan_call_count: 3 });
  });
  it("redacts money in notes", () => {
    const note = callNote({ id: "x", status: "booked", reviewState: "none", tier: "green", flags: [], summary: "Caller has ₹12 lakh and asked about 1,234 per sq ft", facts: {} } as unknown as CallRow, null, undefined);
    expect(note).not.toMatch(/lakh|₹|1,234/);
  });
});
