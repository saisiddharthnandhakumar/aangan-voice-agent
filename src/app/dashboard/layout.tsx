import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/login/actions";
import { loginRequired, requireRole } from "@/lib/auth/guard";
import { MainNav } from "./_components/nav";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { role } = await requireRole("designer");
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[960px] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-1">
          <Link href="/" className="font-display flex min-h-12 items-center text-xl font-semibold tracking-tight">
            Aangan
          </Link>
          <span aria-hidden className="text-ink-3">&middot;</span>
          <MainNav showFounder={role === "founder"} />
          {loginRequired() && (
            <div className="ml-auto flex items-center gap-3 text-[13px] text-ink-2">
              <span className="capitalize">{role}</span>
              <form action={logout}>
                <button type="submit" className="min-h-12 rounded-lg border border-line px-4 text-base font-semibold hover:bg-surface-2">
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[960px] flex-1 px-4 pt-8 pb-12">{children}</main>
      <footer className="border-t border-line">
        <p className="mx-auto w-full max-w-[960px] px-4 py-5 text-[13px] text-ink-3">
          Times shown in IST.
          {!loginRequired() && (
            <>
              {" "}
              <span title="Anyone with this address can open the dashboard">No login: anyone with this address can open this page.</span>
            </>
          )}
        </p>
      </footer>
    </div>
  );
}
