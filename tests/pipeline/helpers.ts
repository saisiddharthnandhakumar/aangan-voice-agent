import { processEvent, recordWebhook } from "@/lib/pipeline/ingest";
import type { PipelineDeps } from "@/lib/pipeline/types";
import { submitAssessment } from "@/lib/tools/service";
import { deps as toolDeps } from "../tools/fakes";
import { memoryPipeline, vaaniEvents } from "./fakes";

export const START = new Date("2026-10-12T05:28:00Z"); // Monday 10:58 IST
export const TOOL_TIME = () => new Date("2026-10-12T05:30:00Z");

export async function post(raw: unknown, d: PipelineDeps) {
  const rec = await recordWebhook(raw, d);
  if (!rec.ok) return { rec, processed: null };
  const processed = rec.duplicate ? null : await processEvent(rec.callId, rec.event, d);
  return { rec, processed };
}

export async function postAll(id: string, d: PipelineDeps, o: Partial<Parameters<typeof vaaniEvents>[1]> = {}) {
  const ev = vaaniEvents(id, { start: START, seconds: 360, ...o });
  for (const e of [ev.started, ev.pickedUp, ev.ended]) await post(e, d);
  return (await post(ev.post, d)).processed;
}

export const assessment = (o: Record<string, unknown> = {}) => ({
  call_id: "",
  call_mode: "phone",
  call_category: "enquiry",
  caller_name: "Priya Sharma",
  phone: "98765 43210",
  project_type: "home",
  scope_type: "full_home",
  property_detail: "3BHK apartment",
  bhk: 3,
  size_sqft: 1400,
  locality: "Kothrud",
  timeline_text: "by March, no rush",
  referral_source: "a friend",
  real_project_status: "pass",
  service_area_status: "pass",
  timeline_status: "pass",
  budget_status: "pass",
  decision_maker_status: "pass",
  tier: "green",
  tier_reason: "all pass",
  ...o,
});

/** Create the tool row (as submit_assessment would), then run the whole webhook sequence for it. */
export async function fullCall(m: ReturnType<typeof memoryPipeline>, d: PipelineDeps, room: string, a: Record<string, unknown> = {}, o: Partial<Parameters<typeof vaaniEvents>[1]> = {}) {
  // The agent's first tool call lands two minutes into the call, so it merges with that call's webhook row.
  const toolTime = new Date((o.start ?? START).getTime() + 120_000);
  await submitAssessment(assessment(a), toolDeps({ repo: m.tools.repo, now: () => toolTime }));
  await postAll(room, d, o);
  return m.calls.find((c) => c.vaaniCallId === room)!;
}
