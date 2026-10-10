import { and, asc, eq, sql } from "drizzle-orm";
import { calls } from "@/db/schema";
import { statusLabel, tierLabel } from "@/lib/rules";
import { formatIstSortable as ist } from "@/lib/rules/time";
import { callIdRef, callTime } from "./queries";
import { istDayBounds, tsParam } from "./range";
import type { AnyDb, Range } from "./types";

/**
 * Founder CSV export (D4): one row per real call in the range. It holds what the founder already sees on
 * the dashboard plus name and phone; never transcripts, budget fields, per-call estimated values (project size
 * next to an estimate would reveal the studio's rates) or any pricing figure. Cells that
 * start with = + - @ are prefixed with an apostrophe so a spreadsheet cannot run them as formulas.
 */
export const CSV_COLUMNS = [
  "Call reference", "Call time (IST)", "Duration (s)", "Tier", "Status", "Priority", "After hours", "Name", "Phone",
  "Locality", "Project type", "Lead source", "Design call booked", "Design call time (IST)", "Vaani cost (INR)",
  "Gemini cost (INR)", "Total cost (INR)", "Price leak", "HubSpot call logged", "HubSpot deal", "Telegram sent (IST)",
] as const;

export function csvCell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  // A plain phone number (+ and digits) is not a formula; anything else starting with = + - @ is defused.
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{8,15}$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function callsCsv(db: AnyDb, range: Range): Promise<string> {
  const rows = await db
    .select({
      ref: calls.callRef,
      time: callTime,
      duration: calls.durationSeconds,
      tier: calls.tier,
      status: calls.status,
      review: calls.reviewState,
      priority: calls.priority,
      afterHours: calls.calledAfterHours,
      name: calls.callerName,
      phone: calls.fromNumber,
      locality: sql<string | null>`${calls.facts}->>'locality'`,
      project: sql<string | null>`${calls.facts}->>'project_type'`,
      source: calls.referralSource,
      consult: sql<Date | null>`(select b.start_at from bookings b where b.call_id = ${callIdRef} and b.status = 'accepted')`,
      vaani: calls.vaaniCostInr,
      gemini: calls.geminiCostInr,
      total: calls.totalCostInr,
      leak: calls.priceLeak,
      hsCall: calls.hubspotCallId,
      hsDeal: calls.hubspotDealId,
      telegram: calls.telegramSentAt,
    })
    .from(calls)
    .where(and(eq(calls.isTest, false), sql`${callTime} >= ${tsParam(istDayBounds(range.from).start)}`, sql`${callTime} < ${tsParam(istDayBounds(range.to).end)}`))
    .orderBy(asc(callTime));
  const yn = (b: boolean | null) => (b == null ? "" : b ? "yes" : "no");
  return toCsv(
    CSV_COLUMNS,
    rows.map((r) => [
      r.ref, ist(new Date(r.time)), r.duration, tierLabel(r.tier) ?? "", statusLabel(r.status, r.review), r.priority ?? "", yn(r.afterHours), r.name, r.phone,
      r.locality, r.project, r.source, r.consult ? "yes" : "no", r.consult ? ist(new Date(r.consult)) : "", r.vaani, r.gemini, r.total, r.leak ? "yes" : "no",
      r.hsCall ? "yes" : "no", r.hsDeal ? "yes" : "no", r.telegram ? ist(new Date(r.telegram)) : "",
    ]),
  );
}
