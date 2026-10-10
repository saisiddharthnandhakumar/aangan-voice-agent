import { and, asc, eq, like } from "drizzle-orm";
import { calls } from "@/db/schema";
import { DEMO_PREFIX } from "@/lib/dashboard/demo";
import type { AnyDb } from "@/lib/dashboard/types";
import { HubspotError, type HubspotApi } from "@/lib/hubspot/client";
import { wantsDeal } from "@/lib/hubspot/mapping";
import { logCallToHubspot, syncDeal } from "@/lib/hubspot/sync";
import type { HubspotIds } from "@/lib/hubspot/mapping";
import { drizzlePipelineRepo } from "@/lib/pipeline/repo";
import type { CallRow } from "@/lib/tools/repo";

/** Hard ceiling on contacts a demo load may create, whatever --limit says (the Free CRM is small and shared). */
export const DEMO_HUBSPOT_MAX = 50;
export const DEMO_HUBSPOT_DEFAULT = 45;

export interface DemoLoadOptions {
  db: AnyDb;
  api: HubspotApi;
  ids: HubspotIds;
  limit?: number;
  dryRun: boolean;
  appBaseUrl?: string;
  /** Wait between calls (HubSpot allows about 100 requests per 10 s on a private app; each call here makes ~6-8). */
  pause?: () => Promise<void>;
  log?: (line: string) => void;
}

export interface DemoLoadReport {
  considered: number;
  skippedAlreadyLogged: number;
  contacts: string[];
  callRecords: string[];
  deals: string[];
  failures: Array<{ vaaniCallId: string; reason: string }>;
  planned: Array<{ vaaniCallId: string; tier: string | null; deal: boolean }>;
}

export const clampLimit = (n: number | undefined): number => Math.max(0, Math.min(DEMO_HUBSPOT_MAX, Math.floor(n ?? DEMO_HUBSPOT_DEFAULT)));

/**
 * Make demo contacts and deals visibly demo without inventing properties: the contact gets the standard `email`
 * property with an @example.com placeholder derived from its fake phone number (+9199999NNNNN), and the deal name
 * is suffixed "(DEMO)". Names are already fictional (seed data) and phones are in the fake range.
 */
export function demoMarkedApi(api: HubspotApi, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): HubspotApi {
  // A short tag in the address so a reload never reuses an address that an earlier purge archived.
  const tag = Date.now().toString(36).slice(-4);
  return {
    ...api,
    // Demo contacts are always new. Searching by phone can return a contact archived by an earlier purge
    // (the search index lags), and updating that archived contact fails with a 404.
    findContactByPhone: async () => null,
    createContact: (props) => {
      const digits = String(props.phone ?? "").replace(/\D/g, "").slice(-5);
      return api.createContact({ ...props, ...(digits ? { email: `demo-${digits}-${tag}@example.com` } : {}) });
    },
    // A contact can answer 404 for a moment right after it is created: try a few more times before failing.
    updateContact: async (id, props) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await api.updateContact(id, props);
        } catch (err) {
          const notFound = err instanceof HubspotError && err.status === 404;
          if (!notFound || attempt >= 3) throw err;
          await sleep(2000);
        }
      }
    },
    createDeal: (props) => api.createDeal({ ...props, dealname: `${String(props.dealname ?? "Demo")} (DEMO)` }),
  };
}

/** Log demo calls (never is_test, "demo-" IDs, no HubSpot IDs yet) to HubSpot, oldest first, up to the cap. */
export async function loadDemoToHubspot(o: DemoLoadOptions): Promise<DemoLoadReport> {
  const limit = clampLimit(o.limit);
  const rows = (await o.db
    .select()
    .from(calls)
    .where(and(like(calls.vaaniCallId, `${DEMO_PREFIX}%`), eq(calls.isTest, false)))
    .orderBy(asc(calls.vaaniCallId))) as CallRow[];
  // A call is done once its HubSpot call record exists. One that stopped before that (a stale or half-made
  // contact) is started again from scratch.
  const fresh = rows.filter((c) => !c.hubspotCallId);
  const batch = fresh.slice(0, limit);
  const report: DemoLoadReport = { considered: rows.length, skippedAlreadyLogged: rows.length - fresh.length, contacts: [], callRecords: [], deals: [], failures: [], planned: [] };

  const repo = drizzlePipelineRepo(o.db);
  // Demo contacts are always new: never borrow a contact ID that another stored call (an old demo row, an
  // earlier test) happens to carry for the same phone number, since that contact may be archived.
  const freshContactRepo = { ...repo, findContactIdByNumber: async () => null };
  const ctx = { api: demoMarkedApi(o.api), ids: o.ids, repo: freshContactRepo, appBaseUrl: o.appBaseUrl };
  for (const c of batch) {
    const deal = wantsDeal(c);
    report.planned.push({ vaaniCallId: c.vaaniCallId as string, tier: c.tier, deal });
    if (o.dryRun) continue;
    try {
      if (c.hubspotContactId || c.hubspotDealId) await repo.updateCall(c.id, { hubspotContactId: null, hubspotDealId: null });
      const logged = await logCallToHubspot(c.id, ctx);
      report.contacts.push(logged.contactId);
      report.callRecords.push(logged.callRecordId);
      if (deal && (await syncDeal(c.id, ctx)) !== "none") {
        const after = await repo.getCall(c.id);
        if (after?.hubspotDealId) report.deals.push(after.hubspotDealId);
      }
    } catch (err) {
      // Stop-free: one failure is recorded and the load carries on; a re-run skips what already has IDs.
      report.failures.push({ vaaniCallId: c.vaaniCallId as string, reason: err instanceof Error ? err.message.slice(0, 160) : "unknown error" });
    }
    await o.pause?.();
  }
  return report;
}
