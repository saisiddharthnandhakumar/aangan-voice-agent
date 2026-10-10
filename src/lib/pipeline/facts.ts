import { redactMoney } from "@/lib/rules";
import type { CallRow } from "@/lib/tools/repo";
import type { GeminiRecord } from "./types";

/**
 * The call's facts for alerts and CRM: what the voice agent recorded (calls.facts) first, then
 * Gemini's reading of the transcript for calls no tool call reached. Display-only; never used
 * to decide a tier. No pricing figure can come out of here: the studio's figures are never stored
 * on a call, and the caller's own budget fields are deliberately not exposed.
 */
export interface CallFacts {
  callerName: string | null;
  projectType: string | null;
  propertyDetail: string | null;
  bhk: number | null;
  sizeSqft: number | null;
  locality: string | null;
  timelineText: string | null;
  completionNeededBy: string | null;
  referralSource: string | null;
  scopeSummary: string | null;
}

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const str = (...vs: unknown[]): string | null => {
  for (const v of vs) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
};
const num = (...vs: unknown[]): number | null => {
  for (const v of vs) if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return null;
};

export function callFacts(call: Pick<CallRow, "facts" | "criteriaGemini" | "callerName" | "referralSource" | "completionNeededBy">): CallFacts {
  const a = bag(call.facts);
  const g = bag(bag(call.criteriaGemini as GeminiRecord | null).extraction);
  return {
    callerName: str(call.callerName, a.caller_name, g.caller_name),
    projectType: str(a.project_type, g.project_type),
    propertyDetail: str(a.property_detail, g.property_detail),
    bhk: num(a.bhk, g.bhk),
    sizeSqft: num(a.size_sqft, g.size_sqft),
    locality: str(a.locality, g.locality),
    timelineText: str(a.timeline_text, g.timeline_text),
    completionNeededBy: str(call.completionNeededBy, a.completion_needed_by, g.completion_needed_by),
    referralSource: str(call.referralSource, a.referral_source, g.referral_source),
    scopeSummary: str(a.scope_summary, g.scope_summary),
  };
}

/** "3BHK apartment" / "home" / "office, 640 sq ft": the project in a few words. */
export function projectLine(f: CallFacts): string | null {
  const base = f.propertyDetail ?? (f.bhk ? `${f.bhk}BHK` : null) ?? f.projectType;
  const kind = f.projectType && base && !base.toLowerCase().includes(f.projectType) && f.projectType !== "other" ? ` (${f.projectType})` : "";
  const size = f.sizeSqft ? `${f.sizeSqft.toLocaleString("en-IN")} sq ft` : null;
  const parts = [base ? `${base}${kind}` : null, size].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** What the caller said, for an alert when Gemini failed (P3, AT10): their turns only, money masked. */
export function callerExcerpt(transcript: string | null | undefined, max = 600): string | null {
  if (!transcript) return null;
  const caller: string[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:\[[^\]]*\]\s*)?(USER|CALLER|HUMAN)\s*:\s*(.*)$/i);
    if (m) caller.push(m[2].trim());
    else if (caller.length && line.trim() && !/^\s*(?:\[[^\]]*\]\s*)?(AGENT|ASSISTANT|BOT)\s*:/i.test(line)) caller[caller.length - 1] += ` ${line.trim()}`;
  }
  const text = redactMoney(caller.filter(Boolean).join(" · "));
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The summary to show: Gemini's if present, else the caller's own words, else null. */
export function summaryOrExcerpt(call: Pick<CallRow, "summary" | "transcript">, max = 600): { text: string | null; isExcerpt: boolean } {
  if (call.summary?.trim()) return { text: redactMoney(call.summary.trim()).slice(0, max), isExcerpt: false };
  const ex = callerExcerpt(call.transcript, max);
  return { text: ex, isExcerpt: ex !== null };
}
