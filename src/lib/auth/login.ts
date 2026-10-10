import { createHash, timingSafeEqual } from "node:crypto";
import type { Role } from "./session";

/**
 * Password check for the two roles. Both passwords are always compared (so timing does not reveal which
 * role a guess was close to), each in constant time over fixed-length SHA-256 digests. A failed attempt
 * from a client is counted; after too many, that client is locked out for a while. The counter is in memory
 * per server instance: enough to slow guessing, not a global quota.
 */
const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export function matchRole(password: string, passwords: { designer?: string; founder?: string }): Role | null {
  const isFounder = passwords.founder ? same(password, passwords.founder) : false;
  const isDesigner = passwords.designer ? same(password, passwords.designer) : false;
  // If both roles share a password, the more powerful role would win; keep that explicit.
  return isFounder ? "founder" : isDesigner ? "designer" : null;
}

const MAX_FAILURES = 8;
const WINDOW_MS = 10 * 60_000;
const failures = new Map<string, number[]>();

export function lockedOut(client: string, now = Date.now()): boolean {
  return (failures.get(client) ?? []).filter((t) => now - t < WINDOW_MS).length >= MAX_FAILURES;
}

export function recordFailure(client: string, now = Date.now()): void {
  const recent = (failures.get(client) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  failures.set(client, recent);
  if (failures.size > 2000) failures.clear();
}

export function clearFailures(client: string): void {
  failures.delete(client);
}
