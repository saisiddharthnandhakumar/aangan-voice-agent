import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { applyReview, syncToHubspot, type ReviewDeps } from "@/lib/dashboard/review";
import { drizzlePipelineRepo } from "@/lib/pipeline/repo";
import { fakeHubspot, HS_IDS } from "../pipeline/fakes";
import { addCall, testDb, type TestDb } from "./harness";

async function setup(call: Parameters<typeof addCall>[1], hs = fakeHubspot()) {
  const db = await testDb();
  const row = await addCall(db, { callerName: "Priya Sharma", fromNumber: "+919876543210", callCategory: "enquiry", startedAt: "2026-10-12T05:30:00Z", facts: { project_type: "home", locality: "Kothrud" }, ...call });
  const deps = (over: Partial<ReviewDeps> = {}): ReviewDeps => ({ db, repo: drizzlePipelineRepo(db), hubspot: { api: hs.api, ids: HS_IDS, appBaseUrl: "https://aangan.example" }, ...over });
  return { db, row, hs, deps };
}
const state = (db: TestDb, id: string) => db.select().from(schema.calls).where(eq(schema.calls.id, id)).then((r) => r[0]);
const actions = (db: TestDb, id: string) => db.select().from(schema.reviewActions).where(eq(schema.reviewActions.callId, id));
const steps = (db: TestDb, id: string) => db.select().from(schema.pipelineSteps).where(eq(schema.pipelineSteps.callId, id));

describe("No Approve: a Green or Amber lead is active from the start", () => {
  it("approve is no longer an action, and nothing changes for a lead nobody touched", async () => {
    const { db, row, deps } = await setup({ tier: "amber", status: "awaiting_designer" });
    expect(await applyReview(deps(), { callId: row.id, action: "approve" as never, role: "designer" })).toEqual({ ok: false, error: "That action is not available." });
    expect((await state(db, row.id)).reviewState).toBe("none");
  });
});

describe("Log a call-back", () => {
  it("is saved as a note starting 'Called back', with no state change and no HubSpot call; an optional detail is appended", async () => {
    const { db, row, hs, deps } = await setup({ tier: null, status: "dropped" });
    expect(await applyReview(deps(), { callId: row.id, action: "callback", role: "designer" })).toEqual({ ok: true, hubspot: "not_needed" });
    expect(await applyReview(deps(), { callId: row.id, action: "callback", role: "designer", note: "will visit Saturday" })).toEqual({ ok: true, hubspot: "not_needed" });
    expect((await actions(db, row.id)).map((a) => [a.action, a.note]).sort()).toEqual([["note", "Called back"], ["note", "Called back: will visit Saturday"]]);
    expect((await state(db, row.id)).reviewState).toBe("none");
    expect(hs.state.requests).toBe(0);
  });
});

describe("Rescue", () => {
  it("on a Red lead creates the deal and keeps the tier Red", async () => {
    const { db, row, hs, deps } = await setup({ tier: "red", status: "unqualified_verified", hubspotContactId: "c1" });
    expect(await applyReview(deps(), { callId: row.id, action: "rescue", role: "designer", note: "worth a call" })).toEqual({ ok: true, hubspot: "synced" });
    expect(await state(db, row.id)).toMatchObject({ reviewState: "rescued", tier: "red" });
    expect(hs.state.deals.size).toBe(1);
    expect((await actions(db, row.id))[0]).toMatchObject({ action: "rescue", note: "worth a call" });
  });
  it("is refused unless the lead is Red", async () => {
    const { row, deps } = await setup({ tier: "green" });
    expect(await applyReview(deps(), { callId: row.id, action: "rescue", role: "designer" })).toMatchObject({ ok: false, error: expect.stringContaining("Red") });
  });
});

