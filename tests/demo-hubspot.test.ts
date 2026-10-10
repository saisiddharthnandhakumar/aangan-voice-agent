import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { archiveDemoHubspot, demoHubspotIds, purgeDemo } from "@/lib/dashboard/demo-db";
import { clampLimit, DEMO_HUBSPOT_MAX, loadDemoToHubspot } from "@/lib/demo/hubspot-load";
import { buildDemoCalls } from "@/lib/seed-data";
import { fakeHubspot, HS_IDS } from "./pipeline/fakes";
import { testDb } from "./dashboard/harness";

const NOW = new Date("2026-10-14T06:00:00Z");

async function seeded() {
  const db = await testDb();
  const rows = buildDemoCalls(NOW);
  await db.insert(schema.calls).values(rows.map((r) => r.call));
  const hs = fakeHubspot();
  return { db, rows, hs };
}
const run = (s: Awaited<ReturnType<typeof seeded>>, o: { limit?: number; dryRun?: boolean } = {}) =>
  loadDemoToHubspot({ db: s.db, api: s.hs.api, ids: HS_IDS, dryRun: false, ...o });

describe("demo HubSpot load", () => {
  it("caps the load at the hard maximum, whatever --limit says", () => {
    expect(clampLimit(undefined)).toBe(45);
    expect(clampLimit(500)).toBe(DEMO_HUBSPOT_MAX);
    expect(clampLimit(-3)).toBe(0);
  });

  it("respects the limit", async () => {
    const s = await seeded();
    const r = await run(s, { limit: 7 });
    expect(r.contacts).toHaveLength(7);
    expect(s.hs.state.contacts.size).toBe(7);
  });

  it("a dry run writes nothing", async () => {
    const s = await seeded();
    const r = await run(s, { dryRun: true });
    expect(r.planned).toHaveLength(45);
    expect(s.hs.state.requests).toBe(0);
    expect((await demoHubspotIds(s.db)).contacts).toHaveLength(0);
  });

  it("is idempotent: a second run creates nothing", async () => {
    const s = await seeded();
    await run(s);
    const before = { c: s.hs.state.contacts.size, k: s.hs.state.calls.size, d: s.hs.state.deals.size };
    const again = await run(s);
    expect(again.contacts).toHaveLength(0);
    expect(again.skippedAlreadyLogged).toBe(45);
    expect({ c: s.hs.state.contacts.size, k: s.hs.state.calls.size, d: s.hs.state.deals.size }).toEqual(before);
  });

  it("gives Red no deal (unless a designer rescued it), marks contacts and deals as demo, and uses the fake phone range", async () => {
    const s = await seeded();
    await run(s);
    const ids = await demoHubspotIds(s.db);
    const byId = new Map(s.rows.map((r) => [r.call.vaaniCallId, r.call]));
    const withDeal = (await s.db.select().from(schema.calls)).filter((c) => c.hubspotDealId);
    for (const c of withDeal) expect(["green", "amber"].includes(c.tier ?? "") || byId.get(c.vaaniCallId)?.reviewState === "rescued").toBe(true);
    const reds = (await s.db.select().from(schema.calls)).filter((c) => c.tier === "red" && c.reviewState !== "rescued");
    expect(reds.length).toBeGreaterThan(3);
    for (const c of reds) {
      expect(c.hubspotContactId).toBeTruthy();
      expect(c.hubspotCallId).toBeTruthy();
      expect(c.hubspotDealId).toBeNull();
    }
    expect(ids.deals.length).toBe(withDeal.length);
    for (const c of s.hs.state.contacts.values()) {
      expect(String(c.email)).toMatch(/^demo-\d{5}-[a-z0-9]{1,4}@example\.com$/);
      expect(String(c.phone)).toMatch(/^\+9199999\d{5}$/);
    }
    for (const d of s.hs.state.deals.values()) expect(String(d.dealname)).toMatch(/\(DEMO\)$/);
  });

  it("purge archives every stored HubSpot ID, then the rows go", async () => {
    const s = await seeded();
    await run(s);
    const ids = await demoHubspotIds(s.db);
    const archived: string[] = [];
    const n = await archiveDemoHubspot({ archive: async (t, id) => void archived.push(`${t}:${id}`) }, ids);
    expect(n).toBe(ids.contacts.length + ids.calls.length + ids.deals.length);
    for (const id of ids.deals) expect(archived).toContain(`deals:${id}`);
    for (const id of ids.calls) expect(archived).toContain(`calls:${id}`);
    for (const id of ids.contacts) expect(archived).toContain(`contacts:${id}`);
    expect(archived.findIndex((a) => a.startsWith("contacts:"))).toBeGreaterThan(archived.findIndex((a) => a.startsWith("deals:")));
    expect(await purgeDemo(s.db)).toBe(45);
  }, 30_000);

  it("a failed archive stops the purge before it can lose the IDs", async () => {
    await expect(archiveDemoHubspot({ archive: async () => { throw new Error("boom"); } }, { contacts: ["1"], calls: [], deals: [] })).rejects.toThrow("boom");
  });
});
