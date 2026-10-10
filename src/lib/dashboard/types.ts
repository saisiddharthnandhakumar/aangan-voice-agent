import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/db/schema";

/** Any Drizzle Postgres database: Neon HTTP in production, PGlite in the query tests. */
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export const TABS = ["needs_review", "booked", "unqualified", "escalations", "dropped", "non_enquiries", "all"] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABELS: Record<Tab, string> = {
  needs_review: "Needs review",
  booked: "Booked",
  unqualified: "Unqualified but verified",
  escalations: "Escalations",
  dropped: "Dropped calls",
  non_enquiries: "Non-enquiries",
  all: "All",
};

export interface ListFilters {
  tab: Tab;
  /** IST dates, inclusive: YYYY-MM-DD */
  from?: string;
  to?: string;
  tier?: "green" | "amber" | "red" | "none";
  priority?: "high" | "normal";
  afterHours?: "yes" | "no";
  includeTests?: boolean;
  /** Only calls where the agent seems to have said a figure (the Founder's view links here). */
  priceLeak?: boolean;
  page?: number;
  pageSize?: number;
  /** Booked tab: upcoming design calls first. */
  order?: "design_call";
  now?: Date;
}

export interface CallListItem {
  id: string;
  callRef: string | null;
  callerName: string | null;
  fromNumber: string | null;
  tier: "green" | "amber" | "red" | null;
  status: string;
  reviewState: string;
  priority: "high" | "normal" | null;
  callTime: Date;
  calledAfterHours: boolean | null;
  isTest: boolean;
  priceLeak: boolean;
  flags: string[];
  locality: string | null;
  projectType: string | null;
  summary: string | null;
  /** What the row shows: the summary, else an excerpt of the caller's words (redacted). */
  brief: string | null;
  briefIsExcerpt: boolean;
  /** A designer logged a call-back on this lead. */
  calledBack: boolean;
  consultAt: Date | null;
  durationSeconds: number | null;
}

export interface Range {
  /** inclusive IST dates */
  from: string;
  to: string;
}

/** The three tabs the designers see. The seven query tabs above stay as the building blocks. */
export const VIEW_TABS = ["todo", "booked", "all"] as const;
export type ViewTab = (typeof VIEW_TABS)[number];
export const VIEW_TAB_LABELS: Record<ViewTab, string> = { todo: "To do", booked: "Booked", all: "All" };

/** Filters that apply on every tab (the Filter sheet). */
export type SheetFilters = Omit<ListFilters, "tab" | "page" | "pageSize">;

export interface TodoGroups {
  /** Amber awaiting review, escalations, dropped calls needing a callback: high priority first, then oldest. */
  needsYou: CallListItem[];
  /** Design calls today (IST), by time. */
  today: CallListItem[];
  /** Design calls after today, by time. */
  comingUp: CallListItem[];
}
