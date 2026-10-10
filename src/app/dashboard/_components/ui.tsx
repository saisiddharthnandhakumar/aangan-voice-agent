import type { ReactNode } from "react";
import { statusLabel, tierLabel } from "@/lib/rules";

/** Tier and status are always text as well as colour, never colour alone. */
const TIER_STYLE = {
  green: "bg-[var(--tier-green-bg)] text-[var(--tier-green-ink)]",
  amber: "bg-[var(--tier-amber-bg)] text-[var(--tier-amber-ink)]",
  red: "bg-[var(--tier-red-bg)] text-[var(--tier-red-ink)]",
  none: "bg-[var(--tier-none-bg)] text-[var(--tier-none-ink)]",
} as const;
const TIER_DOT = { green: "var(--tier-green)", amber: "var(--tier-amber)", red: "var(--tier-red)", none: "var(--tier-none)" } as const;

export function TierBadge({ tier }: { tier: "green" | "amber" | "red" | null }) {
  const k = tier ?? "none";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TIER_STYLE[k]}`}>
      <span aria-hidden className="size-2 rounded-full" style={{ background: TIER_DOT[k] }} />
      {tierLabel(tier) ?? "Not rated"}
    </span>
  );
}

export function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" | "bad" | "ok" }) {
  const t = { plain: "bg-surface-2 text-ink-2", warn: "bg-warn-bg text-warn-ink", bad: "bg-bad-bg text-bad-ink", ok: "bg-ok-bg text-ok-ink" }[tone];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function StatusChip({ status, review }: { status: string; review: string }) {
  return <Chip>{statusLabel(status as Parameters<typeof statusLabel>[0], review as Parameters<typeof statusLabel>[1])}</Chip>;
}

export function Card({ title, children, aside, id }: { title?: ReactNode; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      {(title || aside) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function ageText(from: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** "Unknown caller" for a call with no name. */
export const displayName = (name: string | null | undefined) => name?.trim() || "Unknown caller";
