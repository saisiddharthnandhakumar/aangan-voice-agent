import { describe, expect, it } from "vitest";
import { hubspotApi, HubspotError, type HubspotConfig } from "@/lib/hubspot/client";

const TOKEN = "pat-na1-SECRET-token";

function scripted(responses: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ method: string; path: string; body: unknown; auth: string | null }> = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    calls.push({ method: init?.method ?? "GET", path: u.pathname, body: init?.body ? JSON.parse(String(init.body)) : null, auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
    return responses[Math.min(i++, responses.length - 1)]();
  }) as typeof fetch;
  const sleeps: number[] = [];
  const cfg: HubspotConfig = { accessToken: TOKEN, fetchImpl, sleep: async (ms) => void sleeps.push(ms) };
  return { api: hubspotApi(cfg), calls, sleeps };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("HubSpot client", () => {
  it("creates a call record associated to the contact (type 194) with a Bearer token", async () => {
    const t = scripted([json({ id: "555" }, 201)]);
    expect(await t.api.createCall({ hs_timestamp: "2026-10-12T05:30:00.000Z", hs_call_title: "x" }, "77")).toBe("555");
    expect(t.calls[0]).toMatchObject({ method: "POST", path: "/crm/v3/objects/calls", auth: `Bearer ${TOKEN}` });
    expect(t.calls[0].body).toMatchObject({ associations: [{ to: { id: "77" }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 194 }] }] });
  });

  it("searches by the 10-digit number without the country code, on both phone properties", async () => {
    const t = scripted([json({ results: [{ id: "9" }] })]);
    expect(await t.api.findContactByPhone("9876543210", "+919876543210")).toBe("9");
    const body = t.calls[0].body as { filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }> };
    expect(body.filterGroups.map((g) => g.filters[0])).toEqual([
      { propertyName: "hs_searchable_calculated_phone_number", operator: "CONTAINS_TOKEN", value: "9876543210" },
      { propertyName: "hs_searchable_calculated_mobile_number", operator: "CONTAINS_TOKEN", value: "9876543210" },
    ]);
  });

  it("falls back to an exact phone match if HubSpot rejects the calculated property names", async () => {
    const t = scripted([json({ message: "property does not exist" }, 400), json({ results: [] })]);
    expect(await t.api.findContactByPhone("9876543210", "+919876543210")).toBeNull();
    expect(t.calls).toHaveLength(2);
    expect((t.calls[1].body as { filterGroups: Array<{ filters: Array<{ operator: string; value: string }> }> }).filterGroups[0].filters[0]).toMatchObject({ operator: "EQ", value: "+919876543210" });
  });

  it("retries a read on 5xx and on a 429 (honouring Retry-After)", async () => {
    const t = scripted([json({ message: "busy" }, 429, { "retry-after": "3" }), json({ message: "oops" }, 502), json({ results: [{ name: "email" }] })]);
    expect(await t.api.listContactProperties()).toEqual(["email"]);
    expect(t.calls).toHaveLength(3);
    expect(t.sleeps[0]).toBeGreaterThanOrEqual(3000);
  });

  it("never retries a create after a 5xx (it may have been created), but does after a 429", async () => {
    const a = scripted([json({ message: "boom" }, 503), json({ id: "1" })]);
    await expect(a.api.createContact({ firstname: "x" })).rejects.toBeInstanceOf(HubspotError);
    expect(a.calls).toHaveLength(1);
    const b = scripted([json({ message: "slow down" }, 429), json({ id: "2" }, 201)]);
    expect(await b.api.createContact({ firstname: "x" })).toBe("2");
    expect(b.calls).toHaveLength(2);
  });

  it("never retries a create after a timeout", async () => {
    const calls = { n: 0 };
    const cfg: HubspotConfig = {
      accessToken: TOKEN,
      timeoutMs: 20,
      sleep: async () => undefined,
      fetchImpl: (async (_u: unknown, init?: RequestInit) => {
        calls.n++;
        await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
        return new Response("{}");
      }) as typeof fetch,
    };
    await expect(hubspotApi(cfg).createDeal({ dealname: "x" })).rejects.toThrow();
    expect(calls.n).toBe(1);
  });

  it("does not retry a daily-limit 429", async () => {
    const t = scripted([json({ message: "daily limit", policyName: "DAILY" }, 429)]);
    await expect(t.api.updateContact("1", { aangan_status: "booked" })).rejects.toMatchObject({ status: 429, policyName: "DAILY" });
    expect(t.calls).toHaveLength(1);
  });

  it("does not retry a 4xx", async () => {
    const t = scripted([json({ message: "bad property", category: "VALIDATION_ERROR" }, 400)]);
    await expect(t.api.createDeal({ dealname: "x" })).rejects.toMatchObject({ status: 400, category: "VALIDATION_ERROR" });
    expect(t.calls).toHaveLength(1);
  });

  it("never puts the token, ids or payload in an error", async () => {
    const t = scripted([json({ message: "nope" }, 403)]);
    try {
      await t.api.updateContact("123456", { phone: "+919876543210" });
      expect.unreachable();
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain("SECRET");
      expect(msg).not.toContain("9876543210");
      expect(msg).not.toContain("123456");
    }
  });

  it("reads deal pipelines with stage IDs, order and probability", async () => {
    const t = scripted([json({ results: [{ id: "default", label: "Sales Pipeline", stages: [{ id: "s1", label: "Appointment Scheduled", displayOrder: 0, metadata: { probability: "0.2" } }] }] })]);
    expect(await t.api.listDealPipelines()).toEqual([{ id: "default", label: "Sales Pipeline", stages: [{ id: "s1", label: "Appointment Scheduled", displayOrder: 0, probability: "0.2" }] }]);
  });

  it("uses the v4 default association endpoint", async () => {
    const t = scripted([json({})]);
    await t.api.associate("deals", "5", "contacts", "9");
    expect(t.calls[0]).toMatchObject({ method: "PUT", path: "/crm/v4/objects/deals/5/associations/default/contacts/9" });
  });
});

describe("HubSpot client archive (UNVERIFIED against a live account)", () => {
  it("DELETEs the v3 object and treats a 404 as already archived", async () => {
    const t = scripted([() => new Response(null, { status: 204 }), json({ message: "not found" }, 404)]);
    await t.api.archive("deals", "42");
    await t.api.archive("contacts", "43");
    expect(t.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /crm/v3/objects/deals/42", "DELETE /crm/v3/objects/contacts/43"]);
  });
});
