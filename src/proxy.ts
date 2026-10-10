import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * Early redirect for dashboard pages: no valid session cookie → /login. This is optimistic (it only
 * checks the signature and expiry); every page, action and route still checks the role itself.
 */
export async function proxy(request: NextRequest) {
  if (process.env.DASHBOARD_LOGIN !== "on") return NextResponse.next(); // no login (the default, see src/env.ts)
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);
  if (session) return NextResponse.next();
  const url = new URL("/login", request.url);
  const wanted = request.nextUrl.pathname + request.nextUrl.search;
  if (wanted !== "/dashboard") url.searchParams.set("next", wanted);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/dashboard/:path*"] };
