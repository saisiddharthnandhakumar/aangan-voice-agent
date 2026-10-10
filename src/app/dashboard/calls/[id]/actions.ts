"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireRole } from "@/lib/auth/guard";
import { applyReview, type ReviewActionName, type ReviewDeps } from "@/lib/dashboard/review";
import { pipelineDeps } from "@/lib/pipeline/deps";

export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: readonly string[] = ["rescue", "discard", "note", "callback"];

function reviewDeps(): ReviewDeps {
  const p = pipelineDeps();
  return { db: db(), repo: p.repo, hubspot: p.hubspot ? { api: p.hubspot.api, ids: p.hubspot.ids, appBaseUrl: p.config.appBaseUrl } : null };
}

/** Rescue (Red only), Cancel (stored as discard; reason required), Note or Log a call-back on one call (PRD D3). */
export async function reviewAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { role } = await requireRole("designer");
  const callId = String(form.get("callId") ?? "");
  const action = String(form.get("action") ?? "");
  if (!UUID.test(callId) || !ACTIONS.includes(action)) return { error: "That request was not valid." };
  const r = await applyReview(reviewDeps(), { callId, action: action as ReviewActionName, note: String(form.get("note") ?? ""), role });
  revalidatePath(`/dashboard/calls/${callId}`);
  revalidatePath("/dashboard");
  if (!r.ok) return { error: r.error };
  if (r.hubspot === "failed") return { ok: true, message: "Saved. HubSpot could not be updated; the failure is recorded for the studio's tech contact." };
  return { ok: true, message: action === "note" ? "Note added." : action === "callback" ? "Call-back logged." : "Saved." };
}
