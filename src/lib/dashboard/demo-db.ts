import { inArray, like } from "drizzle-orm";
import { bookings, calls, pipelineSteps, reviewActions, toolCalls } from "@/db/schema";
import type { HubspotArchive } from "@/lib/hubspot/client";
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

export interface DemoHubspotIds {
  contacts: string[];
  calls: string[];
  deals: string[];
}

/** The HubSpot IDs recorded on demo calls (the only HubSpot objects a demo load creates). */
export async function demoHubspotIds(db: AnyDb): Promise<DemoHubspotIds> {
  const rows = await db
    .select({ contact: calls.hubspotContactId, call: calls.hubspotCallId, deal: calls.hubspotDealId })
    .from(calls)
    .where(like(calls.vaaniCallId, `${DEMO_PREFIX}%`));
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
  return { contacts: uniq(rows.map((r) => r.contact)), calls: uniq(rows.map((r) => r.call)), deals: uniq(rows.map((r) => r.deal)) };
}

/**
 * Archive every HubSpot deal, call record and contact stored on demo calls (children first). Throws on the first
 * failure so the caller can stop before it deletes the database rows that hold the IDs; a re-run is safe because
 * archiving an already archived record is a no-op.
 */
export async function archiveDemoHubspot(api: HubspotArchive, ids: DemoHubspotIds, pause: () => Promise<void> = async () => {}): Promise<number> {
  let n = 0;
  for (const [type, list] of [["deals", ids.deals], ["calls", ids.calls], ["contacts", ids.contacts]] as const) {
    for (const id of list) {
      await api.archive(type, id);
      n++;
      await pause();
    }
  }
  return n;
}
