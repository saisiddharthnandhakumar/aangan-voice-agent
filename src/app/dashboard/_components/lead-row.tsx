import Link from "next/link";
import type { CallListItem } from "@/lib/dashboard/types";
import { calledAgo, designCallText, nextAction } from "@/lib/dashboard/present";
import { Chip, displayName, TierBadge } from "./ui";

/**
 * One lead = one tappable block (the whole row opens the call). Phone numbers appear only on dropped calls,
 * as a separate tel: link below the block (a link cannot sit inside a link). Names and numbers never go in a URL.
 */
export function LeadRow({ c, now }: { c: CallListItem; now: Date }) {
  const high = c.priority === "high";
  const place = [c.locality, c.projectType].filter(Boolean).join(" · ");
  const dialable = c.status === "dropped" && c.reviewState === "none" && c.fromNumber ? c.fromNumber.replace(/[^\d+]/g, "") : null;
  return (
    <li className={`overflow-hidden rounded-2xl border border-line border-l-4 bg-surface ${high ? "border-l-[var(--accent)]" : "border-l-transparent"}`}>
      <Link href={`/dashboard/calls/${c.id}`} className="flex min-h-[90px] flex-col gap-x-6 gap-y-3 px-4 py-4 hover:bg-surface-2 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={c.tier} />
            {high && <Chip tone="warn">High priority</Chip>}
            {c.priceLeak && <Chip tone="bad">Price leak</Chip>}
            {c.isTest && <Chip>Test call</Chip>}
          </div>
          <p className="text-[18px] leading-snug">
            <span className="font-semibold">{displayName(c.callerName)}</span>
            {place && <span className="text-ink-2">{`  ${place}`}</span>}
          </p>
          <p className="text-base text-ink-2">{nextAction(c)}</p>
        </div>
        <div className="num flex shrink-0 flex-row flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3 sm:w-44 sm:flex-col sm:items-end sm:text-right">
          <span className={c.consultAt ? "text-base font-semibold text-ink" : "text-base text-ink-3"}>{designCallText(c.consultAt, now)}</span>
          <span>{calledAgo(c.callTime, now)}</span>
          {c.calledAfterHours && <Chip>After hours</Chip>}
        </div>
      </Link>
      {dialable && (
        <a href={`tel:${dialable}`} className="num flex min-h-12 items-center border-t border-line px-4 text-base font-semibold text-accent underline-offset-4 hover:underline">
          Call back {c.fromNumber}
        </a>
      )}
    </li>
  );
}
