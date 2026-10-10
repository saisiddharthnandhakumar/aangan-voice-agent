import { summaryOrExcerpt, callFacts, projectLine } from "@/lib/pipeline/facts";
import { formatIst } from "@/lib/rules";
import type { BookingRow, CallRow } from "@/lib/tools/repo";
import { escapeHtml, type InlineButton } from "./client";

/**
 * What each call sends to Telegram, and to whom (PRD section 4, Telegram; user decision
 * 2026-10-10: Green and Amber both alert the designers, labelled with their tier; Red sends nothing).
 *
 *   designers' group: Green and Amber enquiries, existing-client callback requests, dropped calls
 *                     with a number (callback), and calls no tool call reached (unclassified)
 *   founder chat:     complaints (escalations) and price leaks
 *   nobody:           Red, vendors, job seekers, wrong numbers, calls with no number that dropped,
 *                     and every is_test call (P8)
 *
 * Every caller-supplied string is HTML-escaped. No pricing figure, budget figure or phone number in
 * a URL: the dashboard link carries only the call's UUID.
 */

export type AlertKey = "lead" | "escalation" | "price_leak";
export type AlertKind = "lead_green" | "lead_amber" | "existing_client" | "dropped" | "unclassified" | "escalation" | "price_leak";

export interface PlannedAlert {
  key: AlertKey;
  kind: AlertKind;
  chat: "designers" | "founder";
  text: string;
  button?: InlineButton;
}

export interface AlertContext {
  appBaseUrl?: string;
  booking: Pick<BookingRow, "status" | "startAt"> | null;
  /** Escalations and leaks go to the founder chat; if it is not configured they fall back to the designers' group. */
  founderChatConfigured: boolean;
}

const SUMMARY_MAX = 600;
const e = escapeHtml;

