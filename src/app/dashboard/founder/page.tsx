import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/db";
import { env } from "@/env";
import { requireRole } from "@/lib/auth/guard";
import { founderMetrics, type FounderMetrics } from "@/lib/dashboard/metrics";
import { addDays, parseRange } from "@/lib/dashboard/range";
import { istParts } from "@/lib/rules/time";
import { CallsPerDayChart, CostPerDayChart, TierMix } from "./charts";

export const metadata = { title: "Founder view · Aangan Studio" };
export const maxDuration = 60;

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 1000) / 10}%`);
const inr = (v: number | null) => (v == null ? "–" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const inrWhole = (v: number | null) => (v == null ? "–" : `₹${Math.round(v).toLocaleString("en-IN")}`);
const dur = (s: number | null) => (s == null ? "–" : s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`);
const num = (v: number | null) => (v == null ? "–" : v.toLocaleString("en-IN"));

function Tile({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "warn" | "bad" }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === "bad" ? "border-bad-ink/30 bg-bad-bg" : tone === "warn" ? "border-warn-ink/30 bg-warn-bg" : "border-line bg-surface"}`}>
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className="num mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-3">{note}</p>}
    </div>
  );
}

function Group({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">{title}</h2>
      {hint && <p className="-mt-1 text-xs text-ink-3">{hint}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function FounderPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireRole("founder");
  const p = await searchParams;
  const now = new Date();
  const range = parseRange(one(p.from), one(p.to), now);
  const m: FounderMetrics = await founderMetrics(db(), range, now, { staleHours: env().AMBER_STALE_HOURS });
  const today = istParts(now).date;
  const preset = (days: number) => `/dashboard/founder?from=${addDays(today, -(days - 1))}&to=${today}`;
  const csv = `/api/dashboard/export?from=${range.from}&to=${range.to}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Founder view</h1>
          <p className="text-sm text-ink-2">Test calls are never counted. Times are IST. Estimates are labelled as such.</p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">From<input type="date" name="from" defaultValue={range.from} className="h-10 rounded-lg border border-line bg-surface px-2 text-sm" /></label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">To<input type="date" name="to" defaultValue={range.to} className="h-10 rounded-lg border border-line bg-surface px-2 text-sm" /></label>
          <button className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink">Apply</button>
        </form>
        <div className="flex items-center gap-1 text-sm">
          {[7, 30, 90].map((d) => <Link key={d} href={preset(d)} className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">{d} days</Link>)}
          <a href={csv} className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">Download CSV</a>
        </div>
      </div>

      <Group title="Right now" hint="Current state, not limited to the date range.">
        <Tile label="Live calls" value={m.now.liveCalls} note="In a call, started in the last 30 minutes" />
        <Tile label="Active leads" value={m.now.activeLeads.total} note={`${m.now.activeLeads.amberAwaitingReview} Amber awaiting review + ${m.now.activeLeads.greenWithConsultAhead} Green with a design call ahead`} />
        <Tile label="Waiting too long" value={m.now.waitingTooLong.count} tone={m.now.waitingTooLong.count ? "warn" : undefined} note={m.now.waitingTooLong.count ? `Oldest ${m.now.waitingTooLong.oldestHours} h (limit ${m.now.waitingTooLong.thresholdHours} h)` : `Amber unreviewed past ${m.now.waitingTooLong.thresholdHours} h`} />
      </Group>

      <Group title="Calls" hint="Only calls that reached Vaani are visible. A call that never connected to Vaani cannot be counted here.">
        <Tile label="Calls received" value={num(m.calls.received)} />
        <Tile label="Answered" value={num(m.calls.answered)} />
        <Tile label="Missed or not connected" value={num(m.calls.missedOrNotConnected)} note={`${m.calls.missedInWorkingHours} in working hours · seen by Vaani only`} />
        <Tile label="Dropped before assessment" value={num(m.calls.droppedBeforeAssessment)} note={`${m.calls.droppedWithCallbackAlert} got a callback alert`} />
        <Tile label="Repeat callers" value={num(m.calls.repeatCallers)} note="Calls linked to an earlier call within 24 h" />
        <Tile label="After-hours share" value={pct(m.calls.afterHoursShare)} note={`${m.calls.afterHours} calls outside working hours`} />
      </Group>

      <div className="grid gap-4 lg:grid-cols-2">
        <CallsPerDayChart data={m.series.callsPerDay} />
        <TierMix tiers={m.tiers} />
      </div>

      <Group title="Leads and bookings">
        <Tile label="Design calls booked" value={num(m.bookings.booked)} />
        <Tile label="Booking rate" value={pct(m.bookings.rateOfBookable)} note="Booked ÷ (Green + Amber)" />
        <Tile label="Booking rate, Green only" value={pct(m.bookings.rateOfGreen)} />
        <Tile label="Escalations" value={num(m.escalations.count)} tone={m.escalations.unansweredCount ? "warn" : undefined} note={`${m.escalations.unansweredCount} not yet answered · first response ${m.escalations.avgFirstResponseMinutes == null ? "–" : `${m.escalations.avgFirstResponseMinutes} min`} on average`} />
        <Tile label="Price leaks" value={num(m.escalations.priceLeaks)} tone={m.escalations.priceLeaks ? "bad" : undefined} note="Calls where the agent said a figure" />
      </Group>

      <Group title="Speed" hint="Targets: answered within 5 minutes; Telegram handoff within 2 minutes of the call ending.">
        <Tile label="Time to answer (average)" value={dur(m.timing.answerSeconds.avg)} note={`95th percentile ${dur(m.timing.answerSeconds.p95)} · ${m.timing.answerSeconds.over5Minutes} over 5 min · ${m.timing.answerSeconds.measured} measured`} />
        <Tile label="Time to handoff (average)" value={dur(m.timing.handoffSeconds.avg)} note={`95th percentile ${dur(m.timing.handoffSeconds.p95)} · ${m.timing.handoffSeconds.over2Minutes} over 2 min · ${m.timing.handoffSeconds.measured} measured`} />
      </Group>

      <Group title="HubSpot">
        <Tile label="Calls logged" value={num(m.hubspot.callsLogged)} note={`${pct(m.hubspot.loggingCompleteness)} of calls received`} />
        <Tile label="Calls with a failed sync step" value={num(m.hubspot.callsWithFailedStep)} tone={m.hubspot.callsWithFailedStep ? "bad" : undefined} note="Retry them from the call page" />
        <Tile label="Deals by tier" value={num(m.hubspot.dealsByTier.green + m.hubspot.dealsByTier.amber + m.hubspot.dealsByTier.red + m.hubspot.dealsByTier.none)} note={`Green ${m.hubspot.dealsByTier.green} · Amber ${m.hubspot.dealsByTier.amber} · Red ${m.hubspot.dealsByTier.red}`} />
        <Tile label="Deals by designer action" value={num(m.hubspot.dealsApproved + m.hubspot.dealsRescued)} note={`Approved ${m.hubspot.dealsApproved} · Rescued ${m.hubspot.dealsRescued}`} />
      </Group>

      <div className="grid gap-4 lg:grid-cols-2">
        <CostPerDayChart data={m.series.costPerDay} />
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">Cost and estimated pipeline</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-3">Total cost</dt><dd className="num text-xl font-semibold">{inr(m.cost.totalInr)}</dd><dd className="text-xs text-ink-3">Vaani {inr(m.cost.vaaniInr)} · Gemini {inr(m.cost.geminiInr)}</dd></div>
            <div><dt className="text-ink-3">Cost per call</dt><dd className="num text-xl font-semibold">{inr(m.cost.perCallInr)}</dd><dd className="text-xs text-ink-3">{m.cost.callsWithCost} calls with a cost</dd></div>
            <div><dt className="text-ink-3">Cost per booked design call</dt><dd className="num text-xl font-semibold">{inr(m.cost.perBookedConsultInr)}</dd></div>
            <div><dt className="text-ink-3">Estimated pipeline (an estimate)</dt><dd className="num text-xl font-semibold">{inrWhole(m.pipeline.estimatedValueInr)}</dd><dd className="text-xs text-ink-3">{m.pipeline.qualifiedLeads} qualified leads: Green, Amber, and Red leads that were rescued</dd></div>
          </dl>
          <p className="text-xs text-ink-3">Pipeline value is a midpoint estimate, not a quote, shown beside total cost for scale{m.pipeline.valuePerRupeeOfCost != null ? `: about ₹${num(m.pipeline.valuePerRupeeOfCost)} of estimated pipeline per ₹1 spent` : ""}.</p>
        </section>
      </div>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-2 uppercase">Lead source</h2>
        {m.leadSources.length === 0 ? (
          <p className="text-sm text-ink-2">No lead sources recorded in this range.</p>
        ) : (
          <table className="num w-full max-w-md text-left text-sm">
            <thead><tr className="text-xs text-ink-3"><th className="py-1 pr-3 font-medium">Source</th><th className="py-1 font-medium">Calls</th></tr></thead>
            <tbody>{m.leadSources.map((s) => <tr key={s.source} className="border-t border-line"><td className="py-1.5 pr-3 capitalize">{s.source}</td><td className="py-1.5">{s.count}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
