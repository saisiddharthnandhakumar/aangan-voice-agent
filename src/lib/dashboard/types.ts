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
  page?: number;
  pageSize?: number;
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
  consultAt: Date | null;
  durationSeconds: number | null;
}

export interface Range {
  /** inclusive IST dates */
  from: string;
  to: string;
}
