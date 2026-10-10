import { callFacts, projectLine, summaryOrExcerpt } from "@/lib/pipeline/facts";
import { formatIst, redactMoney, statusLabel, STATUS_LABELS, REVIEW_LABELS, tierLabel } from "@/lib/rules";
import type { BookingRow, CallRow } from "@/lib/tools/repo";
import type { PropertyDef } from "./client";

/**
 * What goes into HubSpot (PRD "HubSpot logging"). The Free CRM allows 10 custom properties in
 * total (docs/PLATFORM_NOTES.md section 3.3), so we create the PRD's 8-property fallback set and put
 * the rest (project type, size, timeline, consultation type, lead source, summary) in the call notes.
 * `--full` in `pnpm hubspot:setup` adds the other six on a paid plan.
 *
 * Nothing here ever contains the studio's pricing: notes are passed through redactMoney, the
 * caller's budget criterion text is left out, and the budget fields are never written.
 */

export const PROPERTY_GROUP = { name: "aangan_voice_agent", label: "Aangan voice agent" } as const;

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const options = (labels: readonly string[]) => labels.map((label, i) => ({ label, value: slug(label), displayOrder: i, hidden: false as const }));

const STATUS_OPTIONS = [...Object.values(STATUS_LABELS).filter((l) => l !== "Processing" && l !== "Failed"), ...Object.values(REVIEW_LABELS)];
const TIERS = ["Green", "Amber", "Red", "Not rated"] as const;
const PRIORITIES = ["High", "Normal"] as const;

const g = PROPERTY_GROUP.name;
/** The 8 properties kept on the Free plan. */
export const CORE_PROPERTIES: PropertyDef[] = [
  { name: "aangan_status", label: "Aangan status", type: "enumeration", fieldType: "select", groupName: g, options: options(STATUS_OPTIONS) },
  { name: "aangan_tier", label: "Aangan tier", type: "enumeration", fieldType: "select", groupName: g, options: options(TIERS) },
  { name: "aangan_priority", label: "Aangan priority", type: "enumeration", fieldType: "select", groupName: g, options: options(PRIORITIES) },
  { name: "aangan_last_call_at", label: "Aangan last call at", type: "datetime", fieldType: "date", groupName: g },
  { name: "aangan_call_count", label: "Aangan call count", type: "number", fieldType: "number", groupName: g },
  { name: "aangan_locality", label: "Aangan locality", type: "string", fieldType: "text", groupName: g },
  { name: "aangan_consult_at", label: "Aangan consultation at", type: "datetime", fieldType: "date", groupName: g },
  { name: "aangan_dashboard_url", label: "Aangan dashboard URL", type: "string", fieldType: "text", groupName: g },
];

/** The other six from the PRD, for a plan with more custom properties. */
export const EXTRA_PROPERTIES: PropertyDef[] = [
  { name: "aangan_project_type", label: "Aangan project type", type: "string", fieldType: "text", groupName: g },
  { name: "aangan_size_sqft", label: "Aangan size (sq ft)", type: "number", fieldType: "number", groupName: g },
  { name: "aangan_timeline", label: "Aangan timeline", type: "string", fieldType: "text", groupName: g },
  { name: "aangan_consult_type", label: "Aangan consultation type", type: "string", fieldType: "text", groupName: g },
  { name: "aangan_lead_source", label: "Aangan lead source", type: "string", fieldType: "text", groupName: g },
  { name: "aangan_summary", label: "Aangan summary", type: "string", fieldType: "textarea", groupName: g },
];

export const MAX_CUSTOM_PROPERTIES_FREE = 10;

export interface ContactStats {
  callCount: number;
}

export type Props = Record<string, string | number | boolean | null>;

export function dashboardUrl(call: Pick<CallRow, "id">, appBaseUrl: string | undefined): string | null {
  return appBaseUrl ? `${appBaseUrl.replace(/\/$/, "")}/dashboard/calls/${call.id}` : null;
}

