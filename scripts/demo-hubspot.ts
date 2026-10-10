/**
 * pnpm demo:hubspot [--limit=45] [--yes] [--env-file=.env.local]
 *
 * Logs the fictional demo- calls to HubSpot so the CRM has realistic contacts, call records and deals for a demo.
 * Reads the database named by DATABASE_URL and HUBSPOT_ACCESS_TOKEN (+ HUBSPOT_PIPELINE_ID and the three
 * HUBSPOT_STAGE_* IDs, from `pnpm hubspot:setup`) from the env file. Default is a DRY RUN that only lists what it
 * would create; --yes does it. At most 50 contacts (--limit defaults to 45). Calls that already carry a HubSpot ID
 * are skipped, so it is safe to run twice. Green and Amber (and rescued) calls get a deal; Red gets a contact and
 * a call record only. Contacts use fictional names, an @example.com email and the fake phone range; deal names end
 * "(DEMO)". Prints counts and HubSpot object IDs only, never the token.
 */
import { config } from "dotenv";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const envFile = arg("env-file") ?? ".env.local";
config({ path: envFile, quiet: true });

async function main() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    console.error(`HUBSPOT_ACCESS_TOKEN is not set in ${envFile}. See docs/HUBSPOT_SETUP.md.`);
    process.exit(1);
  }
  const yes = process.argv.includes("--yes") && !process.argv.includes("--dry-run");
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const { db } = await import("../src/db");
  const { hubspotApi } = await import("../src/lib/hubspot/client");
  const { clampLimit, loadDemoToHubspot } = await import("../src/lib/demo/hubspot-load");

  const ids = {
    pipelineId: process.env.HUBSPOT_PIPELINE_ID ?? "default",
    stageBooked: process.env.HUBSPOT_STAGE_BOOKED ?? null,
    stageAwaiting: process.env.HUBSPOT_STAGE_AWAITING ?? null,
    stageLost: process.env.HUBSPOT_STAGE_LOST ?? null,
    portalId: process.env.HUBSPOT_PORTAL_ID ?? null,
  };
  if (yes && (!ids.stageBooked || !ids.stageAwaiting || !ids.stageLost)) {
    console.error("HUBSPOT_STAGE_BOOKED / _AWAITING / _LOST are not set: run pnpm hubspot:setup first.");
    process.exit(1);
  }
  const report = await loadDemoToHubspot({
    db: db(),
    api: hubspotApi({ accessToken: token }),
    ids,
    limit,
    dryRun: !yes,
    appBaseUrl: process.env.APP_BASE_URL,
    // Search is limited to 5 requests/second and each call makes several requests: stay well under.
    pause: () => new Promise((r) => setTimeout(r, 1500)),
  });

  console.log(`${yes ? "LOAD" : "DRY RUN (nothing written; add --yes to load)"}: ${report.considered} demo calls in the database, ${report.skippedAlreadyLogged} already logged, cap ${clampLimit(limit)}.`);
  if (!yes) {
    for (const p of report.planned) console.log(`  would log ${p.vaaniCallId} (${p.tier ?? "not rated"}) ${p.deal ? "+ deal" : "contact and call only"}`);
    console.log(`Would create up to ${report.planned.length} contacts and call records and ${report.planned.filter((p) => p.deal).length} deals.`);
    return;
  }
  console.log(`Created: ${report.contacts.length} contacts, ${report.callRecords.length} call records, ${report.deals.length} deals.`);
  console.log(`Contact IDs: ${report.contacts.join(", ") || "none"}`);
  console.log(`Deal IDs: ${report.deals.join(", ") || "none"}`);
  for (const f of report.failures) console.log(`  FAILED ${f.vaaniCallId}: ${f.reason}`);
  if (report.failures.length) process.exit(1);
}

main().catch((err) => {
  console.error("Demo HubSpot load failed:", err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "[db-url]") : "unknown error");
  process.exit(1);
});
