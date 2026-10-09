/**
 * pnpm pricing:config
 * Reads the local docs/source/pricing.md, derives the internal pricing config (floors, estimate
 * midpoints, figures for the leak check) and writes PRICING_CONFIG_JSON into .env.local.
 * Prints only the field names, never the figures. Copy the same line into Vercel.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { derivePricingConfig } from "../src/lib/rules/pricing";

const src = "docs/source/pricing.md";
if (!existsSync(src)) {
  console.error(`Missing ${src} (kept out of git). Copy Nikhil's pricing.md there first.`);
  process.exit(1);
}
const config = derivePricingConfig(readFileSync(src, "utf8"));
const line = `PRICING_CONFIG_JSON=${JSON.stringify(config)}`;
const target = process.argv.find((a) => a.startsWith("--env-file="))?.split("=")[1] ?? ".env.local";
const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
const next = /^PRICING_CONFIG_JSON=.*$/m.test(existing)
  ? existing.replace(/^PRICING_CONFIG_JSON=.*$/m, line)
  : `${existing.replace(/\n?$/, "\n")}${line}\n`;
writeFileSync(target, next, { mode: 0o600 });
console.log(`Wrote PRICING_CONFIG_JSON to ${target} with fields: ${Object.keys(config).join(", ")}.`);
