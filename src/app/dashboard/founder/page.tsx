import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/db";
import { env } from "@/env";
import { requireRole } from "@/lib/auth/guard";
import { activePreset, founderHeadlines, RANGE_PRESETS } from "@/lib/dashboard/founder-view";
import { founderMetrics, type FounderMetrics } from "@/lib/dashboard/metrics";
import { addDays, parseRange } from "@/lib/dashboard/range";
import { istParts } from "@/lib/rules/time";
import { CallsPerDayChart, CostPerDayChart, TierBar } from "./charts";

export const metadata = { title: "Founder's view · Aangan Studio" };
export const maxDuration = 60;

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const inr = (v: number | null) => (v == null ? "–" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const inrWhole = (v: number | null) => (v == null ? "–" : `₹${Math.round(v).toLocaleString("en-IN")}`);
const dur = (s: number | null) => (s == null ? "–" : s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

const label = "text-[13px] font-semibold tracking-[0.08em] text-ink-2 uppercase";

function Hero({ name, value, meaning, tone }: { name: string; value: ReactNode; meaning: ReactNode; tone?: "warn" }) {
  return (
    <div className={`flex flex-col gap-2 rounded-2xl border p-5 ${tone === "warn" ? "border-warn-ink/40 bg-warn-bg text-warn-ink" : "border-line bg-surface"}`}>
      <p className={tone === "warn" ? "text-[13px] font-semibold tracking-[0.08em] uppercase" : label}>{name}</p>
      <p className="num font-display text-[56px] leading-none font-light">{value}</p>
      <p className={`text-base ${tone === "warn" ? "" : "text-ink-2"}`}>{meaning}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-display text-[22px] leading-tight font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const Big = ({ children }: { children: ReactNode }) => <p className="num font-display text-[28px] leading-none font-semibold">{children}</p>;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function FounderPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireRole("founder");
  const p = await searchParams;
  const now = new Date();
  const hasRange = Boolean(one(p.from) || one(p.to));
  const range = parseRange(one(p.from), one(p.to), now, 7);
  const m: FounderMetrics = await founderMetrics(db(), range, now, { staleHours: env().AMBER_STALE_HOURS });
  const h = founderHeadlines(m);
  const today = istParts(now).date;
  const active = hasRange ? activePreset(range, today) : 7;
  const preset = (days: number) => `/dashboard/founder?from=${addDays(today, -(days - 1))}&to=${today}`;
  const csv = `/api/dashboard/export?from=${range.from}&to=${range.to}`;
  const chip = (on: boolean) =>
    `flex min-h-12 items-center rounded-lg px-4 text-base font-semibold ${on ? "bg-surface-2 text-ink underline decoration-2 underline-offset-8 decoration-[var(--accent)]" : "text-ink-2 hover:bg-surface-2"}`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[40px] leading-tight font-semibold tracking-tight">Founder&apos;s view</h1>
        <p className="mt-1 text-base text-ink-2">Counts calls that reached Vaani. Test calls excluded.</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <nav aria-label="Date range" className="flex flex-wrap items-center gap-1">
          {RANGE_PRESETS.map((d) => (
            <Link key={d} href={preset(d)} aria-current={active === d ? "page" : undefined} className={chip(active === d)}>
              {d} days
            </Link>
          ))}
          <details className="relative" open={active === "custom"}>
            <summary className={`${chip(active === "custom")} cursor-pointer`}>Custom</summary>
            <form method="get" className="absolute top-14 left-0 z-20 flex w-[min(92vw,340px)] flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">From<input type="date" name="from" defaultValue={range.from} className="min-h-12 rounded-lg border border-line bg-bg px-2 text-base font-normal" /></label>
                <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">To<input type="date" name="to" defaultValue={range.to} className="min-h-12 rounded-lg border border-line bg-bg px-2 text-base font-normal" /></label>
              </div>
              <button className="min-h-12 rounded-lg bg-accent px-5 text-base font-semibold text-accent-ink hover:opacity-90">Show these dates</button>
            </form>
          </details>
        </nav>
        <a href={csv} className="ml-auto flex min-h-12 items-center text-base font-semibold text-accent underline underline-offset-4">
          Download CSV
        </a>
      </div>

      {h.hubspotFailed > 0 && (
        <p role="alert" className="rounded-2xl bg-warn-bg px-5 py-4 text-base text-warn-ink">
          {h.hubspotFailed === 1 ? "One call" : `${h.hubspotFailed} calls`} did not finish syncing to HubSpot. Open the lead in the Designers&apos; view and retry the step.
        </p>
      )}

      <section aria-label="Headlines" className="flex flex-col gap-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Hero
            name="Answered within 5 minutes"
            value={pct(h.answeredFast.pct)}
            meaning={h.answeredFast.measured ? `of ${h.answeredFast.measured} calls were picked up inside 5 minutes` : "No calls measured in this range yet"}
          />
          <Hero
            name="After-hours calls captured"
            value={h.afterHours.count}
            meaning={`${pct(h.afterHours.shareOfAll)} of all calls, ${h.afterHours.booked} became booked design calls`}
          />
          <Hero
            name="Design calls booked"
            value={h.booked.count}
            meaning={h.booked.rateOfBookable == null ? "No Green or Amber leads yet" : `${pct(h.booked.rateOfBookable)} of Green and Amber leads`}
          />
          <Hero
            name="Leads waiting too long"
            value={h.waiting.count}
            tone={h.waiting.count > 0 ? "warn" : undefined}
            meaning={h.waiting.count > 0 ? `Oldest ${h.waiting.oldestHours ?? "?"} h, past the ${h.waiting.thresholdHours} h limit` : "None waiting"}
          />
        </div>
        <p className="text-[13px] text-ink-3">
          Answer time is measured from Vaani&apos;s call start, which may not be the moment the phone began ringing (UNVERIFIED). Leads waiting is right now, not limited to the dates above.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Leads by tier">
          <TierBar tiers={m.tiers} />
        </Panel>
        <Panel title="Time to hand a lead to a designer">
          {h.handoff.measured === 0 ? (
            <p className="text-base text-ink-2">Not measured yet in this range.</p>
          ) : (
            <>
              <Big>{dur(h.handoff.avgSeconds)}</Big>
              <p className="text-base text-ink-2">on average. Target: under 2 min, {h.handoff.over2Minutes} over.</p>
            </>
          )}
        </Panel>
        <Panel title="What it costs to run">
          <Big>{inr(m.cost.totalInr)}</Big>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-base">
            <div><dt className="text-[13px] text-ink-3">Per call</dt><dd className="num font-semibold">{inr(m.cost.perCallInr)}</dd></div>
            <div><dt className="text-[13px] text-ink-3">Per booked design call</dt><dd className="num font-semibold">{inr(m.cost.perBookedConsultInr)}</dd></div>
            <div><dt className="text-[13px] text-ink-3">Vaani</dt><dd className="num">{inr(m.cost.vaaniInr)}</dd></div>
            <div><dt className="text-[13px] text-ink-3">Gemini</dt><dd className="num">{inr(m.cost.geminiInr)}</dd></div>
          </dl>
        </Panel>
        <Panel title="Pipeline generated">
          {h.pipeline.shown ? (
            <>
              <Big>{inrWhole(h.pipeline.estimatedValueInr)}</Big>
              <p className="text-base text-ink-2">
                Estimate across {h.pipeline.qualifiedLeads} qualified leads
                {h.pipeline.perRupee != null ? `: about ₹${h.pipeline.perRupee.toLocaleString("en-IN")} of pipeline per ₹1 of running cost.` : "."}
              </p>
            </>
          ) : (
            <p className="text-base text-ink-2">Not enough leads yet to show a total.</p>
          )}
          <p className="text-[13px] text-ink-3">An estimate, not a quote.</p>
        </Panel>
      </div>

      {h.priceLeaks > 0 ? (
        <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-bad-ink/40 bg-bad-bg p-5 text-bad-ink">
          <div>
            <h2 className="font-display text-[22px] leading-tight font-semibold">Price leaks</h2>
            <p className="text-base">
              <span className="num font-semibold">{h.priceLeaks}</span> {h.priceLeaks === 1 ? "call" : "calls"} where the agent seems to have said a figure.
            </p>
          </div>
          <Link href={`/dashboard?tab=all&leak=1&from=${range.from}&to=${range.to}`} className="ml-auto flex min-h-12 items-center rounded-lg bg-bad-ink px-5 text-base font-semibold text-bad-bg hover:opacity-90">
            Review now
          </Link>
        </section>
      ) : (
        <p className="flex min-h-12 items-center gap-3 text-base text-ink-2">
          <span className="font-semibold text-ink">Price leaks</span>
          <span className="inline-flex min-h-6 items-center rounded-full bg-ok-bg px-2.5 text-[13px] font-semibold text-ok-ink">OK, none</span>
        </p>
      )}

      <div className="flex flex-col gap-4">
        <CallsPerDayChart data={m.series.callsPerDay} />
        <CostPerDayChart data={m.series.costPerDay} />
      </div>
    </div>
  );
}
