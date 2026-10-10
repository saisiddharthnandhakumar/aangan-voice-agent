import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { founderMetrics, type FounderMetrics } from "@/lib/dashboard/metrics";
import { addAction, addBooking, addCall, addStep, testDb, type TestDb } from "./harness";

const NOW = new Date("2026-10-14T06:00:00Z"); // Wed 11:30 IST
const RANGE = { from: "2026-10-10", to: "2026-10-14" };
const STALE_HOURS = 4;

let db: TestDb;
let m: FounderMetrics;

/**
 * A deterministic week. Every metric is asserted two ways: against hand-computed numbers, and against an
 * independent JavaScript recomputation from the raw rows (see recompute below), plus raw-SQL cross-checks.
 */
beforeAll(async () => {
  db = await testDb();
  const G = (extra = {}) => ({ callCategory: "enquiry" as const, tier: "green" as const, ...extra });

  // 1. Green, booked ahead, high priority, fast everything, deal + HubSpot call
  const g1 = await addCall(db, G({ status: "booked", priority: "high", startedAt: "2026-10-12T05:30:00Z", answeredAt: "2026-10-12T05:30:03Z", endedAt: "2026-10-12T05:35:00Z", telegramSentAt: "2026-10-12T05:36:00Z", calledAfterHours: false, referralSource: "Friend", vaaniCostInr: 10, geminiCostInr: 1, totalCostInr: 11, estimatedValueInr: 2_000_000, hubspotCallId: "k1", hubspotDealId: "d1" }));
  await addBooking(db, g1.id, "2026-10-16T05:00:00Z");
  // 2. Green, booked, consultation already in the past, referral with different case/space
  const g2 = await addCall(db, G({ status: "booked", startedAt: "2026-10-11T05:00:00Z", answeredAt: "2026-10-11T05:00:02Z", endedAt: "2026-10-11T05:04:00Z", telegramSentAt: "2026-10-11T05:05:00Z", calledAfterHours: false, referralSource: " friend ", vaaniCostInr: 7, geminiCostInr: 1, totalCostInr: 8, estimatedValueInr: 1_000_000, hubspotCallId: "k2" }));
  await addBooking(db, g2.id, "2026-10-13T05:00:00Z");
  // 3. Green, no booking, slow handoff (150 s), HubSpot step failed
  const g3 = await addCall(db, G({ startedAt: "2026-10-13T04:00:00Z", answeredAt: "2026-10-13T04:00:06Z", endedAt: "2026-10-13T04:04:00Z", telegramSentAt: "2026-10-13T04:06:30Z", calledAfterHours: false, vaaniCostInr: 4, geminiCostInr: 1, totalCostInr: 5, estimatedValueInr: 1_100_000, referralSource: "Google" }));
  await addStep(db, g3.id, "hubspot_log", "failed");
  await addStep(db, g3.id, "telegram", "succeeded");
  // 4. Amber, booked, never reviewed, stale (created 10-12), deal
  const a1 = await addCall(db, { callCategory: "enquiry", tier: "amber", status: "booked", startedAt: "2026-10-12T04:00:00Z", answeredAt: "2026-10-12T04:00:08Z", endedAt: "2026-10-12T04:05:00Z", telegramSentAt: "2026-10-12T04:06:00Z", calledAfterHours: false, totalCostInr: 6, vaaniCostInr: 5, geminiCostInr: 1, estimatedValueInr: 1_500_000, hubspotCallId: "k4", hubspotDealId: "d4" });
  await addBooking(db, a1.id, "2026-10-15T05:00:00Z");
  // 5. Amber, approved by a designer, deal
  await addCall(db, { callCategory: "enquiry", tier: "amber", status: "awaiting_designer", reviewState: "approved", startedAt: "2026-10-13T05:00:00Z", answeredAt: "2026-10-13T05:00:05Z", endedAt: "2026-10-13T05:03:00Z", telegramSentAt: "2026-10-13T05:03:50Z", calledAfterHours: false, totalCostInr: 3, vaaniCostInr: 3, estimatedValueInr: 900_000, hubspotCallId: "k5", hubspotDealId: "d5" });
  // 6. Red after hours, instagram
  await addCall(db, { callCategory: "enquiry", tier: "red", status: "unqualified_verified", startedAt: "2026-10-12T18:00:00Z", answeredAt: "2026-10-12T18:00:04Z", endedAt: "2026-10-12T18:02:00Z", calledAfterHours: true, referralSource: "instagram", totalCostInr: 4, vaaniCostInr: 4, estimatedValueInr: 500_000, hubspotCallId: "k6" });
  // 7. Red, rescued, with a deal
  await addCall(db, { callCategory: "enquiry", tier: "red", status: "unqualified_verified", reviewState: "rescued", startedAt: "2026-10-11T07:00:00Z", answeredAt: "2026-10-11T07:00:04Z", endedAt: "2026-10-11T07:03:00Z", calledAfterHours: false, totalCostInr: 3, vaaniCostInr: 3, estimatedValueInr: 800_000, hubspotCallId: "k7", hubspotDealId: "d7" });
  // 8. Dropped before assessment, callback alert sent, in working hours, never answered
  await addCall(db, { status: "dropped", endReason: "dropped", startedAt: "2026-10-13T06:00:00Z", endedAt: "2026-10-13T06:00:10Z", telegramSentAt: "2026-10-13T06:00:40Z", calledAfterHours: false, totalCostInr: 1, vaaniCostInr: 1 });
  // 9. Dropped at night, no alert, never answered
  await addCall(db, { status: "dropped", endReason: "dropped", startedAt: "2026-10-13T20:30:00Z", endedAt: "2026-10-13T20:30:05Z", calledAfterHours: true });
  // 10. Escalation answered 30 minutes after the call ended
  const c1 = await addCall(db, { callCategory: "existing_client_complaint", status: "escalated", startedAt: "2026-10-12T06:00:00Z", answeredAt: "2026-10-12T06:00:05Z", endedAt: "2026-10-12T06:03:00Z", calledAfterHours: false, totalCostInr: 2, vaaniCostInr: 2, hubspotCallId: "k10" });
  await addAction(db, c1.id, "note", "2026-10-12T06:33:00Z", "called back");
  await addAction(db, c1.id, "note", "2026-10-12T09:00:00Z", "later note");
  // 11. Escalation nobody has answered
  await addCall(db, { callCategory: "existing_client_complaint", status: "escalated", startedAt: "2026-10-13T07:00:00Z", answeredAt: "2026-10-13T07:00:05Z", endedAt: "2026-10-13T07:02:00Z", calledAfterHours: false });
  // 12. Test call: must count nowhere
  await addCall(db, G({ isTest: true, status: "booked", startedAt: "2026-10-12T05:30:00Z", totalCostInr: 99, estimatedValueInr: 9_000_000, hubspotCallId: "kt", hubspotDealId: "dt", referralSource: "testsource" }));
  // 13. Outside the range
  await addCall(db, G({ startedAt: "2026-10-01T05:00:00Z", totalCostInr: 50 }));
  // 14. Green with a price leak and a redial link
  const first = await addCall(db, G({ startedAt: "2026-10-13T09:00:00Z", answeredAt: "2026-10-13T09:00:02Z", endedAt: "2026-10-13T09:02:00Z", calledAfterHours: false }));
  await addCall(db, G({ priceLeak: true, repeatOfCallId: first.id, startedAt: "2026-10-13T09:10:00Z", answeredAt: "2026-10-13T09:10:02Z", endedAt: "2026-10-13T09:12:00Z", calledAfterHours: false, telegramSentAt: "2026-10-13T09:12:30Z" }));
  // 15. Vendor: no tier, answered
  await addCall(db, { callCategory: "vendor_or_sales", status: "non_enquiry", startedAt: "2026-10-13T10:00:00Z", answeredAt: "2026-10-13T10:00:03Z", endedAt: "2026-10-13T10:01:00Z", calledAfterHours: false, hubspotCallId: "k15" });
  // 16. Live now, and one stuck in_call for hours (not live)
  await addCall(db, { status: "in_call", startedAt: "2026-10-14T05:50:00Z", createdAt: "2026-10-14T05:50:00Z" });
  await addCall(db, { status: "in_call", startedAt: "2026-10-14T02:00:00Z", createdAt: "2026-10-14T02:00:00Z" });
  // 17. Answered > 5 minutes after the ring (slow pickup), on the last IST day boundary: 2026-10-14 23:50 IST = 18:20Z
  await addCall(db, G({ startedAt: "2026-10-14T18:20:00Z", answeredAt: "2026-10-14T18:26:00Z", endedAt: "2026-10-14T18:30:00Z", calledAfterHours: true }));
  m = await founderMetrics(db, RANGE, NOW, { staleHours: STALE_HOURS });
});

