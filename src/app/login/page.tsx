import { redirect } from "next/navigation";
import { getSession, loginRequired } from "@/lib/auth/guard";
import { safeNext } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Aangan Studio" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (!loginRequired()) redirect("/dashboard");
  if (await getSession()) redirect(safeNext(next));
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="font-display text-[40px] leading-tight font-semibold tracking-tight">Aangan Studio</h1>
        <p className="mt-1 text-base text-ink-2">Designers&apos; view and Founder&apos;s view.</p>
      </div>
      <LoginForm next={next ? safeNext(next) : ""} />
    </main>
  );
}
