import { describe, expect, it } from "vitest";
import { runDaily } from "@/lib/pipeline/daily";
import { runPipeline } from "@/lib/pipeline/run";
import { fakeHubspot, fakeTelegram, memoryPipeline, pipelineDeps, vaaniEvents } from "./fakes";
import { assessment, fullCall, post, START } from "./helpers";
import { submitAssessment } from "@/lib/tools/service";
import { deps as toolDeps } from "../tools/fakes";

const step = (m: ReturnType<typeof memoryPipeline>, name: string) => m.steps.find((s) => s.step === name);

describe("Telegram step in the pipeline", () => {
  it("sends one lead alert to the designers and records when (Green)", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    const call = await fullCall(m, pipelineDeps({ repo: m.repo, telegram: tg.api }), "r-green");
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]).toMatchObject({ chatId: "-1001" });
    expect(tg.sent[0].text).toContain("GREEN lead");
    expect(call).toMatchObject({ telegramChatId: "-1001", telegramMessageId: tg.sent[0].messageId });
    expect(call.telegramSentAt).toBeInstanceOf(Date);
    expect(step(m, "telegram")?.status).toBe("succeeded");
  });

  it("a duplicate webhook sends one alert (AT9)", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    const d = pipelineDeps({ repo: m.repo, telegram: tg.api });
    await fullCall(m, d, "r-dup");
    const ev = vaaniEvents("r-dup", { start: START, seconds: 360 });
    await post(ev.post, d);
    await post(ev.ended, d);
    expect(tg.sent).toHaveLength(1);
  });

  it("Amber alerts the designers too, labelled AMBER", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    await fullCall(m, pipelineDeps({ repo: m.repo, telegram: tg.api }), "r-amber", { tier: "amber", tier_reason: "parents decide" });
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].text).toContain("AMBER lead");
  });

  it("Red sends nothing and is recorded as skipped", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    await fullCall(m, pipelineDeps({ repo: m.repo, telegram: tg.api }), "r-red", { tier: "red", tier_reason: "Nashik" });
    expect(tg.sent).toHaveLength(0);
    expect(step(m, "telegram")).toMatchObject({ status: "skipped", lastError: "no_alert_for_this_call" });
  });

  it("with Gemini off the alert still goes out with an excerpt (AT10)", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    await fullCall(m, pipelineDeps({ repo: m.repo, telegram: tg.api, analyse: null }), "r-nogem");
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].text).toContain("Caller said (summary unavailable)");
    expect(tg.sent[0].text).toContain("3BHK in Kothrud");
  });

  it("a failed Gemini call does not block the alert (P3)", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    const d = pipelineDeps({ repo: m.repo, telegram: tg.api, analyse: async () => { throw new Error("Gemini down"); } });
    await fullCall(m, d, "r-gfail");
    expect(step(m, "gemini")?.status).toBe("failed");
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].text).toContain("summary unavailable");
  });

  it("test calls never reach Telegram (AT11)", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    await fullCall(m, pipelineDeps({ repo: m.repo, telegram: tg.api }), "r-test", { call_mode: "webrtc" });
    expect(tg.sent).toHaveLength(0);
    expect(step(m, "telegram")).toMatchObject({ status: "skipped", lastError: "is_test" });
  });

  it("a complaint goes to the founder chat immediately, with no deal (AT16)", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    const hs = fakeHubspot();
    const call = await fullCall(m, pipelineDeps({ repo: m.repo, telegram: tg.api, hubspot: hs.wiring }), "r-complaint", { call_category: "existing_client_complaint", tier: undefined, existing_project_designer: "Meera", issue_summary: "no reply for 5 days" });
    expect(tg.sent.map((s) => s.chatId)).toEqual(["-2002"]);
    expect(tg.sent[0].text).toContain("ESCALATION");
    expect(call.status).toBe("escalated");
    expect(hs.state.deals.size).toBe(0);
    expect(hs.state.contacts.size).toBe(1);
    expect([...hs.state.contacts.values()][0]).toMatchObject({ aangan_status: "escalated" });
  });

  it("with no founder chat set, a founder alert falls back to the designers' group and says so", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram({ founderChatId: null });
    await fullCall(m, pipelineDeps({ repo: m.repo, telegram: tg.api }), "r-nofounder", { call_category: "existing_client_complaint", tier: undefined });
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].chatId).toBe("-1001");
    expect(tg.sent[0].text).toContain("no founder chat set");
  });

  it("a price leak alerts the founder chat as well as the designers (AT6)", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    const transcript = "[10:00:01] AGENT: Hello.\n\n[10:00:05] USER: How much for a 3BHK in Kothrud?\n\n[10:00:09] AGENT: Around 1,234 per sq ft.";
    await fullCall(m, pipelineDeps({ repo: m.repo, telegram: tg.api }), "r-leak", {}, { transcript });
    expect(tg.sent.map((s) => [s.chatId, s.text.includes("PRICE LEAK")])).toEqual([["-1001", false], ["-2002", true]]);
  });

  it("records a failed send and resends only what is missing on retry", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    const d = pipelineDeps({ repo: m.repo, telegram: tg.api });
    tg.failNext(1);
    const transcript = "[10:00:01] AGENT: Hello.\n\n[10:00:05] USER: Hi, 3BHK Kothrud.\n\n[10:00:09] AGENT: Around 2 lakh.";
    const call = await fullCall(m, d, "r-retry", {}, { transcript });
    expect(step(m, "telegram")).toMatchObject({ status: "failed", lastError: expect.stringContaining("lead") });
    expect(tg.sent.map((s) => s.chatId)).toEqual(["-2002"]); // the founder alert got through, the lead alert failed
    await runPipeline(call.id, d, { only: "telegram" });
    expect(tg.sent.map((s) => s.chatId)).toEqual(["-2002", "-1001"]); // exactly one more message: no duplicate founder alert
    expect(step(m, "telegram")?.status).toBe("succeeded");
    expect(step(m, "telegram")?.attempts).toBe(2);
  });
});

