import Link from "next/link";
import { db } from "@/db";
import { listCalls, tabCounts } from "@/lib/dashboard/queries";
import { isIstDate } from "@/lib/dashboard/range";
import { TAB_LABELS, TABS, type ListFilters, type Tab } from "@/lib/dashboard/types";
import { formatIst } from "@/lib/rules";
import { Chip, displayName, StatusChip, TierBadge } from "./_components/ui";

export const metadata = { title: "Calls · Aangan Studio" };
export const maxDuration = 60;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function parse(p: Params): ListFilters {
  const tab = (TABS as readonly string[]).includes(one(p.tab) ?? "") ? (one(p.tab) as Tab) : "needs_review";
  const from = one(p.from);
  const to = one(p.to);
  const tier = one(p.tier);
  const priority = one(p.priority);
  const ah = one(p.ah);
  return {
    tab,
    from: isIstDate(from) ? from : undefined,
    to: isIstDate(to) ? to : undefined,
    tier: tier === "green" || tier === "amber" || tier === "red" || tier === "none" ? tier : undefined,
    priority: priority === "high" || priority === "normal" ? priority : undefined,
    afterHours: ah === "yes" || ah === "no" ? ah : undefined,
    includeTests: one(p.tests) === "1",
    page: Math.max(1, Number(one(p.page)) || 1),
  };
}

/** Phone numbers and names never go into a URL: only filter values do. */
function href(f: ListFilters, over: Partial<ListFilters> & { page?: number }): string {
  const m = { ...f, ...over };
  const q = new URLSearchParams();
  q.set("tab", m.tab);
  if (m.from) q.set("from", m.from);
  if (m.to) q.set("to", m.to);
  if (m.tier) q.set("tier", m.tier);
  if (m.priority) q.set("priority", m.priority);
  if (m.afterHours) q.set("ah", m.afterHours);
  if (m.includeTests) q.set("tests", "1");
  if (m.page && m.page > 1) q.set("page", String(m.page));
  return `/dashboard?${q}`;
}

const selectCls = "h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm";

export default async function CallsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const f = parse(await searchParams);
  const pageSize = 25;
  const database = db();
  const [list, counts] = await Promise.all([listCalls(database, { ...f, pageSize }), tabCounts(database, f)]);
  const pages = Math.max(1, Math.ceil(list.total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Call views" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
        {TABS.map((t) => (
          <Link
            key={t}
            href={href(f, { tab: t, page: 1 })}
            aria-current={t === f.tab ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${t === f.tab ? "bg-accent text-accent-ink" : "border border-line bg-surface hover:bg-surface-2"}`}
          >
            {TAB_LABELS[t]}
            <span className={`num rounded-full px-1.5 text-xs ${t === f.tab ? "bg-white/20" : "bg-surface-2 text-ink-2"}`}>{counts[t]}</span>
          </Link>
        ))}
      </nav>

      <form method="get" className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-7 lg:items-end">
        <input type="hidden" name="tab" value={f.tab} />
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          From (IST)
          <input type="date" name="from" defaultValue={f.from} className={selectCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          To (IST)
          <input type="date" name="to" defaultValue={f.to} className={selectCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Tier
          <select name="tier" defaultValue={f.tier ?? ""} className={selectCls}>
            <option value="">Any</option>
            <option value="green">Green</option>
            <option value="amber">Amber</option>
            <option value="red">Red</option>
            <option value="none">Not rated</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Priority
          <select name="priority" defaultValue={f.priority ?? ""} className={selectCls}>
            <option value="">Any</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          After hours
          <select name="ah" defaultValue={f.afterHours ?? ""} className={selectCls}>
            <option value="">Any</option>
            <option value="yes">After hours</option>
            <option value="no">Working hours</option>
          </select>
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="tests" value="1" defaultChecked={f.includeTests} className="size-4" />
          Show test calls
        </label>
        <div className="col-span-2 flex gap-2 sm:col-span-3 lg:col-span-1">
          <button type="submit" className="h-10 flex-1 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink">
            Apply
          </button>
          <Link href={`/dashboard?tab=${f.tab}`} className="flex h-10 items-center rounded-lg border border-line px-3 text-sm hover:bg-surface-2">
            Reset
          </Link>
        </div>
      </form>

      {list.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-ink-2">Nothing here with these filters.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.items.map((c) => (
            <li key={c.id}>
              <Link href={`/dashboard/calls/${c.id}`} className="block rounded-xl border border-line bg-surface p-4 hover:border-ink-3">
                <div className="flex flex-wrap items-center gap-2">
                  <TierBadge tier={c.tier} />
                  {c.priority === "high" && <Chip tone="warn">High priority</Chip>}
                  <StatusChip status={c.status} review={c.reviewState} />
                  {c.isTest && <Chip>Test call</Chip>}
                  {c.priceLeak && <Chip tone="bad">Price leak</Chip>}
                  {c.flags.includes("unclassified") && <Chip tone="warn">Not rated by the agent</Chip>}
                  {c.flags.includes("needs_manual_link") && <Chip tone="warn">Needs linking</Chip>}
                  <span className="num ml-auto text-xs text-ink-3">{formatIst(c.callTime)} IST{c.calledAfterHours ? " · after hours" : ""}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-base font-semibold">{displayName(c.callerName)}</span>
                  {c.fromNumber && <span className="num text-sm text-ink-2">{c.fromNumber}</span>}
                  <span className="text-sm text-ink-2">{[c.projectType, c.locality].filter(Boolean).join(" · ")}</span>
                  {c.consultAt && <span className="text-sm text-ink-2">Design call: {formatIst(c.consultAt)} IST</span>}
                </div>
                {c.summary && <p className="mt-1.5 line-clamp-2 text-sm text-ink-2">{c.summary}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {list.page > 1 ? <Link href={href(f, { page: list.page - 1 })} className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">Previous</Link> : <span />}
          <span className="num text-ink-2">Page {list.page} of {pages} · {list.total} calls</span>
          {list.page < pages ? <Link href={href(f, { page: list.page + 1 })} className="rounded-lg border border-line px-3 py-2 hover:bg-surface-2">Next</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