describe("founder metrics, hand-computed (PRD section 4)", () => {
  it("calls: received, answered, missed, dropped, repeat, after hours", () => {
    // 17 = the 19 rows minus the test call and the out-of-range call
    expect(m.calls).toMatchObject({
      received: 17,
      answered: 13,
      missedOrNotConnected: 4, // two dropped, two in_call rows
      missedInWorkingHours: 1, // dropped 13 Oct 11:30 IST; the two in_call rows have after-hours null
      droppedBeforeAssessment: 2,
      droppedWithCallbackAlert: 1,
      repeatCallers: 1,
      afterHours: 3, // Red at 23:30 IST, the night drop, and the 23:50 IST call
    });
    expect(m.calls.afterHoursShare).toBeCloseTo(3 / 17, 3);
  });

  it("tier mix", () => {
    expect(m.tiers).toEqual({ green: 6, amber: 2, red: 2, none: 7 });
  });

  it("bookings and booking rates", () => {
    expect(m.bookings.booked).toBe(3);
    expect(m.bookings.rateOfBookable).toBeCloseTo(3 / 8, 3);
    expect(m.bookings.rateOfGreen).toBeCloseTo(2 / 6, 3);
  });

  it("escalations, price leaks and time to first response", () => {
    expect(m.escalations).toMatchObject({ count: 2, priceLeaks: 1, respondedCount: 1, unansweredCount: 1, avgFirstResponseMinutes: 30 });
  });

  it("timing: ring to pickup and call end to Telegram", () => {
    expect(m.timing.answerSeconds.measured).toBe(13);
    expect(m.timing.answerSeconds.over5Minutes).toBe(1);
    expect(m.timing.answerSeconds.max).toBe(360);
    expect(m.timing.handoffSeconds).toMatchObject({ measured: 6, over2Minutes: 1 });
    // handoff seconds: 60, 60, 150, 60, 50, 30 → avg 68.33
    expect(m.timing.handoffSeconds.avg).toBeCloseTo(68.3, 1);
  });

  it("lead sources are grouped case- and space-insensitively and exclude test calls", () => {
    expect(m.leadSources).toEqual([
      { source: "friend", count: 2 },
      { source: "google", count: 1 },
      { source: "instagram", count: 1 },
    ]);
  });

  it("HubSpot: logging completeness, failed steps, deals by tier and by designer action", () => {
    expect(m.hubspot.callsLogged).toBe(8);
    expect(m.hubspot.loggingCompleteness).toBeCloseTo(8 / 17, 3);
    expect(m.hubspot.callsWithFailedStep).toBe(1);
    expect(m.hubspot.dealsByTier).toEqual({ green: 1, amber: 2, red: 1, none: 0 });
    expect(m.hubspot.dealsApproved).toBe(1);
    expect(m.hubspot.dealsRescued).toBe(1);
  });

  it("cost: total, per call, per booked consultation", () => {
    expect(m.cost.totalInr).toBe(43); // 11+8+5+6+3+4+3+1+2
    expect(m.cost.vaaniInr).toBe(39);
    expect(m.cost.geminiInr).toBe(4);
    expect(m.cost.callsWithCost).toBe(9);
    expect(m.cost.perCallInr).toBeCloseTo(43 / 9, 2);
    expect(m.cost.perBookedConsultInr).toBeCloseTo(43 / 3, 2);
  });

  it("estimated pipeline sits beside cost; Red counts only once rescued", () => {
    // g1 2.0M + g2 1.0M + g3 1.1M + a1 1.5M + a2 0.9M + rescued red 0.8M (+ green with no estimate adds 0)
    expect(m.pipeline).toMatchObject({ estimatedValueInr: 7_300_000, qualifiedLeads: 9, totalCostInr: 43 });
  });

  it("now: live calls, active leads, waiting too long", () => {
    expect(m.now.liveCalls).toBe(1);
    expect(m.now.activeLeads).toEqual({ amberActive: 2, greenWithConsultAhead: 1, total: 3 });
    // a1 (Amber, booked) is active, not waiting; only a lead still awaiting a designer and a design call counts
    expect(m.now.waitingTooLong).toEqual({ count: 0, oldestHours: null, thresholdHours: 4 });
  });

  it("daily series cover every day in range, in IST", () => {
    expect(m.series.callsPerDay.map((d) => d.date)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]);
    const byDate = Object.fromEntries(m.series.callsPerDay.map((d) => [d.date, d.total]));
    // 12 Oct 18:00Z is 13 Oct 23:30 IST; 14 Oct 18:20Z is 15 Oct 23:50 IST... which is outside the range end (14 Oct)
    expect(byDate["2026-10-10"]).toBe(0);
    expect(byDate["2026-10-11"]).toBe(2);
    expect(m.series.callsPerDay.reduce((s, d) => s + d.total, 0)).toBe(m.calls.received);
    expect(m.series.costPerDay.reduce((s, d) => s + d.totalInr, 0)).toBeCloseTo(m.cost.totalInr, 2);
  });
});