describe("a redial after a dropped call (AT15)", () => {
  it("edits the first alert into the lead alert: one lead, one alert, two calls", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    const d = pipelineDeps({ repo: m.repo, telegram: tg.api, hubspot: fakeHubspot().wiring });

    // First call: caller hangs up almost at once. Number known from call history (here from call_started).
    const first = vaaniEvents("r-first", { start: START, seconds: 12, phone: "+919876543210", transcript: "[10:00:01] AGENT: Hello, thank you for calling Aangan Studio." });
    for (const e of [first.started, first.ended, first.post]) await post(e, d);
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].text).toContain("Dropped call");

    // Two minutes later they ring back and complete the enquiry.
    const later = new Date(START.getTime() + 140_000);
    await submitAssessment(assessment(), toolDeps({ repo: m.tools.repo, now: () => new Date(later.getTime() + 60_000) }));
    const second = vaaniEvents("r-second", { start: later, seconds: 300, phone: "+919876543210" });
    for (const e of [second.started, second.ended, second.post]) await post(e, d);

    expect(tg.sent).toHaveLength(1); // still one message in the chat...
    expect(tg.edits).toHaveLength(1); // ...edited into the lead alert
    expect(tg.edits[0].messageId).toBe(tg.sent[0].messageId);
    expect(tg.edits[0].text).toContain("GREEN lead");
    const calls = m.calls.filter((c) => c.vaaniCallId);
    expect(calls).toHaveLength(2);
    expect(calls[1].repeatOfCallId).toBe(calls[0].id);
    expect(calls[1].telegramMessageId).toBe(tg.sent[0].messageId);
  });

  it("sends a fresh alert if the old one cannot be edited any more", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram({ editStatus: 400 });
    const d = pipelineDeps({ repo: m.repo, telegram: tg.api });
    const first = vaaniEvents("e-first", { start: START, seconds: 10, phone: "+919876543210", transcript: "[10:00:01] AGENT: Hello." });
    for (const e of [first.started, first.ended, first.post]) await post(e, d);
    const later = new Date(START.getTime() + 140_000);
    await submitAssessment(assessment(), toolDeps({ repo: m.tools.repo, now: () => new Date(later.getTime() + 60_000) }));
    const second = vaaniEvents("e-second", { start: later, seconds: 300, phone: "+919876543210" });
    for (const e of [second.started, second.ended, second.post]) await post(e, d);
    expect(tg.sent).toHaveLength(2);
  });
});

