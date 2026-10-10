/** pnpm demo:purge: removes every demo- call (and its design calls, steps and actions) from the database in .env.local. */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const { db } = await import("../src/db");
  const { purgeDemo } = await import("../src/lib/dashboard/demo-db");
  console.log(`Removed ${await purgeDemo(db())} demo calls.`);
}

main().catch((err) => {
  console.error("Purge failed:", err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "[db-url]") : "unknown error");
  process.exit(1);
});