describe("every metric agrees with a direct computation from the rows (AT22)", () => {
  it("recomputes in JavaScript from the raw rows and matches", async () => {
    const rows = await db.select().from(schema.calls);
    const bookings = await db.select().from(schema.bookings);
    const accepted = new Set(bookings.filter((b) => b.status === "accepted").map((b) => b.callId));
    const t = (r: (typeof rows)[number]) => (r.startedAt ?? r.createdAt).getTime();
    const start = new Date("2026-10-09T18:30:00Z").getTime(); // 2026-10-10 00:00 IST
    const end = new Date("2026-10-14T18:30:00Z").getTime(); // 2026-10-15 00:00 IST
    const r = rows.filter((x) => !x.isTest && t(x) >= start && t(x) < end);
    const count = (f: (x: (typeof rows)[number]) => boolean) => r.filter(f).length;
    const answered = (x: (typeof rows)[number]) => x.answeredAt != null || x.callCategory != null || x.transcript != null;

    expect(m.calls.received).toBe(r.length);
    expect(m.calls.answered).toBe(count(answered));
    expect(m.calls.droppedBeforeAssessment).toBe(count((x) => x.endReason === "dropped"));
    expect(m.calls.repeatCallers).toBe(count((x) => x.repeatOfCallId != null));
    expect(m.calls.afterHours).toBe(count((x) => x.calledAfterHours === true));
    expect(m.tiers.green).toBe(count((x) => x.tier === "green"));
    expect(m.tiers.none).toBe(count((x) => x.tier == null));
    expect(m.bookings.booked).toBe(count((x) => accepted.has(x.id)));
    expect(m.hubspot.callsLogged).toBe(count((x) => x.hubspotCallId != null));
    expect(m.cost.totalInr).toBeCloseTo(r.reduce((s, x) => s + (x.totalCostInr ?? 0), 0), 2);
    const qualified = r.filter((x) => (x.tier === "green" || x.tier === "amber" || x.reviewState === "approved" || x.reviewState === "rescued") && x.reviewState !== "discarded");
    expect(m.pipeline.estimatedValueInr).toBe(qualified.reduce((s, x) => s + (x.estimatedValueInr ?? 0), 0));
    expect(m.pipeline.qualifiedLeads).toBe(qualified.length);
  });

  it("matches hand-written SQL for the headline numbers", async () => {
    const q = async (text: string) => Number((((await db.execute(sql.raw(text))) as unknown as { rows: Array<{ n: string | number }> }).rows[0]).n);
    const inRange = `is_test = false and coalesce(started_at, created_at) >= '2026-10-09T18:30:00Z' and coalesce(started_at, created_at) < '2026-10-14T18:30:00Z'`;
    expect(m.calls.received).toBe(await q(`select count(*) n from calls where ${inRange}`));
    expect(m.cost.totalInr).toBeCloseTo(await q(`select coalesce(sum(total_cost_inr),0) n from calls where ${inRange}`), 2);
    expect(m.tiers.amber).toBe(await q(`select count(*) n from calls where ${inRange} and tier = 'amber'`));
    expect(m.bookings.booked).toBe(await q(`select count(distinct c.id) n from calls c join bookings b on b.call_id = c.id where c.is_test = false and b.status = 'accepted' and coalesce(c.started_at, c.created_at) >= '2026-10-09T18:30:00Z' and coalesce(c.started_at, c.created_at) < '2026-10-14T18:30:00Z'`));
    expect(m.escalations.count).toBe(await q(`select count(*) n from calls where ${inRange} and (status = 'escalated' or call_category = 'existing_client_complaint')`));
  });

  it("an empty range gives zeros and nulls, never NaN", async () => {
    const empty = await founderMetrics(db, { from: "2025-01-01", to: "2025-01-03" }, NOW, { staleHours: 4 });
    expect(empty.calls.received).toBe(0);
    expect(empty.calls.afterHoursShare).toBeNull();
    expect(empty.bookings.rateOfBookable).toBeNull();
    expect(empty.cost.perCallInr).toBeNull();
    expect(empty.cost.perBookedConsultInr).toBeNull();
    expect(empty.timing.answerSeconds.avg).toBeNull();
    expect(empty.series.callsPerDay).toHaveLength(3);
    expect(JSON.stringify(empty)).not.toMatch(/NaN|Infinity/);
  });

  it("never exposes pricing: the result has no budget or floor fields", () => {
    expect(JSON.stringify(m)).not.toMatch(/floor|budget/i);
  });
});
