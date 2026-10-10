"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireRole } from "@/lib/auth/guard";
import { applyReview, syncToHubspot, HUBSPOT_REVIEW_STEP, type ReviewActionName, type ReviewDeps } from "@/lib/dashboard/review";
import { pipelineDeps } from "@/lib/pipeline/deps";
import { isStepName, runPipeline } from "@/lib/pipeline/run";

export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: readonly string[] = ["approve", "rescue", "discard", "note"];

function reviewDeps(): ReviewDeps {
  const p = pipelineDeps();
  return { db: db(), repo: p.repo, hubspot: p.hubspot ? { api: p.hubspot.api, ids: p.hubspot.ids, appBaseUrl: p.config.appBaseUrl } : null };
}

/** Approve, Rescue, Discard (reason required) or Note on one call (PRD D3). */
export async function reviewAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { role } = await requireRole("designer");
  const callId = String(form.get("callId") ?? "");
  const action = String(form.get("action") ?? "");
  if (!UUID.test(callId) || !ACTIONS.includes(action)) return { error: "That request was not valid." };
  const r = await applyReview(reviewDeps(), { callId, action: action as ReviewActionName, note: String(form.get("note") ?? ""), role });
  revalidatePath(`/dashboard/calls/${callId}`);
  revalidatePath("/dashboard");
  if (!r.ok) return { error: r.error };
  if (r.hubspot === "failed") return { ok: true, message: "Saved. HubSpot could not be updated; the sync failure is shown below, and you can retry it." };
  return { ok: true, message: action === "note" ? "Note added." : "Saved." };
}

/** Re-run a failed or skipped pipeline step (and the steps after it). PRD P2. */
export async function retryStep(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("designer");
  const callId = String(form.get("callId") ?? "");
  const step = String(form.get("step") ?? "");
  if (!UUID.test(callId)) return { error: "That request was not valid." };
  if (step === HUBSPOT_REVIEW_STEP) {
    const r = await syncToHubspot(reviewDeps(), callId);
    revalidatePath(`/dashboard/calls/${callId}`);
    return r.ok && r.hubspot === "synced" ? { ok: true, message: "HubSpot is up to date." } : { error: r.ok ? (r.hubspotError ?? "HubSpot sync did not run.") : r.error };
  }
  if (!isStepName(step)) return { error: "Unknown step." };
  const reports = await runPipeline(callId, pipelineDeps(), { from: step });
  revalidatePath(`/dashboard/calls/${callId}`);
  const failed = reports.filter((s) => s.status === "failed");
  return failed.length ? { error: `Still failing: ${failed.map((s) => s.step).join(", ")}.` } : { ok: true, message: "Done." };
}
