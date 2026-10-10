import { after } from "next/server";
import { env } from "@/env";
import { errorSummary } from "@/lib/http/retry";
import { pipelineDeps } from "@/lib/pipeline/deps";
import { processEvent, recordWebhook } from "@/lib/pipeline/ingest";
import { secretMatches } from "@/lib/tools/http";

export const runtime = "nodejs";
// Processing runs in after() within this limit (Gemini, Vaani history, a booking reconcile wait).
export const maxDuration = 300;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * POST /api/webhooks/vaani/call-ended?token=<VAANI_WEBHOOK_SECRET> (PRD P1).
 * Vaani signs nothing (docs/PLATFORM_NOTES.md section 1.4), so the URL carries an unguessable
 * token, compared in constant time; an x-webhook-token header is accepted too. The raw event is
 * stored first, idempotently per (Vaani call ID, event type), the response goes out at once, and
 * the work runs in after(). The token, phone numbers and transcripts are never logged.
 */
export async function POST(req: Request): Promise<Response> {
  const expected = env().VAANI_WEBHOOK_SECRET;
  if (!expected) return json({ error: "webhook not configured" }, 503);
  const given = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-webhook-token");
  if (!secretMatches(given, expected)) return json({ error: "unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }

  const deps = pipelineDeps();
  let recorded: Awaited<ReturnType<typeof recordWebhook>>;
  try {
    recorded = await recordWebhook(raw, deps);
  } catch (err) {
    // Not stored: answer 500 so a sender that retries can try again.
    console.error(`vaani webhook: could not store event: ${errorSummary(err)}`);
    return json({ error: "could not store event" }, 500);
  }
  // Acknowledge events we cannot use (no call ID) so the sender does not retry them forever.
  if (!recorded.ok) return json({ ok: false, ignored: recorded.reason });
  if (recorded.duplicate) return json({ ok: true, duplicate: true });

  const { callId, event } = recorded;
  after(async () => {
    try {
      await processEvent(callId, event, deps);
    } catch (err) {
      // Steps record their own failures in pipeline_steps; this catches anything before them.
      console.error(`vaani webhook: processing ${event.type} failed: ${errorSummary(err)}`);
    }
  });
  return json({ ok: true, duplicate: false });
}
