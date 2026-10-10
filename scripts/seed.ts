/**
 * pnpm db:seed
 * Loads ~45 clearly fictional demo calls (vaani_call_id "demo-NNN") into the database named in .env.local.
 * Idempotent: it deletes the existing demo- rows first, then inserts fresh ones with times relative to now.
 * Rows go straight into the tables, never through the pipeline, so nothing reaches HubSpot or Telegram.
 * They are NOT flagged is_test (the dashboards must show them); `pnpm demo:purge` removes them.
 * Point .env.local at the Neon dev branch. To load a deployed database, run with that environment deliberately.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const { db, schema } = await import("../src/db");
  const { buildDemoCalls } = await import("../src/lib/seed-data");
  const { purgeDemo } = await import("../src/lib/dashboard/demo-db");
  const d = db();

  const removed = await purgeDemo(d);
  const demo = buildDemoCalls();
  const inserted = await d.insert(schema.calls).values(demo.map((x) => x.call)).returning({ id: schema.calls.id, vaaniCallId: schema.calls.vaaniCallId });
  const idOf = new Map(inserted.map((r) => [r.vaaniCallId, r.id]));

  const bookings = demo.flatMap((x) => (x.booking ? [{ ...x.booking, callId: idOf.get(x.call.vaaniCallId ?? "") as string }] : []));
  const steps = demo.flatMap((x) => x.steps.map((s) => ({ ...s, callId: idOf.get(x.call.vaaniCallId ?? "") as string })));
  const actions = demo.flatMap((x) =>
    x.actions.map((a) => ({
      callId: idOf.get(x.call.vaaniCallId ?? "") as string,
      actorRole: "designer" as const,
      action: a.action,
      note: a.note ?? null,
      createdAt: new Date((x.call.endedAt as Date).getTime() + a.minutesAfterCall * 60_000),
    })),
  );
  if (bookings.length) await d.insert(schema.bookings).values(bookings);
  if (steps.length) await d.insert(schema.pipelineSteps).values(steps);
  if (actions.length) await d.insert(schema.reviewActions).values(actions);
  console.log(`Removed ${removed} old demo calls; inserted ${inserted.length} demo calls, ${bookings.length} design calls, ${steps.length} pipeline steps, ${actions.length} review actions.`);
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "[db-url]") : "unknown error");
  process.exit(1);
});
