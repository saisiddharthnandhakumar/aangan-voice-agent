import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/login/actions";
import { requireRole } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { role } = await requireRole("designer");
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="text-base font-semibold tracking-tight">
            Aangan Studio
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 text-sm">
            <Link href="/dashboard" className="rounded-md px-3 py-1.5 hover:bg-surface-2">
              Calls
            </Link>
            {role === "founder" && (
              <Link href="/dashboard/founder" className="rounded-md px-3 py-1.5 hover:bg-surface-2">
                Founder view
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-ink-2">
            <span className="capitalize">{role}</span>
            <form action={logout}>
              <button type="submit" className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-2">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}
