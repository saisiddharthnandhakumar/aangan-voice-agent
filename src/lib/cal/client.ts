import { isTimeout, RetryError, withRetry, type RetryOptions } from "@/lib/http/retry";

/**
 * Cal.com API v2 client (docs/PLATFORM_NOTES.md section 2).
 * Verified on 2026-10-10 against the live account (read-only): GET /v2/slots with
 * cal-api-version 2024-09-04 and format=range returns { data: { "YYYY-MM-DD": [{start, end}] } }
 * with +05:30 offsets. Both event types require attendee name and email. The site-visit type
 * offers attendeeAddress; the call type uses its Google Meet integration.
 *
 * Latency budget: tool endpoints must answer in under 2.5 s at p95, so each attempt has a short
 * timeout. Creating a booking is NOT idempotent at Cal.com (no idempotency key), so a create is
 * never retried after a timeout, only after a 429 or 503, which mean the request was not handled.
 */

export interface CalConfig {
  apiKey: string;
  baseUrl: string;
  versionSlots: string;
  versionBookings: string;
  fetchImpl?: typeof fetch;
}

export interface CalSlot {
  start: string; // ISO with offset
  end?: string;
}

export interface CreateBookingInput {
  eventTypeId: number;
  start: string; // ISO UTC
  attendee: { name: string; email: string; timeZone: string; phoneNumber?: string; language?: string };
  location?: Record<string, string>;
  metadata?: Record<string, string>;
  notes?: string;
}

export interface CalBooking {
  uid: string;
  start: string;
  end?: string;
  status?: string;
}

export class CalError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: "timeout" | "http" | "network" | "shape",
  ) {
    super(message);
    this.name = "CalError";
  }
}

const SLOT_TIMEOUT_MS = 1100;
const BOOKING_TIMEOUT_MS = 1800;

async function request<T>(cfg: CalConfig, path: string, init: { method: "GET" | "POST"; version: string; body?: unknown; timeoutMs: number }): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), init.timeoutMs);
  let res: Response;
  try {
    res = await (cfg.fetchImpl ?? fetch)(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "cal-api-version": init.version,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: abort.signal,
    });
  } catch (err) {
    throw isTimeout(err) ? new CalError("Cal.com timed out", null, "timeout") : new CalError("Cal.com unreachable", null, "network");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
    throw new CalError(`Cal.com ${res.status}: ${String(msg).slice(0, 160)}`, res.status, "http");
  }
  return json as T;
}

/** Retry, but surface the underlying CalError so callers can tell a timeout from a refusal. */
async function retrying<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  try {
    return (await withRetry(fn, opts)).value;
  } catch (err) {
    throw err instanceof RetryError ? err.lastError : err;
  }
}

const retryableRead = (err: unknown) =>
  err instanceof CalError && (err.kind === "timeout" || err.kind === "network" || err.status === 429 || (err.status ?? 0) >= 500);
const retryableCreate = (err: unknown) => err instanceof CalError && (err.status === 429 || err.status === 503);

/** Open slots for an event type between two instants. Returns a flat, sorted list. */
export async function getSlots(cfg: CalConfig, eventTypeId: number, startIso: string, endIso: string): Promise<CalSlot[]> {
  const qs = new URLSearchParams({ eventTypeId: String(eventTypeId), start: startIso, end: endIso, timeZone: "Asia/Kolkata", format: "range" });
  const value = await retrying(
    () => request<{ status?: string; data?: Record<string, Array<CalSlot | string>> }>(cfg, `/v2/slots?${qs}`, { method: "GET", version: cfg.versionSlots, timeoutMs: SLOT_TIMEOUT_MS }),
    { attempts: 2, baseDelayMs: 100, maxDelayMs: 200, retryable: retryableRead },
  );
  if (!value || typeof value.data !== "object" || value.data === null) throw new CalError("unexpected slots response", null, "shape");
  return Object.values(value.data)
    .flat()
    .map((s) => (typeof s === "string" ? { start: s } : s))
    .filter((s): s is CalSlot => typeof s?.start === "string")
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Create a booking. Throws CalError; a 4xx usually means the slot is no longer free. */
export async function createBooking(cfg: CalConfig, input: CreateBookingInput): Promise<CalBooking> {
  const body: Record<string, unknown> = {
    start: input.start,
    eventTypeId: input.eventTypeId,
    attendee: { language: "en", ...input.attendee },
    ...(input.location ? { location: input.location } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.notes ? { bookingFieldsResponses: { notes: input.notes } } : {}),
  };
  const value = await retrying(
    () => request<{ data?: CalBooking | CalBooking[] }>(cfg, "/v2/bookings", { method: "POST", version: cfg.versionBookings, body, timeoutMs: BOOKING_TIMEOUT_MS }),
    { attempts: 2, baseDelayMs: 150, maxDelayMs: 300, retryable: retryableCreate },
  );
  const data = Array.isArray(value?.data) ? value.data[0] : value?.data;
  if (!data?.uid) throw new CalError("booking response had no uid", null, "shape");
  return data;
}
