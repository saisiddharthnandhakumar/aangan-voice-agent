import { buildDigest } from "@/lib/telegram/alerts";
import { runPipeline } from "./run";
import type { PipelineDeps } from "./types";

/**
 * The daily job (Vercel cron, 09:00 IST; once a day on Hobby): settle bookings whose Cal.com create
 * timed out, then send the digest of Red and unreviewed Amber leads (PRD P9). Cron may fire twice or
 * late (±59 min on Hobby), so every part is safe to repeat: reconcile only touches pending bookings,
 * and a duplicate digest is harmless.
 */
export interface DailyResult {
  reconciled: number;
  digest: { sent: boolean; amber: number; red: number; reason?: string };
}

export async function runDaily(deps: PipelineDeps): Promise<DailyResult> {
  const now = deps.now();
  const pending = await deps.repo.listPendingBookings(new Date(now.getTime() - deps.config.reconcileAfterMs));
  let reconciled = 0;
  for (const { callId } of pending) {
    // Booking first, then the steps that depend on it: final status, and what HubSpot shows.
    const reports = await runPipeline(callId, deps, { only: ["booking", "tier", "hubspot_log", "hubspot_deal"] });
    if (reports.some((r) => r.step === "booking" && r.status === "succeeded")) reconciled++;
  }

  const items = await deps.repo.digestItems(now);
  const amber = items.filter((i) => i.tier === "amber").length;
  const red = items.filter((i) => i.tier === "red").length;
  if (!deps.telegram) return { reconciled, digest: { sent: false, amber, red, reason: "missing_config" } };
  if (!items.length) return { reconciled, digest: { sent: false, amber, red, reason: "nothing_to_report" } };
  const { text, button } = buildDigest(items, deps.config.appBaseUrl, now);
  await deps.telegram.send({ chatId: deps.telegram.designersChatId, text, button });
  return { reconciled, digest: { sent: true, amber, red } };
}
