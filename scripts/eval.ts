/**
 * pnpm eval [--source=gemini|fixtures] [--only=T01,T02] [--concurrency=4]
 *
 * Replays every enquiry in enquiries/ through criteria extraction and the rules engine, then
 * compares the tier with enquiries/expected_tiers.csv (PRD section 5, acceptance test 23):
 * a confusion matrix, every disagreement, and pass/fail against "at least 90% agreement and no
 * Green-labelled enquiry comes out Red".
 *
 * Sources: gemini (default when GEMINI_API_KEY is set) extracts with Gemini Flash using
 * rubric.txt; fixtures uses enquiries/assessments.fixture.json, hand-recorded, to test the rules alone.
 *
 * This script never imports the database: the sample enquiries are test data only (rule 9).
 * Output goes to the terminal and .eval-out/ (gitignored).
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extractionJsonSchema, extractionPrompt, extractionShape } from "../src/lib/gemini/extraction";
import { generateJson, geminiCostInr, type GeminiUsage } from "../src/lib/gemini/client";
import { assess, assessmentInputSchema, parsePricingConfig, type AssessmentResult } from "../src/lib/rules";
import { parseEnv } from "../src/env";
import { enquiryTime, parseCsv } from "../src/lib/eval";

type Label = "green" | "amber" | "red" | "none";
const LABELS: Label[] = ["green", "amber", "red", "none"];

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const istDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

function expandFixture(id: string, f: Record<string, unknown>): unknown {
  const code = String(f.c ?? "UUUPU");
  const s = (ch: string) => ({ P: "pass", F: "fail", U: "unclear" })[ch] ?? "unclear";
  const names = ["real_project", "service_area", "timeline", "budget", "decision_maker"];
  const rest = Object.fromEntries(Object.entries(f).filter(([k]) => k !== "c"));
  return {
    call_id: `eval-${id}`,
    call_category: "enquiry",
    ...rest,
    criteria: Object.fromEntries(names.map((n, i) => [n, { status: s(code[i]), evidence: "fixture" }])),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main() {
  const env = parseEnv(process.env);
  const pricing = parsePricingConfig(env.PRICING_CONFIG_JSON);
  if (!pricing) console.warn("! PRICING_CONFIG_JSON missing: budgets are not checked. Run pnpm pricing:config.");
  const hours = { start: env.BUSINESS_HOURS_START, end: env.BUSINESS_HOURS_END, days: env.BUSINESS_DAYS };

  const source = (arg("source") ?? (env.GEMINI_API_KEY ? "gemini" : "fixtures")) as "gemini" | "fixtures";
  if (source === "gemini" && !env.GEMINI_API_KEY) throw new Error("--source=gemini needs GEMINI_API_KEY in .env.local");
  const rubric = source === "gemini" ? readFileSync("rubric.txt", "utf8") : "";
  const fixtures = source === "fixtures" ? (JSON.parse(readFileSync("enquiries/assessments.fixture.json", "utf8")) as Record<string, Record<string, unknown>>) : {};

  const expected = parseCsv(readFileSync("enquiries/expected_tiers.csv", "utf8"));
  const only = arg("only")?.split(",");
  const rows = expected.filter((r) => !only || only.includes(r.id));
  console.log(`Eval: ${rows.length} enquiries, source=${source}${source === "gemini" ? ` (${env.GEMINI_MODEL})` : ""}\n`);

  const usage: GeminiUsage = { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0 };
  const results = await mapLimit(rows, Number(arg("concurrency") ?? 4), async (row) => {
    const path = `enquiries/${row.id}.md`;
    if (!existsSync(path)) return { row, predicted: "error" as const, error: "missing file" };
    const text = readFileSync(path, "utf8");
    const now = enquiryTime(text);
    try {
      let raw: unknown;
      if (source === "gemini") {
        const res = await generateJson({
          apiKey: env.GEMINI_API_KEY as string,
          model: env.GEMINI_MODEL,
          system: extractionPrompt(rubric, istDate(now)),
          user: `ENQUIRY ${row.id} (${row.channel}):\n\n${text.replace(/^---[\s\S]*?---\n/, "")}`,
          jsonSchema: extractionJsonSchema as unknown as Record<string, unknown>,
          validate: extractionShape,
          maxOutputTokens: 4096,
        });
        usage.promptTokens += res.usage.promptTokens;
        usage.outputTokens += res.usage.outputTokens;
        usage.thoughtsTokens += res.usage.thoughtsTokens;
        raw = { call_id: `eval-${row.id}`, ...res.data };
      } else {
        if (!fixtures[row.id]) return { row, predicted: "error" as const, error: "no fixture" };
        raw = expandFixture(row.id, fixtures[row.id]);
      }
      const input = assessmentInputSchema.parse(raw);
      const result = assess(input, { now, pricing, hours, assumedDealValueInr: env.ASSUMED_DEAL_VALUE_INR });
      const predicted: Label = result.tier ?? "none";
      return { row, predicted, result, input };
    } catch (err) {
      return { row, predicted: "error" as const, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
    }
  });

  // Confusion matrix: rows expected, columns predicted.
  const matrix = Object.fromEntries(LABELS.map((e) => [e, Object.fromEntries([...LABELS, "error"].map((p) => [p, 0]))]));
  for (const r of results) {
    const exp = (r.row.expected_tier || "none") as Label;
    matrix[exp][r.predicted] += 1;
  }
  const pad = (s: string | number, n = 8) => String(s).padStart(n);
  console.log(`${"expected \\ got".padEnd(16)}${[...LABELS, "error"].map((l) => pad(l)).join("")}`);
  for (const e of LABELS) console.log(`${e.padEnd(16)}${[...LABELS, "error"].map((p) => pad(matrix[e][p] || ".")).join("")}`);

  const agree = results.filter((r) => r.predicted === (r.row.expected_tier || "none")).length;
  const greenToRed = results.filter((r) => r.row.expected_tier === "green" && r.predicted === "red");
  const pct = (agree / results.length) * 100;

  console.log(`\nAgreement: ${agree}/${results.length} = ${pct.toFixed(1)}%  (target ≥ 90%)`);
  console.log(`Green-labelled enquiries that came out Red: ${greenToRed.length}  (target 0)`);

  const misses = results.filter((r) => r.predicted !== (r.row.expected_tier || "none"));
  if (misses.length) {
    console.log("\nDisagreements:");
    for (const m of misses) {
      const why = "result" in m && m.result ? (m.result as AssessmentResult).reasons.join("; ") : `error: ${"error" in m ? m.error : ""}`;
      console.log(`  ${m.row.id}  expected ${m.row.expected_tier || "none"}, got ${m.predicted}\n      label: ${m.row.main_reason}\n      rules: ${why}`);
    }
  }

  if (source === "gemini") {
    const cost = geminiCostInr(usage, env.GEMINI_PRICE_IN_PER_MTOK_INR, env.GEMINI_PRICE_OUT_PER_MTOK_INR);
    console.log(`\nGemini tokens: ${usage.promptTokens} in, ${usage.outputTokens} out (${usage.thoughtsTokens} thinking)${cost != null ? `, ≈ ₹${cost.toFixed(2)}` : ""}`);
  }

  mkdirSync(".eval-out", { recursive: true });
  const outFile = `.eval-out/eval-${source}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    outFile,
    JSON.stringify(
      results.map((r) => ({
        id: r.row.id,
        expected: r.row.expected_tier || "none",
        predicted: r.predicted,
        ...("result" in r && r.result ? { reasons: r.result.reasons, flags: r.result.flags, criteria: r.result.criteria, priority: r.result.priority } : {}),
        ...("input" in r ? { input: r.input } : {}),
        ...("error" in r ? { error: r.error } : {}),
      })),
      null,
      2,
    ),
  );
  console.log(`\nDetails: ${outFile}`);

  const ok = pct >= 90 && greenToRed.length === 0 && !results.some((r) => r.predicted === "error");
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
