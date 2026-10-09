/**
 * pnpm vaani:prompt — writes docs/vaani/system_prompt.txt (gitignored: it contains the internal
 * pricing section) from docs/vaani/system_prompt.template.txt with rubric.txt in place of {{RUBRIC}}.
 * Run pnpm rubric:build first.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (!existsSync("rubric.txt")) {
  console.error("rubric.txt missing: run pnpm rubric:build first.");
  process.exit(1);
}
const template = readFileSync("docs/vaani/system_prompt.template.txt", "utf8");
if (!template.includes("{{RUBRIC}}")) throw new Error("template has no {{RUBRIC}} marker");
const prompt = template.replace("{{RUBRIC}}", readFileSync("rubric.txt", "utf8").trim());
writeFileSync("docs/vaani/system_prompt.txt", prompt);
console.log(`Wrote docs/vaani/system_prompt.txt (${prompt.length} characters). Paste it into Vaani; do not commit it.`);
