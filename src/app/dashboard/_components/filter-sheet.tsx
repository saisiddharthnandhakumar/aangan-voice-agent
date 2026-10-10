import Link from "next/link";
import type { SheetFilters, ViewTab } from "@/lib/dashboard/types";
import { activeFilterCount } from "@/lib/dashboard/present";

const field = "min-h-12 w-full rounded-lg border border-line bg-bg px-3 text-base";

/**
 * Filter button and its sheet (a <details>: works without JavaScript, closes when Apply reloads the page).
 * Values go in the query string as filter choices only, never names or phone numbers.
 */
export function FilterSheet({ tab, f }: { tab: ViewTab; f: SheetFilters }) {
  const count = activeFilterCount(f);
  return (
    <details className="group relative">
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-4 text-base font-semibold hover:bg-surface-2">
        Filter
        {count > 0 && (
          <span aria-label={`${count} active`} className="num inline-flex min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-[13px] font-semibold text-accent-ink">
            {count}
          </span>
        )}
      </summary>
      <form
        method="get"
        className="fixed inset-x-0 bottom-0 z-30 flex max-h-[85vh] flex-col gap-4 overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 sm:absolute sm:inset-x-auto sm:top-14 sm:right-0 sm:bottom-auto sm:w-[360px] sm:rounded-2xl"
      >
        <input type="hidden" name="tab" value={tab} />
        <h2 className="font-display text-[22px] font-semibold">Filter</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">
            From (IST)
            <input type="date" name="from" defaultValue={f.from} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">
            To (IST)
            <input type="date" name="to" defaultValue={f.to} className={field} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">
          Tier
          <select name="tier" defaultValue={f.tier ?? ""} className={field}>
            <option value="">Any</option>
            <option value="green">Green</option>
            <option value="amber">Amber</option>
            <option value="red">Red</option>
            <option value="none">Not rated</option>
          </select>
        </label>
        {[
          ["priority", "high", "High priority only", f.priority === "high"],
          ["ah", "yes", "After-hours only", f.afterHours === "yes"],
          ["leak", "1", "Price leaks only", Boolean(f.priceLeak)],
          ["tests", "1", "Show test calls", Boolean(f.includeTests)],
        ].map(([name, value, label, on]) => (
          <label key={name as string} className="flex min-h-12 items-center gap-3 text-base">
            <input type="checkbox" name={name as string} value={value as string} defaultChecked={on as boolean} className="size-6 accent-[var(--accent)]" />
            {label as string}
          </label>
        ))}
        <div className="flex items-center gap-3">
          <button type="submit" className="min-h-12 flex-1 rounded-lg bg-accent px-5 text-base font-semibold text-accent-ink hover:opacity-90">
            Apply
          </button>
          <Link href={`/dashboard?tab=${tab}`} className="flex min-h-12 items-center px-3 text-base font-semibold text-accent underline-offset-4 hover:underline">
            Clear filters
          </Link>
        </div>
      </form>
    </details>
  );
}