/** The aangan_* properties for the latest call. The latest event sets the contact's status. */
export function contactProperties(call: CallRow, booking: Pick<BookingRow, "status" | "startAt"> | null, stats: ContactStats, appBaseUrl: string | undefined, extra = false): Props {
  const f = callFacts(call);
  const at = call.startedAt ?? call.createdAt;
  const props: Props = {
    aangan_status: slug(statusLabel(call.status, call.reviewState)),
    aangan_tier: slug(tierLabel(call.tier) ?? "Not rated"),
    aangan_priority: call.priority === "high" ? "high" : "normal",
    aangan_last_call_at: at.toISOString(),
    aangan_call_count: stats.callCount,
    ...(f.locality ? { aangan_locality: f.locality } : {}),
    ...(booking && booking.status === "accepted" ? { aangan_consult_at: booking.startAt.toISOString() } : {}),
    ...(dashboardUrl(call, appBaseUrl) ? { aangan_dashboard_url: dashboardUrl(call, appBaseUrl) as string } : {}),
  };
  if (extra) {
    if (f.projectType) props.aangan_project_type = f.projectType;
    if (f.sizeSqft) props.aangan_size_sqft = f.sizeSqft;
    if (f.timelineText ?? f.completionNeededBy) props.aangan_timeline = (f.timelineText ?? f.completionNeededBy) as string;
    if (booking) props.aangan_consult_type = "design call";
    if (f.referralSource) props.aangan_lead_source = f.referralSource;
    const s = summaryOrExcerpt(call, 600).text;
    if (s) props.aangan_summary = s;
  }
  return props;
}

/** Name fields for a NEW contact. An unknown caller is never merged: name "Unknown caller", last name = the call reference. */
export function newContactProperties(call: CallRow): Props {
  const f = callFacts(call);
  const props: Props = {};
  if (f.callerName) {
    const [first, ...rest] = f.callerName.split(/\s+/);
    props.firstname = first;
    props.lastname = rest.join(" ") || "(voice enquiry)";
  } else {
    props.firstname = "Unknown caller";
    props.lastname = call.callRef ?? call.id.slice(0, 8);
  }
  if (call.fromNumber) props.phone = call.fromNumber;
  return props;
}

// ---------------------------------------------------------------- call record

const DISPOSITION = {
  connected: "f240bbac-87c9-4f6e-bf70-924b57d47db7",
  wrongNumber: "17b47fee-58de-441e-a44c-c6300d46f273",
} as const;

type CriteriaBag = Record<string, { status?: string; evidence?: string | null }>;

function criteriaLines(call: CallRow): string[] {
  const agent = call.criteriaAgent as { final?: CriteriaBag; recorded?: CriteriaBag } | null;
  const gem = (call.criteriaGemini as { extraction?: { criteria?: CriteriaBag } } | null)?.extraction?.criteria;
  const c = agent?.recorded ?? agent?.final ?? gem;
  if (!c) return [];
  const names = { real_project: "Real project", service_area: "Service area", timeline: "Timeline", budget: "Budget", decision_maker: "Decision maker" } as const;
  return (Object.keys(names) as Array<keyof typeof names>).flatMap((k) => {
    const row = c[k];
    if (!row?.status) return [];
    // The caller's budget words are left out: they can hold the very figures the studio never shows.
    const evidence = k === "budget" ? "" : row.evidence ? `: "${row.evidence}"` : "";
    return [`- ${names[k]}: ${row.status}${evidence}`];
  });
}

