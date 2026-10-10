import type { CalListedBooking } from "@/lib/cal/client";
import type { GeminiUsage } from "@/lib/gemini/client";
import type { PostCallResult } from "@/lib/gemini/postcall";
import type { BusinessHours, PricingConfig } from "@/lib/rules";
import type { VaaniHistoryItem } from "@/lib/vaani/history";
import type { PipelineRepo } from "./repo";

/** Post-call steps in run order (PRD P2, plus enrich, booking reconcile and cost). */
export const PIPELINE_STEPS = [
  "save",
  "enrich",
  "booking",
  "gemini",
  "tier",
  "leak_check",
  "cost",
  "hubspot_log",
  "hubspot_deal",
  "telegram",
] as const;
export type StepName = (typeof PIPELINE_STEPS)[number];

export interface PipelineConfig {
  pricing: PricingConfig | null;
  hours: BusinessHours;
  vaaniCostPerMinInr?: number;
  testAgentIds: string[];
  geminiPriceInPerMtokInr?: number;
  geminiPriceOutPerMtokInr?: number;
  /** Pending bookings younger than this are given time to settle before reconciling. */
  reconcileAfterMs: number;
  hubspotConfigured: boolean;
  telegramConfigured: boolean;
}

export interface PipelineDeps {
  repo: PipelineRepo;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  config: PipelineConfig;
  /** Vaani call history lookup; null when VAANI_API_KEY is missing. */
  history: ((vaaniCallId: string) => Promise<VaaniHistoryItem | null>) | null;
  /** Gemini post-call analysis; null when the key or the rubric is missing. */
  analyse: ((transcript: string, todayIst: string) => Promise<{ result: PostCallResult; usage: GeminiUsage; model: string; attempts: number }>) | null;
  /** Cal.com bookings lookup for reconciliation; null when Cal.com is not configured. */
  calLookup: ((q: { attendeeEmail: string; eventTypeId?: number; afterCreatedAt?: string }) => Promise<CalListedBooking[]>) | null;
}

/** What Gemini left on the call row (calls.criteria_gemini). Reference only, never the tier. */
export interface GeminiRecord {
  model: string;
  analysed_at: string;
  has_project_details: boolean;
  price_leak: { leaked: boolean; evidence: string | null };
  extraction: Record<string, unknown>;
}
