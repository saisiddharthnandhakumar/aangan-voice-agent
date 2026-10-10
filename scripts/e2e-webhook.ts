/**
 * pnpm e2e:webhook [--base=http://localhost:3000] [--env-file=.env.local] [--mode=a|b] [--tier=green|amber|red] [--real]
 *
 * End-to-end check of the webhook and pipeline through the real HTTP routes:
 *   mode a (default): submit_assessment (call_mode "e2e-test", so is_test) → call_started →
 *     user_picked_up_at → call_ended → call_postprocessing (twice, to prove idempotency);
 *   mode b: the same events with no tool call (Vaani tools not reaching us).
 * Every event carries is_test: true and an "e2e-" room name, so nothing reaches HubSpot or
 * Telegram. With --real it instead posts a NON-test lead (call_mode "phone", name "E2E Test (ignore)",
 * a fixed dummy number) so that Telegram and HubSpot really fire: use it once after connecting them, then
 * delete the contact and deal in HubSpot. Then it polls the database named by the env file and prints the call's status, tier,
 * flags and pipeline steps. Prints no secrets and no phone numbers.
 *
 * Production: --base=https://aangan-voice-agent-inky.vercel.app --env-file=.env.main-branch.local
 */
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const envFile = arg("env-file", ".env.local");
config({ path: envFile, quiet: true });

const base = arg("base", "http://localhost:3000").replace(/\/$/, "");
const mode = arg("mode", "a");
const tier = arg("tier", "green");
const real = process.argv.includes("--real");
const DUMMY_PHONE = "+919999900001";
const webhookSecret = process.env.VAANI_WEBHOOK_SECRET;
const toolSecret = process.env.VAANI_TOOL_SECRET;
const dbUrl = process.env.DATABASE_URL;
if (!webhookSecret || !dbUrl) throw new Error(`VAANI_WEBHOOK_SECRET and DATABASE_URL must be set in ${envFile}`);
if (mode === "a" && !toolSecret) throw new Error(`mode a needs VAANI_TOOL_SECRET in ${envFile}`);

const room = `e2e-${randomBytes(6).toString("hex")}`;
const start = new Date();
const seconds = 185;
const end = new Date(start.getTime() + seconds * 1000);
const hhmmss = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 19);
const transcript = [
  `[${hhmmss(start)}] AGENT: Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded so our designers have your details. How can I help you today?`,
  `[${hhmmss(new Date(start.getTime() + 6000))}] USER: Hi, this is an end-to-end test. I'd like my 3BHK in Kothrud fully redesigned and executed, done by March.`,
  `[${hhmmss(new Date(start.getTime() + 14000))}] AGENT: Thank you. Who will be deciding on the project?`,
  `[${hhmmss(new Date(start.getTime() + 20000))}] USER: My husband and I. Roughly what would it cost?`,
  `[${hhmmss(new Date(start.getTime() + 26000))}] AGENT: Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation.`,
].join("\n\n");

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, json };
}

const hook = (body: unknown) => postJson(`/api/webhooks/vaani/call-ended?token=${encodeURIComponent(webhookSecret as string)}`, body);

