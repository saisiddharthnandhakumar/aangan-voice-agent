import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { canAccess, SESSION_COOKIE, verifySession, type Role } from "./session";

/**
 * Server-side checks, used by every dashboard page, action and route. The proxy only does an early,
 * optimistic redirect; this is the real gate, close to the data (docs: authentication guide).
 */
/** True when the dashboard asks for a password (DASHBOARD_LOGIN=on). Off by default: see src/env.ts. */
export const loginRequired = () => env().DASHBOARD_LOGIN === "on";

export async function getSession(): Promise<{ role: Role } | null> {
  // No login: everyone is treated as the founder, who may open every page.
  if (!loginRequired()) return { role: "founder" };
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

/**
 * For route handlers, which answer with a status code instead of redirecting. `strict` ignores the no-login
 * setting and needs a real signed cookie: used by the pipeline retry endpoint, which should never be open to
 * anonymous callers because it spends Gemini and HubSpot calls.
 */
export async function sessionFromRequest(req: Request, o: { strict?: boolean } = {}): Promise<{ role: Role } | null> {
  if (!o.strict && !loginRequired()) return { role: "founder" };
  const header = req.headers.get("cookie") ?? "";
  const token = header.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const s = await verifySession(token, env().SESSION_SECRET);
  return s ? { role: s.role } : null;
}
