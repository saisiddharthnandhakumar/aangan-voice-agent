/**
 * pnpm demo:purge [--hubspot] [--env-file=.env.local]
 * Removes every demo- call (and its design calls, steps and actions) from the database in the env file.
 * With --hubspot (and HUBSPOT_ACCESS_TOKEN set) it first archives the HubSpot deals, call records and contacts
 * stored on those calls, and stops before touching the database if any archive fails. Without --hubspot the
 * HubSpot objects stay where they are.
 */
import { config } from "dotenv";
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
config({ path: arg("env-file") ?? ".env.local", quiet: true });

async function main() {
  const { db } = await import("../src/db");
  const { archiveDemoHubspot, demoHubspotIds, purgeDemo } = await import("../src/lib/dashboard/demo-db");
  const d = db();
  const ids = await demoHubspotIds(d);
  const stored = ids.contacts.length + ids.calls.length + ids.deals.length;
  if (process.argv.includes("--hubspot")) {
    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) {
      console.error("--hubspot needs HUBSPOT_ACCESS_TOKEN in the env file.");
      process.exit(1);
    }
    const { hubspotApi } = await import("../src/lib/hubspot/client");
    const n = await archiveDemoHubspot(hubspotApi({ accessToken: token }), ids, () => new Promise((r) => setTimeout(r, 300)));
    console.log(`Archived ${n} HubSpot objects (${ids.deals.length} deals, ${ids.calls.length} call records, ${ids.contacts.length} contacts).`);
  } else if (stored) {
    console.log(`Note: ${stored} HubSpot objects recorded on demo calls stay in HubSpot. Re-run with --hubspot to archive them.`);
  }
  console.log(`Removed ${await purgeDemo(d)} demo calls.`);
}

main().catch((err) => {
  console.error("Purge failed:", err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "[db-url]") : "unknown error");
  process.exit(1);
});
