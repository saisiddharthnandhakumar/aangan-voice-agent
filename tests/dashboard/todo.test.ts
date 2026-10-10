import { beforeAll, describe, expect, it } from "vitest";
import { founderHeadlines, activePreset } from "@/lib/dashboard/founder-view";
import { founderMetrics } from "@/lib/dashboard/metrics";
import { activeFilterCount, calledAgo, designCallText, nextAction } from "@/lib/dashboard/present";
import { listCalls, listTodo, needYouCount, viewTabCounts } from "@/lib/dashboard/queries";
import { addAction, addBooking, addCall, testDb, type TestDb } from "./harness";

const NOW = new Date("2026-10-14T06:00:00Z"); // Wed 11:30 IST
let db: TestDb;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await testDb();
  const mk = async (key: string, v: Parameters<typeof addCall>[1]) => {
    ids[key] = (await addCall(db, { callerName: key, callCategory: "enquiry", startedAt: "2026-10-14T04:00:00Z", ...v })).id;
  };
  await mk("amber-old", { tier: "amber", priority: "normal", startedAt: "2026-10-13T04:00:00Z" });
  await mk("amber-new", { tier: "amber", priority: "normal", startedAt: "2026-10-14T05:00:00Z" });
  await mk("green-high", { tier: "green", priority: "high", status: "awaiting_designer", startedAt: "2026-10-14T05:30:00Z" });
  await mk("dropped", { tier: null, callCategory: null, status: "dropped", startedAt: "2026-10-14T05:40:00Z" });
  await mk("escalated", { tier: null, callCategory: "existing_client_complaint", status: "escalated", startedAt: "2026-10-14T03:00:00Z" });
  await mk("dropped-done", { tier: null, callCategory: null, status: "dropped", reviewState: "discarded", startedAt: "2026-10-12T05:40:00Z" });
  await mk("amber-booked", { tier: "amber", status: "booked", startedAt: "2026-10-14T02:00:00Z", calledAfterHours: true });
  await mk("today-late", { tier: "green", status: "booked", startedAt: "2026-10-13T05:00:00Z", calledAfterHours: true });
  await mk("today-early", { tier: "green", status: "booked", startedAt: "2026-10-13T06:00:00Z" });
  await mk("tomorrow", { tier: "green", status: "booked", startedAt: "2026-10-13T07:00:00Z" });
  await mk("friday", { tier: "green", status: "booked", startedAt: "2026-10-13T08:00:00Z", priceLeak: true });
  await mk("past", { tier: "green", status: "booked", startedAt: "2026-10-01T08:00:00Z" });
  await mk("red", { tier: "red", status: "unqualified_verified" });
  await mk("test", { tier: "amber", isTest: true });
  await addBooking(db, ids["amber-booked"], "2026-10-15T07:00:00Z");
  await addBooking(db, ids["today-late"], "2026-10-14T12:00:00Z");
  await addBooking(db, ids["today-early"], "2026-10-14T05:30:00Z");
  await addBooking(db, ids["tomorrow"], "2026-10-15T05:30:00Z");
  await addBooking(db, ids["friday"], "2026-10-16T09:30:00Z");
  await addBooking(db, ids["past"], "2026-10-05T09:30:00Z");
});

const names = (items: Array<{ callerName: string | null }>) => items.map((i) => i.callerName);

