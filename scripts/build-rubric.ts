/**
 * pnpm rubric:build [--check]
 * Builds rubric.txt (gitignored: it contains internal pricing) from docs/source/qualified.md,
 * docs/source/services.md, docs/source/pricing.md and src/lib/rubric/examples.txt.
 * --check exits non-zero if the existing rubric.txt differs from a fresh build.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildRubric, sha256 } from "../src/lib/rubric/build";

const read = (p: string) => {
  if (!existsSync(p)) throw new Error(`Missing ${p}. pricing.md is kept out of git; copy Nikhil's file into docs/source/.`);
  return readFileSync(p, "utf8");
};

const rubric = buildRubric({
  qualified: read("docs/source/qualified.md"),
  services: read("docs/source/services.md"),
  pricing: read("docs/source/pricing.md"),
  examples: read("src/lib/rubric/examples.txt"),
});

if (process.argv.includes("--check")) {
  const current = existsSync("rubric.txt") ? readFileSync("rubric.txt", "utf8") : "";
  if (current !== rubric) {
    console.error("rubric.txt is out of date. Run pnpm rubric:build.");
    process.exit(1);
  }
  console.log(`rubric.txt is up to date (sha256 ${sha256(rubric).slice(0, 12)}).`);
} else {
  writeFileSync("rubric.txt", rubric);
  console.log(`Wrote rubric.txt: ${Buffer.byteLength(rubric)} bytes, sha256 ${sha256(rubric).slice(0, 12)}.`);
}
