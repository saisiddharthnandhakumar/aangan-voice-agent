import type { Action, CallCategory, Tier } from "./types";

/**
 * Outcomes under the user's decision of 2026-10-10, which overrides the PRD where they differ:
 * - The voice agent decides Green, Amber or Red itself from rubric.txt during the call. The
 *   backend stores that tier as given; neither the rules engine nor Gemini changes it.
 * - Green and Amber are both offered design-call slots and booked in the call. Amber differs only
 *   by its label on the dashboards, HubSpot and Telegram.
 * - Red is declined kindly in the call, and is still stored and logged.
 * These are mappings, not judgements: the judgement is the agent's.
 */

/** The action returned to the agent for the tier it reported. */
export function actionForAgentTier(category: CallCategory, tier: Tier | null): Action {
  if (category === "existing_client_complaint") return "escalate";
  if (category === "existing_client") return "callback";
  if (category !== "enquiry") return "close_non_enquiry";
  if (tier === "green" || tier === "amber") return "offer_booking";
  if (tier === "red") return "decline";
  // An enquiry with no tier: the agent must resubmit with one. Meanwhile promise a callback.
  return "callback";
}

export type FinalStatus = "booked" | "awaiting_designer" | "unqualified_verified" | "escalated" | "dropped" | "non_enquiry";

export interface OutcomeInput {
  /** From the agent's submit_assessment; null when no tool call reached us (Mode B). */
  category: CallCategory | null;
  tier: Tier | null;
  hasAcceptedBooking: boolean;
  dropped: boolean;
}

/**
 * Final call status after the pipeline (Phase 4, step tier):
 * dropped → dropped; complaint → escalated; existing client → awaiting_designer (callback
 * request); other non-enquiries → non_enquiry; Green or Amber with a booking → booked, without one
 * → awaiting_designer; Red → unqualified_verified; no assessment at all → awaiting_designer, so a
 * designer reviews it (it is labelled unclassified).
 */
export function finalStatus(o: OutcomeInput): FinalStatus {
  if (o.dropped) return "dropped";
  if (o.category === null) return "awaiting_designer";
  if (o.category === "existing_client_complaint") return "escalated";
  if (o.category === "existing_client") return "awaiting_designer";
  if (o.category !== "enquiry") return "non_enquiry";
  if (o.tier === "red") return "unqualified_verified";
  if ((o.tier === "green" || o.tier === "amber") && o.hasAcceptedBooking) return "booked";
  return "awaiting_designer";
}

export const STATUS_LABELS = {
  in_call: "In call",
  processing: "Processing",
  booked: "Booked",
  awaiting_designer: "Awaiting designer",
  unqualified_verified: "Unqualified verified",
  escalated: "Escalated",
  dropped: "Dropped",
  non_enquiry: "Not an enquiry",
  failed: "Failed",
} as const;

export const REVIEW_LABELS = { approved: "Approved", rescued: "Rescued", discarded: "Discarded" } as const;

/**
 * The status shown on the dashboards and in HubSpot (aangan_status). A designer's decision
 * (Approve, Rescue, Discard) replaces the pipeline status; the tier is shown beside it as its own
 * label, on every surface, so an Amber lead always reads Amber.
 */
export function statusLabel(status: keyof typeof STATUS_LABELS, reviewState: "none" | "approved" | "rescued" | "discarded" | null | undefined): string {
  if (reviewState && reviewState !== "none") return REVIEW_LABELS[reviewState];
  return STATUS_LABELS[status];
}

export function tierLabel(tier: Tier | null | undefined): string | null {
  return tier ? tier[0].toUpperCase() + tier.slice(1) : null;
}