describe("To do groups", () => {
  it("Needs you now: high priority first, then oldest; a booked Amber lead is active, not waiting", async () => {
    const t = await listTodo(db, {}, NOW);
    expect(names(t.needsYou)).toEqual(["green-high", "amber-old", "escalated", "amber-new", "dropped"]);
    expect(t.needsYou[0].callerName).toBe("green-high");
    expect(names(t.needsYou)).not.toContain("dropped-done");
    expect(names(t.needsYou)).not.toContain("test");
    expect(names(t.needsYou)).not.toContain("red");
  });

  it("Today by time, Coming up by time, and no call in two groups", async () => {
    const t = await listTodo(db, {}, NOW);
    expect(names(t.today)).toEqual(["today-early", "today-late"]);
    expect(names(t.comingUp)).toEqual(["tomorrow", "amber-booked", "friday"]);
    expect(names(t.needsYou)).not.toContain("amber-booked");
    expect(names([...t.needsYou, ...t.today, ...t.comingUp])).not.toContain("past");
  });

  it("applies the Filter sheet filters", async () => {
    expect(names((await listTodo(db, { priority: "high" }, NOW)).needsYou)).toEqual(["green-high"]);
    const after = await listTodo(db, { afterHours: "yes" }, NOW);
    expect(names(after.needsYou)).toEqual([]);
    expect(names(after.today)).toEqual(["today-late"]);
    expect(names(after.comingUp)).toEqual(["amber-booked"]);
    expect(names((await listTodo(db, { includeTests: true }, NOW)).needsYou)).toContain("test");
  });

  it("counts what needs a designer, for the landing page", async () => {
    expect(await needYouCount(db)).toBe(5);
  });

  it("a logged call-back takes a dropped or escalated lead off Needs you now, and the row says so", async () => {
    const d = await testDb();
    const x = await addCall(d, { callerName: "x", status: "dropped", tier: null, startedAt: "2026-10-14T05:00:00Z" });
    const y = await addCall(d, { callerName: "y", status: "escalated", tier: null, startedAt: "2026-10-14T05:00:00Z" });
    expect(await needYouCount(d)).toBe(2);
    await addAction(d, x.id, "note", "2026-10-14T05:30:00Z", "Called back");
    await addAction(d, y.id, "note", "2026-10-14T05:30:00Z", "left a voicemail"); // an ordinary note is not a call-back
    expect(await needYouCount(d)).toBe(1);
    const all = (await listCalls(d, { tab: "all" })).items;
    expect(all.find((i) => i.callerName === "x")).toMatchObject({ calledBack: true });
    expect(all.find((i) => i.callerName === "y")).toMatchObject({ calledBack: false });
  });

  it("every row carries a summary, else an excerpt of the caller's own words", async () => {
    const d = await testDb();
    await addCall(d, { callerName: "with", summary: "Wants a two-bedroom refit in Baner.", startedAt: "2026-10-14T05:00:00Z" });
    await addCall(d, { callerName: "without", transcript: "AGENT: Hello\nUSER: I need my kitchen redone", startedAt: "2026-10-14T05:00:00Z" });
    await addCall(d, { callerName: "empty", startedAt: "2026-10-14T05:00:00Z" });
    const by = Object.fromEntries((await listCalls(d, { tab: "all" })).items.map((i) => [i.callerName, i]));
    expect(by.with).toMatchObject({ brief: "Wants a two-bedroom refit in Baner.", briefIsExcerpt: false });
    expect(by.without).toMatchObject({ brief: expect.stringContaining("kitchen redone"), briefIsExcerpt: true });
    expect(by.empty).toMatchObject({ brief: null });
  });

  it("counts the three tabs", async () => {
    const c = await viewTabCounts(db, {}, NOW);
    expect(c.todo).toBe(6 + 2 + 2);
    expect(c.booked).toBe(6);
    expect(c.all).toBe(13);
  });
});

describe("Booked and price-leak lists", () => {
  it("lists upcoming design calls first, soonest first, then past ones", async () => {
    const r = await listCalls(db, { tab: "booked", order: "design_call", now: NOW });
    expect(names(r.items)).toEqual(["today-late", "tomorrow", "amber-booked", "friday", "today-early", "past"]);
  });

  it("filters to price leaks only", async () => {
    expect(names((await listCalls(db, { tab: "all", priceLeak: true })).items)).toEqual(["friday"]);
  });
});

