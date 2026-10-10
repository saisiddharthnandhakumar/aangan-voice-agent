import { describe, expect, it } from "vitest";
import { GeminiOutputError } from "@/lib/gemini/client";
import { RetryError } from "@/lib/http/retry";
import { processEvent, recordWebhook } from "@/lib/pipeline/ingest";
import { runPipeline } from "@/lib/pipeline/run";
import type { PipelineDeps } from "@/lib/pipeline/types";
import { submitAssessment } from "@/lib/tools/service";
import { deps as toolDeps } from "../tools/fakes";
import { fakeHubspot, fakeTelegram, memoryPipeline, pipelineDeps, postCall, USAGE, vaaniEvents } from "./fakes";

const START = new Date("2026-10-12T05:28:00Z"); // Monday 10:58 IST
const TOOL_TIME = () => new Date("2026-10-12T05:30:00Z");

/** Post every event through the same two halves the route uses. */
async function post(raw: unknown, d: PipelineDeps) {
  const rec = await recordWebhook(raw, d);
  if (!rec.ok) return { rec, processed: null };
  const processed = rec.duplicate ? null : await processEvent(rec.callId, rec.event, d);
  return { rec, processed };
}

async function postAll(id: string, d: PipelineDeps, o: Partial<Parameters<typeof vaaniEvents>[1]> = {}) {
  const ev = vaaniEvents(id, { start: START, seconds: 360, ...o });
  for (const e of [ev.started, ev.pickedUp, ev.ended]) await post(e, d);
  return (await post(ev.post, d)).processed;
}

const assessment = (o: Record<string, unknown> = {}) => ({
  call_id: "",
  call_mode: "phone",
  call_category: "enquiry",
  caller_name: "Priya",
  phone: "98765 43210",
  project_type: "home",
  scope_type: "full_home",
  bhk: 3,
  locality: "Kothrud",
  real_project_status: "pass",
  service_area_status: "pass",
  timeline_status: "pass",
  budget_status: "pass",
  decision_maker_status: "pass",
  tier: "green",
  tier_reason: "all pass",
  ...o,
});

describe("webhook: storing events (P1)", () => {
  it("stores the raw event first and is idempotent per (call, event type) (AT9)", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({ repo: m.repo });
    const ev = vaaniEvents("room-1", { start: START, seconds: 60 });
    const a = await recordWebhook(ev.ended, d);
    const b = await recordWebhook(ev.ended, d);
    const c = await recordWebhook(ev.post, d);
    expect(a).toMatchObject({ ok: true, duplicate: false });
    expect(b).toMatchObject({ ok: true, duplicate: true });
    expect(c).toMatchObject({ ok: true, duplicate: false });
    expect(m.calls).toHaveLength(1);
    const stored = (m.calls[0].rawWebhook as { events: Array<{ event: string; payload: unknown }> }).events;
    expect(stored.map((e) => e.event)).toEqual(["call_ended", "call_postprocessing"]);
    expect(stored[1].payload).toEqual(ev.post);
  });

  it("acknowledges but ignores events with no call ID", async () => {
    const m = memoryPipeline();
    expect(await recordWebhook({ event: "call_ended", call_duration: 4 }, pipelineDeps({ repo: m.repo }))).toEqual({ ok: false, reason: "no_call_id" });
    expect(m.calls).toHaveLength(0);
  });

  it("a duplicate call_postprocessing runs the pipeline once", async () => {
    const m = memoryPipeline();
    let runs = 0;
    const d = pipelineDeps({ repo: m.repo, analyse: async () => (runs++, { result: postCall(), usage: USAGE, model: "g", attempts: 1 }) });
    const ev = vaaniEvents("room-dup", { start: START, seconds: 300 });
    await post(ev.post, d);
    await post(ev.post, d);
    expect(runs).toBe(1);
  });

  it("sets in_call, answered, ended and processing from the events", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({ repo: m.repo });
    const ev = vaaniEvents("room-2", { start: START, seconds: 125, phone: "+91 98765 43210" });
    await post(ev.started, d);
    expect(m.calls[0]).toMatchObject({ status: "in_call", startedAt: START, fromNumber: "+919876543210" });
    await post(ev.pickedUp, d);
    expect(m.calls[0].answeredAt).toEqual(new Date(START.getTime() + 3000));
    await post(ev.ended, d);
    expect(m.calls[0]).toMatchObject({ status: "processing", durationSeconds: 125, endReason: "completed" });
  });
});

