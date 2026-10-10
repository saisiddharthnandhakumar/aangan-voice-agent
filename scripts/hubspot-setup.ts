/**
 * pnpm hubspot:setup [--full] [--env-file=.env.local] [--write]
 *
 * Creates the "Aangan voice agent" contact-property group and properties in HubSpot (the 8-property
 * Free-plan set; --full adds the other six for a paid plan), finds the deal pipeline and maps the
 * stages, then prints the environment lines to use. Safe to run twice. Reads HUBSPOT_ACCESS_TOKEN from
 * the env file; never prints it. --write also puts the printed pipeline/stage lines into the env file.
 */
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hubspotApi } from "../src/lib/hubspot/client";
import { runHubspotSetup } from "../src/lib/hubspot/setup";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const envFile = arg("env-file") ?? ".env.local";
config({ path: envFile, quiet: true });

async function main() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    console.error(`HUBSPOT_ACCESS_TOKEN is not set in ${envFile}. Create the private app (or service key) first, see docs/HUBSPOT_SETUP.md.`);
    process.exit(1);
  }
  const report = await runHubspotSetup(hubspotApi({ accessToken: token }), { full: process.argv.includes("--full") });

  console.log(`Property group: ${report.groupCreated ? "created" : "already there"}`);
  console.log(`Properties created (${report.propertiesCreated.length}): ${report.propertiesCreated.join(", ") || "none"}`);
  console.log(`Properties already there (${report.propertiesExisting.length}): ${report.propertiesExisting.join(", ") || "none"}`);
  for (const f of report.propertiesFailed) console.log(`  FAILED ${f.name}: ${f.reason}`);
  if (report.stages) {
    console.log(`\nDeal pipeline: ${report.stages.pipelineLabel} (id ${report.stages.pipelineId})`);
    for (const l of report.stages.lines) console.log(`  ${l}`);
  }
  for (const w of report.warnings) console.log(`! ${w}`);
  console.log(`\nAdd these to ${envFile} and to Vercel (they are IDs, not secrets):\n${report.envLines.map((l) => `  ${l}`).join("\n")}`);

  if (process.argv.includes("--write") && report.envLines.length) {
    let text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
    for (const line of report.envLines) {
      const key = line.split("=")[0];
      text = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
    }
    writeFileSync(envFile, text, { mode: 0o600 });
    console.log(`\nWrote those lines to ${envFile}.`);
  }
  process.exit(report.propertiesFailed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
