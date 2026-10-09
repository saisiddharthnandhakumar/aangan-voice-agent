import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { tableNames } from "@/db/schema";
import { integrationStatus } from "@/env";

export const runtime = "nodejs";

/**
 * GET /api/health: checks the database and reports which integrations have keys.
 * Returns booleans and counts only, never values. 200 when healthy, 503 otherwise.
 */
export async function GET() {
  await connection();
  const started = Date.now();
  try {
    const rows = await db().execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ${sql.raw(`(${tableNames.map((t) => `'${t}'`).join(",")})`)}
    `);
    const present = new Set(rows.rows.map((r) => r.table_name));
    const missing = tableNames.filter((t) => !present.has(t));
    const ok = missing.length === 0;
    return Response.json(
      {
        ok,
        db: { ok, latency_ms: Date.now() - started, tables_present: present.size, tables_missing: missing },
        integrations: integrationStatus(),
        time_utc: new Date().toISOString(),
      },
      { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
    );
  } catch {
    // The error text can contain connection details, so it is not returned or logged.
    return Response.json(
      { ok: false, db: { ok: false, latency_ms: Date.now() - started, error: "database unreachable" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
