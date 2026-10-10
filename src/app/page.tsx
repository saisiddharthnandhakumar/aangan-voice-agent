import Link from "next/link";
import { db } from "@/db";
import { getSession } from "@/lib/auth/guard";
import { needYouCount } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan Studio" };

/** The live count is a nicety: if the database or the session check fails, the card simply shows no count. */
async function waitingCount(): Promise<number | null> {
  try {
    if (!(await getSession())) return null;
    return await needYouCount(db());
  } catch {
    return null;
  }
}

export default async function Home() {
  const n = await waitingCount();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* Decorative: four flat tonal bars (stone, clay, sage, oat). */}
      <div aria-hidden className="grid h-3 grid-cols-4">
        <div className="bg-[#b9ae9c]" />
        <div className="bg-[#7a4a32]" />
        <div className="bg-[#5e6b4f]" />
        <div className="bg-[#e2d5bb]" />
      </div>
      <main className="mx-auto grid w-full max-w-[960px] flex-1 content-center gap-10 px-5 py-12 lg:grid-cols-12 lg:gap-12 lg:py-20">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <p className="font-display text-xl font-semibold tracking-tight">Aangan Studio</p>
          <h1 className="font-display text-[44px] leading-[1.05] font-light tracking-tight lg:text-[72px]">
            Every enquiry answered. Every good lead in a designer&apos;s hands.
          </h1>
          <p className="max-w-md text-base text-ink-2">Vaani picks up every call, rates the lead, and books the design call.</p>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5 lg:justify-center">
          <Link
            href="/dashboard"
            className="flex min-h-48 flex-col justify-between gap-6 rounded-2xl bg-accent p-6 text-accent-ink hover:opacity-90"
          >
            <span className="font-display text-[28px] leading-tight font-semibold">Designers&apos; view</span>
            <span className="flex items-end justify-between gap-3">
              <span className="text-[18px]">See who to call next.</span>
              {n != null && (
                <span className="num rounded-full border border-current px-3 py-1 text-base font-semibold">{n === 0 ? "All caught up" : n === 1 ? "1 needs you" : `${n} need you`}</span>
              )}
            </span>
          </Link>
          <Link
            href="/dashboard/founder"
            className="flex min-h-48 flex-col justify-between gap-6 rounded-2xl border-2 border-[var(--accent)] p-6 text-ink hover:bg-surface-2"
          >
            <span className="font-display text-[28px] leading-tight font-semibold">Founder&apos;s view</span>
            <span className="text-[18px]">See what the system earns and costs.</span>
          </Link>
        </div>
      </main>
      <footer>
        <p className="mx-auto w-full max-w-[960px] px-5 pb-6 text-[13px] text-ink-3">Times shown in IST.</p>
      </footer>
    </div>
  );
}
