/**
 * Signed, stateless session cookies for the two dashboard roles (PRD D1). The cookie holds
 * {role, exp} and an HMAC-SHA256 signature made with SESSION_SECRET. Web Crypto only, so the same code
 * runs in the proxy and in server components and actions. Verification uses subtle.verify, which
 * compares in constant time. The cookie holds no personal data.
 */
export type Role = "designer" | "founder";
export const SESSION_COOKIE = "aangan_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const key = (secret: string, usage: KeyUsage[]) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);

export async function signSession(role: Role, secret: string, nowMs = Date.now(), ttlSeconds = SESSION_TTL_SECONDS): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ r: role, e: Math.floor(nowMs / 1000) + ttlSeconds })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret, ["sign"]), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined | null, secret: string | undefined, nowMs = Date.now()): Promise<{ role: Role; expiresAt: number } | null> {
  if (!token || !secret) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const sigBytes = fromB64url(sig);
  if (!sigBytes) return null;
  const ok = await crypto.subtle.verify("HMAC", await key(secret, ["verify"]), sigBytes as BufferSource, enc.encode(payload));
  if (!ok) return null;
  const bytes = fromB64url(payload);
  if (!bytes) return null;
  try {
    const { r, e } = JSON.parse(new TextDecoder().decode(bytes)) as { r?: unknown; e?: unknown };
    if ((r !== "designer" && r !== "founder") || typeof e !== "number" || e * 1000 <= nowMs) return null;
    return { role: r, expiresAt: e * 1000 };
  } catch {
    return null;
  }
}

/** A designer may open the designer view; only the founder may open the founder view. */
export function canAccess(role: Role, needs: Role): boolean {
  return needs === "designer" || role === "founder";
}

/** Only same-site dashboard paths are valid redirect targets after login. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/dashboard(\/[A-Za-z0-9\-_/]*)?(\?[A-Za-z0-9\-_=&%.]*)?$/.test(next) && !next.includes("//") ? next : "/dashboard";
}
