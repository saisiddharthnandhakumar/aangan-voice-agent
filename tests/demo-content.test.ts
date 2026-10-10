import { describe, expect, it } from "vitest";
import { parseTranscript } from "@/lib/dashboard/transcript";
import { contentA } from "@/lib/demo/content-a";
import { contentB } from "@/lib/demo/content-b";
import { contentC } from "@/lib/demo/content-c";
import { agentTurns, detectPriceLeak } from "@/lib/rules/price-leak";
import { buildDemoCalls } from "@/lib/seed-data";

const OPENING =
  "Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded so our designers have your details. How can I help you today?";
const LEAK_CALL = 15;
const rows = buildDemoCalls(new Date("2026-10-14T06:00:00Z"));
const secs = (t: string | null) => {
  const m = t?.match(/^(\d+):(\d+):(\d+)$/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
};

describe("demo content", () => {
  it("covers keys 1 to 45 exactly once across the three maps", () => {
    const keys = [...Object.keys(contentA), ...Object.keys(contentB), ...Object.keys(contentC)].map(Number).sort((a, b) => a - b);
    expect(keys).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    expect(rows).toHaveLength(45);
  });

  rows.forEach(({ call }, i) => {
    const n = i + 1;
    describe(`call ${n}`, () => {
      const turns = parseTranscript(call.transcript);
      const dropped = call.status === "dropped";
      const enquiry = call.callCategory === "enquiry" && !dropped;

      it("starts with the exact opening line and has enough turns", () => {
        expect(turns[0]?.speaker).toBe("agent");
        expect(turns[0]?.text).toBe(OPENING);
        if (!dropped && call.status !== "non_enquiry") expect(turns.length).toBeGreaterThanOrEqual(12);
        if (enquiry && call.status !== "escalated") expect(turns.length).toBeGreaterThanOrEqual(20);
      });

      it("has increasing timestamps inside the call's duration", () => {
        const t = turns.map((x) => secs(x.time));
        t.forEach((v, j) => {
          expect(Number.isNaN(v)).toBe(false);
          if (j) expect(v).toBeGreaterThan(t[j - 1]);
        });
        expect(t[t.length - 1]).toBeLessThanOrEqual(call.durationSeconds as number);
      });

      it("keeps the summary short and the text free of money, rates and real emails", () => {
        expect((call.summary as string).length).toBeLessThanOrEqual(200);
        for (const turn of turns.filter((x) => x.speaker === "agent")) {
          if (n === LEAK_CALL && turn.leak) continue;
          expect(turn.text).not.toMatch(/[₹$€£]|budget|rate per|per sq/i);
        }
        const all = `${call.transcript}\n${call.summary}\n${call.handoffNote}`;
        for (const e of all.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? []) expect(e.endsWith("@example.com")).toBe(true);
      });

      it("speaks only this call's own number", () => {
        const own = (call.fromNumber as string).replace(/^\+91/, "");
        for (const m of (call.transcript as string).match(/\b\d{5}\s?\d{5}\b/g) ?? []) expect(m.replace(/\s/g, "")).toBe(own);
        expect(own).toBe(`99999${String(n).padStart(5, "0")}`);
      });

      it("never stores budget evidence", () => {
        const crit = (call.criteriaAgent as { recorded?: { budget?: { evidence: string | null } } } | null)?.recorded;
        if (crit) expect(crit.budget?.evidence).toBeNull();
      });
    });
  });

  it("flags the price leak in call 15 and in no other transcript", () => {
    const leaking = rows.flatMap((r, i) => (detectPriceLeak(agentTurns(r.call.transcript), null).leak ? [i + 1] : []));
    expect(leaking).toEqual([LEAK_CALL]);
    expect(rows[LEAK_CALL - 1].call.priceLeak).toBe(true);
    expect(rows.filter((r) => r.call.priceLeak)).toHaveLength(1);
  });

  it("reconciles the specs with the content", () => {
    const by = (n: number) => rows[n - 1].call;
    expect(by(19).budgetTight).toBe(false);
    expect(by(19).flags).toContain("structural_changes");
    expect(by(21).tier).toBe("amber");
    expect(by(21).status).toBe("booked");
    expect(by(32).tier).toBe("red");
    expect(by(32).reviewState).toBe("rescued");
    expect(rows[31].booking).toBeDefined();
    expect(JSON.stringify(by(32).tierReasons)).not.toMatch(/budget/i);
    expect((by(32).criteriaAgent as { timeline_move_asked?: boolean }).timeline_move_asked).toBe(true);
  });
});
