"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Founder charts (three at most). Each has a text title, direct labels in text, an aria-label and a table
 * fallback, so colour is never the only carrier. Flat, no animation: the series colours are clay and sage.
 */
interface Day {
  date: string;
  [k: string]: number | string;
}

const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const tick = { fontSize: 13, fill: "var(--ink-3)" };

function TipBox({ active, label, payload, format }: { active?: boolean; label?: string | number; payload?: Array<{ name?: string | number; value?: number | string; color?: string }>; format: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
      <p className="mb-1 font-semibold">{short(String(label))}</p>
      {payload.map((p) => (
        <p key={String(p.name)} className="num text-ink-2">
          {p.name}: <span className="font-semibold text-ink">{format(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

function ChartShell({ title, summary, children, table }: { title: string; summary: ReactNode; children: ReactNode; table: ReactNode }) {
  return (
    <figure className="rounded-2xl border border-line bg-surface p-5">
      <figcaption>
        <span className="font-display block text-[22px] leading-tight font-semibold">{title}</span>
        <span className="num mt-1 block text-base text-ink-2">{summary}</span>
      </figcaption>
      <div className="mt-4">{children}</div>
      <details className="mt-3 text-base">
        <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-accent underline underline-offset-4">View as table</summary>
        <div className="max-h-72 overflow-auto">{table}</div>
      </details>
    </figure>
  );
}

export function CallsPerDayChart({ data }: { data: Day[] }) {
  const working = data.reduce((s, d) => s + Number(d.working), 0);
  const after = data.reduce((s, d) => s + Number(d.afterHours), 0);
  const series = [
    { key: "working", label: "Working hours", color: "var(--series-2)", shape: "■" },
    { key: "afterHours", label: "After hours", color: "var(--series-1)", shape: "■" },
  ] as const;
  return (
    <ChartShell
      title="Calls per day"
      summary={
        <>
          {series.map((s, i) => (
            <span key={s.key} className={i ? "ml-4" : ""}>
              <span aria-hidden style={{ color: s.color }}>{s.shape}</span> {s.label} {i === 0 ? working : after}
            </span>
          ))}
        </>
      }
      table={
        <table className="num w-full text-left text-[13px]">
          <thead><tr><th className="py-1 pr-3">Day</th><th className="py-1 pr-3">Working hours</th><th className="py-1 pr-3">After hours</th><th className="py-1">Total</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.date} className="border-t border-line"><td className="py-1.5 pr-3">{short(d.date)}</td><td className="py-1.5 pr-3">{d.working}</td><td className="py-1.5 pr-3">{d.afterHours}</td><td className="py-1.5">{d.total}</td></tr>)}</tbody>
        </table>
      }
    >
      <div className="h-64 w-full" role="img" aria-label={`Calls per day: ${working} in working hours, ${after} after hours. A table follows.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="12%">
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="date" tickFormatter={short} tick={tick} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={24} />
            <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<TipBox format={(n) => String(n)} />} />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="hours" fill={s.color} stroke="var(--surface)" strokeWidth={2} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

export function CostPerDayChart({ data }: { data: Day[] }) {
  const total = data.reduce((s, d) => s + Number(d.totalInr), 0);
  const peak = data.reduce((best, d) => (Number(d.totalInr) > Number(best.totalInr) ? d : best), data[0] ?? { date: "", totalInr: 0 });
  return (
    <ChartShell
      title="Cost per day"
      summary={
        <>
          <span aria-hidden style={{ color: "var(--series-1)" }}>&#9644;</span> Vaani and Gemini together, {inr(total)} in all{Number(peak.totalInr) > 0 ? `, highest ${inr(Number(peak.totalInr))} on ${short(peak.date)}` : ""}
        </>
      }
      table={
        <table className="num w-full text-left text-[13px]">
          <thead><tr><th className="py-1 pr-3">Day</th><th className="py-1 pr-3">Vaani</th><th className="py-1 pr-3">Gemini</th><th className="py-1">Total</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.date} className="border-t border-line"><td className="py-1.5 pr-3">{short(d.date)}</td><td className="py-1.5 pr-3">{inr(Number(d.vaaniInr))}</td><td className="py-1.5 pr-3">{inr(Number(d.geminiInr))}</td><td className="py-1.5">{inr(Number(d.totalInr))}</td></tr>)}</tbody>
        </table>
      }
    >
      <div className="h-64 w-full" role="img" aria-label={`Line of cost per day, ${inr(total)} in all. A table follows.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="date" tickFormatter={short} tick={tick} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={24} />
            <YAxis tickFormatter={(v) => `₹${v}`} tick={tick} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ stroke: "var(--line)" }} content={<TipBox format={inr} />} />
            <Line type="linear" dataKey="totalInr" name="Total cost" stroke="var(--series-1)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

const TIERS = [
  { key: "green", label: "Green", shape: "●", color: "var(--tier-green)" },
  { key: "amber", label: "Amber", shape: "▲", color: "var(--tier-amber)" },
  { key: "red", label: "Red", shape: "■", color: "var(--tier-red)" },
  { key: "none", label: "Not rated", shape: "○", color: "var(--tier-none)" },
] as const;

/** Leads by tier: one horizontal bar split by tier, with a labelled count (and shape) under each part. */
export function TierBar({ tiers }: { tiers: { green: number; amber: number; red: number; none: number } }) {
  const total = tiers.green + tiers.amber + tiers.red + tiers.none;
  if (total === 0) return <p className="text-base text-ink-2">No calls in this range.</p>;
  return (
    <div>
      <div className="flex h-8 w-full gap-0.5 overflow-hidden rounded-lg" role="img" aria-label={`Leads by tier: ${TIERS.map((t) => `${t.label} ${tiers[t.key]}`).join(", ")}`}>
        {TIERS.filter((t) => tiers[t.key] > 0).map((t) => (
          <div key={t.key} style={{ width: `${(tiers[t.key] / total) * 100}%`, background: t.color }} />
        ))}
      </div>
      <ul className="num mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-base">
        {TIERS.map((t) => (
          <li key={t.key}>
            <span aria-hidden className="mr-1.5 text-[13px]" style={{ color: t.color }}>{t.shape}</span>
            {t.label} <span className="font-semibold">{tiers[t.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
