import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { Db } from "@/db";
import { bookings, calls, toolCalls } from "@/db/schema";

export type CallRow = InferSelectModel<typeof calls>;
export type CallInsert = InferInsertModel<typeof calls>;
export type BookingRow = InferSelectModel<typeof bookings>;
export type BookingInsert = InferInsertModel<typeof bookings>;
export type ToolCallInsert = InferInsertModel<typeof toolCalls>;

/** Persistence the tool endpoints need. Drizzle in production, in-memory in tests. */
export interface ToolsRepo {
  findCallByRef(ref: string): Promise<CallRow | null>;
  /** An in-call row from the same number created recently (the agent forgot to pass call_id). */
  findRecentOpenCallByPhone(phone: string, since: Date): Promise<CallRow | null>;
  /** Insert; returns null if call_ref collided (caller retries with a new ref). */
  createCall(values: CallInsert): Promise<CallRow | null>;
  updateCall(id: string, values: Partial<CallInsert>): Promise<void>;
  getBookingForCall(callId: string): Promise<BookingRow | null>;
  /** Insert a pending booking unless one exists for the call. Returns the row and whether it is new. */
  claimBooking(values: BookingInsert): Promise<{ booking: BookingRow; created: boolean }>;
  updateBooking(id: string, values: Partial<BookingInsert>): Promise<void>;
  logToolCall(values: ToolCallInsert): Promise<void>;
}

export function drizzleToolsRepo(db: Db): ToolsRepo {
  return {
    async findCallByRef(ref) {
      const rows = await db.select().from(calls).where(eq(calls.callRef, ref)).limit(1);
      return rows[0] ?? null;
    },
    async findRecentOpenCallByPhone(phone, since) {
      const rows = await db
        .select()
        .from(calls)
        .where(and(eq(calls.fromNumber, phone), eq(calls.status, "in_call"), isNull(calls.vaaniCallId), gte(calls.createdAt, since)))
        .orderBy(desc(calls.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },
    async createCall(values) {
      const rows = await db.insert(calls).values(values).onConflictDoNothing({ target: calls.callRef }).returning();
      return rows[0] ?? null;
    },
    async updateCall(id, values) {
      await db.update(calls).set(values).where(eq(calls.id, id));
    },
    async getBookingForCall(callId) {
      const rows = await db.select().from(bookings).where(eq(bookings.callId, callId)).limit(1);
      return rows[0] ?? null;
    },
    async claimBooking(values) {
      const inserted = await db.insert(bookings).values(values).onConflictDoNothing({ target: bookings.callId }).returning();
      if (inserted[0]) return { booking: inserted[0], created: true };
      const existing = await db.select().from(bookings).where(eq(bookings.callId, values.callId)).limit(1);
      return { booking: existing[0], created: false };
    },
    async updateBooking(id, values) {
      await db.update(bookings).set(values).where(eq(bookings.id, id));
    },
    async logToolCall(values) {
      await db.insert(toolCalls).values(values);
    },
  };
}
