import { eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { purgeDemo } from "@/lib/dashboard/demo-db";
import { founderMetrics } from "@/lib/dashboard/metrics";
import { listTodo, needYouCount } from "@/lib/dashboard/queries";
import { buildDemoCalls, DEMO_PREFIX, DEMO_VAANI_COST_PER_MIN_INR } from "@/lib/seed-data";
import { testDb } from "./dashboard/harness";

const NOW = new Date("2026-10-14T06:00:00Z"); // Wed 11:30 IST
const rows = buildDemoCalls(NOW);

describe("demo data", () => {
  it("has about 45 calls with unique demo- IDs, none flagged is_test", () => {
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(new Set(rows.map((r) => r.call.vaaniCallId)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.call.callRef)).size).toBe(rows.length);
    for (const { call } of rows) {
      expect(call.vaaniCallId?.startsWith(DEMO_PREFIX)).toBe(true);
      expect(call.isTest).toBe(false);
    }
  });

  it("spans the last 30 days and every kind of call", () => {
    const days = rows.map((r) => (NOW.getTime() - (r.call.startedAt as Date).getTime()) / 86_400_000);
    expect(Math.min(...days)).toBeLessThan(1);
    expect(Math.max(...days)).toBeGreaterThan(25);
    expect(Math.max(...days)).toBeLessThan(31);
    expect(new Set(rows.map((r) => r.call.status))).toEqual(
      new Set(["booked", "awaiting_designer", "unqualified_verified", "escalated", "non_enquiry", "dropped"]),
    );
    expect(new Set(rows.map((r) => r.call.tier))).toEqual(new Set(["green", "amber", "red", null]));
    expect(rows.some((r) => r.call.calledAfterHours)).toBe(true);
    expect(rows.filter((r) => r.call.priority === "high").length).toBeGreaterThanOrEqual(2);
    expect(rows.filter((r) => r.call.priceLeak)).toHaveLength(1);
  });

  it("prices Vaani minutes at the configured rate and books design calls only", () => {
    for (const { call, booking } of rows) {
      expect(call.vaaniCostInr).toBeCloseTo(((call.durationSeconds as number) / 60) * DEMO_VAANI_COST_PER_MIN_INR, 1);
      if (booking) {
        expect(booking.consultType).toBe("call");
        expect(booking.status).toBe("accepted");
      }
      expect(call.consultType).not.toBe("site_visit");
    }
  });

  it("books design calls today, tomorrow and later this week", () => {
    const day = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const dates = new Set(rows.flatMap((r) => (r.booking ? [day(r.booking.startAt as Date)] : [])));
    expect(dates.has("2026-10-14")).toBe(true);
    expect(dates.has("2026-10-15")).toBe(true);
    expect([...dates].some((d) => d > "2026-10-15")).toBe(true);
  });

  it("contains no pricing language and no failed steps", () => {
    expect(JSON.stringify(rows)).not.toMatch(/per sq ?ft|lakh|crore|₹|rupee/i);
    for (const r of rows) for (const s of r.steps) expect(s.status).not.toBe("failed");
  });
});

describe("demo data in a database", () => {
  it("loads, shows on the dashboards, and purges cleanly without touching other calls", async () => {
    const db = await testDb();
    const [real] = await db.insert(schema.calls).values({ vaaniCallId: "real-1", status: "awaiting_designer", tier: "amber", startedAt: NOW }).returning();
    const inserted = await db.insert(schema.calls).values(rows.map((r) => r.call)).returning({ id: schema.calls.id, v: schema.calls.vaaniCallId });
    const idOf = new Map(inserted.map((r) => [r.v, r.id]));
    await db.insert(schema.bookings).values(rows.flatMap((r) => (r.booking ? [{ ...r.booking, callId: idOf.get(r.call.vaaniCallId ?? "") as string }] : [])));
    await db.insert(schema.pipelineSteps).values(rows.flatMap((r) => r.steps.map((s) => ({ ...s, callId: idOf.get(r.call.vaaniCallId ?? "") as string }))));

    const todo = await listTodo(db, {}, NOW);
    expect(todo.needsYou.length).toBeGreaterThan(5);
    expect(todo.today.length).toBeGreaterThanOrEqual(2);
    expect(todo.comingUp.length).toBeGreaterThanOrEqual(3);
    expect(await needYouCount(db)).toBe(todo.needsYou.length);

    const m = await founderMetrics(db, { from: "2026-09-15", to: "2026-10-14" }, NOW, { staleHours: 4 });
    expect(m.calls.received).toBe(rows.length + 1);
    expect(m.calls.afterHoursBooked).toBeGreaterThan(0);
    expect(m.bookings.booked).toBeGreaterThan(10);

    expect(await purgeDemo(db)).toBe(rows.length);
    expect(await db.select().from(schema.calls).where(like(schema.calls.vaaniCallId, "demo-%"))).toHaveLength(0);
    expect(await db.select().from(schema.calls).where(eq(schema.calls.id, real.id))).toHaveLength(1);
    expect(await db.select().from(schema.bookings)).toHaveLength(0);
    expect(await purgeDemo(db)).toBe(0);
  }, 30_000);
});
