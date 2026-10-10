/**
 * Vaani webhook adapter: the ONLY place that knows Vaani's payload shapes.
 *
 * Documented events (docs.vaanivoice.ai/guides/webhook-setup, docs/PLATFORM_NOTES.md section 1.4):
 *   call_started        {event, room_name, status, phone_number?}
 *   user_picked_up_at   {event, room_name, status}
 *   call_ended          {event, room_name, call_duration (SECONDS), end_reason}
 *   call_postprocessing {event, call_id, timestamp, data{room_name, call_id, call_duration (MILLISECONDS),
 *                        end_reason, summary, entities, dispositions, recording_url, transcript}}
 * UNVERIFIED: every shape above (only the docs' examples have been seen, no live inbound payload),
 * whether inbound call_started carries the caller's number, and the timestamp format. So this
 * parser is lenient: it accepts unknown fields, looks in both the top level and `data`, and never
 * throws on a missing field.
 */

export const KNOWN_EVENTS = ["call_started", "user_picked_up_at", "call_ended", "call_postprocessing"] as const;
export type KnownEvent = (typeof KNOWN_EVENTS)[number];

export interface VaaniEvent {
  /** Event name as sent (lower-cased); unknown names are kept and stored, not processed. */
  type: string;
  known: boolean;
  /** room_name / call_id; Vaani's examples use the same value for both. */
  vaaniCallId: string | null;
  /** When the event happened, from the payload; null if it carries no usable time. */
  occurredAt: Date | null;
  status: string | null;
  phoneNumber: string | null;
  durationSeconds: number | null;
  endReason: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  summary: string | null;
  agentId: string | null;
  /** Only our own e2e script sets this (the URL token is still required). */
  isTest: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function str(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** ISO string, or epoch seconds / milliseconds. */
export function parseTime(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" || (typeof v === "string" && /^\d{9,13}(\.\d+)?$/.test(v.trim()))) {
    const n = Number(v);
    const d = new Date(n > 1e12 ? n : n * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Duration in whole seconds. call_ended documents seconds, call_postprocessing milliseconds.
 * Explicit *_ms / *_seconds keys win over call_duration.
 */
function durationSeconds(type: string, top: Obj, data: Obj): number | null {
  const ms = num(data.duration_ms ?? top.duration_ms);
  if (ms != null) return Math.round(ms / 1000);
  const s = num(data.duration_seconds ?? top.duration_seconds);
  if (s != null) return Math.round(s);
  const raw = num(type === "call_postprocessing" ? (data.call_duration ?? top.call_duration) : (top.call_duration ?? data.call_duration));
  if (raw == null) return null;
  return type === "call_postprocessing" ? Math.round(raw / 1000) : Math.round(raw);
}

export function parseVaaniEvent(raw: unknown): VaaniEvent | null {
  if (!isObj(raw)) return null;
  const data = isObj(raw.data) ? raw.data : {};
  const type = (str(raw.event, raw.type, raw.event_type, data.event) ?? "").toLowerCase();
  if (!type) return null;
  return {
    type,
    known: (KNOWN_EVENTS as readonly string[]).includes(type),
    vaaniCallId: str(raw.call_id, data.call_id, raw.room_name, data.room_name),
    occurredAt: parseTime(raw.timestamp ?? data.timestamp ?? raw[type] ?? raw.time),
    status: str(raw.status, data.status),
    phoneNumber: str(raw.phone_number, data.phone_number, raw.from_number, data.from_number, raw.caller_number),
    durationSeconds: durationSeconds(type, raw, data),
    endReason: str(data.end_reason, raw.end_reason),
    transcript: str(data.transcript, raw.transcript),
    recordingUrl: str(data.recording_url, raw.recording_url),
    summary: str(data.summary, raw.summary),
    agentId: str(raw.agent_id, data.agent_id),
    isTest: raw.is_test === true || data.is_test === true,
  };
}

/** Vaani's end_reason text → our end_reason enum. Dropped is decided later by the pipeline. */
export function mapEndReason(text: string | null): "completed" | "failed" {
  return text && /fail|error|sip|reject/i.test(text) ? "failed" : "completed";
}
