import { sql } from "drizzle-orm";
import { istParts } from "@/lib/rules/time";

/**
 * Date ranges are chosen in IST (YYYY-MM-DD, inclusive) and stored/queried in UTC.
 * India has no daylight saving, so a day is exactly +05:30 from midnight to midnight.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIstDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  // Round-trip: V8 accepts impossible dates such as 2026-02-30 and rolls them over.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** A JS Date as an explicit timestamptz parameter, so every Postgres driver reads it the same way. */
export const tsParam = (d: Date) => sql`${d.toISOString()}::timestamptz`;

export function istDayBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The last `days` IST days up to and including today. */
export function lastNDays(now: Date, days: number): { from: string; to: string } {
  const to = istParts(now).date;
  return { from: addDays(to, -(days - 1)), to };
}

/** Parse ?from=&to= with a default; swaps a reversed range and caps it at one year. */
export function parseRange(from: unknown, to: unknown, now: Date, defaultDays = 30): { from: string; to: string } {
  const def = lastNDays(now, defaultDays);
  let f = isIstDate(from) ? from : def.from;
  let t = isIstDate(to) ? to : def.to;
  if (f > t) [f, t] = [t, f];
  if (Date.parse(t) - Date.parse(f) > 365 * 86_400_000) f = addDays(t, -365);
  return { from: f, to: t };
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
