import Link from "next/link";
import { db } from "@/db";
import { listCalls, listTodo, viewTabCounts } from "@/lib/dashboard/queries";
import { activeFilterCount, longDate } from "@/lib/dashboard/present";
import { isIstDate } from "@/lib/dashboard/range";
import { VIEW_TAB_LABELS, VIEW_TABS, type CallListItem, type SheetFilters, type ViewTab } from "@/lib/dashboard/types";
import { FilterSheet } from "./_components/filter-sheet";
import { LeadRow } from "./_components/lead-row";

export const metadata = { title: "Designers' view · Aangan Studio" };
export const maxDuration = 60;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STEP = 25;

/** Links from before the redesign (?tab=needs_review and so on) still land somewhere sensible. */
function parseTab(raw: string | undefined): ViewTab {
  if ((VIEW_TABS as readonly string[]).includes(raw ?? "")) return raw as ViewTab;
  if (raw === "booked") return "booked";
  if (raw === "unqualified" || raw === "non_enquiries") return "all";
  return "todo";
}

function parse(p: Params): { tab: ViewTab; f: SheetFilters; shown: number } {
  const from = one(p.from);
  const to = one(p.to);
  const tier = one(p.tier);
  return {
    tab: parseTab(one(p.tab)),
    shown: Math.min(300, Math.max(STEP, Math.round((Number(one(p.n)) || STEP) / STEP) * STEP)),
    f: {
      from: isIstDate(from) ? from : undefined,
      to: isIstDate(to) ? to : undefined,
      tier: tier === "green" || tier === "amber" || tier === "red" || tier === "none" ? tier : undefined,
      priority: one(p.priority) === "high" ? "high" : undefined,
      afterHours: one(p.ah) === "yes" ? "yes" : undefined,
      includeTests: one(p.tests) === "1",
      priceLeak: one(p.leak) === "1" ? true : undefined,
    },
  };
}

/** Filter choices only: names and phone numbers never go into a URL. */
function href(tab: ViewTab, f: SheetFilters, n?: number): string {
  const q = new URLSearchParams({ tab });
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.tier) q.set("tier", f.tier);
  if (f.priority) q.set("priority", f.priority);
  if (f.afterHours) q.set("ah", f.afterHours);
  if (f.includeTests) q.set("tests", "1");
  if (f.priceLeak) q.set("leak", "1");
  if (n && n > STEP) q.set("n", String(n));
  return `/dashboard?${q}`;
}

function Group({ title, items, now }: { title: string; items: CallListItem[]; now: Date }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-[13px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
        {title} <span className="num text-ink-3">{items.length}</span>
      </h2>
      <ul className="flex flex-col gap-3">
        {items.map((c) => (
          <LeadRow key={c.id} c={c} now={now} />
        ))}
      </ul>
    </section>
  );
}

export default async function DesignersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { tab, f, shown } = parse(await searchParams);
  const now = new Date();
  const database = db();
  const filtered = activeFilterCount(f) > 0;

  const todo = await listTodo(database, f, now);
  const counts = await viewTabCounts(database, f, now, todo);

  let body: React.ReactNode;
  let hasMore = false;
  if (tab === "todo") {
    // "Show 25 more" counts rows across the groups, in the order they are shown.
    const take = <T,>(rows: T[], used: number) => rows.slice(0, Math.max(0, shown - used));
    const needs = take(todo.needsYou, 0);
    const today = take(todo.today, needs.length);
    const ahead = take(todo.comingUp, needs.length + today.length);
    hasMore = counts.todo > shown;
    body = counts.todo === 0 ? (
      <Empty>{filtered ? "Nothing matches." : "You're all caught up. New leads appear here within minutes of a call."}</Empty>
    ) : (
      <div className="flex flex-col gap-8">
        <Group title="Needs you now" items={needs} now={now} />
        <Group title="Today" items={today} now={now} />
        <Group title="Coming up" items={ahead} now={now} />
      </div>
    );
  } else {
    const list = await listCalls(database, { ...f, tab, page: 1, pageSize: shown, order: tab === "booked" ? "design_call" : undefined, now });
    hasMore = list.total > list.items.length;
    body = list.items.length === 0 ? (
      <Empty>{filtered ? "Nothing matches." : tab === "booked" ? "No design calls booked yet." : "No calls yet."}</Empty>
    ) : (
      <ul className="flex flex-col gap-3">
        {list.items.map((c) => (
          <LeadRow key={c.id} c={c} now={now} />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[40px] leading-tight font-semibold tracking-tight">Designers&apos; view</h1>
        <p className="mt-1 text-base text-ink-2">{longDate(now)}</p>
      </div>

      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-b border-line bg-bg px-4 py-3">
        <nav aria-label="Lead views" className="flex min-h-12 flex-1 gap-1 rounded-lg bg-surface-2 p-1">
          {VIEW_TABS.map((t) => (
            <Link
              key={t}
              href={href(t, f)}
              aria-current={t === tab ? "page" : undefined}
              className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-base font-semibold ${t === tab ? "bg-surface text-ink underline decoration-2 underline-offset-8 decoration-[var(--accent)]" : "text-ink-2 hover:bg-surface"}`}
            >
              {VIEW_TAB_LABELS[t]}
              <span className="num text-[13px] font-normal text-ink-3">{counts[t]}</span>
            </Link>
          ))}
        </nav>
        <FilterSheet tab={tab} f={f} />
      </div>

      {body}

      {hasMore && (
        <Link href={href(tab, f, shown + STEP)} className="flex min-h-12 items-center justify-center rounded-lg border border-line bg-surface text-base font-semibold hover:bg-surface-2">
          Show {STEP} more
        </Link>
      )}
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-line px-4 py-12 text-center text-base text-ink-2">
      {children}
      {children === "Nothing matches." && (
        <>
          {" "}
          <Link href="/dashboard" className="font-semibold text-accent underline underline-offset-4">
            Clear filters.
          </Link>
        </>
      )}
    </p>
  );
}
