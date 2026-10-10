import type { CalListedBooking } from "@/lib/cal/client";
import type { HubspotApi } from "@/lib/hubspot/client";
import type { HubspotIds } from "@/lib/hubspot/mapping";
import type { SendOptions, SentMessage } from "@/lib/telegram/client";
import type { GeminiUsage } from "@/lib/gemini/client";
import type { PostCallResult } from "@/lib/gemini/postcall";
import type { BusinessHours, PricingConfig } from "@/lib/rules";
import type { VaaniHistoryItem } from "@/lib/vaani/history";
import type { PipelineRepo } from "./repo";

/**
 * Post-call steps in run order (PRD P2, plus enrich, booking reconcile and cost). Telegram runs before
 * HubSpot on purpose: a HubSpot outage and its retries must never delay a designer's alert (AT21).
 */
export const PIPELINE_STEPS = [
  "save",
  "enrich",
  "booking",
  "gemini",
  "tier",
  "leak_check",
  "cost",
  "telegram",
  "hubspot_log",
  "hubspot_deal",
] as const;
export type StepName = (typeof PIPELINE_STEPS)[number];

export interface PipelineConfig {
  pricing: PricingConfig | null;
  hours: BusinessHours;
  vaaniCostPerMinInr?: number;
  testAgentIds: string[];
  geminiPriceInPerMtokInr?: number;
  geminiPriceOutPerMtokInr?: number;
  /** A pending booking younger than this is left for the daily reconcile (the alert must not wait for it). */
  reconcileAfterMs: number;
  appBaseUrl?: string;
  /** Transcripts and recording links older than this many days are cleared by the daily job (PRD privacy). */
  retentionDays: number;
}

/** Telegram, bound to the configured bot and chats. Null when TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing. */
export interface TelegramApi {
  designersChatId: string;
  /** Falls back to the designers' group when no founder chat is set. */
  founderChatId: string | null;
  send(o: SendOptions): Promise<SentMessage>;
  edit(o: SendOptions & { messageId: string }): Promise<SentMessage>;
}

export interface HubspotWiring {
  api: HubspotApi;
  ids: HubspotIds;
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
  telegram: TelegramApi | null;
  hubspot: HubspotWiring | null;
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
