"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Main navigation: the current page is marked for screen readers and styled, not just coloured. */
export function MainNav({ showFounder }: { showFounder: boolean }) {
  const path = usePathname();
  const founder = path.startsWith("/dashboard/founder");
  const item = (active: boolean) =>
    `flex min-h-12 items-center rounded-lg px-3 text-base font-semibold ${active ? "bg-surface-2 text-ink underline decoration-2 underline-offset-8 decoration-[var(--accent)]" : "text-ink-2 hover:bg-surface-2"}`;
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      <Link href="/dashboard" aria-current={!founder ? "page" : undefined} className={item(!founder)}>
        Designers&apos; view
      </Link>
      {showFounder && (
        <Link href="/dashboard/founder" aria-current={founder ? "page" : undefined} className={item(founder)}>
          Founder&apos;s view
        </Link>
      )}
    </nav>
  );
}
