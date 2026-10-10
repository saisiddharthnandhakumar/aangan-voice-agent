import { describe, expect, it } from "vitest";
import { clearFailures, lockedOut, matchRole, recordFailure } from "@/lib/auth/login";
import { canAccess, safeNext, signSession, verifySession } from "@/lib/auth/session";

const SECRET = "s".repeat(48);
const T0 = 1_760_000_000_000;

describe("session cookie", () => {
  it("round-trips a role and expires", async () => {
    const token = await signSession("designer", SECRET, T0, 60);
    expect(await verifySession(token, SECRET, T0 + 30_000)).toEqual({ role: "designer", expiresAt: T0 + 60_000 });
    expect(await verifySession(token, SECRET, T0 + 61_000)).toBeNull();
  });
  it("rejects a tampered payload, a wrong secret and malformed tokens", async () => {
    const token = await signSession("designer", SECRET, T0);
    const [payload, sig] = token.split(".");
    const forged = btoa(JSON.stringify({ r: "founder", e: Math.floor(T0 / 1000) + 3600 })).replace(/=+$/, "");
    expect(await verifySession(`${forged}.${sig}`, SECRET, T0)).toBeNull();
    expect(await verifySession(token, "x".repeat(48), T0)).toBeNull();
    for (const bad of ["", "abc", `${payload}`, `${payload}.${sig}.extra`, `${payload}.!!!`, undefined, null]) expect(await verifySession(bad as string, SECRET, T0)).toBeNull();
    expect(await verifySession(token, undefined, T0)).toBeNull();
  });
  it("role access: the founder sees everything, a designer only the designer view", () => {
    expect(canAccess("founder", "founder")).toBe(true);
    expect(canAccess("founder", "designer")).toBe(true);
    expect(canAccess("designer", "designer")).toBe(true);
    expect(canAccess("designer", "founder")).toBe(false);
  });
  it("only same-site dashboard paths are valid redirect targets", () => {
    expect(safeNext("/dashboard/calls/abc-123")).toBe("/dashboard/calls/abc-123");
    expect(safeNext("/dashboard?tab=booked&tier=amber")).toBe("/dashboard?tab=booked&tier=amber");
    for (const bad of ["https://evil.example", "//evil.example", "/dashboard//evil", "/login", "/dashboard/../x", "javascript:alert(1)", undefined, 5]) expect(safeNext(bad)).toBe("/dashboard");
  });
});

describe("password check", () => {
  const pw = { designer: "designer-pass-1", founder: "founder-pass-1" };
  it("maps each password to its role and rejects the rest", () => {
    expect(matchRole("designer-pass-1", pw)).toBe("designer");
    expect(matchRole("founder-pass-1", pw)).toBe("founder");
    for (const bad of ["", "designer-pass-", "FOUNDER-PASS-1", "nope"]) expect(matchRole(bad, pw)).toBeNull();
  });
  it("a missing password never matches, even an empty guess", () => {
    expect(matchRole("", { designer: undefined, founder: undefined })).toBeNull();
    expect(matchRole("x", { designer: "x" })).toBe("designer");
  });
  it("locks a client out after repeated failures, and a success clears the count", () => {
    const c = "1.2.3.4";
    for (let i = 0; i < 7; i++) recordFailure(c, T0 + i);
    expect(lockedOut(c, T0 + 10)).toBe(false);
    recordFailure(c, T0 + 8);
    expect(lockedOut(c, T0 + 10)).toBe(true);
    expect(lockedOut(c, T0 + 11 * 60_000)).toBe(false); // the window passes
    recordFailure(c, T0 + 11 * 60_000);
    clearFailures(c);
    expect(lockedOut("other", T0)).toBe(false);
  });
});
