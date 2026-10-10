import { beforeAll, describe, expect, it } from "vitest";
import { callsCsv, CSV_COLUMNS, csvCell, toCsv } from "@/lib/dashboard/csv";
import { addBooking, addCall, testDb, type TestDb } from "./harness";

let db: TestDb;
beforeAll(async () => {
  db = await testDb();
  const c = await addCall(db, { callRef: "ABC234", callerName: '=HYPERLINK("http://evil")', fromNumber: "+919876543210", callCategory: "enquiry", tier: "amber", status: "booked", priority: "high", startedAt: "2026-10-12T05:30:00Z", durationSeconds: 300, calledAfterHours: false, facts: { locality: "Kothrud, Pune", project_type: "home" }, referralSource: "a friend", vaaniCostInr: 10, geminiCostInr: 1, totalCostInr: 11, estimatedValueInr: 1_500_000, budgetLowInr: 400_000, budgetFloorInr: 700_000, transcript: "SECRET TRANSCRIPT", hubspotCallId: "k1" });
  await addBooking(db, c.id, "2026-10-14T05:30:00Z");
  await addCall(db, { callCategory: "enquiry", isTest: true, tier: "green", startedAt: "2026-10-12T05:30:00Z" });
  await addCall(db, { callCategory: "enquiry", tier: "green", startedAt: "2026-09-12T05:30:00Z" });
});

describe("CSV cells", () => {
  it("quotes commas, quotes and newlines, and defuses formulas", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    for (const f of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "+1+1"]) expect(csvCell(f).startsWith("'")).toBe(true);
    expect(csvCell("+919876543210")).toBe("+919876543210");
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });
  it("joins rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});

describe("calls CSV", () => {
  it("has one row per real call in range, with tier, status, booking, cost and IST times", async () => {
    const csv = await callsCsv(db, { from: "2026-10-01", to: "2026-10-31" });
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2); // header + 1 (the test call and the September call are out)
    expect(lines[0].split(",")).toHaveLength(CSV_COLUMNS.length);
    expect(lines[1]).toContain("Amber");
    expect(lines[1]).toContain("Booked");
    expect(lines[1]).toContain("2026-10-12 11:00");
    expect(lines[1]).toContain(",+919876543210,"); // a phone number is not defused
    expect(lines[1]).toContain("2026-10-14 11:00"); // consultation time
    expect(lines[1]).toContain("11"); // total cost
    expect(lines[1]).toContain("yes"); // booked
    expect(lines[1]).toContain("\"Kothrud, Pune\"");
  });
  it("defuses a formula in a caller's name", async () => {
    expect(await callsCsv(db, { from: "2026-10-01", to: "2026-10-31" })).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
  it("never includes transcripts, budget fields or the floor", async () => {
    const csv = await callsCsv(db, { from: "2026-10-01", to: "2026-10-31" });
    expect(csv).not.toContain("SECRET TRANSCRIPT");
    expect(csv).not.toMatch(/budget|floor|400000|700000|1500000|estimate/i);
  });
});
