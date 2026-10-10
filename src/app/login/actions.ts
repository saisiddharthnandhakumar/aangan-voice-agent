"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { clearFailures, lockedOut, matchRole, recordFailure } from "@/lib/auth/login";
import { safeNext, SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth/session";

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const e = env();
  if (e.DASHBOARD_LOGIN !== "on") redirect("/dashboard");
  if (!e.SESSION_SECRET || (!e.DASHBOARD_DESIGNER_PASSWORD && !e.DASHBOARD_FOUNDER_PASSWORD)) {
    return { error: "The dashboard is not configured yet: SESSION_SECRET and the dashboard passwords are missing." };
  }
  const client = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (lockedOut(client)) return { error: "Too many wrong attempts. Please wait ten minutes and try again." };

  const password = String(form.get("password") ?? "");
  const role = matchRole(password, { designer: e.DASHBOARD_DESIGNER_PASSWORD, founder: e.DASHBOARD_FOUNDER_PASSWORD });
  if (!role) {
    recordFailure(client);
    await new Promise((r) => setTimeout(r, 600)); // slows guessing a little
    return { error: "That password is not right." };
  }
  clearFailures(client);
  (await cookies()).set(SESSION_COOKIE, await signSession(role, e.SESSION_SECRET), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect(role === "founder" && !form.get("next") ? "/dashboard/founder" : safeNext(String(form.get("next") ?? "")));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
