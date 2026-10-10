import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { bookings, calls, pipelineSteps, reviewActions } from "@/db/schema";
import { istDayBounds, tsParam } from "./range";
import { istParts } from "@/lib/rules/time";
import type { AnyDb, CallListItem, ListFilters, SheetFilters, Tab, TodoGroups, ViewTab } from "./types";

/**
 * Designer-view queries (PRD D2, D3). Phone numbers and transcripts are read here but never put in a
 * URL or a log. The budget floor and every pricing figure are not selected anywhere.
 */

/**
 * `calls.id` for use inside a correlated subquery. In a single-table select Drizzle renders bare column
 * references in the select list WITHOUT the table name, so `b.call_id = ${calls.id}` would compare against
 * the subquery's own `id`. This is always qualified.
 */
export const callIdRef = sql.raw('"calls"."id"');

/** When the call happened: Vaani's start time, else when we first saw it. */
export const callTime = sql<Date>`coalesce(${calls.startedAt}, ${calls.createdAt})`;

/**
 * Which calls belong on which tab. A call can appear on more than one (a booked Amber lead is both
 * "Needs review" and "Booked"); "All" shows everything.
 */
export function tabCondition(tab: Tab): SQL | undefined {
  switch (tab) {
    case "needs_review":
      // Awaiting a designer, or an Amber lead nobody has reviewed yet. Never dropped, escalated or Red.
      return and(
        eq(calls.reviewState, "none"),
        or(eq(calls.status, "awaiting_designer"), and(eq(calls.tier, "amber"), inArray(calls.status, ["booked", "awaiting_designer"]))),
      );
    case "booked":
      return eq(calls.status, "booked");
    case "unqualified":
      return eq(calls.status, "unqualified_verified");
    case "escalations":
      return eq(calls.status, "escalated");
    case "dropped":
      return eq(calls.status, "dropped");
    case "non_enquiries":
      return eq(calls.status, "non_enquiry");
    case "all":
      return undefined;
  }
}

export function filterConditions(f: Omit<ListFilters, "tab" | "page" | "pageSize">): SQL[] {
  const c: SQL[] = [];
  if (!f.includeTests) c.push(eq(calls.isTest, false));
  if (f.from) c.push(sql`${callTime} >= ${tsParam(istDayBounds(f.from).start)}`);
  if (f.to) c.push(sql`${callTime} < ${tsParam(istDayBounds(f.to).end)}`);
  if (f.tier === "none") c.push(sql`${calls.tier} is null`);
  else if (f.tier) c.push(eq(calls.tier, f.tier));
  if (f.priority) c.push(eq(calls.priority, f.priority));
  if (f.afterHours) c.push(eq(calls.calledAfterHours, f.afterHours === "yes"));
  if (f.priceLeak) c.push(eq(calls.priceLeak, true));
  return c;
}

const facts = (key: string) => sql<string | null>`${calls.facts}->>${key}`;

/** The columns a list row needs. Never a pricing figure, budget field or estimated value. */
const listSelect = {
  id: calls.id,
  callRef: calls.callRef,
  callerName: calls.callerName,
  fromNumber: calls.fromNumber,
  tier: calls.tier,
  status: calls.status,
  reviewState: calls.reviewState,
  priority: calls.priority,
  callTime,
  calledAfterHours: calls.calledAfterHours,
  isTest: calls.isTest,
  priceLeak: calls.priceLeak,
  flags: calls.flags,
  locality: facts("locality"),
  projectType: facts("project_type"),
  summary: sql<string | null>`left(${calls.summary}, 220)`,
  consultAt: sql<Date | null>`(select b.start_at from bookings b where b.call_id = ${callIdRef} and b.status = 'accepted')`,
  durationSeconds: calls.durationSeconds,
};

function mapRows(rows: Array<{ callTime: Date; consultAt: Date | null }>): CallListItem[] {
  return rows.map((r) => ({ ...r, callTime: new Date(r.callTime), consultAt: r.consultAt ? new Date(r.consultAt) : null })) as CallListItem[];
}

/** Upcoming design calls first (soonest at the top), then past ones (most recent first). */
const designCallOrder = (now: Date) => {
  const start = sql`(select b.start_at from bookings b where b.call_id = ${callIdRef} and b.status = 'accepted')`;
  const ahead = sql`${start} >= ${tsParam(now)}`;
  return [sql`case when ${ahead} then 0 else 1 end`, sql`case when ${ahead} then ${start} end asc`, sql`${start} desc`];
};

export async function listCalls(db: AnyDb, f: ListFilters): Promise<{ items: CallListItem[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 300);
  const page = Math.max(f.page ?? 1, 1);
  const where = and(tabCondition(f.tab), ...filterConditions(f));

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(calls).where(where);
  const rows = await db
    .select(listSelect)
    .from(calls)
    .where(where)
    .orderBy(...(f.order === "design_call" ? designCallOrder(f.now ?? new Date()) : [sql`case when ${calls.priority} = 'high' then 0 else 1 end`, desc(callTime)]))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { total, page, pageSize, items: mapRows(rows) };
}

