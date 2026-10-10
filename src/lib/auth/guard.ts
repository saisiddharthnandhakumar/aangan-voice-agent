import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { canAccess, SESSION_COOKIE, verifySession, type Role } from "./session";

/**
 * Server-side checks, used by every dashboard page, action and route. The proxy only does an early,
 * optimistic redirect; this is the real gate, close to the data (docs: authentication guide).
 */
export async function getSession(): Promise<{ role: Role } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await verifySession(token, env().SESSION_SECRET);
  return s ? { role: s.role } : null;
}

export async function requireRole(needs: Role): Promise<{ role: Role }> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!canAccess(s.role, needs)) redirect("/dashboard");
  return s;
}

/** For route handlers, which answer with a status code instead of redirecting. */
export async function sessionFromRequest(req: Request): Promise<{ role: Role } | null> {
  const header = req.headers.get("cookie") ?? "";
  const token = header.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const s = await verifySession(token, env().SESSION_SECRET);
  return s ? { role: s.role } : null;
}