describe("HubSpot down does not delay Telegram (AT21)", () => {
  it("the alert is sent and recorded before HubSpot is touched; HubSpot steps show failures", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    const hs = fakeHubspot({ down: true });
    const call = await fullCall(m, pipelineDeps({ repo: m.repo, telegram: tg.api, hubspot: hs.wiring }), "r-hsdown");
    expect(tg.sent).toHaveLength(1);
    expect(step(m, "telegram")?.status).toBe("succeeded");
    expect(step(m, "hubspot_log")).toMatchObject({ status: "failed", lastError: expect.stringContaining("HubSpot") });
    expect(step(m, "hubspot_deal")?.status).toBe("failed");
    const order = m.steps.map((s) => s.step);
    expect(order.indexOf("telegram")).toBeLessThan(order.indexOf("hubspot_log"));
    expect(call.hubspotContactId).toBeNull();
  });
});

describe("retention", () => {
  it("clears transcripts and recording links older than RETENTION_DAYS, keeping the call, summary and tier", async () => {
    const m = memoryPipeline();
    const old = await fullCall(m, pipelineDeps({ repo: m.repo }), "r-old", {}, { start: new Date("2026-06-01T05:28:00Z") });
    const recent = await fullCall(m, pipelineDeps({ repo: m.repo }), "r-recent", {}, { start: new Date("2026-10-10T05:28:00Z") });
    old.recordingUrl = "https://rec.example/old.mp3";
    old.createdAt = new Date("2026-06-01T05:28:00Z");
    recent.createdAt = new Date("2026-10-10T05:28:00Z");
    const res = await runDaily(pipelineDeps({ repo: m.repo, now: new Date("2026-10-13T03:30:00Z") }));
    expect(res.purged).toBe(1);
    expect(old).toMatchObject({ transcript: null, recordingUrl: null, tier: "green", summary: expect.any(String) });
    expect(recent.transcript).toContain("AGENT:");
  });
});

describe("daily job (P9)", () => {
  it("sends the digest of unreviewed Amber and Red, and settles stale pending bookings", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    const d = pipelineDeps({ repo: m.repo, telegram: tg.api, now: new Date("2026-10-13T03:30:00Z"), calLookup: async () => [] });
    await fullCall(m, pipelineDeps({ repo: m.repo }), "r-d1", { tier: "amber", tier_reason: "x" });
    await fullCall(m, pipelineDeps({ repo: m.repo }), "r-d2", { tier: "red", tier_reason: "Nashik", phone: "98111 22233" }, { start: new Date("2026-10-12T05:40:00Z") });
    const res = await runDaily(d);
    expect(res.digest).toMatchObject({ sent: true, amber: 1, red: 1 });
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].text).toContain("Morning digest");
  });

  it("sends nothing when there is nothing to report, or no Telegram", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    expect(await runDaily(pipelineDeps({ repo: m.repo, telegram: tg.api }))).toMatchObject({ digest: { sent: false, reason: "nothing_to_report" } });
    expect(await runDaily(pipelineDeps({ repo: m.repo }))).toMatchObject({ digest: { sent: false, reason: "missing_config" } });
  });

  it("a reviewed Amber lead is left out", async () => {
    const m = memoryPipeline();
    const tg = fakeTelegram();
    const call = await fullCall(m, pipelineDeps({ repo: m.repo }), "r-rev", { tier: "amber", tier_reason: "x" });
    call.reviewState = "approved";
    expect(await runDaily(pipelineDeps({ repo: m.repo, telegram: tg.api }))).toMatchObject({ digest: { sent: false, reason: "nothing_to_report" } });
  });
});
