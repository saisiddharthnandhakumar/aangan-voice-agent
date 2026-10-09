import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enquiryTime, parseCsv } from "@/lib/eval";

describe("eval helpers", () => {
  it("parses quoted CSV with commas inside fields", () => {
    const rows = parseCsv('id,label,notes\nT01,green,"3BHK, Kothrud"\nT02,amber,"He said ""no"""\n');
    expect(rows).toEqual([
      { id: "T01", label: "green", notes: "3BHK, Kothrud" },
      { id: "T02", label: "amber", notes: 'He said "no"' },
    ]);
  });

  it.each([
    ["# T01 · Phone · 2 September · 10:23am · 4 min 12 sec", "2026-09-02T04:53:00.000Z"],
    ["# T08 · Phone · 9 September · 10:47pm · MISSED CALL", "2026-09-09T17:17:00.000Z"],
    ["# T17 · Phone · 22 September · 2:14pm then 2:16pm", "2026-09-22T08:44:00.000Z"],
    ["# W01 · WhatsApp · 3–4 September", "2026-09-03T06:30:00.000Z"],
  ])("reads the enquiry time from %s", (heading, iso) => {
    expect(enquiryTime(`---\nid: x\n---\n\n${heading}\n\nbody`).toISOString()).toBe(iso);
  });
});

describe("rule 9: the eval never touches the database", () => {
  it("scripts/eval.ts does not import the db module", () => {
    const src = readFileSync("scripts/eval.ts", "utf8");
    expect(src).not.toMatch(/from ["'][^"']*\/db["']|@\/db|drizzle/);
  });
});
