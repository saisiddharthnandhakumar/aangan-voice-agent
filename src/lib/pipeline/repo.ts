import { and, eq, gte, isNull, lt, lte, ne, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Db } from "@/db";
import { bookings, calls, pipelineSteps } from "@/db/schema";
import type { PriorCall } from "@/lib/rules/repeat";
import type { BookingInsert, BookingRow, CallInsert, CallRow } from "@/lib/tools/repo";

export type StepRow = InferSelectModel<typeof pipelineSteps>;
export type StepStatus = StepRow["status"];

/** One raw webhook event as stored in calls.raw_webhook = {events: [...]}. */
export interface StoredEvent {
  event: string;
  received_at: string;
  payload: unknown;
}

/** Persistence for the webhook and the post-call pipeline. Drizzle in production, in-memory in tests. */
export interface PipelineRepo {
  /**
   * Upsert the row for this Vaani call and append the raw event, unless an event of the same type
   * is already stored (idempotent per (vaani_call_id, event type)). Atomic in Postgres.
   */
  recordEvent(vaaniCallId: string, event: StoredEvent, isTest: boolean): Promise<{ call: CallRow; duplicate: boolean }>;
  getCall(id: string): Promise<CallRow | null>;
  getCallByRef(ref: string): Promise<CallRow | null>;
  getCallByVaaniId(vaaniCallId: string): Promise<CallRow | null>;
  updateCall(id: string, values: Partial<CallInsert>): Promise<void>;
  /** Rows created by submit_assessment, not yet linked to a Vaani call, created within [from, to]. */
  findUnlinkedToolRows(from: Date, to: Date): Promise<CallRow[]>;
  /**
   * Fold the webhook-only row (stub) into the tool row: copy the call's timings, transcript and
   * raw events, delete the stub, and give the tool row the Vaani call ID. One transaction.
   */
  mergeStubIntoToolRow(stubId: string, toolRowId: string): Promise<CallRow>;
  getBookingForCall(callId: string): Promise<BookingRow | null>;
  updateBooking(id: string, values: Partial<BookingInsert>): Promise<void>;
  /** Calls from this number that started in [since, before), excluding one call. */
  priorCallsFromNumber(fromNumber: string, since: Date, before: Date, excludeId: string): Promise<PriorCall[]>;
  getSteps(callId: string): Promise<StepRow[]>;
  upsertStep(callId: string, step: string, values: { status: StepStatus; attempts: number; lastError: string | null }): Promise<void>;
}