function dashboardButton(call: CallRow, appBaseUrl?: string): InlineButton | undefined {
  if (!appBaseUrl || !/^https:\/\//.test(appBaseUrl)) return undefined; // Telegram only accepts public URLs
  return { text: "Open in dashboard", url: `${appBaseUrl.replace(/\/$/, "")}/dashboard/calls/${call.id}` };
}

function line(label: string, value: string | null | undefined): string | null {
  return value ? `<b>${e(label)}:</b> ${e(value)}` : null;
}

function timelineLine(call: CallRow): string | null {
  const f = callFacts(call);
  const parts = [f.completionNeededBy ? `by ${f.completionNeededBy}` : null, f.timelineText ? `"${f.timelineText}"` : null].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function consultLine(ctx: AlertContext): string {
  if (ctx.booking?.status === "accepted") return `${formatIst(ctx.booking.startAt)} IST (booked)`;
  if (ctx.booking?.status === "pending") return `${formatIst(ctx.booking.startAt)} IST (booking being confirmed)`;
  return "Not booked: please call to arrange";
}

/** The "uncertainty" note: why a designer should look twice. Plain words, no figures. */
function notes(call: CallRow): string | null {
  const n: string[] = [];
  if (call.budgetTight) n.push("budget is on the lower side");
  if (call.flags.includes("unclassified")) n.push("the voice agent did not record a tier, so this lead is unrated");
  if (call.flags.includes("needs_manual_link")) n.push("two calls overlapped and could not be matched automatically");
  if (call.flags.includes("wants_human")) n.push("the caller asked for a person");
  if (call.flags.includes("structural_changes")) n.push("structural changes mentioned");
  if (call.flags.includes("frustrated_repeat")) n.push("frustrated repeat caller");
  return n.length ? n.join("; ") : null;
}

function summaryBlock(call: CallRow): string | null {
  const s = summaryOrExcerpt(call, SUMMARY_MAX);
  if (!s.text) return null;
  return `<b>${s.isExcerpt ? "Caller said (summary unavailable)" : "Summary"}:</b> ${e(s.text)}`;
}

function header(kind: AlertKind, call: CallRow): string {
  const high = call.priority === "high" ? " · ⚠ High priority" : "";
  switch (kind) {
    case "lead_green":
      return `🟢 <b>GREEN lead</b> · ready for a designer${high}`;
    case "lead_amber":
      return `🟠 <b>AMBER lead</b> · needs a look first${high}`;
    case "existing_client":
      return `🔵 <b>Existing client: callback request</b>${high}`;
    case "unclassified":
      return `⚪ <b>New call, not rated</b>${high}`;
    case "dropped":
      return "📵 <b>Dropped call: please call back</b>";
    case "escalation":
      return `🚨 <b>ESCALATION: existing client unhappy</b>${high}`;
    case "price_leak":
      return "⚠ <b>PRICE LEAK: the agent said a price</b>";
  }
}

/** Line 2 of a lead alert: what the tier means for the designer, plus when the design call is. */
function verdict(kind: AlertKind, call: CallRow, ctx: AlertContext): string | null {
  if (kind === "lead_green") return `Meets all the criteria. <b>Design call:</b> ${e(consultLine(ctx))}`;
  if (kind === "lead_amber") {
    const why = call.tierReasons?.[0] ? `Why Amber: ${call.tierReasons[0]}. ` : "";
    return `${e(why)}<b>Design call:</b> ${e(consultLine(ctx))}`;
  }
  return null;
}

function who(call: CallRow): string {
  const f = callFacts(call);
  const name = f.callerName ?? "Unknown caller";
  return call.fromNumber ? `<b>${e(name)}</b> · ${e(call.fromNumber)}` : `<b>${e(name)}</b> · no number`;
}

export function buildAlertText(kind: AlertKind, call: CallRow, ctx: AlertContext): string {
  const f = callFacts(call);
  const common = [header(kind, call), verdict(kind, call, ctx), who(call)].filter((x): x is string => x !== null);
  let body: Array<string | null>;
  switch (kind) {
    case "dropped":
      body = [`The call ended before the caller gave details.`, line("Duration", call.durationSeconds != null ? `${call.durationSeconds}s` : null), summaryBlock(call)];
      break;
    case "escalation":
      body = [
        line("Their designer", call.existingProjectDesigner),
        summaryBlock(call),
        "The agent did not try to solve it and promised no callback time.",
      ];
      break;
    case "price_leak": {
      const evidence = (call.criteriaGemini as { price_leak?: { evidence?: string | null } } | null)?.price_leak?.evidence;
      body = [
        `Call ${e(call.callRef ?? call.id.slice(0, 8))}: a figure appears in the agent's own words.`,
        evidence ? `<b>Gemini saw:</b> ${e(evidence)}` : null,
        "Review the transcript in the dashboard.",
      ];
      break;
    }
    case "existing_client":
      body = [line("Their designer", call.existingProjectDesigner), summaryBlock(call)];
      break;
    default:
      body = [
        line("Project", projectLine(f)),
        line("Locality", f.locality),
        line("Timeline", timelineLine(call)),
        line("Lead source", f.referralSource),
        notes(call) ? `<b>Note:</b> ${e(notes(call) as string)}` : null,
        summaryBlock(call),
        call.handoffNote ? `<b>Handoff:</b> ${e(call.handoffNote)}` : null,
        call.openQuestions?.length ? `<b>Still to ask:</b> ${e(call.openQuestions.join(" · "))}` : null,
      ];
  }
  return [...common, ...body].filter(Boolean).join("\n");
}

/** Decide which alerts a call should send. Pure. */
export function planAlerts(call: CallRow, ctx: AlertContext): PlannedAlert[] {
  if (call.isTest) return [];
  const out: PlannedAlert[] = [];
  const button = dashboardButton(call, ctx.appBaseUrl);
  const add = (key: AlertKey, kind: AlertKind, chat: "designers" | "founder") => out.push({ key, kind, chat, text: buildAlertText(kind, call, ctx), button });

  if (call.status === "dropped") {
    if (call.fromNumber) add("lead", "dropped", "designers");
  } else if (call.callCategory === "enquiry") {
    if (call.tier === "green") add("lead", "lead_green", "designers");
    else if (call.tier === "amber") add("lead", "lead_amber", "designers");
    else if (call.tier === null) add("lead", "unclassified", "designers");
    // Red: no alert (PRD section 3, step 7); it is on the dashboard and in HubSpot.
  } else if (call.callCategory === "existing_client") {
    add("lead", "existing_client", "designers");
  } else if (call.callCategory === null) {
    add("lead", "unclassified", "designers");
  }
  if (call.callCategory === "existing_client_complaint") add("escalation", "escalation", "founder");
  if (call.priceLeak) add("price_leak", "price_leak", "founder");
  return out;
}

/** Daily digest (P9): Red leads from the last day and every Amber lead still without a design call. */
export interface DigestItem {
  id: string;
  tier: "red" | "amber";
  name: string | null;
  locality: string | null;
  createdAt: Date;
}

export function buildDigest(items: readonly DigestItem[], appBaseUrl: string | undefined, now: Date): { text: string; button?: InlineButton } {
  const red = items.filter((i) => i.tier === "red");
  const amber = items.filter((i) => i.tier === "amber");
  const row = (i: DigestItem) => {
    const ageH = Math.max(0, Math.round((now.getTime() - i.createdAt.getTime()) / 3_600_000));
    const age = ageH >= 48 ? `${Math.round(ageH / 24)} days ago` : `${ageH}h ago`;
    return `• ${e(i.name ?? "Unknown caller")}${i.locality ? `, ${e(i.locality)}` : ""} (${age})`;
  };
  const lines = [
    `📋 <b>Morning digest</b> · ${e(formatIst(now).replace(/, .*$/, ""))}`,
    amber.length ? `\n🟠 <b>Amber, no design call yet (${amber.length})</b>\n${amber.slice(0, 15).map(row).join("\n")}${amber.length > 15 ? `\n…and ${amber.length - 15} more` : ""}` : "\n🟠 No Amber leads waiting for a design call.",
    red.length ? `\n🔴 <b>Red in the last day (${red.length})</b>\n${red.slice(0, 15).map(row).join("\n")}${red.length > 15 ? `\n…and ${red.length - 15} more` : ""}\nRed leads are never deleted: Rescue any that deserve another look.` : "\n🔴 No Red leads in the last day.",
  ];
  const button = appBaseUrl && /^https:\/\//.test(appBaseUrl) ? { text: "Open dashboard", url: `${appBaseUrl.replace(/\/$/, "")}/dashboard` } : undefined;
  return { text: lines.join("\n"), button };
}
