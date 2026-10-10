import type { FounderMetrics } from "./metrics";

/**
 * What the Founder's view shows, derived from FounderMetrics with no new rounding of its own beyond display.
 * Kept pure so each headline can be tested without a browser. The pipeline total is an aggregate estimate and is
 * hidden until there are enough qualified leads for it to mean anything.
 */
export const MIN_LEADS_FOR_PIPELINE = 5;

export interface FounderHeadlines {
  answeredFast: { pct: number | null; within: number; measured: number };
  afterHours: { count: number; shareOfAll: number | null; booked: number };
  booked: { count: number; rateOfBookable: number | null };
  waiting: { count: number; oldestHours: number | null; thresholdHours: number };
  handoff: { avgSeconds: number | null; over2Minutes: number; measured: number };
  pipeline: { shown: boolean; estimatedValueInr: number; qualifiedLeads: number; perRupee: number | null };
  priceLeaks: number;
  hubspotFailed: number;
}

export function founderHeadlines(m: FounderMetrics): FounderHeadlines {
  const a = m.timing.answerSeconds;
  const within = Math.max(0, a.measured - a.over5Minutes);
  return {
    answeredFast: { pct: a.measured > 0 ? within / a.measured : null, within, measured: a.measured },
    afterHours: { count: m.calls.afterHours, shareOfAll: m.calls.afterHoursShare, booked: m.calls.afterHoursBooked },
    booked: { count: m.bookings.booked, rateOfBookable: m.bookings.rateOfBookable },
    waiting: m.now.waitingTooLong,
    handoff: { avgSeconds: m.timing.handoffSeconds.avg, over2Minutes: m.timing.handoffSeconds.over2Minutes, measured: m.timing.handoffSeconds.measured },
    pipeline: {
      shown: m.pipeline.qualifiedLeads >= MIN_LEADS_FOR_PIPELINE,
      estimatedValueInr: m.pipeline.estimatedValueInr,
      qualifiedLeads: m.pipeline.qualifiedLeads,
      perRupee: m.pipeline.valuePerRupeeOfCost,
    },
    priceLeaks: m.escalations.priceLeaks,
    hubspotFailed: m.hubspot.callsWithFailedStep,
  };
}

/** Preset ranges for the chips; anything else is "custom". */
export const RANGE_PRESETS = [7, 30, 90] as const;
export function activePreset(range: { from: string; to: string }, today: string): number | "custom" {
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
  return range.to === today && (RANGE_PRESETS as readonly number[]).includes(days) ? days : "custom";
}
