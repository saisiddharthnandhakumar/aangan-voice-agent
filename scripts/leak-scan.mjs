// pnpm leak:scan — fails if staged files contain any figure from the local (gitignored) pricing.md,
// or a Neon password marker. The figures are read at run time, so this script itself holds none.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const src = "docs/source/pricing.md";
if (!existsSync(src)) {
  console.error(`Missing ${src}; cannot scan.`);
  process.exit(2);
}
const figures = [...new Set([...readFileSync(src, "utf8").matchAll(/₹\s*([\d,]+(?:\.\d+)?)/g)].map((m) => m[1]))];
const patterns = figures.flatMap((f) => [f, f.replace(/,/g, "")]).filter((f) => f.replace(/\D/g, "").length >= 3);
const files = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" }).split("\n").filter((f) => f && f !== "pnpm-lock.yaml" && existsSync(f));
let hits = 0;
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const p of [...patterns, "npg_"]) {
      if (new RegExp(`(^|[^\\d,.])${p.replace(/[.]/g, "\\.")}([^\\d,]|$)`).test(line)) {
        console.log(`${f}:${i + 1}: matches a pricing figure or secret marker`);
        hits++;
      }
    }
  });
}
console.log(hits ? `${hits} hit(s). Check each: some may be harmless (e.g. a timeout constant).` : "Clean.");
process.exit(hits ? 1 : 0);
