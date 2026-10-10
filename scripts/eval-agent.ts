/**
 * pnpm eval:agent [--only=T01,T02] [--model=gemini-3.5-flash] [--concurrency=4] [--runs=1]
 *
 * Acceptance test 23 for the agent-decides design (user decision 2026-10-10): the Vaani agent, not the rules
 * engine, decides Green, Amber or Red from rubric.txt. This replays each of the 40 sample enquiries through
 * Gemini given the real Vaani system prompt (docs/vaani/system_prompt.txt, which holds the rubric and the
 * decision rules), asks it for the tier it would send in submit_assessment, and compares with
 * enquiries/expected_tiers.csv: a confusion matrix, every disagreement, and pass/fail against
 * "at least 90% agreement and no Green-labelled enquiry comes out Red".
 *
 * Caveats: this tests the PROMPT and RUBRIC with a Gemini model, not Vaani's live agent (its model is set in
 * the Vaani dashboard; pass --model to match it). The enquiries are text, not live conversations, so the
 * agent's own questions are not replayed. Never touches the database: the sample enquiries are test data only.
 * Output goes to the terminal and .eval-out/ (gitignored).
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateJson, geminiCostInr, type GeminiUsage } from "../src/lib/gemini/client";
import { parseEnv } from "../src/env";
import { enquiryTime, parseCsv } from "../src/lib/eval";
import { istParts } from "../src/lib/rules/time";

type Label = "green" | "amber" | "red" | "none";
const LABELS: Label[] = ["green", "amber", "red", "none"];
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const schema = {
  type: "object",
  properties: {
    call_category: { type: "string", enum: ["enquiry", "existing_client", "existing_client_complaint", "vendor_or_sales", "job_seeker", "wrong_number", "other"] },
    criteria: {
      type: "object",
      properties: Object.fromEntries(["real_project", "service_area", "timeline", "budget", "decision_maker"].map((k) => [k, { type: "string", enum: ["pass", "fail", "unclear"] }])),
      required: ["real_project", "service_area", "timeline", "budget", "decision_maker"],
      additionalProperties: false,
    },
    tier: { type: ["string", "null"], enum: ["green", "amber", "red", null], description: "Your decision for an enquiry; null for any other call_category" },
    tier_reason: { type: "string" },
  },
  required: ["call_category", "criteria", "tier", "tier_reason"],
  additionalProperties: false,
} as const;

const TASK = `This is an evaluation harness, not a live call. Below is a complete enquiry that reached the studio
(a phone transcript, a WhatsApp thread or a web form). Act as the voice agent at the moment you would call
submit_assessment: apply the rubric and your decision rules to everything the person said, decide the tier, and
return ONLY the requested JSON (call_category, the five criteria statuses, tier, tier_reason). If the person
never answered something the agent would have asked, judge from what is there using the rules: unclear
criteria 1 to 3 make it Amber. Today's date in India is {{TODAY}}.`;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function main() {
  const env = parseEnv(process.env);
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set in .env.local");
  if (!existsSync("docs/vaani/system_prompt.txt")) throw new Error("docs/vaani/system_prompt.txt missing: run pnpm rubric:build && pnpm vaani:prompt");
  const systemPrompt = readFileSync("docs/vaani/system_prompt.txt", "utf8");
  const model = arg("model") ?? env.GEMINI_MODEL;
  const runs = Number(arg("runs") ?? 1);

  const expected = parseCsv(readFileSync("enquiries/expected_tiers.csv", "utf8"));
  const only = arg("only")?.split(",");
  const rows = expected.filter((r) => !only || only.includes(r.id));
  console.log(`Agent eval: ${rows.length} enquiries x ${runs} run(s), model=${model}\n`);

  const usage: GeminiUsage = { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0 };
  const results = await mapLimit(rows, Number(arg("concurrency") ?? 4), async (row) => {
    const path = `enquiries/${row.id}.md`;
    if (!existsSync(path)) return { row, predicted: "error" as const, reason: "missing file", votes: [] as string[] };
    const text = readFileSync(path, "utf8");
    // A missed call has no conversation: the agent never sees it, so there is nothing to decide (T08).
    if (/MISSED CALL/i.test(text.split("\n").find((l) => l.startsWith("# ")) ?? "")) return { row, predicted: "none" as const, reason: "missed call: no conversation, nothing to decide", votes: ["none"] };
    const today = istParts(enquiryTime(text)).date;
    const votes: string[] = [];
    let reason = "";
    for (let i = 0; i < runs; i++) {
      try {
        const res = await generateJson({
          apiKey: env.GEMINI_API_KEY as string,
          model,
          system: systemPrompt,
          user: `${TASK.replace("{{TODAY}}", today)}\n\nENQUIRY ${row.id} (${row.channel}):\n\n${text.replace(/^---[\s\S]*?---\n/, "")}`,
          jsonSchema: schema as unknown as Record<string, unknown>,
          validate: { safeParse: (v: unknown) => ({ success: true as const, data: v as { call_category: string; tier: string | null; tier_reason: string } }) } as never,
          maxOutputTokens: 4096,
          timeoutMs: 90_000, // the system prompt is long; a 30 s default times out under load
          attempts: 4,
        });
        const d = res.data as unknown as { call_category: string; tier: string | null; tier_reason: string };
        usage.promptTokens += res.usage.promptTokens;
        usage.outputTokens += res.usage.outputTokens;
        usage.thoughtsTokens += res.usage.thoughtsTokens;
        votes.push(d.call_category === "enquiry" ? (d.tier ?? "none") : "none");
        reason = d.tier_reason;
      } catch (err) {
        votes.push("error");
        reason = err instanceof Error ? err.message.slice(0, 120) : String(err);
      }
    }
    // Majority vote across runs; a tie leans to the more cautious (amber).
    const counts = votes.reduce<Record<string, number>>((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {});
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] === "amber" ? -1 : 1))[0][0];
    return { row, predicted: best as Label | "error", reason, votes };
  });

  const matrix = Object.fromEntries(LABELS.map((e) => [e, Object.fromEntries([...LABELS, "error"].map((p) => [p, 0]))]));
  for (const r of results) matrix[(r.row.expected_tier || "none") as Label][r.predicted] += 1;
  const pad = (s: string | number, n = 8) => String(s).padStart(n);
  console.log(`${"expected \\ got".padEnd(16)}${[...LABELS, "error"].map((l) => pad(l)).join("")}`);
  for (const e of LABELS) console.log(`${e.padEnd(16)}${[...LABELS, "error"].map((p) => pad(matrix[e][p] || ".")).join("")}`);

  const agree = results.filter((r) => r.predicted === (r.row.expected_tier || "none")).length;
  const greenToRed = results.filter((r) => r.row.expected_tier === "green" && r.predicted === "red");
  const redToGreen = results.filter((r) => r.row.expected_tier === "red" && r.predicted === "green");
  const pct = (agree / results.length) * 100;
  console.log(`\nAgreement: ${agree}/${results.length} = ${pct.toFixed(1)}%  (target ≥ 90%)`);
  console.log(`Green-labelled enquiries that came out Red: ${greenToRed.length}  (target 0)`);
  console.log(`Red-labelled enquiries that came out Green: ${redToGreen.length}  (a Red wrongly booked)`);

  const misses = results.filter((r) => r.predicted !== (r.row.expected_tier || "none"));
  if (misses.length) {
    console.log("\nDisagreements:");
    for (const m of misses) console.log(`  ${m.row.id}  expected ${m.row.expected_tier || "none"}, got ${m.predicted}${m.votes.length > 1 ? ` (votes ${m.votes.join(",")})` : ""}\n      label: ${m.row.main_reason}\n      agent: ${m.reason}`);
  }
  const cost = geminiCostInr(usage, env.GEMINI_PRICE_IN_PER_MTOK_INR, env.GEMINI_PRICE_OUT_PER_MTOK_INR);
  console.log(`\nGemini tokens: ${usage.promptTokens} in, ${usage.outputTokens} out${cost != null ? `, ≈ ₹${cost.toFixed(2)}` : ""}`);

  mkdirSync(".eval-out", { recursive: true });
  const outFile = `.eval-out/eval-agent-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(outFile, JSON.stringify(results.map((r) => ({ id: r.row.id, expected: r.row.expected_tier || "none", predicted: r.predicted, votes: r.votes, reason: r.reason })), null, 2));
  console.log(`\nDetails: ${outFile}`);
  const ok = pct >= 90 && greenToRed.length === 0 && !results.some((r) => r.predicted === "error");
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
