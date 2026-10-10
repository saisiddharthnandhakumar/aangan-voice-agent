import { and, eq, sql } from "drizzle-orm";
import { calls } from "@/db/schema";
import { callIdRef, callTime } from "./queries";
import { eachDay, istDayBounds, tsParam } from "./range";
import type { AnyDb, Range } from "./types";

/**
 * Founder metrics (PRD section 4, D4). Every number below is one plain SQL aggregate over `calls`
 * (and `bookings`, `pipeline_steps`, `review_actions` where named), so it can be checked by hand with the
 * query written next to it; docs/METRICS.md lists the same definitions. Test calls are always excluded.
 * No pricing figure is read: costs are what the platforms charged us, values are labelled estimates.
 *
 * "Range" metrics count calls whose call time (Vaani start, else first seen) falls in the IST date
 * range. "Now" metrics (live calls, active leads, waiting too long) describe the current state and
 * ignore the range.
 */

export interface FounderMetrics {
  range: Range;
  generatedAt: string;
  now: {
    liveCalls: number;
    activeLeads: { amberAwaitingReview: number; greenWithConsultAhead: number; total: number };
    waitingTooLong: { count: number; oldestHours: number | null; thresholdHours: number };
  };
  calls: {
    received: number;
    answered: number;
    /** Never connected or hung up before anyone spoke: seen by Vaani only (calls that never reached Vaani are invisible). */
    missedOrNotConnected: number;
    missedInWorkingHours: number;
    droppedBeforeAssessment: number;
    droppedWithCallbackAlert: number;
    repeatCallers: number;
    afterHours: number;
    afterHoursShare: number | null;
  };
  tiers: { green: number; amber: number; red: number; none: number };
  bookings: { booked: number; rateOfBookable: number | null; rateOfGreen: number | null };
  escalations: { count: number; priceLeaks: number; respondedCount: number; avgFirstResponseMinutes: number | null; unansweredCount: number };
  timing: {
    answerSeconds: { avg: number | null; p95: number | null; max: number | null; over5Minutes: number; measured: number };
    handoffSeconds: { avg: number | null; p95: number | null; over2Minutes: number; measured: number };
  };
  leadSources: Array<{ source: string; count: number }>;
  hubspot: {
    callsLogged: number;
    loggingCompleteness: number | null;
    callsWithFailedStep: number;
    dealsByTier: { green: number; amber: number; red: number; none: number };
    dealsApproved: number;
    dealsRescued: number;
  };
  cost: { totalInr: number; vaaniInr: number; geminiInr: number; perCallInr: number | null; perBookedConsultInr: number | null; callsWithCost: number };
  pipeline: { estimatedValueInr: number; qualifiedLeads: number; totalCostInr: number; valuePerRupeeOfCost: number | null };
  series: {
    callsPerDay: Array<{ date: string; green: number; amber: number; red: number; none: number; total: number }>;
    costPerDay: Array<{ date: string; vaaniInr: number; geminiInr: number; totalInr: number }>;
  };
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const nul = (v: unknown): number | null => (v == null ? null : Number(v));
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const round = (v: number | null, d = 2): number | null => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** An accepted booking exists for the call. */
const hasBooking = sql`exists (select 1 from bookings b where b.call_id = ${callIdRef} and b.status = 'accepted')`;
/** The caller actually spoke with the agent. */
const answered = sql`(${calls.answeredAt} is not null or ${calls.callCategory} is not null or ${calls.transcript} is not null)`;

export async function founderMetrics(db: AnyDb, range: Range, now: Date, o: { staleHours: number }): Promise<FounderMetrics> {
  const inRange = and(
    eq(calls.isTest, false),
    sql`${callTime} >= ${tsParam(istDayBounds(range.from).start)}`,
    sql`${callTime} < ${tsParam(istDayBounds(range.to).end)}`,
  );
  const real = eq(calls.isTest, false);
  const nowIso = now.toISOString();
  const nowTs = tsParam(now);
  const staleTs = tsParam(new Date(now.getTime() - o.staleHours * 3_600_000));

  // ---- range: calls, tiers, bookings, escalations, hubspot, cost, pipeline (one pass over calls)
  const [r] = await db
    .select({
      received: sql<number>`count(*)::int`,
      answered: sql<number>`(count(*) filter (where ${answered}))::int`,
      missedWorking: sql<number>`(count(*) filter (where not ${answered} and ${calls.calledAfterHours} = false))::int`,
      dropped: sql<number>`(count(*) filter (where ${calls.endReason} = 'dropped'))::int`,
      droppedAlerted: sql<number>`(count(*) filter (where ${calls.endReason} = 'dropped' and ${calls.telegramSentAt} is not null))::int`,
      repeat: sql<number>`(count(*) filter (where ${calls.repeatOfCallId} is not null))::int`,
      afterHours: sql<number>`(count(*) filter (where ${calls.calledAfterHours} = true))::int`,
      green: sql<number>`(count(*) filter (where ${calls.tier} = 'green'))::int`,
      amber: sql<number>`(count(*) filter (where ${calls.tier} = 'amber'))::int`,
      red: sql<number>`(count(*) filter (where ${calls.tier} = 'red'))::int`,
      none: sql<number>`(count(*) filter (where ${calls.tier} is null))::int`,
      booked: sql<number>`(count(*) filter (where ${hasBooking}))::int`,
      bookedGreen: sql<number>`(count(*) filter (where ${calls.tier} = 'green' and ${hasBooking}))::int`,
      bookedAmber: sql<number>`(count(*) filter (where ${calls.tier} = 'amber' and ${hasBooking}))::int`,
      escalations: sql<number>`(count(*) filter (where ${calls.status} = 'escalated' or ${calls.callCategory} = 'existing_client_complaint'))::int`,
      leaks: sql<number>`(count(*) filter (where ${calls.priceLeak}))::int`,
      hsLogged: sql<number>`(count(*) filter (where ${calls.hubspotCallId} is not null))::int`,
      hsFailed: sql<number>`(count(*) filter (where exists (select 1 from pipeline_steps s where s.call_id = ${callIdRef} and s.status = 'failed' and s.step in ('hubspot_log','hubspot_deal'))))::int`,
      dealGreen: sql<number>`(count(*) filter (where ${calls.hubspotDealId} is not null and ${calls.tier} = 'green'))::int`,
      dealAmber: sql<number>`(count(*) filter (where ${calls.hubspotDealId} is not null and ${calls.tier} = 'amber'))::int`,
      dealRed: sql<number>`(count(*) filter (where ${calls.hubspotDealId} is not null and ${calls.tier} = 'red'))::int`,
      dealNone: sql<number>`(count(*) filter (where ${calls.hubspotDealId} is not null and ${calls.tier} is null))::int`,
      dealApproved: sql<number>`(count(*) filter (where ${calls.hubspotDealId} is not null and ${calls.reviewState} = 'approved'))::int`,
      dealRescued: sql<number>`(count(*) filter (where ${calls.hubspotDealId} is not null and ${calls.reviewState} = 'rescued'))::int`,
      costTotal: sql<number>`coalesce(sum(${calls.totalCostInr}), 0)::float8`,
      costVaani: sql<number>`coalesce(sum(${calls.vaaniCostInr}), 0)::float8`,
      costGemini: sql<number>`coalesce(sum(${calls.geminiCostInr}), 0)::float8`,
      withCost: sql<number>`(count(*) filter (where ${calls.totalCostInr} is not null))::int`,
      qualified: sql<number>`(count(*) filter (where (${calls.tier} in ('green','amber') or ${calls.reviewState} in ('approved','rescued')) and ${calls.reviewState} <> 'discarded'))::int`,
      estimate: sql<number>`coalesce(sum(${calls.estimatedValueInr}) filter (where (${calls.tier} in ('green','amber') or ${calls.reviewState} in ('approved','rescued')) and ${calls.reviewState} <> 'discarded'), 0)::float8`,
    })
    .from(calls)
    .where(inRange);

  // ---- range: escalation first response = first review action after the call, in minutes
  const firstAction = sql`(select min(a.created_at) from review_actions a where a.call_id = ${callIdRef})`;
  const [esc] = await db
    .select({
      responded: sql<number>`(count(*) filter (where ${firstAction} is not null))::int`,
      unanswered: sql<number>`(count(*) filter (where ${firstAction} is null))::int`,
      avgMin: sql<number | null>`(avg(extract(epoch from (${firstAction} - coalesce(${calls.endedAt}, ${calls.createdAt}))) / 60.0) filter (where ${firstAction} is not null))::float8`,
    })
    .from(calls)
    .where(and(inRange, sql`(${calls.status} = 'escalated' or ${calls.callCategory} = 'existing_client_complaint')`));

  // ---- range: time to answer (ring to pickup) and time to handoff (call end to Telegram sent)
  const [ans] = await db
    .select({
      measured: sql<number>`count(*)::int`,
      avg: sql<number | null>`avg(extract(epoch from (${calls.answeredAt} - ${calls.startedAt})))::float8`,
      p95: sql<number | null>`(percentile_cont(0.95) within group (order by extract(epoch from (${calls.answeredAt} - ${calls.startedAt}))))::float8`,
      max: sql<number | null>`max(extract(epoch from (${calls.answeredAt} - ${calls.startedAt})))::float8`,
      over: sql<number>`(count(*) filter (where extract(epoch from (${calls.answeredAt} - ${calls.startedAt})) > 300))::int`,
    })
    .from(calls)
    .where(and(inRange, sql`${calls.answeredAt} is not null and ${calls.startedAt} is not null and ${calls.answeredAt} >= ${calls.startedAt}`));

  const [hand] = await db
    .select({
      measured: sql<number>`count(*)::int`,
      avg: sql<number | null>`avg(extract(epoch from (${calls.telegramSentAt} - ${calls.endedAt})))::float8`,
      p95: sql<number | null>`(percentile_cont(0.95) within group (order by extract(epoch from (${calls.telegramSentAt} - ${calls.endedAt}))))::float8`,
      over: sql<number>`(count(*) filter (where extract(epoch from (${calls.telegramSentAt} - ${calls.endedAt})) > 120))::int`,
    })
    .from(calls)
    .where(and(inRange, sql`${calls.tier} in ('green','amber') and ${calls.telegramSentAt} is not null and ${calls.endedAt} is not null and ${calls.telegramSentAt} >= ${calls.endedAt}`));

  // ---- range: lead source
  const sources = await db
    .select({ source: sql<string>`lower(trim(${calls.referralSource}))`, count: sql<number>`count(*)::int` })
    .from(calls)
    .where(and(inRange, sql`${calls.referralSource} is not null and trim(${calls.referralSource}) <> ''`))
    .groupBy(sql`lower(trim(${calls.referralSource}))`)
    .orderBy(sql`count(*) desc`, sql`lower(trim(${calls.referralSource}))`)
    .limit(10);

  // ---- range: per day (IST)
  const day = sql<string>`to_char(${callTime} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
  const perDay = await db
    .select({
      date: day,
      green: sql<number>`(count(*) filter (where ${calls.tier} = 'green'))::int`,
      amber: sql<number>`(count(*) filter (where ${calls.tier} = 'amber'))::int`,
      red: sql<number>`(count(*) filter (where ${calls.tier} = 'red'))::int`,
      none: sql<number>`(count(*) filter (where ${calls.tier} is null))::int`,
      total: sql<number>`count(*)::int`,
      vaani: sql<number>`coalesce(sum(${calls.vaaniCostInr}), 0)::float8`,
      gemini: sql<number>`coalesce(sum(${calls.geminiCostInr}), 0)::float8`,
      cost: sql<number>`coalesce(sum(${calls.totalCostInr}), 0)::float8`,
    })
    .from(calls)
    .where(inRange)
    .groupBy(day);
  const byDay = new Map(perDay.map((p) => [p.date, p]));
  const days = eachDay(range.from, range.to);

  // ---- now: live calls, active leads, waiting too long (current state, not the range)
  const [live] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(calls)
    .where(and(real, eq(calls.status, "in_call"), sql`${calls.createdAt} >= ${tsParam(new Date(now.getTime() - 30 * 60_000))}`));
  const [lead] = await db
    .select({
      amber: sql<number>`(count(*) filter (where ${calls.tier} = 'amber' and ${calls.reviewState} = 'none'))::int`,
      greenAhead: sql<number>`(count(*) filter (where ${calls.tier} = 'green' and exists (select 1 from bookings b where b.call_id = ${callIdRef} and b.status = 'accepted' and b.start_at > ${nowTs})))::int`,
      stale: sql<number>`(count(*) filter (where ${calls.tier} = 'amber' and ${calls.reviewState} = 'none' and ${calls.createdAt} < ${staleTs}))::int`,
      oldestSec: sql<number | null>`(max(extract(epoch from (${nowTs} - ${calls.createdAt}))) filter (where ${calls.tier} = 'amber' and ${calls.reviewState} = 'none' and ${calls.createdAt} < ${staleTs}))::float8`,
    })
    .from(calls)
    .where(real);

  const bookable = r.green + r.amber;
  return {
    range,
    generatedAt: nowIso,
    now: {
      liveCalls: live.n,
      activeLeads: { amberAwaitingReview: lead.amber, greenWithConsultAhead: lead.greenAhead, total: lead.amber + lead.greenAhead },
      waitingTooLong: { count: lead.stale, oldestHours: round(nul(lead.oldestSec) == null ? null : (nul(lead.oldestSec) as number) / 3600, 1), thresholdHours: o.staleHours },
    },
    calls: {
      received: r.received,
      answered: r.answered,
      missedOrNotConnected: r.received - r.answered,
      missedInWorkingHours: r.missedWorking,
      droppedBeforeAssessment: r.dropped,
      droppedWithCallbackAlert: r.droppedAlerted,
      repeatCallers: r.repeat,
      afterHours: r.afterHours,
      afterHoursShare: round(ratio(r.afterHours, r.received), 4),
    },
    tiers: { green: r.green, amber: r.amber, red: r.red, none: r.none },
    bookings: { booked: r.booked, rateOfBookable: round(ratio(r.bookedGreen + r.bookedAmber, bookable), 4), rateOfGreen: round(ratio(r.bookedGreen, r.green), 4) },
    escalations: {
      count: r.escalations,
      priceLeaks: r.leaks,
      respondedCount: num(esc?.responded),
      avgFirstResponseMinutes: round(nul(esc?.avgMin), 1),
      unansweredCount: num(esc?.unanswered),
    },
    timing: {
      answerSeconds: { avg: round(nul(ans?.avg), 1), p95: round(nul(ans?.p95), 1), max: round(nul(ans?.max), 1), over5Minutes: num(ans?.over), measured: num(ans?.measured) },
      handoffSeconds: { avg: round(nul(hand?.avg), 1), p95: round(nul(hand?.p95), 1), over2Minutes: num(hand?.over), measured: num(hand?.measured) },
    },
    leadSources: sources.map((s) => ({ source: s.source, count: s.count })),
    hubspot: {
      callsLogged: r.hsLogged,
      loggingCompleteness: round(ratio(r.hsLogged, r.received), 4),
      callsWithFailedStep: r.hsFailed,
      dealsByTier: { green: r.dealGreen, amber: r.dealAmber, red: r.dealRed, none: r.dealNone },
      dealsApproved: r.dealApproved,
      dealsRescued: r.dealRescued,
    },
    cost: {
      totalInr: round(r.costTotal) as number,
      vaaniInr: round(r.costVaani) as number,
      geminiInr: round(r.costGemini) as number,
      perCallInr: round(ratio(r.costTotal, r.withCost)),
      perBookedConsultInr: round(ratio(r.costTotal, r.booked)),
      callsWithCost: r.withCost,
    },
    pipeline: {
      estimatedValueInr: Math.round(r.estimate),
      qualifiedLeads: r.qualified,
      totalCostInr: round(r.costTotal) as number,
      valuePerRupeeOfCost: round(ratio(r.estimate, r.costTotal), 0),
    },
    series: {
      callsPerDay: days.map((d) => {
        const p = byDay.get(d);
        return { date: d, green: num(p?.green), amber: num(p?.amber), red: num(p?.red), none: num(p?.none), total: num(p?.total) };
      }),
      costPerDay: days.map((d) => {
        const p = byDay.get(d);
        return { date: d, vaaniInr: round(num(p?.vaani)) as number, geminiInr: round(num(p?.gemini)) as number, totalInr: round(num(p?.cost)) as number };
      }),
    },
  };
}
