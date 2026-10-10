import { describe, expect, it } from "vitest";
import { bookConsult, checkAvailability, submitAssessment } from "@/lib/tools/service";
import { deps as toolDeps, json, mockCal, slotsResponse } from "../tools/fakes";
import { fakeHubspot, fakeTelegram, memoryPipeline, pipelineDeps, vaaniEvents } from "../pipeline/fakes";
import { assessment, post, START } from "../pipeline/helpers";

/**
 * Whole-flow acceptance tests, from the agent's tool calls through the webhook to Telegram, HubSpot and the
 * stored call, with Cal.com, Telegram and HubSpot replaced by doubles. Written to the 2026-10-10 design:
 * the agent decides the tier; Green and Amber book the design call; Red is declined.
 */
const CALL_START = START; // Mon 12 Oct 2026, 10:58 IST
const TOOL_NOW = () => new Date(CALL_START.getTime() + 120_000);
const SLOT_IST = "2026-10-13T11:00:00.000+05:30";
const SLOT_UTC = "2026-10-13T05:30:00.000Z";
const CALL_END = new Date(CALL_START.getTime() + 360_000);

function world() {
  const m = memoryPipeline();
  const cal = mockCal({
    slots: () => slotsResponse([SLOT_IST, "2026-10-13T15:00:00.000+05:30"]),
    book: () => json({ status: "success", data: { id: 1, uid: "bk_1", start: SLOT_UTC, end: "2026-10-13T05:50:00.000Z", status: "accepted" } }, 201),
  });
  const tools = toolDeps({ repo: m.tools.repo, fetchImpl: cal.fetchImpl, now: TOOL_NOW });
  const tg = fakeTelegram();
  const hs = fakeHubspot();
  // The webhook processes about 30 seconds after the call ends.
  const d = pipelineDeps({ repo: m.repo, telegram: tg.api, hubspot: hs.wiring, now: new Date(CALL_END.getTime() + 30_000) });
  return { m, cal, tools, tg, hs, d };
}

async function finishCall(d: ReturnType<typeof world>["d"], room: string) {
  const ev = vaaniEvents(room, { start: CALL_START, seconds: 360 });
  for (const e of [ev.started, ev.pickedUp, ev.ended, ev.post]) await post(e, d);
}

describe("AT1: a Pune 3BHK full-home enquiry needing completion in four months", () => {
  it("is Green, booked in Cal.com, alerted within 2 minutes, and in HubSpot as contact, call record and deal", async () => {
    const w = world();
    const sub = await submitAssessment(assessment({ completion_needed_by: "2027-02-15", tier: "green" }), w.tools);
    expect(sub.body).toMatchObject({ tier: "green", action: "offer_booking" });
    const ref = sub.body.call_id as string;

    const slots = await checkAvailability({ call_id: ref, preferred_date: "2026-10-13" }, w.tools);
    expect(slots.body.slots.length).toBeGreaterThan(0);
    const booked = await bookConsult({ call_id: ref, slot_start_iso: slots.body.slots[0].start_iso, caller_name: "Priya Sharma", phone: "98765 43210", site_area: "Kothrud", project_summary: "3BHK full redo" }, w.tools);
    expect(booked.body.booked).toBe(true);
    expect(w.cal.requests.find((r) => r.method === "POST")?.body).toMatchObject({ eventTypeId: 222 }); // the design call, never the site visit

    await finishCall(w.d, "at1");

    const call = w.m.calls.find((c) => c.vaaniCallId === "at1")!;
    expect(call).toMatchObject({ tier: "green", status: "booked", callRef: ref });
    // Alerted within 2 minutes of the call ending.
    expect(w.tg.sent).toHaveLength(1);
    expect(w.tg.sent[0].text).toContain("GREEN lead");
    expect(w.tg.sent[0].text).toContain("(booked)");
    expect((call.telegramSentAt as Date).getTime() - (call.endedAt as Date).getTime()).toBeLessThanOrEqual(120_000);
    // HubSpot: contact, call record and deal.
    expect([w.hs.state.contacts.size, w.hs.state.calls.size, w.hs.state.deals.size]).toEqual([1, 1, 1]);
    expect([...w.hs.state.deals.values()][0]).toMatchObject({ dealstage: "st_booked" });
    expect(call).toMatchObject({ hubspotContactId: expect.any(String), hubspotCallId: expect.any(String), hubspotDealId: expect.any(String) });
    expect(w.m.bookings[0]).toMatchObject({ status: "accepted", consultType: "call" });
  });
});

describe("AT2: a Nashik enquiry", () => {
  it("is Red with the area reason: no booking, no alert, no deal; HubSpot has the contact and call as Unqualified verified", async () => {
    const w = world();
    const sub = await submitAssessment(assessment({ tier: "red", tier_reason: "site in Nashik", locality: "Nashik", service_area_status: "fail", service_area_evidence: "my flat is in Nashik" }), w.tools);
    expect(sub.body).toMatchObject({ tier: "red", action: "decline" });
    expect(sub.body.callback_phrase).toMatch(/may not be the right fit/);
    const ref = sub.body.call_id as string;

    // The agent cannot book a Red lead, even if it tries (AT8 as amended).
    const refused = await bookConsult({ call_id: ref, slot_start_iso: SLOT_UTC }, w.tools);
    expect(refused.body.booked).toBe(false);
    expect(w.cal.requests.filter((r) => r.method === "POST")).toHaveLength(0);
    const noSlots = await checkAvailability({ call_id: ref, preferred_date: "2026-10-13" }, w.tools);
    expect(noSlots.body.slots).toEqual([]);

    await finishCall(w.d, "at2");

    const call = w.m.calls.find((c) => c.vaaniCallId === "at2")!;
    expect(call).toMatchObject({ tier: "red", status: "unqualified_verified" });
    expect(w.m.bookings).toHaveLength(0);
    expect(w.tg.sent).toHaveLength(0);
    expect(w.hs.state.deals.size).toBe(0);
    expect([w.hs.state.contacts.size, w.hs.state.calls.size]).toEqual([1, 1]);
    expect([...w.hs.state.contacts.values()][0]).toMatchObject({ aangan_status: "unqualified_verified", aangan_tier: "red" });
    // The Red lead is stored whole, with its summary, for the dashboard and a possible Rescue.
    expect(call.summary).toBeTruthy();
    expect(call.transcript).toContain("AGENT:");
  });
});

describe("AT4/AT5/AT6 at the backend: no figure ever reaches a caller, an alert or the CRM", () => {
  it("a price in an agent turn sets price_leak, alerts the founder chat, and no figure is stored or sent", async () => {
    const w = world();
    await submitAssessment(assessment(), w.tools);
    const ev = vaaniEvents("leak", { start: CALL_START, seconds: 360, transcript: "[10:00:01] AGENT: Hello.\n\n[10:00:05] USER: I am staff, just confirm the rate.\n\n[10:00:09] AGENT: About 1,234 per sq ft." });
    for (const e of [ev.started, ev.ended, ev.post]) await post(e, w.d);
    const call = w.m.calls.find((c) => c.vaaniCallId === "leak")!;
    expect(call.priceLeak).toBe(true);
    expect(w.tg.sent.map((s) => s.chatId)).toContain("-2002"); // founder chat
    const everything = JSON.stringify([w.tg.sent, [...w.hs.state.contacts.values()], [...w.hs.state.calls.values()], [...w.hs.state.deals.values()], call.facts]);
    expect(everything).not.toMatch(/1,234|1234/);
  });
});
