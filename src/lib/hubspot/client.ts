import { isTimeout, RetryError, withRetry } from "@/lib/http/retry";

/**
 * HubSpot CRM client (docs/PLATFORM_NOTES.md section 3). Free CRM, a private app or service key as a
 * Bearer token, v3 object endpoints (the semantic versions stop working in September 2027: the
 * version lives in API_VERSION_PATH only, so the migration is one constant plus the paths below).
 *
 * Verified against the HubSpot docs on 2026-10-10: POST /crm/v3/objects/calls body (properties incl.
 * hs_timestamp, hs_call_duration in ms; inline associations with HUBSPOT_DEFINED type 194 for
 * call→contact), contact search (filterGroups; the guide says to search WITHOUT the country code and
 * to use the hs_searchable_calculated_* properties; search is limited to 5 requests/second),
 * deal create/update (dealname, dealstage, pipeline, amount; PATCH with a properties object).
 * UNVERIFIED (no live account yet): the exact hs_searchable_calculated_phone_number name, the
 * v4 default-association path, the deal `description` property, and the duplicate-create status codes.
 *
 * Retry policy: GET, search, PATCH and PUT are idempotent, so they retry timeouts, 429 and 5xx. A POST
 * create is never retried after a timeout or a 5xx (it may have been created); it retries only a 429,
 * which means it was not handled. A daily-limit 429 is never retried. Tokens never appear in errors.
 */

export const API_VERSION_PATH = "/crm/v3";
const ASSOC_V4 = "/crm/v4";

export interface HubspotConfig {
  accessToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class HubspotError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly category: string | null,
    readonly policyName: string | null,
    readonly retryAfterSec: number | null,
  ) {
    super(message);
    this.name = "HubspotError";
  }
}

type Props = Record<string, string | number | boolean | null>;

interface Req {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  body?: unknown;
  /** POST creates: do not retry a timeout or 5xx. */
  create?: boolean;
}