describe("Cancel (stored as discard)", () => {
  it("requires a reason", async () => {
    const { db, row, deps } = await setup({ tier: "amber" });
    for (const note of [undefined, "", "  ", "ab"]) expect(await applyReview(deps(), { callId: row.id, action: "discard", role: "designer", note })).toMatchObject({ ok: false, error: expect.stringContaining("reason") });
    expect((await state(db, row.id)).reviewState).toBe("none");
    expect(await actions(db, row.id)).toHaveLength(0);
  });
  it("records the reason, moves an existing deal to Lost and never creates one", async () => {
    const withDeal = await setup({ tier: "amber", hubspotContactId: "c1", hubspotDealId: "d1" });
    withDeal.hs.state.deals.set("d1", { dealstage: "st_await" });
    await applyReview(withDeal.deps(), { callId: withDeal.row.id, action: "discard", role: "designer", note: "caller was a student" });
    expect(withDeal.hs.state.deals.get("d1")).toMatchObject({ dealstage: "st_lost" });
    expect((await actions(withDeal.db, withDeal.row.id))[0]).toMatchObject({ action: "discard", note: "caller was a student" });
    expect(await state(withDeal.db, withDeal.row.id)).toMatchObject({ reviewState: "discarded", tier: "amber" });

    const noDeal = await setup({ tier: "red", status: "unqualified_verified" });
    await applyReview(noDeal.deps(), { callId: noDeal.row.id, action: "discard", role: "designer", note: "not a fit at all" });
    expect(noDeal.hs.state.deals.size).toBe(0);
  });
  it("never deletes the call: a Red lead stays in the database", async () => {
    const { db, row, deps } = await setup({ tier: "red", status: "unqualified_verified" });
    await applyReview(deps(), { callId: row.id, action: "discard", role: "founder", note: "spam caller" });
    expect(await state(db, row.id)).toMatchObject({ id: row.id, tier: "red", reviewState: "discarded" });
  });
});

describe("Note", () => {
  it("is saved with no state change and no HubSpot call; it needs text", async () => {
    const { db, row, hs, deps } = await setup({ tier: "amber" });
    expect(await applyReview(deps(), { callId: row.id, action: "note", role: "designer", note: "left a voicemail" })).toEqual({ ok: true, hubspot: "not_needed" });
    expect(await applyReview(deps(), { callId: row.id, action: "note", role: "designer", note: "   " })).toMatchObject({ ok: false });
    expect((await state(db, row.id)).reviewState).toBe("none");
    expect(hs.state.requests).toBe(0);
    expect(await actions(db, row.id)).toHaveLength(1);
  });
});

describe("HubSpot down (AT21)", () => {
  it("the decision is kept, the failure is recorded for retry, and a retry succeeds once HubSpot is back", async () => {
    const { db, row, hs, deps } = await setup({ tier: "red", status: "unqualified_verified", hubspotContactId: "c1" }, fakeHubspot({ down: true }));
    const r = await applyReview(deps(), { callId: row.id, action: "rescue", role: "designer" });
    expect(r).toMatchObject({ ok: true, hubspot: "failed", hubspotError: expect.stringContaining("HubSpot") });
    expect(await state(db, row.id)).toMatchObject({ reviewState: "rescued" });
    expect((await steps(db, row.id))[0]).toMatchObject({ step: "hubspot_review", status: "failed", attempts: 1, lastError: expect.stringContaining("HubSpot") });

    hs.state.down = false;
    expect(await syncToHubspot(deps(), row.id)).toEqual({ ok: true, hubspot: "synced" });
    expect((await steps(db, row.id))[0]).toMatchObject({ status: "succeeded", attempts: 2, lastError: null });
    expect(hs.state.deals.size).toBe(1);
  });
  it("skips HubSpot for test calls and when it is not configured", async () => {
    const t = await setup({ tier: "red", isTest: true });
    expect(await applyReview(t.deps(), { callId: t.row.id, action: "rescue", role: "designer" })).toEqual({ ok: true, hubspot: "skipped" });
    expect(t.hs.state.requests).toBe(0);
    const n = await setup({ tier: "red" });
    expect(await applyReview(n.deps({ hubspot: null }), { callId: n.row.id, action: "rescue", role: "designer" })).toEqual({ ok: true, hubspot: "skipped" });
    expect((await state(n.db, n.row.id)).reviewState).toBe("rescued");
  });
  it("an unknown call is an error, not a crash", async () => {
    const { deps } = await setup({});
    expect(await applyReview(deps(), { callId: "00000000-0000-0000-0000-000000000000", action: "note", role: "designer", note: "x" })).toEqual({ ok: false, error: "Call not found." });
  });
});
