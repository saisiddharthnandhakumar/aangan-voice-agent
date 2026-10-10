import { env } from "@/env";
import { errorSummary } from "@/lib/http/retry";
import { runDaily } from "@/lib/pipeline/daily";
import { pipelineDeps } from "@/lib/pipeline/deps";
import { secretMatches } from "@/lib/tools/http";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/digest: the 09:00 IST job (vercel.json: 30 3 * * * UTC). Vercel sends
 * Authorization: Bearer $CRON_SECRET with cron requests. Returns counts only.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = env().CRON_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!secret || !secretMatches(bearer, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json(await runDaily(pipelineDeps()), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error(`daily job failed: ${errorSummary(err)}`);
    return Response.json({ error: "daily job failed" }, { status: 500 });
  }
}
