import { describe, expect, it } from "vitest";
import { buildSeedCalls, SEED_PREFIX } from "@/lib/seed-data";

describe("seed data", () => {
  const rows = buildSeedCalls(new Date("2026-10-09T06:00:00Z"));

  it("flags every call as a test call with a seed ID", () => {
    for (const { call } of rows) {
      expect(call.isTest).toBe(true);
      expect(call.vaaniCallId?.startsWith(SEED_PREFIX)).toBe(true);
    }
  });

  it("has unique call IDs and covers the dashboard tabs", () => {
    expect(new Set(rows.map((r) => r.call.vaaniCallId)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.call.status))).toEqual(
      new Set(["booked", "awaiting_designer", "unqualified_verified", "escalated", "non_enquiry", "dropped"]),
    );
  });

  it("only books Green calls", () => {
    for (const { call, booking } of rows) if (booking) expect(call.tier).toBe("green");
  });

  it("contains no pricing figures", () => {
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/per sq ?ft|lakh|₹/i);
  });
});
