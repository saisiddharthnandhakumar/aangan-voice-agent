import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { AnyDb } from "@/lib/dashboard/types";

/** A fresh in-memory Postgres with our real migrations applied. */
export async function testDb() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db as unknown as AnyDb & ReturnType<typeof drizzle<typeof schema>>;
}

export type TestDb = Awaited<ReturnType<typeof testDb>>;

type CallValues = typeof schema.calls.$inferInsert;

/** Insert a call with sensible defaults; times are ISO strings in UTC. */
export async function addCall(db: TestDb, v: Partial<Omit<CallValues, "startedAt" | "endedAt" | "answeredAt" | "createdAt" | "telegramSentAt">> & { startedAt?: string; endedAt?: string; answeredAt?: string; createdAt?: string; telegramSentAt?: string }) {
  const { startedAt, endedAt, answeredAt, createdAt, telegramSentAt, ...rest } = v;
  const [row] = await db
    .insert(schema.calls)
    .values({
      status: "awaiting_designer",
      ...rest,
      ...(startedAt ? { startedAt: new Date(startedAt) } : {}),
      ...(endedAt ? { endedAt: new Date(endedAt) } : {}),
      ...(answeredAt ? { answeredAt: new Date(answeredAt) } : {}),
      ...(telegramSentAt ? { telegramSentAt: new Date(telegramSentAt) } : {}),
      createdAt: new Date(createdAt ?? startedAt ?? "2026-10-12T05:30:00Z"),
    })
    .returning();
  return row;
}

export async function addBooking(db: TestDb, callId: string, startAt: string, status: "pending" | "accepted" | "failed" | "cancelled" = "accepted") {
  await db.insert(schema.bookings).values({ callId, consultType: "call", startAt: new Date(startAt), status, eventTypeId: 222 });
}

export async function addStep(db: TestDb, callId: string, step: string, status: "succeeded" | "failed" | "skipped") {
  await db.insert(schema.pipelineSteps).values({ callId, step, status, attempts: 1 });
}

export async function addAction(db: TestDb, callId: string, action: "approve" | "rescue" | "discard" | "note", createdAt: string, note?: string) {
  await db.insert(schema.reviewActions).values({ callId, actorRole: "designer", action, note: note ?? null, createdAt: new Date(createdAt) });
}