export function callNote(call: CallRow, booking: Pick<BookingRow, "status" | "startAt"> | null, appBaseUrl: string | undefined): string {
  const f = callFacts(call);
  const s = summaryOrExcerpt(call, 600);
  const lines = [
    `Tier: ${tierLabel(call.tier) ?? "Not rated"} · Status: ${statusLabel(call.status, call.reviewState)}${call.priority === "high" ? " · High priority" : ""}`,
    s.text ? `${s.isExcerpt ? "Caller said (summary unavailable)" : "Summary"}: ${s.text}` : null,
    call.handoffNote ? `Handoff: ${call.handoffNote}` : null,
    call.openQuestions?.length ? `Still to ask: ${call.openQuestions.join("; ")}` : null,
    [projectLine(f), f.locality].filter(Boolean).length ? `Project: ${[projectLine(f), f.locality].filter(Boolean).join(" · ")}` : null,
    f.timelineText || f.completionNeededBy ? `Timeline: ${[f.completionNeededBy ? `by ${f.completionNeededBy}` : null, f.timelineText].filter(Boolean).join(" ")}` : null,
    booking?.status === "accepted" ? `Design call booked: ${formatIst(booking.startAt, true)} IST` : null,
    f.referralSource ? `Lead source: ${f.referralSource}` : null,
    call.budgetTight ? "Note: budget is on the lower side." : null,
    call.flags.length ? `Flags: ${call.flags.join(", ")}` : null,
    criteriaLines(call).length ? `Criteria:\n${criteriaLines(call).join("\n")}` : null,
    dashboardUrl(call, appBaseUrl) ? `Dashboard: ${dashboardUrl(call, appBaseUrl)}` : null,
    call.callRef ? `Call reference: ${call.callRef}` : null,
  ];
  return redactMoney(lines.filter(Boolean).join("\n"));
}

export function callRecordProperties(call: CallRow, booking: Pick<BookingRow, "status" | "startAt"> | null, appBaseUrl: string | undefined): Props {
  const label = tierLabel(call.tier) ?? statusLabel(call.status, call.reviewState);
  return {
    hs_timestamp: (call.startedAt ?? call.createdAt).toISOString(),
    hs_call_title: `Aangan voice enquiry (${label})${call.callRef ? ` ${call.callRef}` : ""}`,
    hs_call_body: callNote(call, booking, appBaseUrl),
    hs_call_direction: "INBOUND",
    ...(call.durationSeconds != null ? { hs_call_duration: String(call.durationSeconds * 1000) } : {}),
    ...(call.fromNumber ? { hs_call_from_number: call.fromNumber } : {}),
    ...(call.toNumber ? { hs_call_to_number: call.toNumber } : {}),
    hs_call_status: call.status === "failed" || call.endReason === "failed" ? "FAILED" : "COMPLETED",
    hs_call_disposition: call.callCategory === "wrong_number" ? DISPOSITION.wrongNumber : DISPOSITION.connected,
  };
}

// ---------------------------------------------------------------- deals

export interface HubspotIds {
  pipelineId: string;
  stageBooked: string | null;
  stageAwaiting: string | null;
  stageLost: string | null;
  portalId: string | null;
}

/**
 * Deal rules (user decision 2026-10-10 replacing the PRD's "Amber on Approve"): Green and Amber
 * enquiries get a deal automatically; Red only on Rescue; an unrated enquiry only on Approve or
 * Rescue; never for non-enquiries, test calls or a Discarded lead.
 */
export function wantsDeal(call: Pick<CallRow, "isTest" | "callCategory" | "tier" | "reviewState">): boolean {
  if (call.isTest || call.callCategory !== "enquiry" || call.reviewState === "discarded") return false;
  if (call.reviewState === "approved" || call.reviewState === "rescued") return true;
  return call.tier === "green" || call.tier === "amber";
}

export function dealStage(call: Pick<CallRow, "reviewState">, booking: Pick<BookingRow, "status"> | null, ids: HubspotIds): string | null {
  if (call.reviewState === "discarded") return ids.stageLost;
  return booking?.status === "accepted" ? ids.stageBooked : ids.stageAwaiting;
}

export function dealName(call: CallRow): string {
  const f = callFacts(call);
  const parts = [f.callerName ?? "Unknown caller", f.projectType && f.projectType !== "other" ? f.projectType : null, f.locality].filter(Boolean);
  return parts.join(", ");
}

export function hubspotRecordUrl(portalId: string | null, objectTypeId: string, id: string | null): string | null {
  return portalId && id ? `https://app.hubspot.com/contacts/${portalId}/record/${objectTypeId}/${id}` : null;
}
