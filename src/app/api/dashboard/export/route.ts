import { db } from "@/db";
import { sessionFromRequest } from "@/lib/auth/guard";
import { callsCsv } from "@/lib/dashboard/csv";
import { parseRange } from "@/lib/dashboard/range";

export const runtime = "nodejs";

/** GET /api/dashboard/export?from=YYYY-MM-DD&to=YYYY-MM-DD: the founder's CSV (D4). Founder session only. */
export async function GET(req: Request): Promise<Response> {
  const session = await sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "founder") return Response.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const range = parseRange(url.searchParams.get("from"), url.searchParams.get("to"), new Date());
  const csv = await callsCsv(db(), range);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="aangan-calls-${range.from}_to_${range.to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
