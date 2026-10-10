import { isTimeout, withRetry } from "@/lib/http/retry";
import { parseTime } from "./events";

/**
 * Vaani call history (GET https://api.vaanivoice.ai/api/call-history?page=&page_size=, header
 * X-API-Key). Source: docs.vaanivoice.ai/api-reference/call-history, checked 2026-10-10.
 * Response: {data: [...], pagination: {page, page_size, total_count, total_pages, has_next}}.
 * There is no filter by call ID, so we page the newest calls (page_size up to 200).
 *
 * Known problem (2026-10-10): the endpoint answers 500 "Invalid client_id format" for our key,
 * a Vaani-side bug. The enrich step records the failure and the pipeline carries on.
 * UNVERIFIED: field values for inbound calls; the unit of call_cost ("credits" per the docs, not
 * INR), so cost in INR comes from duration × VAANI_COST_PER_MIN_INR instead.
 */

export interface VaaniHistoryItem {
  callId: string;
  agentId: string | null;
  callType: string | null;
  direction: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  pickedUpAt: Date | null;
  durationSeconds: number | null;
  /** In Vaani credits per the docs; NOT converted to INR. */
  costCredits: number | null;
}

export class VaaniApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "VaaniApiError";
  }
}

export interface VaaniHistoryConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** How many pages of `pageSize` to scan for the call. */
  pages?: number;
  pageSize?: number;
  sleep?: (ms: number) => Promise<void>;
}

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

export function mapHistoryItem(raw: Record<string, unknown>): VaaniHistoryItem | null {
  const callId = s(raw.call_id);
  if (!callId) return null;
  const ms = n(raw.duration_ms);
  return {
    callId,
    agentId: s(raw.agent_id),
    callType: s(raw.call_type),
    direction: s(raw.direction),
    fromNumber: s(raw.from_number),
    toNumber: s(raw.to_number),
    startedAt: parseTime(raw.Start_time ?? raw.start_time),
    endedAt: parseTime(raw.End_time ?? raw.end_time),
    pickedUpAt: parseTime(raw.user_picked_up_at),
    durationSeconds: ms == null ? null : Math.round(ms / 1000),
    costCredits: n(raw.call_cost),
  };
}

const retryable = (err: unknown) =>
  isTimeout(err) || (err instanceof VaaniApiError && (err.status === null || err.status === 429 || err.status >= 500));

async function fetchPage(cfg: VaaniHistoryConfig, page: number): Promise<{ items: Record<string, unknown>[]; hasNext: boolean }> {
  const base = (cfg.baseUrl ?? "https://api.vaanivoice.ai").replace(/\/$/, "");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), cfg.timeoutMs ?? 6000);
  let res: Response;
  try {
    res = await (cfg.fetchImpl ?? fetch)(`${base}/api/call-history?page=${page}&page_size=${cfg.pageSize ?? 100}`, {
      headers: { "X-API-Key": cfg.apiKey, Accept: "application/json" },
      signal: abort.signal,
    });
  } catch (err) {
    if (isTimeout(err)) throw err;
    throw new VaaniApiError("Vaani unreachable", null);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
      detail = String(j.detail ?? j.message ?? j.error ?? "").slice(0, 80);
    } catch {
      /* not JSON */
    }
    throw new VaaniApiError(`Vaani call history ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
  }
  const body = JSON.parse(text) as { data?: unknown; pagination?: { has_next?: boolean } };
  return { items: Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [], hasNext: body.pagination?.has_next === true };
}

/** Find one call in the newest history pages. Null if it is not there (yet). */
export async function findCallInHistory(cfg: VaaniHistoryConfig, vaaniCallId: string): Promise<VaaniHistoryItem | null> {
  for (let page = 1; page <= (cfg.pages ?? 2); page++) {
    const { value } = await withRetry(() => fetchPage(cfg, page), {
      attempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 4000,
      retryable,
      sleep: cfg.sleep,
    });
    const hit = value.items.find((i) => s(i.call_id) === vaaniCallId || s(i.room_name) === vaaniCallId);
    if (hit) return mapHistoryItem(hit);
    if (!value.hasNext) break;
  }
  return null;
}
