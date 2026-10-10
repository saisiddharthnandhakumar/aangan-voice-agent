import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { env } from "@/env";
import { getCallDetail } from "@/lib/dashboard/queries";
import { parseTranscript } from "@/lib/dashboard/transcript";
import { callFacts, projectLine } from "@/lib/pipeline/facts";
import { hubspotRecordUrl } from "@/lib/hubspot/mapping";
import { formatIst, statusLabel } from "@/lib/rules";
import { calledAgo, designCallText, nextAction } from "@/lib/dashboard/present";
import { dialable, isCallbackNote } from "@/lib/dashboard/callback";
import { Card, Chip, displayName, StatusChip, TierBadge } from "../../_components/ui";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Lead · Aangan Studio" };
export const maxDuration = 300;

type Crit = Record<string, { status?: string; evidence?: string | null }>;
const CRITERIA: Array<[string, string]> = [
  ["real_project", "Real project"],
  ["service_area", "Service area"],
  ["timeline", "Timeline"],
  ["budget", "Budget"],
  ["decision_maker", "Decision maker"],
];
function criteriaOf(raw: unknown): Crit | null {
  const r = raw as { recorded?: Crit; final?: Crit } | null;
  return r?.recorded ?? r?.final ?? null;
}

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getCallDetail(db(), id);
  if (!detail) notFound();
  const { call, booking, actions, related } = detail;
  const tel = dialable(call.fromNumber);
  const calledBack = actions.some((a) => isCallbackNote(a.note));
  const facts = callFacts(call);
  const turns = parseTranscript(call.transcript);
  const agentCrit = criteriaOf(call.criteriaAgent);
  const gemCrit = (call.criteriaGemini as { extraction?: { criteria?: Crit } } | null)?.extraction?.criteria ?? null;
  const portal = env().HUBSPOT_PORTAL_ID ?? null;
  const when = call.startedAt ?? call.createdAt;
  const link = (obj: string, hid: string | null) => hubspotRecordUrl(portal, obj, hid);


  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard" className="inline-flex min-h-12 items-center text-base font-semibold text-accent underline-offset-4 hover:underline">&larr; Designers&apos; view</Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-[40px] leading-tight font-semibold tracking-tight">{displayName(facts.callerName)}</h1>
          <TierBadge tier={call.tier} />
          {call.priority === "high" && <Chip tone="warn">High priority</Chip>}
          {call.isTest && <Chip>Test call</Chip>}
          {call.reviewState === "discarded" && <Chip tone="bad">Cancelled</Chip>}
          {call.priceLeak && <Chip tone="bad">Price leak</Chip>}
        </div>
        <p className="num mt-2 text-[13px] text-ink-3">
          {call.fromNumber ?? "No number"} &middot; {formatIst(when, true)} IST{call.calledAfterHours ? " \u00B7 after hours" : ""}
          {call.durationSeconds != null ? ` \u00B7 ${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s` : ""}
          {call.callRef ? ` \u00B7 ref ${call.callRef}` : ""}
        </p>
      </div>

      <section aria-label="Next action" className="grid gap-4 rounded-2xl border border-line border-l-4 border-l-[var(--accent)] bg-surface p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="text-[13px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Next action</p>
          <p className="font-display mt-1 text-[22px] leading-snug font-semibold">{nextAction({ tier: call.tier, status: call.status, reviewState: call.reviewState, calledBack, consultAt: booking?.status === "accepted" ? booking.startAt : null })}</p>
          <p className="mt-1 text-[13px] text-ink-3"><StatusChip status={call.status} review={call.reviewState} /> <span className="ml-1">{calledAgo(when, new Date())}</span></p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end sm:text-right">
          {tel && (
            <a href={`tel:${tel}`} className="num inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-6 text-base font-semibold text-accent-ink hover:opacity-90">
              Call back {call.fromNumber}
            </a>
          )}
          <div>
          <p className="text-[13px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Design call</p>
          <p className="num font-display mt-1 text-[22px] font-semibold">{designCallText(booking?.status === "accepted" ? booking.startAt : null, new Date())}</p>
          </div>
        </div>
      </section>

      {call.flags.includes("unclassified") && (
        <p className="rounded-2xl bg-warn-bg px-5 py-4 text-base text-warn-ink">The voice agent did not record a tier for this call (its tools did not reach us), so it is unrated. Please read the summary and transcript and decide.</p>
      )}
      {call.flags.includes("needs_manual_link") && (
        <p className="rounded-2xl bg-warn-bg px-5 py-4 text-base text-warn-ink">Two calls overlapped and this one could not be matched to its assessment automatically.</p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="Summary">
            {call.summary ? <p className="whitespace-pre-line">{call.summary}</p> : <p className="text-ink-2">No summary yet (Gemini has not run or failed). The transcript is below.</p>}
            {call.handoffNote && <p className="mt-3"><span className="font-semibold">Handoff: </span>{call.handoffNote}</p>}
            {call.openQuestions && call.openQuestions.length > 0 && (
              <div className="mt-3">
                <p className="font-semibold">Still to ask</p>
                <ul className="ml-5 list-disc text-ink-2">{call.openQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
              </div>
            )}
          </Card>

          <Card title="Criteria">
            {agentCrit || gemCrit ? (
              <ul className="divide-y divide-line">
                {CRITERIA.map(([k, label]) => {
                  const a = agentCrit?.[k];
                  const g = gemCrit?.[k];
                  return (
                    <li key={k} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-32 font-medium">{label}</span>
                        <Chip tone={a?.status === "pass" ? "ok" : a?.status === "fail" ? "bad" : "warn"}>{a?.status ?? "not recorded"}</Chip>
                        {g?.status && g.status !== a?.status && <span className="text-[13px] text-ink-3">Gemini read it as {g.status}</span>}
                      </div>
                      {/* The caller's budget words are never shown: they can hold the very figures we keep out of the UI. */}
                      {a?.evidence && k !== "budget" && <p className="mt-1 text-base text-ink-2">&ldquo;{a.evidence}&rdquo;</p>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-ink-2">No criteria were recorded for this call.</p>
            )}
            {call.tierReasons && call.tierReasons.length > 0 && <p className="mt-3 text-base"><span className="font-semibold">Why this tier: </span>{call.tierReasons.join("; ")}</p>}
            {(call.flags.length > 0 || call.budgetTight) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {call.budgetTight && <Chip tone="warn">Budget on the lower side</Chip>}
                {call.flags.filter((f) => f !== "budget_tight").map((f) => <Chip key={f} tone="warn">{f.replace(/_/g, " ")}</Chip>)}
              </div>
            )}
          </Card>

          <Card title="Project">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-base sm:grid-cols-2">
              {[
                ["Project", projectLine(facts)],
                ["Locality", facts.locality],
                ["Timeline", [facts.completionNeededBy ? `by ${facts.completionNeededBy}` : null, facts.timelineText].filter(Boolean).join(" · ") || null],
                ["Site ready", call.siteReadyText],
                ["Lead source", facts.referralSource],
                ["Scope", facts.scopeSummary],
              ].map(([k, v]) => v && <div key={k}><dt className="text-ink-3">{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </Card>

          <Card title="Transcript" aside={call.recordingUrl && /^https:\/\//.test(call.recordingUrl) ? <a href={call.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-base underline">Recording</a> : undefined}>
            {turns.length === 0 ? (
              <p className="text-ink-2">No transcript yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {turns.map((t, i) => (
                  <li key={i} className={`flex gap-3 rounded-lg px-3 py-2 ${t.leak ? "bg-bad-bg" : t.speaker === "agent" ? "bg-surface-2" : ""}`}>
                    <span className="w-14 shrink-0 text-[13px] font-semibold text-ink-3 uppercase">{t.speaker === "agent" ? "Agent" : "Caller"}</span>
                    <span className="min-w-0 flex-1 text-base">{t.text}{t.leak && <span className="ml-2 font-semibold text-bad-ink">(looks like a price)</span>}</span>
                    {t.time && <span className="num shrink-0 text-[13px] text-ink-3">{t.time}</span>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Your decision">
            <ReviewForm callId={call.id} tier={call.tier} reviewState={call.reviewState} />
          </Card>

          <Card title="Design call">
            {booking ? (
              <div className="text-base">
                <p className="font-medium">{formatIst(booking.startAt, true)} IST</p>
                <p className="text-ink-2">Status: {booking.status}{booking.emailIsPlaceholder ? " · the caller gave no email, so the invite went to a placeholder address" : ""}</p>
              </div>
            ) : (
              <p className="text-base text-ink-2">No design call booked.</p>
            )}
          </Card>

          <Card title="HubSpot">
            <ul className="flex flex-col gap-1.5 text-base">
              {[["Contact", "0-1", call.hubspotContactId], ["Call record", "0-48", call.hubspotCallId], ["Deal", "0-3", call.hubspotDealId]].map(([label, obj, hid]) => (
                <li key={label as string} className="flex items-center justify-between gap-3">
                  <span className="text-ink-3">{label}</span>
                  {hid ? (link(obj as string, hid as string) ? <a className="inline-flex min-h-12 items-center font-semibold text-accent underline underline-offset-4" href={link(obj as string, hid as string) as string} target="_blank" rel="noopener noreferrer">Open</a> : <Chip tone="ok">Logged</Chip>) : <Chip>Not logged</Chip>}
                </li>
              ))}
            </ul>
            {call.isTest && <p className="mt-2 text-[13px] text-ink-3">Test calls are never sent to HubSpot or Telegram.</p>}
          </Card>

          <Card title="Telegram">
            <p className="text-base text-ink-2">{call.telegramSentAt ? `Alert sent ${formatIst(call.telegramSentAt)} IST` : "No alert sent for this call."}</p>
          </Card>

          <Card title="History">
            {actions.length === 0 ? (
              <p className="text-base text-ink-2">No actions yet.</p>
            ) : (
              <ol className="flex flex-col gap-2 text-base">
                {actions.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium">{isCallbackNote(a.note) ? "Call-back" : a.action === "discard" ? "Cancelled" : a.action === "note" ? "Note" : a.action === "rescue" ? "Rescued" : a.action}</span> <span className="text-ink-3">by {a.actorRole} · {formatIst(a.createdAt)} IST</span>
                    {a.note && <p className="text-ink-2">{a.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {related.length > 0 && (
            <Card title="Linked calls (same caller, within a day)">
              <ul className="flex flex-col gap-1.5 text-base">
                {related.map((r) => (
                  <li key={r.id}><Link className="inline-flex min-h-8 items-center text-accent underline underline-offset-4" href={`/dashboard/calls/${r.id}`}>{formatIst(r.callTime)} IST</Link> · {statusLabel(r.status, "none")}{r.tier ? ` · ${r.tier}` : ""}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