describe("Mode A: tool row and webhook row become one call", () => {
  it("merges, keeps call_ref and the booking, and sets status booked with the agent's tier", async () => {
    const m = memoryPipeline();
    const tools = toolDeps({ repo: m.tools.repo, now: TOOL_TIME });
    const sub = await submitAssessment(assessment({ tier: "amber", tier_reason: "parents decide" }), tools);
    const callId = sub.callId as string;
    await m.tools.repo.claimBooking({ callId, consultType: "call", startAt: new Date("2026-10-13T05:30:00Z"), eventTypeId: 222, attendeeEmail: "x@example.com", status: "accepted" });

    const d = pipelineDeps({ repo: m.repo });
    const ev = vaaniEvents("room-A", { start: START, seconds: 360 });
    await post(ev.started, d);
    expect(m.calls).toHaveLength(2); // the webhook row and the tool row, until the call ends
    expect((await post(ev.ended, d)).processed?.link).toBe("merged");
    expect((await post(ev.post, d)).processed?.link).toBe("already_linked");
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]).toMatchObject({ id: callId, callRef: sub.body.call_id, vaaniCallId: "room-A", tier: "amber", status: "booked", startedAt: START, durationSeconds: 360 });
    expect(m.bookings[0].callId).toBe(callId);
    expect(m.calls[0].flags).not.toContain("unclassified");
  });

  it("Gemini never changes the agent's tier (decision 2026-10-10)", async () => {
    const m = memoryPipeline();
    await submitAssessment(assessment({ tier: "green" }), toolDeps({ repo: m.tools.repo, now: TOOL_TIME }));
    const red = postCall({ extraction: { call_category: "enquiry", criteria: { service_area: { status: "fail", evidence: "Nashik" } } } });
    await postAll("room-G", pipelineDeps({ repo: m.repo, analyse: async () => ({ result: red, usage: USAGE, model: "g", attempts: 1 }) }));
    expect(m.calls[0]).toMatchObject({ tier: "green", tierConflict: false, status: "awaiting_designer" });
    expect(m.calls[0].flags).not.toContain("tier_conflict");
  });

  it("Red is unqualified_verified and still fully stored", async () => {
    const m = memoryPipeline();
    await submitAssessment(assessment({ tier: "red", tier_reason: "site in Nashik" }), toolDeps({ repo: m.tools.repo, now: TOOL_TIME }));
    await postAll("room-R", pipelineDeps({ repo: m.repo }));
    expect(m.calls[0]).toMatchObject({ tier: "red", status: "unqualified_verified", summary: expect.any(String) });
    expect(m.calls[0].transcript).toContain("AGENT:");
  });

  it("a complaint is escalated", async () => {
    const m = memoryPipeline();
    await submitAssessment(assessment({ call_category: "existing_client_complaint", tier: undefined }), toolDeps({ repo: m.tools.repo, now: TOOL_TIME }));
    await postAll("room-C", pipelineDeps({ repo: m.repo }));
    expect(m.calls[0]).toMatchObject({ tier: null, status: "escalated" });
  });

  it("two overlapping calls with no numbers are not merged; the webhook row is flagged", async () => {
    const m = memoryPipeline();
    const t = toolDeps({ repo: m.tools.repo, now: TOOL_TIME });
    await submitAssessment(assessment({ phone: null }), t);
    await submitAssessment(assessment({ phone: null }), t);
    const out = await postAll("room-amb", pipelineDeps({ repo: m.repo }));
    expect(out?.link).toBe("ambiguous");
    const stub = m.calls.find((c) => c.vaaniCallId === "room-amb");
    expect(stub?.flags).toContain("needs_manual_link");
    expect(m.calls).toHaveLength(3);
  });
});

