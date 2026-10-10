import { describe, expect, it } from "vitest";
import { HubspotError, type HubspotApi, type HubspotPipeline } from "@/lib/hubspot/client";
import { CORE_PROPERTIES, EXTRA_PROPERTIES, MAX_CUSTOM_PROPERTIES_FREE } from "@/lib/hubspot/mapping";
import { mapStages, runHubspotSetup } from "@/lib/hubspot/setup";

const DEFAULT: HubspotPipeline = {
  id: "default",
  label: "Sales Pipeline",
  stages: [
    { id: "s_appt", label: "Appointment Scheduled", displayOrder: 0, probability: "0.2" },
    { id: "s_qual", label: "Qualified To Buy", displayOrder: 1, probability: "0.4" },
    { id: "s_pres", label: "Presentation Scheduled", displayOrder: 2, probability: "0.6" },
    { id: "s_dm", label: "Decision Maker Bought-In", displayOrder: 3, probability: "0.8" },
    { id: "s_contract", label: "Contract Sent", displayOrder: 4, probability: "0.9" },
    { id: "s_won", label: "Closed Won", displayOrder: 5, probability: "1.0" },
    { id: "s_lost", label: "Closed Lost", displayOrder: 6, probability: "0.0" },
  ],
};

function statefulApi(o: { limit?: number; pipelines?: HubspotPipeline[]; existing?: string[] } = {}) {
  const props = new Set(o.existing ?? []);
  const log = { groups: 0, created: [] as string[] };
  let groupExists = false;
  const api = {
    async listContactProperties() {
      return [...props];
    },
    async createPropertyGroup() {
      log.groups++;
      if (groupExists) throw new HubspotError("HubSpot POST groups 409: exists", 409, null, null, null);
      groupExists = true;
    },
    async createContactProperty(def: { name: string }) {
      if (o.limit != null && props.size >= o.limit) throw new HubspotError("HubSpot POST properties 400: property limit reached", 400, null, null, null);
      props.add(def.name);
      log.created.push(def.name);
    },
    async listDealPipelines() {
      return o.pipelines ?? [DEFAULT];
    },
  } as unknown as HubspotApi;
  return { api, props, log };
}

describe("stage mapping onto the default pipeline", () => {
  it("maps booked, awaiting and lost by name", () => {
    const m = mapStages(DEFAULT);
    expect(m).toMatchObject({ pipelineId: "default", booked: "s_appt", awaiting: "s_qual", lost: "s_lost", warnings: [] });
    expect(m.lines[0]).toContain("Appointment Scheduled");
  });
  it("falls back to position when labels are custom, and warns on a collision", () => {
    const p: HubspotPipeline = { id: "p", label: "X", stages: [{ id: "a", label: "Alpha", displayOrder: 0, probability: "0.1" }, { id: "w", label: "Won", displayOrder: 1, probability: "1.0" }, { id: "l", label: "Dead", displayOrder: 2, probability: "0.0" }] };
    const m = mapStages(p);
    expect(m.lost).toBe("l");
    expect(m.warnings.join(" ")).toContain("same stage");
  });
});

describe("pnpm hubspot:setup", () => {
  it("creates the 8 Free-plan properties and prints the env lines", async () => {
    const t = statefulApi();
    const r = await runHubspotSetup(t.api);
    expect(r.propertiesCreated).toEqual(CORE_PROPERTIES.map((p) => p.name));
    expect(CORE_PROPERTIES).toHaveLength(8);
    expect(r.groupCreated).toBe(true);
    expect(r.envLines).toEqual(["HUBSPOT_PIPELINE_ID=default", "HUBSPOT_STAGE_BOOKED=s_appt", "HUBSPOT_STAGE_AWAITING=s_qual", "HUBSPOT_STAGE_LOST=s_lost"]);
    expect(r.warnings.join(" ")).toContain("Free plan");
  });

  it("is safe to run twice: the second run creates nothing", async () => {
    const t = statefulApi();
    await runHubspotSetup(t.api);
    const again = await runHubspotSetup(t.api);
    expect(again.propertiesCreated).toEqual([]);
    expect(again.propertiesExisting).toHaveLength(8);
    expect(t.log.created).toHaveLength(8);
    expect(t.log.groups).toBe(1); // the group is not even attempted when nothing is missing
  });

  it("creates only what is missing", async () => {
    const t = statefulApi({ existing: ["aangan_status", "aangan_tier"] });
    const r = await runHubspotSetup(t.api);
    expect(r.propertiesCreated).toHaveLength(6);
    expect(r.propertiesExisting).toEqual(["aangan_status", "aangan_tier"]);
  });

  it("tolerates an existing group (409) and reports property-limit failures", async () => {
    const t = statefulApi({ limit: 10, existing: Array.from({ length: 8 }, (_, i) => `custom_${i}`) });
    await t.api.createPropertyGroup("aangan_voice_agent", "Aangan voice agent");
    const r = await runHubspotSetup(t.api);
    expect(r.propertiesCreated).toHaveLength(2);
    expect(r.propertiesFailed).toHaveLength(6);
    expect(r.warnings.join(" ")).toContain(`${MAX_CUSTOM_PROPERTIES_FREE} custom properties`);
  });

  it("--full adds the six extra properties for a paid plan", async () => {
    const r = await runHubspotSetup(statefulApi().api, { full: true });
    expect(r.propertiesCreated).toHaveLength(14);
    expect(EXTRA_PROPERTIES).toHaveLength(6);
  });

  it("the Free-plan set stays within the 10-property cap with room to spare", () => {
    expect(CORE_PROPERTIES.length).toBeLessThanOrEqual(MAX_CUSTOM_PROPERTIES_FREE - 2);
  });
});
