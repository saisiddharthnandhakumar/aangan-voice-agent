/**
 * pnpm mock:cal  — a tiny local stand-in for Cal.com v2 on http://localhost:4010, for the curl
 * scripts. GET /v2/slots returns weekday slots at 10:00, 12:00, 15:00 and 18:00 IST; POST
 * /v2/bookings books once per start time and returns 400 when the slot is already taken.
 */
import { createServer } from "node:http";

const port = Number(process.env.MOCK_CAL_PORT ?? 4010);
const taken = new Set<string>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!req.headers.authorization?.startsWith("Bearer ")) return send(401, { status: "error", error: { message: "no key" } });

  if (req.method === "GET" && url.pathname === "/v2/slots") {
    const start = new Date(url.searchParams.get("start") ?? Date.now());
    const end = new Date(url.searchParams.get("end") ?? Date.now() + 3 * 86_400_000);
    const data: Record<string, Array<{ start: string; end: string }>> = {};
    for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86_400_000)) {
      const day = new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
      if (new Date(`${day}T12:00:00+05:30`).getUTCDay() === 0) continue; // Sunday off
      for (const hh of ["10", "12", "15", "18"]) {
        const s = `${day}T${hh}:00:00.000+05:30`;
        if (Date.parse(s) < start.getTime() || Date.parse(s) >= end.getTime() || taken.has(new Date(s).toISOString())) continue;
        (data[day] ??= []).push({ start: s, end: `${day}T${hh}:45:00.000+05:30` });
      }
    }
    return send(200, { status: "success", data });
  }

  if (req.method === "POST" && url.pathname === "/v2/bookings") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const start = new Date(body.start).toISOString();
    if (taken.has(start)) return send(400, { status: "error", error: { message: "slot no longer available" } });
    taken.add(start);
    return send(201, { status: "success", data: { id: taken.size, uid: `mock_${taken.size}`, start, end: new Date(Date.parse(start) + 45 * 60_000).toISOString(), status: "accepted" } });
  }
  send(404, { status: "error", error: { message: "not found" } });
}).listen(port, () => console.log(`mock Cal.com on http://localhost:${port}`));