async function once(cfg: HubspotConfig, r: Req): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), cfg.timeoutMs ?? 8000);
  let res: Response;
  try {
    res = await (cfg.fetchImpl ?? fetch)(`${(cfg.baseUrl ?? "https://api.hubapi.com").replace(/\/$/, "")}${r.path}`, {
      method: r.method,
      headers: { Authorization: `Bearer ${cfg.accessToken}`, ...(r.body ? { "content-type": "application/json" } : {}) },
      body: r.body ? JSON.stringify(r.body) : undefined,
      signal: abort.signal,
    });
  } catch (err) {
    if (isTimeout(err)) throw err;
    throw new HubspotError("HubSpot unreachable", null, null, null, null);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new HubspotError(
      `HubSpot ${r.method} ${r.path.split("?")[0].replace(/\/\d+(?=\/|$)/g, "/{id}")} ${res.status}: ${String(json?.message ?? "").slice(0, 160)}`,
      res.status,
      typeof json?.category === "string" ? json.category : null,
      typeof json?.policyName === "string" ? json.policyName : null,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  return json;
}

function retryableFor(create: boolean) {
  return (err: unknown): boolean => {
    if (isTimeout(err)) return !create;
    if (!(err instanceof HubspotError)) return false;
    if (err.status === 429) return !/daily/i.test(err.policyName ?? ""); // a daily limit will not clear in seconds
    if (err.status === null) return !create;
    return !create && err.status >= 500;
  };
}

async function request(cfg: HubspotConfig, r: Req): Promise<unknown> {
  try {
    const { value } = await withRetry(() => once(cfg, r), {
      attempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10_000,
      retryable: retryableFor(r.create === true),
      retryAfterMs: (err) => (err instanceof HubspotError && err.retryAfterSec ? err.retryAfterSec * 1000 : undefined),
      sleep: cfg.sleep,
    });
    return value;
  } catch (err) {
    throw err instanceof RetryError ? err.lastError : err;
  }
}

const idOf = (v: unknown): string => {
  const id = (v as { id?: unknown } | null)?.id;
  if (typeof id !== "string" && typeof id !== "number") throw new HubspotError("HubSpot response had no id", null, null, null, null);
  return String(id);
};

export interface HubspotPipeline {
  id: string;
  label: string;
  stages: Array<{ id: string; label: string; displayOrder: number; probability: string | null }>;
}

export interface PropertyDef {
  name: string;
  label: string;
  type: "string" | "number" | "enumeration" | "datetime";
  fieldType: "text" | "number" | "select" | "date" | "textarea";
  groupName: string;
  options?: Array<{ label: string; value: string; displayOrder: number; hidden: false }>;
  description?: string;
}

export interface HubspotApi {
  /** Contact ID whose phone matches this Indian number (10 digits), or null. */
  findContactByPhone(national10: string, e164: string): Promise<string | null>;
  createContact(props: Props): Promise<string>;
  updateContact(id: string, props: Props): Promise<void>;
  /** Inline-associated to the contact (type 194). */
  createCall(props: Props, contactId: string): Promise<string>;
  createDeal(props: Props): Promise<string>;
  updateDeal(id: string, props: Props): Promise<void>;
  /** v4 default association between two records. */
  associate(fromType: "deals" | "calls", fromId: string, toType: "contacts" | "deals", toId: string): Promise<void>;
  // setup only
  listContactProperties(): Promise<string[]>;
  createPropertyGroup(name: string, label: string): Promise<void>;
  createContactProperty(def: PropertyDef): Promise<void>;
  listDealPipelines(): Promise<HubspotPipeline[]>;
}

export function hubspotApi(cfg: HubspotConfig): HubspotApi {
  const o = API_VERSION_PATH;
  return {
    async findContactByPhone(national10, e164) {
      const search = async (filterGroups: unknown[]) => {
        const r = (await request(cfg, { method: "POST", path: `${o}/objects/contacts/search`, body: { filterGroups, properties: ["phone", "mobilephone"], limit: 5 } })) as {
          results?: Array<{ id: string }>;
        };
        return r?.results?.[0]?.id ? String(r.results[0].id) : null;
      };
      // Primary (docs): the calculated searchable properties, without the country code. UNVERIFIED names.
      try {
        return await search([
          { filters: [{ propertyName: "hs_searchable_calculated_phone_number", operator: "CONTAINS_TOKEN", value: national10 }] },
          { filters: [{ propertyName: "hs_searchable_calculated_mobile_number", operator: "CONTAINS_TOKEN", value: national10 }] },
        ]);
      } catch (err) {
        if (!(err instanceof HubspotError) || err.status !== 400) throw err;
      }
      // Fallback if those property names are rejected: exact match on the number as we write it.
      return search([
        { filters: [{ propertyName: "phone", operator: "EQ", value: e164 }] },
        { filters: [{ propertyName: "mobilephone", operator: "EQ", value: e164 }] },
      ]);
    },
    async createContact(props) {
      return idOf(await request(cfg, { method: "POST", path: `${o}/objects/contacts`, body: { properties: props }, create: true }));
    },
    async updateContact(id, props) {
      await request(cfg, { method: "PATCH", path: `${o}/objects/contacts/${encodeURIComponent(id)}`, body: { properties: props } });
    },
    async createCall(props, contactId) {
      return idOf(
        await request(cfg, {
          method: "POST",
          path: `${o}/objects/calls`,
          body: { properties: props, associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 194 }] }] },
          create: true,
        }),
      );
    },
    async createDeal(props) {
      return idOf(await request(cfg, { method: "POST", path: `${o}/objects/deals`, body: { properties: props }, create: true }));
    },
    async updateDeal(id, props) {
      await request(cfg, { method: "PATCH", path: `${o}/objects/deals/${encodeURIComponent(id)}`, body: { properties: props } });
    },
    async associate(fromType, fromId, toType, toId) {
      await request(cfg, {
        method: "PUT",
        path: `${ASSOC_V4}/objects/${fromType}/${encodeURIComponent(fromId)}/associations/default/${toType}/${encodeURIComponent(toId)}`,
      });
    },
    async listContactProperties() {
      const r = (await request(cfg, { method: "GET", path: `${o}/properties/contacts` })) as { results?: Array<{ name: string }> };
      return (r?.results ?? []).map((p) => p.name);
    },
    async createPropertyGroup(name, label) {
      await request(cfg, { method: "POST", path: `${o}/properties/contacts/groups`, body: { name, label, displayOrder: -1 }, create: true });
    },
    async createContactProperty(def) {
      await request(cfg, { method: "POST", path: `${o}/properties/contacts`, body: def, create: true });
    },
    async listDealPipelines() {
      const r = (await request(cfg, { method: "GET", path: `${o}/pipelines/deals` })) as {
        results?: Array<{ id: string; label: string; stages?: Array<{ id: string; label: string; displayOrder: number; metadata?: { probability?: string } }> }>;
      };
      return (r?.results ?? []).map((p) => ({
        id: p.id,
        label: p.label,
        stages: (p.stages ?? []).map((s) => ({ id: s.id, label: s.label, displayOrder: s.displayOrder, probability: s.metadata?.probability ?? null })),
      }));
    },
  };
}
