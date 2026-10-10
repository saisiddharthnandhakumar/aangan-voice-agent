"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Founder charts. Colours come from the validated data-viz palette through CSS variables (so dark mode
 * swaps in one place): tiers use the fixed status steps, cost series the first two categorical slots.
 * Every chart has a legend, a hover tooltip, and a table view, so colour is never the only carrier.
 */
interface Day {
  date: string;
  [k: string]: number | string;
}

const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function TipBox({ active, label, payload, format }: { active?: boolean; label?: string | number; payload?: Array<{ name?: string | number; value?: number | string; color?: string }>; format: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold">{short(String(label))}</p>
      {payload.map((p) => (
        <p key={String(p.name)} className="num flex items-center gap-2 text-ink-2">
          <span aria-hidden className="size-2 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-ink">{format(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

function ChartShell({ title, legend, children, table }: { title: string; legend: Array<{ label: string; color: string }>; children: ReactNode; table: ReactNode }) {
  return (
    <figure className="rounded-xl border border-line bg-surface p-4">
      <figcaption className="mb-2 text-sm font-semibold tracking-wide text-ink-2 uppercase">{title}</figcaption>
      <Legend items={legend} />
      {children}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-2">View as table</summary>
        <div className="mt-2 max-h-72 overflow-auto">{table}</div>
      </details>
    </figure>
  );
}

const TIERS = [
  { key: "green", label: "Green", color: "var(--tier-green)" },
  { key: "amber", label: "Amber", color: "var(--tier-amber)" },
  { key: "red", label: "Red", color: "var(--tier-red)" },
  { key: "none", label: "Not rated", color: "var(--tier-none)" },
] as const;

export function CallsPerDayChart({ data }: { data: Day[] }) {
  return (
    <ChartShell
      title="Calls per day"
      legend={TIERS.map((t) => ({ label: t.label, color: t.color }))}
      table={
        <table className="num w-full text-left text-xs">
          <thead><tr><th className="py-1 pr-3">Day</th>{TIERS.map((t) => <th key={t.key} className="py-1 pr-3">{t.label}</th>)}<th className="py-1">Total</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.date} className="border-t border-line"><td className="py-1 pr-3">{short(d.date)}</td>{TIERS.map((t) => <td key={t.key} className="py-1 pr-3">{d[t.key]}</td>)}<td className="py-1">{d.total}</td></tr>)}</tbody>
        </table>
      }
    >
      <div className="h-64 w-full" role="img" aria-label="Stacked bars of calls per day by tier">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="12%">
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="date" tickFormatter={short} tick={{ fontSize: 11, fill: "var(--ink-3)" }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--ink-3)" }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<TipBox format={(n) => String(n)} />} />
            {TIERS.map((t, i) => (
              <Bar key={t.key} dataKey={t.key} name={t.label} stackId="tier" fill={t.color} stroke="var(--surface)" strokeWidth={2} radius={i === TIERS.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

export function CostPerDayChart({ data }: { data: Day[] }) {
  const series = [
    { key: "vaaniInr", label: "Vaani", color: "var(--series-1)" },
    { key: "geminiInr", label: "Gemini", color: "var(--series-2)" },
  ] as const;
  return (
    <ChartShell
      title="Cost per day"
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
      table={
        <table className="num w-full text-left text-xs">
          <thead><tr><th className="py-1 pr-3">Day</th><th className="py-1 pr-3">Vaani</th><th className="py-1 pr-3">Gemini</th><th className="py-1">Total</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.date} className="border-t border-line"><td className="py-1 pr-3">{short(d.date)}</td><td className="py-1 pr-3">{inr(Number(d.vaaniInr))}</td><td className="py-1 pr-3">{inr(Number(d.geminiInr))}</td><td className="py-1">{inr(Number(d.totalInr))}</td></tr>)}</tbody>
        </table>
      }
    >
      <div className="h-64 w-full" role="img" aria-label="Stacked bars of cost per day, Vaani and Gemini">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barCategoryGap="12%">
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="date" tickFormatter={short} tick={{ fontSize: 11, fill: "var(--ink-3)" }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={24} />
            <YAxis tickFormatter={(v) => `₹${v}`} tick={{ fontSize: 11, fill: "var(--ink-3)" }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<TipBox format={inr} />} />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="cost" fill={s.color} stroke="var(--surface)" strokeWidth={2} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

/** Tier mix: one horizontal bar split by tier, each segment labelled with its count and share. */
export function TierMix({ tiers }: { tiers: { green: number; amber: number; red: number; none: number } }) {
  const total = tiers.green + tiers.amber + tiers.red + tiers.none;
  return (
    <ChartShell
      title="Tier mix"
      legend={TIERS.map((t) => ({ label: t.label, color: t.color }))}
      table={
        <table className="num w-full text-left text-xs">
          <thead><tr><th className="py-1 pr-3">Tier</th><th className="py-1 pr-3">Calls</th><th className="py-1">Share</th></tr></thead>
          <tbody>{TIERS.map((t) => <tr key={t.key} className="border-t border-line"><td className="py-1 pr-3">{t.label}</td><td className="py-1 pr-3">{tiers[t.key]}</td><td className="py-1">{total ? Math.round((tiers[t.key] / total) * 100) : 0}%</td></tr>)}</tbody>
        </table>
      }
    >
      {total === 0 ? (
        <p className="py-6 text-center text-sm text-ink-2">No calls in this range.</p>
      ) : (
        <div>
          <div className="flex h-8 w-full gap-0.5 overflow-hidden rounded-md" role="img" aria-label={`Tier mix: ${TIERS.map((t) => `${t.label} ${tiers[t.key]}`).join(", ")}`}>
            {TIERS.filter((t) => tiers[t.key] > 0).map((t) => (
              <div key={t.key} title={`${t.label}: ${tiers[t.key]}`} style={{ width: `${(tiers[t.key] / total) * 100}%`, background: t.color }} />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {TIERS.map((t) => (
              <li key={t.key} className="rounded-lg bg-surface-2 px-3 py-2">
                <span className="block text-xs text-ink-3">{t.label}</span>
                <span className="num text-lg font-semibold">{tiers[t.key]}</span> <span className="num text-xs text-ink-3">{Math.round((tiers[t.key] / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartShell>
  );
}