describe("Mode B and dropped calls", () => {
  it("with no tool call, the call is unclassified and waits for a designer; Gemini does not tier it", async () => {
    const m = memoryPipeline();
    await postAll("room-B", pipelineDeps({ repo: m.repo }));
    expect(m.calls[0]).toMatchObject({ tier: null, callCategory: null, status: "awaiting_designer", summary: expect.any(String) });
    expect(m.calls[0].flags).toContain("unclassified");
  });

  it("a short call with no assessment is dropped", async () => {
    const m = memoryPipeline();
    await postAll("room-D", pipelineDeps({ repo: m.repo }), { seconds: 12, transcript: "[10:00:01] AGENT: Hello, thank you for calling Aangan Studio." });
    expect(m.calls[0]).toMatchObject({ status: "dropped", endReason: "dropped" });
    expect(m.calls[0].flags).not.toContain("unclassified");
  });

  it("a long call where the caller described nothing is dropped (Gemini: no project details)", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({ repo: m.repo, analyse: async () => ({ result: postCall({ hasProjectDetails: false }), usage: USAGE, model: "g", attempts: 1 }) });
    await postAll("room-D2", d, { seconds: 45 });
    expect(m.calls[0].status).toBe("dropped");
  });

  it("an assessed call is never dropped, however short", async () => {
    const m = memoryPipeline();
    await submitAssessment(assessment(), toolDeps({ repo: m.tools.repo, now: TOOL_TIME }));
    await postAll("room-short", pipelineDeps({ repo: m.repo }), { seconds: 15 });
    expect(m.calls[0].status).toBe("awaiting_designer");
  });
});

describe("repeat callers (P6)", () => {
  it("a redial from the same number within 24 h links to the first call (AT15)", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({ repo: m.repo });
    await postAll("room-first", d, { phone: "+919876543210", seconds: 10 });
    const first = m.calls.find((c) => c.vaaniCallId === "room-first")!;
    expect(first.status).toBe("dropped");
    const later = new Date(START.getTime() + 2 * 60_000 + 10_000);
    const ev = vaaniEvents("room-second", { start: later, seconds: 300, phone: "+919876543210" });
    for (const e of [ev.started, ev.ended, ev.post]) await post(e, d);
    const second = m.calls.find((c) => c.vaaniCallId === "room-second")!;
    expect(second.repeatOfCallId).toBe(first.id);
  });

  it("a call from another number, or after 24 h, is not linked", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({ repo: m.repo });
    await postAll("r1", d, { phone: "+919876543210" });
    const ev = vaaniEvents("r2", { start: new Date(START.getTime() + 25 * 3_600_000), seconds: 300, phone: "+919876543210" });
    for (const e of [ev.started, ev.ended, ev.post]) await post(e, d);
    expect(m.calls.find((c) => c.vaaniCallId === "r2")?.repeatOfCallId).toBeNull();
  });
});

describe("price-leak check (P5)", () => {
  it("flags a figure in an agent turn, storing only the kind", async () => {
    const m = memoryPipeline();
    const transcript = "[10:00:01] AGENT: Hello.\n\n[10:00:05] USER: How much?\n\n[10:00:09] AGENT: Usually around 2 lakh for a kitchen.";
    await postAll("room-L", pipelineDeps({ repo: m.repo }), { transcript });
    expect(m.calls[0].priceLeak).toBe(true);
    const check = (m.calls[0].facts as { pipeline: { price_leak_check: { pattern_kinds: string[] } } }).pipeline.price_leak_check;
    expect(check.pattern_kinds).toContain("lakh_crore");
    expect(JSON.stringify(m.calls[0].facts)).not.toMatch(/2 lakh/);
  });

  it("the pricing line alone is clean; the caller's own figures never count", async () => {
    const m = memoryPipeline();
    const transcript = "[10:00:01] AGENT: Pricing depends on the site, the materials you choose, and the scope.\n\n[10:00:05] USER: My budget is 20 lakh.";
    await postAll("room-clean", pipelineDeps({ repo: m.repo }), { transcript });
    expect(m.calls[0].priceLeak).toBe(false);
  });

  it("Gemini's verdict alone also sets price_leak, with digits masked in the evidence", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({ repo: m.repo, analyse: async () => ({ result: postCall({ priceLeak: { leaked: true, evidence: "about #### a square foot" } }), usage: USAGE, model: "g", attempts: 1 }) });
    await postAll("room-GL", d);
    expect(m.calls[0].priceLeak).toBe(true);
  });
});