async function main() {
  console.log(`E2E webhook → ${base} (mode ${mode}${mode === "a" ? `, agent tier ${tier}` : ""}${real ? ", REAL: not marked as a test" : ""}), room ${room}\n`);

  // Auth check first: a wrong token must be refused.
  const bad = await postJson("/api/webhooks/vaani/call-ended?token=wrong", { event: "call_started", room_name: room });
  console.log(`wrong token            → ${bad.status} ${bad.status === 401 ? "ok" : "UNEXPECTED"}`);

  const started = await hook({ event: "call_started", room_name: room, status: "dialing", timestamp: start.toISOString(), ...(real ? { phone_number: DUMMY_PHONE } : { is_test: true }) });
  console.log(`call_started           → ${started.status} ${JSON.stringify(started.json)}`);
  await hook({ event: "user_picked_up_at", room_name: room, status: "active", timestamp: new Date(start.getTime() + 2000).toISOString(), ...(real ? {} : { is_test: true }) });

  let ref: string | null = null;
  if (mode === "a") {
    const sub = await postJson(
      "/api/vaani/tools/submit_assessment",
      {
        call_id: "",
        call_mode: real ? "phone" : "e2e-test",
        call_category: "enquiry",
        caller_name: real ? "E2E Test (ignore)" : "E2E Test",
        ...(real ? { phone: DUMMY_PHONE } : {}),
        project_type: "home",
        scope_type: "full_home",
        bhk: 3,
        locality: "Kothrud",
        scope_summary: "E2E test: full 3BHK redesign",
        completion_needed_by: `${start.getUTCFullYear() + 1}-03-01`,
        real_project_status: "pass",
        service_area_status: "pass",
        timeline_status: "pass",
        budget_status: "pass",
        decision_maker_status: "pass",
        tier,
        tier_reason: "e2e test",
      },
      { "X-Tool-Secret": toolSecret as string },
    );
    ref = (sub.json as { call_id?: string }).call_id ?? null;
    console.log(`submit_assessment      → ${sub.status} action=${(sub.json as { action?: string }).action} call_ref=${ref}`);
  }

  const ended = await hook({ event: "call_ended", room_name: room, call_duration: seconds, end_reason: "AGENT_REQUESTED_DISCONNECT", timestamp: end.toISOString(), ...(real ? {} : { is_test: true }) });
  console.log(`call_ended             → ${ended.status} ${JSON.stringify(ended.json)}`);
  await new Promise((r) => setTimeout(r, 2000)); // Vaani sends post-processing some time after the call ends
  const post = {
    event: "call_postprocessing",
    call_id: room,
    timestamp: end.toISOString(),
    ...(real ? {} : { is_test: true }),
    data: { room_name: room, call_id: room, call_duration: seconds * 1000, end_reason: "Call ended", summary: "e2e", entities: {}, dispositions: {}, recording_url: null, transcript },
  };
  const p1 = await hook(post);
  const p2 = await hook(post);
  console.log(`call_postprocessing    → ${p1.status} ${JSON.stringify(p1.json)}`);
  console.log(`  …duplicate           → ${p2.status} ${JSON.stringify(p2.json)}`);

  const sql = neon(dbUrl as string);
  const deadline = Date.now() + 120_000;
  for (;;) {
    const rows = (await sql`
      select c.id, c.call_ref, c.status, c.tier, c.flags, c.is_test, c.price_leak, c.duration_seconds,
             c.vaani_cost_inr, c.gemini_cost_inr, c.total_cost_inr, (c.summary is not null) as has_summary,
             jsonb_array_length(coalesce(c.raw_webhook->'events', '[]'::jsonb)) as events,
             (select count(*) from calls x where x.vaani_call_id = ${room}) as rows_for_room,
             (select json_agg(json_build_object('step', s.step, 'status', s.status, 'attempts', s.attempts, 'note', s.last_error) order by s.updated_at)
                from pipeline_steps s where s.call_id = c.id) as steps
      from calls c where c.vaani_call_id = ${room}`) as Array<Record<string, unknown>>;
    const row = rows[0];
    const steps = (row?.steps as Array<{ step: string; status: string }> | null) ?? [];
    if (row && steps.length >= 10 && !steps.some((s) => s.status === "running")) {
      console.log("\nResult");
      console.log(JSON.stringify({ ...row, steps: undefined }, null, 2));
      for (const s of steps as Array<{ step: string; status: string; attempts: number; note: string | null }>) {
        console.log(`  ${s.step.padEnd(13)} ${s.status.padEnd(10)} attempts=${s.attempts}${s.note ? `  ${s.note}` : ""}`);
      }
      const checks = [
        ["one row for the room", Number(row.rows_for_room) === 1],
        [real ? "not a test call (reaches Telegram and HubSpot)" : "is_test", row.is_test === !real],
        ["4 distinct events stored", Number(row.events) === 4],
        ...(mode === "a" ? [["merged with the tool row", row.call_ref === ref] as const, ["tier kept as the agent's", row.tier === tier] as const] : [["unclassified (Mode B)", (row.flags as string[]).includes("unclassified")] as const]),
        ["no price leak", row.price_leak === false],
      ] as const;
      console.log("");
      for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
      process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
    }
    if (Date.now() > deadline) {
      console.error("Timed out waiting for the pipeline (2 min).");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
