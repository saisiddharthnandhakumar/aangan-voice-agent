import { env } from "@/env";
import { sessionFromRequest } from "@/lib/auth/guard";
import { pipelineDeps } from "@/lib/pipeline/deps";
import { isStepName, runPipeline } from "@/lib/pipeline/run";
import { secretMatches } from "@/lib/tools/http";
import { normaliseRef } from "@/lib/tools/service";

export const runtime = "nodejs";
export const maxDuration = 300;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/pipeline/retry {call_id, step} (PRD P2). Re-runs `step` and every step after it
 * ("all" re-runs the whole pipeline; add "only": true to run just that step). call_id is the
 * calls.id UUID or the 6-character call_ref. Auth: Authorization: Bearer <CRON_SECRET>, or a dashboard
 * session (designer or founder). Returns step statuses only, never call data.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = env().CRON_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const byBearer = Boolean(secret && secretMatches(bearer, secret));
  if (!byBearer && !(await sessionFromRequest(req))) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as { call_id?: unknown; step?: unknown; only?: unknown } | null;
  const step = body?.step ?? "all";
  if (step !== "all" && !isStepName(step)) return json({ error: "unknown step" }, 400);

  const deps = pipelineDeps();
  const rawId = typeof body?.call_id === "string" ? body.call_id.trim() : "";
  const ref = normaliseRef(rawId);
  const call = UUID.test(rawId) ? await deps.repo.getCall(rawId) : ref ? await deps.repo.getCallByRef(ref) : null;
  if (!call) return json({ error: "call not found" }, 404);

  const steps = await runPipeline(call.id, deps, step === "all" ? {} : body?.only === true ? { only: step } : { from: step });
  return json({ call_id: call.id, steps });
}