describe("cost (P7)", () => {
  it("Vaani = duration × rate, Gemini = tokens × rates, total = both", async () => {
    const m = memoryPipeline();
    await postAll("room-cost", pipelineDeps({ repo: m.repo }), { seconds: 90 });
    // 1.5 min × 6 = 9.00; Gemini (10,000 × 50 + 2,000 × 300) / 1e6 = 1.1
    expect(m.calls[0]).toMatchObject({ vaaniCostInr: 9, geminiCostInr: 1.1, totalCostInr: 10.1, geminiTokensIn: 10_000, geminiTokensOut: 2_000 });
  });

  it("with no rates configured, costs stay null rather than wrong", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({ repo: m.repo, config: { vaaniCostPerMinInr: undefined, geminiPriceInPerMtokInr: undefined } });
    await postAll("room-nocost", d);
    expect(m.calls[0]).toMatchObject({ vaaniCostInr: null, geminiCostInr: null, totalCostInr: null });
  });
});

describe("pipeline steps and retries (P2)", () => {
  it("records every step; HubSpot and Telegram are skipped when not configured", async () => {
    const m = memoryPipeline();
    const out = await postAll("room-steps", pipelineDeps({ repo: m.repo }));
    expect(out?.pipeline?.map((s) => [s.step, s.status])).toEqual([
      ["save", "succeeded"],
      ["enrich", "skipped"],
      ["booking", "skipped"],
      ["gemini", "succeeded"],
      ["tier", "succeeded"],
      ["leak_check", "succeeded"],
      ["cost", "succeeded"],
      ["telegram", "skipped"],
      ["hubspot_log", "skipped"],
      ["hubspot_deal", "skipped"],
    ]);
    expect(m.steps.find((s) => s.step === "hubspot_log")?.lastError).toBe("missing_config");
  });

  it("is_test calls are skipped for HubSpot and Telegram even when configured (P8, AT11)", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({ repo: m.repo, telegram: fakeTelegram().api, hubspot: fakeHubspot().wiring });
    const ev = vaaniEvents("room-test", { start: START, seconds: 200 });
    for (const e of [ev.started, ev.ended, { ...ev.post, is_test: true }]) await post(e, d);
    expect(m.calls[0].isTest).toBe(true);
    for (const step of ["hubspot_log", "hubspot_deal", "telegram"]) expect(m.steps.find((s) => s.step === step)).toMatchObject({ status: "skipped", lastError: "is_test" });
  });

  it("a Gemini failure is recorded with attempts and is not fatal; a retry fixes it (P3)", async () => {
    const m = memoryPipeline();
    let fail = true;
    const d = pipelineDeps({
      repo: m.repo,
      analyse: async () => {
        if (fail) throw new RetryError("GeminiOutputError: response failed validation", 3, new GeminiOutputError("response failed validation"));
        return { result: postCall(), usage: USAGE, model: "g", attempts: 1 };
      },
    });
    await postAll("room-gfail", d);
    const call = m.calls[0];
    expect(m.steps.find((s) => s.step === "gemini")).toMatchObject({ status: "failed", attempts: 3, lastError: expect.stringContaining("validation") });
    expect(call).toMatchObject({ status: "awaiting_designer", summary: null });
    expect(m.steps.find((s) => s.step === "cost")?.status).toBe("succeeded");

    fail = false;
    const retry = await runPipeline(call.id, d, { from: "gemini" });
    expect(retry[0]).toMatchObject({ step: "gemini", status: "succeeded", attempts: 4 });
    expect(m.calls[0].summary).toMatch(/Kothrud/);
  });

  it("only: re-runs a single step", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({ repo: m.repo });
    await postAll("room-only", d);
    const r = await runPipeline(m.calls[0].id, d, { only: "cost" });
    expect(r.map((s) => s.step)).toEqual(["cost"]);
    expect(m.steps.find((s) => s.step === "cost")?.attempts).toBe(2);
  });

  it("enrich tolerates Vaani's call-history 500 and the pipeline carries on", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({ repo: m.repo, history: async () => { throw new Error("VaaniApiError: Vaani call history 500: Invalid client_id format"); } });
    await postAll("room-enrich", d);
    expect(m.steps.find((s) => s.step === "enrich")).toMatchObject({ status: "failed", lastError: expect.stringContaining("500") });
    expect(m.calls[0].status).toBe("awaiting_designer");
  });

  it("enrich fills numbers and pickup, and marks a test agent's call is_test", async () => {
    const m = memoryPipeline();
    const d = pipelineDeps({
      repo: m.repo,
      history: async (id) => ({ callId: id, agentId: "agent-test", callType: "Inbound", direction: "Incoming", fromNumber: "+919876543210", toNumber: "+912012345678", startedAt: START, endedAt: null, pickedUpAt: new Date(START.getTime() + 2000), durationSeconds: 360, costCredits: 2.5 }),
    });
    await postAll("room-hist", d);
    expect(m.calls[0]).toMatchObject({ fromNumber: "+919876543210", toNumber: "+912012345678", vaaniAgentId: "agent-test", isTest: true });
  });
});

