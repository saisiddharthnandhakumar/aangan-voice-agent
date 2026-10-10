import { beforeAll, describe, expect, it } from "vitest";
import { getCallDetail, listCalls, tabCounts } from "@/lib/dashboard/queries";
import { parseRange, lastNDays, eachDay, istDayBounds } from "@/lib/dashboard/range";
import { addAction, addBooking, addCall, addStep, testDb, type TestDb } from "./harness";

let db: TestDb;
const ids: Record<string, string> = {};
const names = (items: Array<{ callerName: string | null }>) => items.map((i) => i.callerName);

beforeAll(async () => {
  db = await testDb();
  const mk = async (key: string, v: Parameters<typeof addCall>[1]) => {
    ids[key] = (await addCall(db, { callerName: key, callCategory: "enquiry", ...v })).id;
  };
  await mk("green-booked", { tier: "green", status: "booked", priority: "normal", startedAt: "2026-10-12T05:00:00Z", facts: { locality: "Kothrud", project_type: "home" }, summary: "g".repeat(400), calledAfterHours: false });
  await mk("amber-booked", { tier: "amber", status: "booked", priority: "high", startedAt: "2026-10-11T05:00:00Z", calledAfterHours: true });
  await mk("amber-waiting", { tier: "amber", status: "awaiting_designer", priority: "normal", startedAt: "2026-10-13T05:00:00Z", calledAfterHours: false });
  await mk("amber-reviewed", { tier: "amber", status: "awaiting_designer", reviewState: "approved", startedAt: "2026-10-13T06:00:00Z" });
  await mk("red", { tier: "red", status: "unqualified_verified", startedAt: "2026-10-12T06:00:00Z" });
  await mk("unrated", { tier: null, callCategory: null, status: "awaiting_designer", startedAt: "2026-10-12T07:00:00Z" });
  await mk("dropped", { tier: null, callCategory: null, status: "dropped", startedAt: "2026-10-12T08:00:00Z" });
  await mk("complaint", { tier: null, callCategory: "existing_client_complaint", status: "escalated", startedAt: "2026-10-12T09:00:00Z" });
  await mk("vendor", { tier: null, callCategory: "vendor_or_sales", status: "non_enquiry", startedAt: "2026-10-12T10:00:00Z" });
  await mk("test", { tier: "green", status: "booked", isTest: true, startedAt: "2026-10-12T11:00:00Z" });
  await mk("old", { tier: "green", status: "booked", startedAt: "2026-09-01T05:00:00Z" });
  await addBooking(db, ids["green-booked"], "2026-10-15T05:00:00Z");
  await addBooking(db, ids["amber-booked"], "2026-10-16T05:00:00Z");
  await addStep(db, ids["green-booked"], "save", "succeeded");
  await addStep(db, ids["green-booked"], "hubspot_log", "failed");
  await addAction(db, ids["amber-reviewed"], "approve", "2026-10-13T07:00:00Z");
  await addAction(db, ids["amber-reviewed"], "note", "2026-10-13T08:00:00Z", "called, will visit");
  // a redial chain
  const [a] = [ids["dropped"]];
  await addCall(db, { callerName: "redial", callCategory: "enquiry", tier: "green", status: "booked", repeatOfCallId: a, startedAt: "2026-10-12T08:10:00Z" });
});

const base = { from: "2026-10-01", to: "2026-10-31" };

describe("designer tabs (PRD D2)", () => {
  it("Needs review: awaiting a designer, or a dropped or escalated call; a booked Amber lead is active, never Red, cancelled or test", async () => {
    const r = await listCalls(db, { tab: "needs_review", ...base });
    expect(names(r.items).sort()).toEqual(["amber-waiting", "complaint", "dropped", "unrated"]);
  });
  it("Booked, Unqualified but verified, Escalations, Dropped, Non-enquiries", async () => {
    expect(names((await listCalls(db, { tab: "booked", ...base })).items).sort()).toEqual(["amber-booked", "green-booked", "redial"]);
    expect(names((await listCalls(db, { tab: "unqualified", ...base })).items)).toEqual(["red"]);
    expect(names((await listCalls(db, { tab: "escalations", ...base })).items)).toEqual(["complaint"]);
    expect(names((await listCalls(db, { tab: "dropped", ...base })).items)).toEqual(["dropped"]);
    expect(names((await listCalls(db, { tab: "non_enquiries", ...base })).items)).toEqual(["vendor"]);
  });
  it("All shows every real call in range and hides test calls by default", async () => {
    const r = await listCalls(db, { tab: "all", ...base });
    expect(r.total).toBe(10);
    expect(names(r.items)).not.toContain("test");
    expect(names((await listCalls(db, { tab: "all", ...base, includeTests: true })).items)).toContain("test");
  });
  it("a Red lead is on a tab and the dashboard, never hidden: it is only ever filtered, not deleted", async () => {
    expect((await listCalls(db, { tab: "all", ...base, tier: "red" })).items.map((i) => i.callerName)).toEqual(["red"]);
  });
  it("tab badges count under the same filters", async () => {
    const c = await tabCounts(db, base);
    expect(c).toEqual({ needs_review: 4, booked: 3, unqualified: 1, escalations: 1, dropped: 1, non_enquiries: 1, all: 10 });
  });
});

