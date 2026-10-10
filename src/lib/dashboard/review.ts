import { eq } from "drizzle-orm";
import { pipelineSteps, reviewActions } from "@/db/schema";
import { errorSummary } from "@/lib/http/retry";
import { syncReviewDecision, type HubspotCtx } from "@/lib/hubspot/sync";
import type { PipelineRepo } from "@/lib/pipeline/repo";
import type { Role } from "@/lib/auth/session";
import type { AnyDb } from "./types";

/**
 * Designer actions (PRD D3). The decision is saved first (review_actions plus calls.review_state); HubSpot is
 * synced second, and a HubSpot failure is recorded as a failed `hubspot_review` pipeline step the dashboard
 * can retry, never undoing or blocking the decision (AT21). Red leads are never deleted: Discard only sets
 * review_state. Approve is for leads that are not Red; Rescue only for Red leads.
 */
export type ReviewActionName = "approve" | "rescue" | "discard" | "note";

export interface ReviewDeps {
  db: AnyDb;
  repo: Pick<PipelineRepo, "getCall" | "updateCall" | "getBookingForCall" | "findContactIdByNumber" | "findDealIdByContact" | "countCallsFromNumber">;
  /** Null when HubSpot is not configured. */
  hubspot: Omit<HubspotCtx, "repo"> | null;
}

export type ReviewResult =
  | { ok: true; hubspot: "synced" | "skipped" | "failed" | "not_needed"; hubspotError?: string }
  | { ok: false; error: string };

const NOTE_MAX = 2000;
export const HUBSPOT_REVIEW_STEP = "hubspot_review";

export async function applyReview(deps: ReviewDeps, input: { callId: string; action: ReviewActionName; note?: string; role: Role }): Promise<ReviewResult> {
  const note = (input.note ?? "").trim().slice(0, NOTE_MAX);
  const call = await deps.repo.getCall(input.callId);
  if (!call) return { ok: false, error: "Call not found." };

  if ((input.action === "discard" || input.action === "note") && note.length < (input.action === "discard" ? 3 : 1)) {
    return { ok: false, error: input.action === "discard" ? "A reason is required to discard a lead." : "Write a note first." };
  }
  if (input.action === "approve") {
    if (call.tier === "red") return { ok: false, error: "A Red lead can be rescued, not approved." };
    if (call.reviewState !== "none") return { ok: false, error: "This lead has already been reviewed." };
  }
  if (input.action === "rescue") {
    if (call.tier !== "red") return { ok: false, error: "Only a Red lead can be rescued." };
    if (call.reviewState !== "none") return { ok: false, error: "This lead has already been reviewed." };
  }
  if (input.action === "discard" && call.reviewState === "discarded") return { ok: false, error: "This lead is already discarded." };

  await deps.db.insert(reviewActions).values({ callId: call.id, actorRole: input.role, action: input.action, note: note || null });
  if (input.action === "note") return { ok: true, hubspot: "not_needed" };

  const reviewState = input.action === "approve" ? "approved" : input.action === "rescue" ? "rescued" : "discarded";
  await deps.repo.updateCall(call.id, { reviewState });
  return syncToHubspot(deps, call.id);
}

/** Push the call's current review state to HubSpot, recording the outcome as a pipeline step. */
export async function syncToHubspot(deps: ReviewDeps, callId: string): Promise<ReviewResult> {
  const call = await deps.repo.getCall(callId);
  if (!call) return { ok: false, error: "Call not found." };
  if (call.isTest) return { ok: true, hubspot: "skipped" };
  if (!deps.hubspot) return { ok: true, hubspot: "skipped" };
  const prior = await deps.db.select().from(pipelineSteps).where(eq(pipelineSteps.callId, callId));
  const attempts = (prior.find((s) => s.step === HUBSPOT_REVIEW_STEP)?.attempts ?? 0) + 1;
  try {
    await syncReviewDecision(callId, { ...deps.hubspot, repo: deps.repo });
    await upsertStep(deps.db, callId, "succeeded", attempts, null);
    return { ok: true, hubspot: "synced" };
  } catch (err) {
    const message = errorSummary(err);
    await upsertStep(deps.db, callId, "failed", attempts, message);
    return { ok: true, hubspot: "failed", hubspotError: message };
  }
}

async function upsertStep(db: AnyDb, callId: string, status: "succeeded" | "failed", attempts: number, lastError: string | null) {
  await db
    .insert(pipelineSteps)
    .values({ callId, step: HUBSPOT_REVIEW_STEP, status, attempts, lastError })
    .onConflictDoUpdate({ target: [pipelineSteps.callId, pipelineSteps.step], set: { status, attempts, lastError, updatedAt: new Date() } });
}