describe("booking reconcile", () => {
  async function pendingCall(m: ReturnType<typeof memoryPipeline>) {
    const sub = await submitAssessment(assessment(), toolDeps({ repo: m.tools.repo, now: TOOL_TIME }));
    const callId = sub.callId as string;
    const { booking } = await m.tools.repo.claimBooking({ callId, consultType: "call", startAt: new Date("2026-10-13T05:30:00Z"), eventTypeId: 222, attendeeEmail: `${String(sub.body.call_id).toLowerCase()}@example.com`, emailIsPlaceholder: true, status: "pending" });
    booking.createdAt = TOOL_TIME();
    return { callId, ref: sub.body.call_id as string };
  }

  it("marks a timed-out booking accepted when Cal.com has it", async () => {
    const m = memoryPipeline();
    const { ref } = await pendingCall(m);
    const queries: unknown[] = [];
    const d = pipelineDeps({
      repo: m.repo,
      calLookup: async (q) => (queries.push(q), [{ uid: "bk_9", start: "2026-10-13T05:30:00.000Z", status: "accepted", attendeeEmails: [q.attendeeEmail], metadata: { call_ref: ref } }]),
    });
    await postAll("room-rec", d);
    expect(m.bookings[0]).toMatchObject({ status: "accepted", calBookingUid: "bk_9" });
    expect(m.calls[0].status).toBe("booked");
    expect(queries[0]).toMatchObject({ attendeeEmail: `${ref.toLowerCase()}@example.com`, eventTypeId: 222 });
  });

  it("marks it failed when Cal.com does not have it", async () => {
    const m = memoryPipeline();
    await pendingCall(m);
    const d = pipelineDeps({ repo: m.repo, now: new Date("2026-10-12T06:00:00Z"), calLookup: async () => [] });
    await postAll("room-rec2", d);
    expect(m.bookings[0].status).toBe("failed");
    expect(m.calls[0].status).toBe("awaiting_designer");
  });

  it("leaves a booking younger than 2 minutes pending, without making the alert wait for it", async () => {
    const m = memoryPipeline();
    await pendingCall(m);
    let looked = 0;
    const d = pipelineDeps({ repo: m.repo, now: new Date("2026-10-12T05:31:00Z"), calLookup: async () => (looked++, []) });
    await postAll("room-rec3", d);
    expect(looked).toBe(0);
    expect(d.slept).toEqual([]);
    expect(m.bookings[0].status).toBe("pending");
    expect(m.steps.find((s) => s.step === "booking")).toMatchObject({ status: "skipped", lastError: "too_recent" });
  });
});
