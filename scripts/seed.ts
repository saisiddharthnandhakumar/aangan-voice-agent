/**
 * pnpm db:seed [--reset]
 * Inserts invented calls flagged is_test into the database in .env.local (the Neon dev branch).
 * Safe to run twice: rows are keyed on vaani_call_id "seed-NNN". --reset removes only those rows.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq, inArray, like } from "drizzle-orm";

async function main() {
  const { db, schema } = await import("../src/db");
  const { buildSeedCalls, SEED_PREFIX } = await import("../src/lib/seed-data");
  const d = db();
  const seedFilter = and(eq(schema.calls.isTest, true), like(schema.calls.vaaniCallId, `${SEED_PREFIX}%`));

  if (process.argv.includes("--reset")) {
    const ids = (await d.select({ id: schema.calls.id }).from(schema.calls).where(seedFilter)).map((r) => r.id);
    if (ids.length) {
      await d.delete(schema.bookings).where(inArray(schema.bookings.callId, ids));
      await d.delete(schema.pipelineSteps).where(inArray(schema.pipelineSteps.callId, ids));
      await d.delete(schema.toolCalls).where(inArray(schema.toolCalls.callId, ids));
      await d.delete(schema.reviewActions).where(inArray(schema.reviewActions.callId, ids));
      await d.delete(schema.calls).where(inArray(schema.calls.id, ids));
    }
    console.log(`Removed ${ids.length} seed calls.`);
  }

  let inserted = 0;
  for (const { call, booking } of buildSeedCalls()) {
    const rows = await d
      .insert(schema.calls)
      .values(call)
      .onConflictDoNothing({ target: schema.calls.vaaniCallId })
      .returning({ id: schema.calls.id });
    if (!rows[0]) continue;
    inserted++;
    if (booking) await d.insert(schema.bookings).values({ ...booking, callId: rows[0].id }).onConflictDoNothing();
  }
  const total = (await d.select({ id: schema.calls.id }).from(schema.calls).where(seedFilter)).length;
  console.log(`Inserted ${inserted} new seed calls; ${total} seed calls present (all is_test).`);
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "[db-url]") : "unknown error");
  process.exit(1);
});
