import { describe, expect, it } from "vitest";
import { normalisePhone } from "@/lib/phone";
import { findRepeatOf } from "@/lib/rules";

const t = (iso: string) => new Date(iso);

describe("normalisePhone", () => {
  it.each([
    ["+91 98765 43210", "+919876543210"],
    ["098765 43210", "+919876543210"],
    ["9876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091-98765-43210", "+919876543210"],
    ["+1 415 555 1234", "+14155551234"],
    ["12345", null],
    [null, null],
  ])("%s → %s", (raw, out) => expect(normalisePhone(raw)).toBe(out));
});

describe("findRepeatOf (P6, AT15)", () => {
  const prior = [
    { id: "a", fromNumber: "+919999900001", startedAt: t("2026-09-22T08:44:00Z"), repeatOfCallId: null },
    { id: "b", fromNumber: "+919999900002", startedAt: t("2026-09-22T08:00:00Z"), repeatOfCallId: null },
  ];
  it("links a redial two minutes later (T17)", () => {
    expect(findRepeatOf(prior, "+919999900001", t("2026-09-22T08:46:00Z"))).toBe("a");
  });
  it("does not link another number or a call outside 24 hours", () => {
    expect(findRepeatOf(prior, "+919999900003", t("2026-09-22T08:46:00Z"))).toBeNull();
    expect(findRepeatOf(prior, "+919999900001", t("2026-09-23T09:00:00Z"))).toBeNull();
  });
  it("links a chain to the first call", () => {
    const chain = [...prior, { id: "c", fromNumber: "+919999900001", startedAt: t("2026-09-22T09:00:00Z"), repeatOfCallId: "a" }];
    expect(findRepeatOf(chain, "+919999900001", t("2026-09-22T10:00:00Z"))).toBe("a");
  });
  it("never links a caller with no number", () => {
    expect(findRepeatOf(prior, null, t("2026-09-22T08:46:00Z"))).toBeNull();
  });
});