export function drizzlePipelineRepo(db: Db): PipelineRepo {
  return {
    async recordEvent(vaaniCallId, event, isTest) {
      await db
        .insert(calls)
        .values({ vaaniCallId, status: "in_call", rawWebhook: { events: [] }, isTest })
        .onConflictDoNothing({ target: calls.vaaniCallId });
      const probe = JSON.stringify([{ event: event.event }]);
      const appended = await db
        .update(calls)
        .set({
          rawWebhook: sql`jsonb_build_object('events', coalesce(${calls.rawWebhook}->'events', '[]'::jsonb) || ${JSON.stringify([event])}::jsonb)`,
          isTest: sql`${calls.isTest} or ${isTest}`,
        })
        .where(and(eq(calls.vaaniCallId, vaaniCallId), sql`not (coalesce(${calls.rawWebhook}->'events', '[]'::jsonb) @> ${probe}::jsonb)`))
        .returning();
      if (appended[0]) return { call: appended[0], duplicate: false };
      const existing = await db.select().from(calls).where(eq(calls.vaaniCallId, vaaniCallId)).limit(1);
      return { call: existing[0], duplicate: true };
    },
    async getCall(id) {
      const rows = await db.select().from(calls).where(eq(calls.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async getCallByRef(ref) {
      const rows = await db.select().from(calls).where(eq(calls.callRef, ref)).limit(1);
      return rows[0] ?? null;
    },
    async getCallByVaaniId(vaaniCallId) {
      const rows = await db.select().from(calls).where(eq(calls.vaaniCallId, vaaniCallId)).limit(1);
      return rows[0] ?? null;
    },
    async updateCall(id, values) {
      await db.update(calls).set(values).where(eq(calls.id, id));
    },
    async findUnlinkedToolRows(from, to) {
      return db
        .select()
        .from(calls)
        .where(and(isNull(calls.vaaniCallId), sql`${calls.callRef} is not null`, gte(calls.createdAt, from), lte(calls.createdAt, to)));
    },
    async mergeStubIntoToolRow(stubId, toolRowId) {
      const [stub] = await db.select({ vaaniCallId: calls.vaaniCallId }).from(calls).where(eq(calls.id, stubId)).limit(1);
      if (!stub?.vaaniCallId) throw new Error("merge: stub row not found");
      // Columns are read from the stub inside the transaction, so an event appended just before
      // the merge is not lost. The stub is deleted before its Vaani ID moves (unique index).
      const s = (col: string) => sql`(select s.${sql.identifier(col)} from calls s where s.id = ${stubId})`;
      await db.batch([
        db
          .update(calls)
          .set({
            startedAt: sql`coalesce(${s("started_at")}, ${calls.startedAt})`,
            answeredAt: sql`coalesce(${s("answered_at")}, ${calls.answeredAt})`,
            endedAt: sql`coalesce(${s("ended_at")}, ${calls.endedAt})`,
            durationSeconds: sql`coalesce(${s("duration_seconds")}, ${calls.durationSeconds})`,
            endReason: sql`coalesce(${s("end_reason")}, ${calls.endReason})`,
            transcript: sql`coalesce(${s("transcript")}, ${calls.transcript})`,
            recordingUrl: sql`coalesce(${s("recording_url")}, ${calls.recordingUrl})`,
            vaaniAgentId: sql`coalesce(${s("vaani_agent_id")}, ${calls.vaaniAgentId})`,
            toNumber: sql`coalesce(${calls.toNumber}, ${s("to_number")})`,
            fromNumber: sql`coalesce(${calls.fromNumber}, ${s("from_number")})`,
            rawWebhook: s("raw_webhook"),
            isTest: sql`${calls.isTest} or coalesce(${s("is_test")}, false)`,
            status: sql`case when ${s("status")} = 'in_call' then ${calls.status} else ${s("status")} end`,
          })
          .where(eq(calls.id, toolRowId)),
        db.delete(pipelineSteps).where(eq(pipelineSteps.callId, stubId)),
        db.delete(calls).where(eq(calls.id, stubId)),
        db.update(calls).set({ vaaniCallId: stub.vaaniCallId }).where(eq(calls.id, toolRowId)),
      ]);
      const [merged] = await db.select().from(calls).where(eq(calls.id, toolRowId)).limit(1);
      return merged;
    },
    async getBookingForCall(callId) {
      const rows = await db.select().from(bookings).where(eq(bookings.callId, callId)).limit(1);
      return rows[0] ?? null;
    },
    async updateBooking(id, values) {
      await db.update(bookings).set(values).where(eq(bookings.id, id));
    },
    async priorCallsFromNumber(fromNumber, since, before, excludeId) {
      return db
        .select({ id: calls.id, fromNumber: calls.fromNumber, startedAt: calls.startedAt, repeatOfCallId: calls.repeatOfCallId })
        .from(calls)
        .where(and(eq(calls.fromNumber, fromNumber), gte(calls.startedAt, since), lt(calls.startedAt, before), ne(calls.id, excludeId)));
    },
    async getSteps(callId) {
      return db.select().from(pipelineSteps).where(eq(pipelineSteps.callId, callId));
    },
    async upsertStep(callId, step, values) {
      await db
        .insert(pipelineSteps)
        .values({ callId, step, ...values })
        .onConflictDoUpdate({ target: [pipelineSteps.callId, pipelineSteps.step], set: { ...values, updatedAt: new Date() } });
    },
  };
}
