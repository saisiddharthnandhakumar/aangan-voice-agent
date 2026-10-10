import { HubspotError, type HubspotApi, type HubspotPipeline, type PropertyDef } from "./client";
import { CORE_PROPERTIES, EXTRA_PROPERTIES, MAX_CUSTOM_PROPERTIES_FREE, PROPERTY_GROUP } from "./mapping";

/**
 * pnpm hubspot:setup, as testable functions. Idempotent: it reads what exists first and creates only
 * what is missing (the duplicate-create status code is not documented, so it never relies on one).
 *
 * Free plan (docs/PLATFORM_NOTES.md section 3.3): 10 custom properties in total and no custom deal
 * pipeline, so it creates the PRD's 8-property fallback and uses the account's default deal pipeline,
 * mapping our stages onto its stages by name. `full` adds the six extra properties for a paid plan.
 */

export interface StageMapping {
  pipelineId: string;
  pipelineLabel: string;
  booked: string | null;
  awaiting: string | null;
  lost: string | null;
  /** Human-readable "our stage → HubSpot stage" lines for the printout. */
  lines: string[];
  warnings: string[];
}

const find = (p: HubspotPipeline, re: RegExp) => p.stages.find((s) => re.test(s.label));

/** Map Consultation booked / Awaiting designer / Lost onto an existing pipeline's stages. */
export function mapStages(pipeline: HubspotPipeline): StageMapping {
  const ordered = [...pipeline.stages].sort((a, b) => a.displayOrder - b.displayOrder);
  const open = ordered.filter((s) => !/won|lost/i.test(s.label) && s.probability !== "1.0" && s.probability !== "0.0");
  const booked = find(pipeline, /appointment|meeting|consult|booked/i) ?? open[1] ?? open[0] ?? null;
  const awaiting = find(pipeline, /qualif|await|new|lead/i) ?? open[0] ?? null;
  const lost = find(pipeline, /lost/i) ?? [...ordered].reverse().find((s) => s.probability === "0.0") ?? null;
  const warnings: string[] = [];
  if (!booked) warnings.push("No stage found for Consultation booked.");
  if (!awaiting) warnings.push("No stage found for Awaiting designer.");
  if (!lost) warnings.push("No Lost stage found: Discard will not move the deal.");
  if (booked && awaiting && booked.id === awaiting.id) warnings.push("Booked and Awaiting map to the same stage; pick different ones in HubSpot or edit the env lines.");
  return {
    pipelineId: pipeline.id,
    pipelineLabel: pipeline.label,
    booked: booked?.id ?? null,
    awaiting: awaiting?.id ?? null,
    lost: lost?.id ?? null,
    lines: [
      `Consultation booked → ${booked?.label ?? "(none)"}`,
      `Awaiting designer   → ${awaiting?.label ?? "(none)"}`,
      `Lost (Discard)      → ${lost?.label ?? "(none)"}`,
    ],
    warnings,
  };
}

export interface SetupReport {
  groupCreated: boolean;
  propertiesCreated: string[];
  propertiesExisting: string[];
  propertiesFailed: Array<{ name: string; reason: string }>;
  stages: StageMapping | null;
  warnings: string[];
  envLines: string[];
}

export async function runHubspotSetup(api: HubspotApi, o: { full?: boolean } = {}): Promise<SetupReport> {
  const warnings: string[] = [];
  const wanted: PropertyDef[] = o.full ? [...CORE_PROPERTIES, ...EXTRA_PROPERTIES] : CORE_PROPERTIES;
  const existing = new Set(await api.listContactProperties());

  let groupCreated = false;
  const needsGroup = wanted.some((p) => !existing.has(p.name));
  if (needsGroup) {
    try {
      await api.createPropertyGroup(PROPERTY_GROUP.name, PROPERTY_GROUP.label);
      groupCreated = true;
    } catch (err) {
      // An existing group is the normal second run; any other failure shows up when properties are created.
      if (!(err instanceof HubspotError) || ![400, 409].includes(err.status ?? 0)) throw err;
    }
  }

  const created: string[] = [];
  const present: string[] = [];
  const failed: Array<{ name: string; reason: string }> = [];
  for (const def of wanted) {
    if (existing.has(def.name)) {
      present.push(def.name);
      continue;
    }
    try {
      await api.createContactProperty(def);
      created.push(def.name);
    } catch (err) {
      failed.push({ name: def.name, reason: err instanceof Error ? err.message.slice(0, 200) : "unknown error" });
    }
  }
  if (failed.length) warnings.push(`${failed.length} propert${failed.length === 1 ? "y" : "ies"} could not be created. On the Free plan the limit is ${MAX_CUSTOM_PROPERTIES_FREE} custom properties in total across the account.`);

  const pipelines = await api.listDealPipelines();
  const chosen = pipelines.find((p) => p.id === "default") ?? pipelines[0] ?? null;
  const stages = chosen ? mapStages(chosen) : null;
  if (!chosen) warnings.push("No deal pipeline found.");
  if (stages) warnings.push(...stages.warnings);
  if (pipelines.length === 1) warnings.push('Free plan: only the default deal pipeline exists, so "Aangan enquiries" cannot be created; the default pipeline is used.');

  const envLines = stages
    ? [
        `HUBSPOT_PIPELINE_ID=${stages.pipelineId}`,
        `HUBSPOT_STAGE_BOOKED=${stages.booked ?? ""}`,
        `HUBSPOT_STAGE_AWAITING=${stages.awaiting ?? ""}`,
        `HUBSPOT_STAGE_LOST=${stages.lost ?? ""}`,
      ]
    : [];
  return { groupCreated, propertiesCreated: created, propertiesExisting: present, propertiesFailed: failed, stages, warnings, envLines };
}
