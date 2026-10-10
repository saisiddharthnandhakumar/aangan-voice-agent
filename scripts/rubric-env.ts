/**
 * pnpm rubric:env [--env-file=.env.main-branch.local]
 * Base64-encodes the local rubric.txt (gitignored: it holds the internal pricing section) and
 * writes RUBRIC_TXT_B64 into the env file (default .env.local), so the post-call Gemini step can
 * read the rubric on Vercel. Prints only the size and a hash, never the content. Run
 * pnpm rubric:build first, then copy the line into Vercel → Settings → Environment Variables.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { sha256 } from "../src/lib/rubric/build";

if (!existsSync("rubric.txt")) {
  console.error("rubric.txt missing: run pnpm rubric:build first.");
  process.exit(1);
}
const rubric = readFileSync("rubric.txt", "utf8");
const b64 = Buffer.from(rubric, "utf8").toString("base64");
const line = `RUBRIC_TXT_B64=${b64}`;
const target = process.argv.find((a) => a.startsWith("--env-file="))?.split("=")[1] ?? ".env.local";
const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
const next = /^RUBRIC_TXT_B64=.*$/m.test(existing)
  ? existing.replace(/^RUBRIC_TXT_B64=.*$/m, line)
  : `${existing.replace(/\n?$/, "\n")}${line}\n`;
writeFileSync(target, next, { mode: 0o600 });
if (b64.length > 60_000) console.warn(`! ${b64.length} characters is close to Vercel's 64 KB per-variable limit.`);
console.log(`Wrote RUBRIC_TXT_B64 to ${target}: ${b64.length} characters, rubric sha256 ${sha256(rubric).slice(0, 12)}.`);