describe("plain wording", () => {
  const base = { tier: null, status: "awaiting_designer", reviewState: "none", consultAt: null } as const;
  it("says what to do next", () => {
    expect(nextAction({ ...base, tier: "amber" })).toBe("No design call yet. Call them to book one.");
    expect(nextAction({ ...base, tier: "amber", status: "booked", consultAt: NOW })).toBe("Design call booked. Read the brief.");
    expect(nextAction({ ...base, status: "dropped", calledBack: true })).toBe("Called back. Nothing more to do.");
    expect(nextAction({ ...base, tier: "amber", reviewState: "discarded" })).toBe("Cancelled. Nothing to do.");
    expect(nextAction({ ...base, tier: "green", status: "booked", consultAt: NOW })).toBe("Design call booked. Read the brief.");
    expect(nextAction({ ...base, status: "dropped" })).toBe("Call back. They hung up early.");
    expect(nextAction({ ...base, tier: "red", status: "unqualified_verified" })).toBe("Declined kindly. Nothing to do.");
  });
  it("shows design call times relative to today in IST", () => {
    expect(designCallText(new Date("2026-10-14T11:00:00Z"), NOW)).toBe("Today 4:30 pm");
    expect(designCallText(new Date("2026-10-15T05:30:00Z"), NOW)).toBe("Tomorrow 11 am");
    expect(designCallText(new Date("2026-10-16T09:30:00Z"), NOW)).toBe("Fri 3 pm");
    expect(designCallText(null, NOW)).toBe("No call yet");
    // 11 pm IST on the 14th is still "today", even though it is the 14th in UTC as well; 1 am IST on the 15th is tomorrow.
    expect(designCallText(new Date("2026-10-14T19:30:00Z"), NOW)).toBe("Tomorrow 1 am");
  });
  it("says how long ago a call was", () => {
    expect(calledAgo(new Date("2026-10-14T05:48:00Z"), NOW)).toBe("Called 12 min ago");
    expect(calledAgo(new Date("2026-10-14T01:00:00Z"), NOW)).toBe("Called 5 h ago");
  });
  it("counts active filters for the badge", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ from: "2026-10-01", to: "2026-10-05", tier: "red", priority: "high", includeTests: true })).toBe(4);
  });
});

describe("Founder's view headlines", () => {
  it("splits calls by hours, counts after-hours bookings, and derives the headline numbers", async () => {
    const d = await testDb();
    const mk = (v: Parameters<typeof addCall>[1]) => addCall(d, { callCategory: "enquiry", status: "booked", tier: "green", ...v });
    const a = await mk({ startedAt: "2026-10-13T04:00:00Z", answeredAt: "2026-10-13T04:00:04Z", calledAfterHours: false, vaaniCostInr: 6, totalCostInr: 6 });
    const b = await mk({ startedAt: "2026-10-13T16:00:00Z", answeredAt: "2026-10-13T16:00:04Z", calledAfterHours: true, vaaniCostInr: 6, totalCostInr: 6 });
    await mk({ startedAt: "2026-10-13T17:00:00Z", answeredAt: "2026-10-13T17:06:30Z", calledAfterHours: true, status: "awaiting_designer", vaaniCostInr: 6, totalCostInr: 6 });
    await mk({ startedAt: "2026-10-13T05:00:00Z", answeredAt: "2026-10-13T05:00:02Z", calledAfterHours: null, tier: "red", status: "unqualified_verified", totalCostInr: 3 });
    await addBooking(d, a.id, "2026-10-16T05:00:00Z");
    await addBooking(d, b.id, "2026-10-16T06:00:00Z");
    const m = await founderMetrics(d, { from: "2026-10-13", to: "2026-10-14" }, NOW, { staleHours: 4 });
    expect(m.calls.afterHours).toBe(2);
    expect(m.calls.afterHoursBooked).toBe(1);
    const day = m.series.callsPerDay.find((x) => x.date === "2026-10-13");
    expect(day).toMatchObject({ total: 4, afterHours: 2, working: 2 });
    expect(m.series.callsPerDay.reduce((s, x) => s + x.working + x.afterHours, 0)).toBe(m.calls.received);

    const h = founderHeadlines(m);
    expect(h.answeredFast).toEqual({ pct: 0.75, within: 3, measured: 4 });
    expect(h.afterHours).toEqual({ count: 2, shareOfAll: 0.5, booked: 1 });
    expect(h.booked.count).toBe(2);
    expect(h.pipeline.shown).toBe(false); // 3 qualified leads: below the 5 needed to show a total
    expect(h.waiting.count).toBe(0);
  });

  it("recognises the range chips", () => {
    expect(activePreset({ from: "2026-10-08", to: "2026-10-14" }, "2026-10-14")).toBe(7);
    expect(activePreset({ from: "2026-09-15", to: "2026-10-14" }, "2026-10-14")).toBe(30);
    expect(activePreset({ from: "2026-10-01", to: "2026-10-14" }, "2026-10-14")).toBe("custom");
    expect(activePreset({ from: "2026-10-08", to: "2026-10-13" }, "2026-10-14")).toBe("custom");
  });
});
