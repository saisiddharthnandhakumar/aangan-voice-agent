import { statusLabel } from "@/lib/rules";
import { IST_TIMEZONE, istParts } from "@/lib/rules/time";
import type { CallListItem } from "./types";

/** Plain-language wording for the Designers' view. Pure, so it is tested without a browser. */

type NextActionInput = Pick<CallListItem, "tier" | "status" | "reviewState" | "consultAt">;

/** What the designer should do with this lead, in one short sentence. */
export function nextAction(c: NextActionInput): string {
  if (c.reviewState === "discarded") return "Discarded. Nothing to do.";
  if (c.reviewState === "rescued") return c.consultAt ? "Rescued. Design call booked." : "Rescued. Call them to book.";
  if (c.status === "dropped") return "Call back. They hung up early.";
  if (c.status === "escalated") return "Existing client. Call back today.";
  if (c.status === "non_enquiry") return "Not an enquiry. Nothing to do.";
  if (c.tier === "red" && c.reviewState === "none") return "Declined kindly. Nothing to do.";
  if (c.tier === "amber" && c.reviewState === "none") return c.consultAt ? "Review the lead. Design call is booked." : "Review, then book a call";
  if (c.status === "booked" || (c.consultAt && c.tier === "green")) return "Design call booked. Read the brief.";
  if (c.tier === null && c.status === "awaiting_designer") return "Not rated. Read the call and decide.";
  if (c.tier === "green" && !c.consultAt) return "No design call yet. Call them to book one.";
  if (c.reviewState === "approved") return c.consultAt ? "Approved. Design call booked." : "Approved. Call them to book.";
  return statusLabel(c.status as Parameters<typeof statusLabel>[0], c.reviewState as Parameters<typeof statusLabel>[1]);
}

/** "4:30 pm", "11 am": no minutes on the hour. */
export function clock(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-IN", { timeZone: IST_TIMEZONE, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minute = get("minute");
  return `${get("hour")}${minute === "00" ? "" : `:${minute}`} ${get("dayPeriod").toLowerCase()}`;
}

const WEEKDAY = new Intl.DateTimeFormat("en-IN", { timeZone: IST_TIMEZONE, weekday: "short" });
const DAY_MONTH = new Intl.DateTimeFormat("en-IN", { timeZone: IST_TIMEZONE, day: "numeric", month: "short" });
const dayNumber = (d: Date) => Math.round(Date.parse(`${istParts(d).date}T00:00:00Z`) / 86_400_000);

/** The design call time, relative to today in IST: "Today 4:30 pm", "Tomorrow 11 am", "Fri 3 pm", "No call yet". */
export function designCallText(at: Date | null, now: Date): string {
  if (!at) return "No call yet";
  const diff = dayNumber(at) - dayNumber(now);
  const time = clock(at);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff > 1 && diff < 7) return `${WEEKDAY.format(at)} ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  return `${WEEKDAY.format(at)} ${DAY_MONTH.format(at)} ${time}`;
}

/** "Called 12 min ago", "Called 3 h ago", "Called 4 days ago". */
export function calledAgo(from: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (min < 1) return "Called just now";
  if (min < 60) return `Called ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `Called ${h} h ago`;
  return `Called ${Math.round(h / 24)} days ago`;
}

/** "Saturday 10 October" for the page subtitle, in IST. */
export function longDate(now: Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST_TIMEZONE, weekday: "long", day: "numeric", month: "long" }).format(now);
}

/** Count of active filters in the sheet (the badge on the Filter button). */
export function activeFilterCount(f: { from?: string; to?: string; tier?: string; priority?: string; afterHours?: string; includeTests?: boolean; priceLeak?: boolean }): number {
  return (f.priceLeak ? 1 : 0) + (f.from || f.to ? 1 : 0) + (f.tier ? 1 : 0) + (f.priority ? 1 : 0) + (f.afterHours ? 1 : 0) + (f.includeTests ? 1 : 0);
}
