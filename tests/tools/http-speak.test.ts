import { describe, expect, it } from "vitest";
import { rateLimited, secretMatches, unwrapArgs } from "@/lib/tools/http";
import { parseTimePreference, pickSlots, slotLabel, speakList } from "@/lib/tools/speak";

describe("tool HTTP helpers", () => {
  it("compares the shared secret in constant time and rejects missing values", () => {
    expect(secretMatches("a".repeat(64), "a".repeat(64))).toBe(true);
    expect(secretMatches("a".repeat(63), "a".repeat(64))).toBe(false);
    expect(secretMatches(null, "x")).toBe(false);
    expect(secretMatches("x", undefined)).toBe(false);
  });
  it("unwraps one level of envelope", () => {
    expect(unwrapArgs({ call_id: "A" })).toEqual({ call_id: "A" });
    expect(unwrapArgs({ args: { call_id: "A" } })).toEqual({ call_id: "A" });
    expect(unwrapArgs({ arguments: '{"call_id":"A"}', name: "t" })).toEqual({ call_id: "A" });
    expect(unwrapArgs(null)).toEqual({});
    expect(unwrapArgs([1])).toEqual({});
  });
  it("rate-limits per key per minute", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimited("k", 3, t + i)).toBe(false);
    expect(rateLimited("k", 3, t + 10)).toBe(true);
    expect(rateLimited("k", 3, t + 61_000)).toBe(false);
  });
});

describe("speakable slots", () => {
  const now = new Date("2026-10-12T05:30:00Z"); // Mon 11:00 IST
  it.each([
    ["2026-10-12T10:30:00Z", "today at 4 PM"],
    ["2026-10-13T06:00:00Z", "tomorrow at 11:30 AM"],
    ["2026-10-14T05:30:00Z", "Wednesday the 14th of October at 11 AM"],
    ["2026-10-21T06:30:00Z", "Wednesday the 21st of October at 12 PM"],
    ["2026-11-02T18:00:00Z", "Monday the 2nd of November at 11:30 PM"],
    ["2026-11-03T18:30:00Z", "Wednesday the 4th of November at 12 AM"],
  ])("%s → %s", (iso, label) => expect(slotLabel(iso, now)).toBe(label));

  it("speaks lists naturally", () => {
    expect(speakList(["A"])).toBe("A");
    expect(speakList(["A", "B", "C"])).toBe("A, B or C");
  });
  it("reads preferences in English and Hinglish", () => {
    expect(parseTimePreference("weekday evenings after 6 pm")).toEqual({ part: "evening" });
    expect(parseTimePreference("Koi bhi Saturday subah")).toEqual({ part: "morning", weekday: "sat" });
    expect(parseTimePreference("weekends only")).toEqual({ weekend: true });
    expect(parseTimePreference(null)).toEqual({});
  });
  it("spreads picks across days", () => {
    const s = (iso: string) => ({ start: iso });
    const picked = pickSlots([s("2026-10-13T03:30:00Z"), s("2026-10-13T04:30:00Z"), s("2026-10-14T03:30:00Z")], 2);
    expect(picked.map((p) => p.start)).toEqual(["2026-10-13T03:30:00Z", "2026-10-14T03:30:00Z"]);
  });
});

describe("readArgs", () => {
  it("reads JSON, form bodies and query parameters", async () => {
    const { readArgs } = await import("@/lib/tools/http");
    const json = await readArgs(new Request("https://x.test/t?call_mode=web", { method: "POST", body: '{"call_id":"A"}' }));
    expect(json.args).toEqual({ call_id: "A", call_mode: "web" });
    const form = await readArgs(new Request("https://x.test/t", { method: "POST", body: "call_id=B&consult_type=call", headers: { "content-type": "application/x-www-form-urlencoded" } }));
    expect(form.args).toEqual({ call_id: "B", consult_type: "call" });
    const get = await readArgs(new Request("https://x.test/t?call_id=C&preferred_date=2026-10-14", { method: "GET" }));
    expect(get.args).toEqual({ call_id: "C", preferred_date: "2026-10-14" });
  });
});