describe("filters and order", () => {
  it("high priority first, then newest", async () => {
    const r = await listCalls(db, { tab: "all", ...base });
    expect(r.items[0].callerName).toBe("amber-booked"); // the only high-priority call, though it is older than most
    const rest = r.items.slice(1).map((i) => i.callTime.getTime());
    expect([...rest].sort((a, b) => b - a)).toEqual(rest);
  });
  it("filters by date range in IST, tier, priority, after-hours", async () => {
    expect(names((await listCalls(db, { tab: "all", from: "2026-10-13", to: "2026-10-13" })).items).sort()).toEqual(["amber-reviewed", "amber-waiting"]);
    expect(names((await listCalls(db, { tab: "all", ...base, tier: "amber" })).items).sort()).toEqual(["amber-booked", "amber-reviewed", "amber-waiting"]);
    expect(names((await listCalls(db, { tab: "all", ...base, tier: "none" })).items).sort()).toEqual(["complaint", "dropped", "unrated", "vendor"]);
    expect(names((await listCalls(db, { tab: "all", ...base, priority: "high" })).items)).toEqual(["amber-booked"]);
    expect(names((await listCalls(db, { tab: "all", ...base, afterHours: "yes" })).items)).toEqual(["amber-booked"]);
    expect(names((await listCalls(db, { tab: "all", ...base, afterHours: "no" })).items).sort()).toEqual(["amber-waiting", "green-booked"]);
  });
  it("paginates", async () => {
    const p1 = await listCalls(db, { tab: "all", ...base, pageSize: 4, page: 1 });
    const p3 = await listCalls(db, { tab: "all", ...base, pageSize: 4, page: 3 });
    expect([p1.items.length, p3.items.length, p1.total]).toEqual([4, 2, 10]);
  });
  it("list rows carry locality, consultation time and a short summary, and no budget or floor", async () => {
    const r = await listCalls(db, { tab: "booked", ...base });
    const g = r.items.find((i) => i.callerName === "green-booked")!;
    expect(g).toMatchObject({ locality: "Kothrud", projectType: "home", consultAt: new Date("2026-10-15T05:00:00Z") });
    expect(g.summary).toHaveLength(400);
    expect(g.brief).toHaveLength(220);
    expect(Object.keys(g).join(" ")).not.toMatch(/budget|floor/i);
  });
});

describe("call detail (PRD D3)", () => {
  it("returns the call, its booking, pipeline steps, review actions and linked calls", async () => {
    const d = await getCallDetail(db, ids["green-booked"]);
    expect(d?.booking).toMatchObject({ status: "accepted" });
    expect(d?.steps.map((s) => [s.step, s.status])).toEqual([["save", "succeeded"], ["hubspot_log", "failed"]]);
    const r = await getCallDetail(db, ids["amber-reviewed"]);
    expect(r?.actions.map((a) => a.action)).toEqual(["note", "approve"]); // newest first
    const linked = await getCallDetail(db, ids["dropped"]);
    expect(linked?.related.map((c) => c.status)).toEqual(["booked"]);
  });
  it("returns null for an unknown call", async () => {
    expect(await getCallDetail(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("IST date ranges", () => {
  it("bounds a day as +05:30 midnight to midnight", () => {
    expect(istDayBounds("2026-10-13")).toEqual({ start: new Date("2026-10-12T18:30:00Z"), end: new Date("2026-10-13T18:30:00Z") });
  });
  it("defaults to the last 30 IST days, swaps a reversed range, ignores junk, caps at a year", () => {
    const now = new Date("2026-10-14T20:00:00Z"); // already 15 Oct in IST
    expect(lastNDays(now, 30)).toEqual({ from: "2026-09-16", to: "2026-10-15" });
    expect(parseRange(undefined, undefined, now)).toEqual({ from: "2026-09-16", to: "2026-10-15" });
    expect(parseRange("2026-10-20", "2026-10-10", now)).toEqual({ from: "2026-10-10", to: "2026-10-20" });
    expect(parseRange("nonsense", "2026-02-30", now)).toEqual({ from: "2026-09-16", to: "2026-10-15" });
    expect(parseRange("2020-01-01", "2026-10-10", now).from).toBe("2025-10-10");
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});
