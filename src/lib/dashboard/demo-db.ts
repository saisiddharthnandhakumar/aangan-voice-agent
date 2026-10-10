import { inArray, like } from "drizzle-orm";
import { bookings, calls, pipelineSteps, reviewActions, toolCalls } from "@/db/schema";
import { DEMO_PREFIX } from "./demo";
import type { AnyDb } from "./types";

/**
 * Delete every demo- call and the rows that hang off it, children first (the foreign keys restrict).
 * Matches only the demo- prefix, so a real call can never be touched.
 */
export async function purgeDemo(db: AnyDb): Promise<number> {
  const ids = (await db.select({ id: calls.id }).from(calls).where(like(calls.vaaniCallId, `${DEMO_PREFIX}%`))).map((r) => r.id);
  if (ids.length === 0) return 0;
  await db.delete(bookings).where(inArray(bookings.callId, ids));
  await db.delete(pipelineSteps).where(inArray(pipelineSteps.callId, ids));
  await db.delete(toolCalls).where(inArray(toolCalls.callId, ids));
  await db.delete(reviewActions).where(inArray(reviewActions.callId, ids));
  await db.delete(calls).where(inArray(calls.id, ids));
  return ids.length;
}
