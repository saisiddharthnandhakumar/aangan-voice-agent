import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { db } from "@/db";
import { env } from "@/env";
import { errorSummary } from "@/lib/http/retry";
import { parsePricingConfig } from "@/lib/rules";
import { drizzleToolsRepo } from "./repo";
import type { ToolDeps, ToolResult } from "./service";

/**
 * Shared wrapper for the three Vaani tool routes (PRD section 4, T1–T4):
 * X-Tool-Secret check, rate limit, tolerant JSON parsing, a hard deadline so the caller never
 * hears dead air, and request/response logging to tool_calls after the response is sent.
 */

const DEADLINE_MS = 2300;
const SECRET_HEADER = "x-tool-secret";
const HIDDEN_HEADERS = new Set([SECRET_HEADER, "authorization", "cookie", "x-vercel-oidc-token", "x-forwarded-for", "x-real-ip"]);

export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vaani's exact request envelope is UNVERIFIED: accept the arguments flat or wrapped once. */
export function unwrapArgs(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const obj = body as Record<string, unknown>;
  for (const key of ["args", "arguments", "parameters", "params", "input", "data", "body"]) {
    const inner = obj[key];
    if (inner && typeof inner === "object" && !Array.isArray(inner) && Object.keys(obj).length <= 3) return inner as Record<string, unknown>;
    if (typeof inner === "string" && Object.keys(obj).length <= 3) {
      try {
        const parsed = JSON.parse(inner);
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      } catch {
        /* not JSON */
      }
    }
  }
  return obj;
}

// In-memory, per server instance: enough to stop a runaway loop, not a global quota.
const hits = new Map<string, number[]>();
export function rateLimited(key: string, limitPerMin: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > limitPerMin;
}

function safeHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (!HIDDEN_HEADERS.has(k.toLowerCase())) out[k] = v.slice(0, 200);
  });
  return out;
}

export function toolDeps(): ToolDeps {
  const e = env();
  return {
    repo: drizzleToolsRepo(db()),
    now: () => new Date(),
    rules: {
      pricing: parsePricingConfig(e.PRICING_CONFIG_JSON),
      hours: { start: e.BUSINESS_HOURS_START, end: e.BUSINESS_HOURS_END, days: e.BUSINESS_DAYS },
      assumedDealValueInr: e.ASSUMED_DEAL_VALUE_INR,
    },
    cal: e.CAL_API_KEY
      ? {
          apiKey: e.CAL_API_KEY,
          baseUrl: e.CAL_API_BASE_URL,
          versionSlots: e.CAL_API_VERSION_SLOTS,
          versionBookings: e.CAL_API_VERSION_BOOKINGS,
          eventTypeIds: { site_visit: e.CAL_EVENT_TYPE_ID_SITE_VISIT, call: e.CAL_EVENT_TYPE_ID_CALL },
        }
      : null,
    placeholderEmailDomain: e.PLACEHOLDER_EMAIL_DOMAIN,
    testAgentIds: e.VAANI_TEST_AGENT_IDS,
  };
}

export interface ToolRouteOptions<B> {
  tool: "submit_assessment" | "check_availability" | "book_consult";
  run: (args: Record<string, unknown>, deps: ToolDeps) => Promise<ToolResult<B>>;
  /** Speakable answer when the backend fails or the deadline passes. */
  fallback: (deps: ToolDeps) => B;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function toolRoute<B>(opts: ToolRouteOptions<B>) {
  return async function POST(req: Request): Promise<Response> {
    const started = Date.now();
    const e = env();
    if (!secretMatches(req.headers.get(SECRET_HEADER), e.VAANI_TOOL_SECRET)) {
      // Logged (headers only, never the secret or body) so a misconfigured Vaani tool is visible.
      const given = req.headers.get(SECRET_HEADER);
      const headers = safeHeaders(req);
      after(async () => {
        try {
          await drizzleToolsRepo(db()).logToolCall({
            callId: null,
            tool: opts.tool,
            request: { headers, secret: given ? `present, ${given.length} chars` : "missing" },
            response: { error: "unauthorized" },
            latencyMs: Date.now() - started,
          });
        } catch {
          // never break the response
        }
      });
      return json({ error: "unauthorized" }, 401);
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (rateLimited(`${opts.tool}:${ip}`, e.TOOL_RATE_LIMIT_PER_MIN)) {
      return json({ error: "rate_limited", message: "Sorry, one moment please." }, 429);
    }

    let raw: unknown = null;
    try {
      raw = await req.json();
    } catch {
      raw = null;
    }
    const args = unwrapArgs(raw);
    const deps = toolDeps();

    let body: B;
    let callId: string | null = null;
    let error: string | null = null;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const timer = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("tool deadline exceeded")), DEADLINE_MS);
      });
      const result = await Promise.race([opts.run(args, deps), timer]);
      body = result.body;
      callId = result.callId;
    } catch (err) {
      error = errorSummary(err);
      body = opts.fallback(deps);
    } finally {
      clearTimeout(deadline);
    }
    const latency = Date.now() - started;

    after(async () => {
      try {
        await deps.repo.logToolCall({
          callId,
          tool: opts.tool,
          request: { body: raw, headers: safeHeaders(req) },
          response: error ? { body, error } : { body },
          latencyMs: latency,
        });
      } catch {
        // Logging must never break the call. Nothing is printed: the request holds caller data.
      }
    });
    return json(body);
  };
}