/** Count per tab under the same non-tab filters, for the tab badges. */
export async function tabCounts(db: AnyDb, f: Pick<ListFilters, "from" | "to" | "tier" | "priority" | "afterHours" | "includeTests">): Promise<Record<Tab, number>> {
  const base = filterConditions(f);
  const tabs = ["needs_review", "booked", "unqualified", "escalations", "dropped", "non_enquiries", "all"] as const;
  const out = {} as Record<Tab, number>;
  await Promise.all(
    tabs.map(async (t) => {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(calls)
        .where(and(tabCondition(t), ...base));
      out[t] = n;
    }),
  );
  return out;
}

export async function getCallDetail(db: AnyDb, id: string) {
  const [call] = await db.select().from(calls).where(eq(calls.id, id)).limit(1);
  if (!call) return null;
  const [booking] = await db.select().from(bookings).where(eq(bookings.callId, id)).limit(1);
  const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.callId, id)).orderBy(asc(pipelineSteps.updatedAt));
  const actions = await db.select().from(reviewActions).where(eq(reviewActions.callId, id)).orderBy(desc(reviewActions.createdAt));
  // Calls linked to this one (a redial chain), so a designer sees the whole lead.
  const rootId = call.repeatOfCallId ?? call.id;
  const related = await db
    .select({ id: calls.id, callRef: calls.callRef, status: calls.status, tier: calls.tier, callTime })
    .from(calls)
    .where(and(or(eq(calls.id, rootId), eq(calls.repeatOfCallId, rootId)), ne(calls.id, id)))
    .orderBy(asc(callTime));
  return { call, booking: booking ?? null, steps, actions, related: related.map((r) => ({ ...r, callTime: new Date(r.callTime) })) };
}

// ---- Designers' view: the To do tab ---------------------------------------------------------------

const acceptedBookingIn = (from: Date, to?: Date) =>
  sql`exists (select 1 from bookings b where b.call_id = ${callIdRef} and b.status = 'accepted' and b.start_at >= ${tsParam(from)}${to ? sql` and b.start_at < ${tsParam(to)}` : sql``})`;

/** Someone has to act: an unreviewed Amber or unrated lead, an escalation, or a dropped call needing a callback. */
export const needsYouCondition = (): SQL | undefined =>
  and(
    eq(calls.reviewState, "none"),
    or(
      eq(calls.status, "awaiting_designer"),
      eq(calls.status, "escalated"),
      eq(calls.status, "dropped"),
      and(eq(calls.tier, "amber"), inArray(calls.status, ["booked", "awaiting_designer"])),
    ),
  );

const TODO_CAP = 300;

/**
 * To do: "Needs you now" (high priority first, then oldest), "Today" (design calls today by time) and "Coming up".
 * A call is in one group only: a booked Amber lead nobody has reviewed is in "Needs you now".
 */
export async function listTodo(db: AnyDb, f: SheetFilters, now: Date): Promise<TodoGroups> {
  const base = filterConditions(f);
  const dayStart = istDayBounds(istParts(now).date);
  const run = (where: SQL | undefined, order: SQL[]) =>
    db.select(listSelect).from(calls).where(and(where, ...base)).orderBy(...order).limit(TODO_CAP);
  const consult = sql`(select b.start_at from bookings b where b.call_id = ${callIdRef} and b.status = 'accepted')`;
  const live = and(ne(calls.reviewState, "discarded"), or(isNull(calls.tier), ne(calls.tier, "red")));

  const [needs, today, ahead] = await Promise.all([
    run(needsYouCondition(), [sql`case when ${calls.priority} = 'high' then 0 else 1 end`, asc(callTime)]),
    run(and(live, acceptedBookingIn(dayStart.start, dayStart.end)), [asc(consult)]),
    run(and(live, acceptedBookingIn(dayStart.end)), [asc(consult)]),
  ]);
  const needsItems = mapRows(needs);
  const seen = new Set(needsItems.map((i) => i.id));
  const fresh = (rows: typeof today) => mapRows(rows).filter((i) => !seen.has(i.id));
  return { needsYou: needsItems, today: fresh(today), comingUp: fresh(ahead) };
}

/** How many leads need a designer right now (no filters; real calls only). Feeds the landing page. */
export async function needYouCount(db: AnyDb): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(calls)
    .where(and(eq(calls.isTest, false), needsYouCondition()));
  return n;
}

/** Counts for the three tabs under the Filter sheet's filters. */
export async function viewTabCounts(db: AnyDb, f: SheetFilters, now: Date, todo?: TodoGroups): Promise<Record<ViewTab, number>> {
  const groups = todo ?? (await listTodo(db, f, now));
  const base = filterConditions(f);
  const [[b], [a]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(calls).where(and(tabCondition("booked"), ...base)),
    db.select({ n: sql<number>`count(*)::int` }).from(calls).where(and(...base)),
  ]);
  return { todo: groups.needsYou.length + groups.today.length + groups.comingUp.length, booked: b.n, all: a.n };
}
