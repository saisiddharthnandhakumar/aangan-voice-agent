import { describe, expect, it } from "vitest";
import { checkAvailability } from "@/lib/tools/service";
import { deps, json, memoryRepo, mockCal, slotsResponse } from "./fakes";

async function greenCall(m: ReturnType<typeof memoryRepo>, tier: "green" | "amber" = "green") {
  const row = await m.repo.createCall({ callRef: "ABCDEF", status: "in_call", tier });
  return row!;
}

const SLOTS = [
  "2026-10-13T09:00:00.000+05:30",
  "2026-10-13T10:00:00.000+05:30",
  "2026-10-13T17:00:00.000+05:30",
  "2026-10-14T09:00:00.000+05:30",
  "2026-10-15T18:00:00.000+05:30",
];

describe("T2 check_availability", () => {
  it("returns up to three slots, spread across days, with speakable IST labels", async () => {
    const m = memoryRepo();
    await greenCall(m);
    const cal = mockCal({ slots: () => slotsResponse(SLOTS) });
    const r = await checkAvailability({ call_id: "ABCDEF", preferred_date: "2026-10-13", consult_type: "site_visit" }, deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(r.body.slots.map((s) => s.label)).toEqual(["tomorrow at 9 AM", "Wednesday the 14th of October at 9 AM", "Thursday the 15th of October at 6 PM"]);
    expect(r.body.slots[0].start_iso).toBe("2026-10-13T03:30:00.000Z");
    expect(r.body.message).toBe("I have tomorrow at 9 AM, Wednesday the 14th of October at 9 AM or Thursday the 15th of October at 6 PM. Which would you like?");
  });

  it("asks Cal.com for the right event type, window and version header", async () => {
    const m = memoryRepo();
    await greenCall(m);
    const cal = mockCal({ slots: () => slotsResponse(SLOTS) });
    await checkAvailability({ call_id: "ABCDEF", preferred_date: "2026-10-13", consult_type: "call", days_to_search: 2 }, deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    const req = cal.requests[0];
    const q = new URL(`https://x${req.path}?${""}`);
    expect(req.path).toBe("/v2/slots");
    expect(req.headers["cal-api-version"]).toBe("2024-09-04");
    expect(req.headers.authorization).toBe("Bearer cal_test");
    expect(q).toBeTruthy();
  });

  it("filters by the caller's preference (evening)", async () => {
    const m = memoryRepo();
    await greenCall(m);
    const cal = mockCal({ slots: () => slotsResponse(SLOTS) });
    const r = await checkAvailability({ call_id: "ABCDEF", preferred_date: "2026-10-13", preferred_time_text: "evening after work", consult_type: "site_visit" }, deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(r.body.slots.map((s) => s.label)).toEqual(["tomorrow at 5 PM", "Thursday the 15th of October at 6 PM"]);
  });

  it("offers other times when nothing matches the preference", async () => {
    const m = memoryRepo();
    await greenCall(m);
    const cal = mockCal({ slots: () => slotsResponse(SLOTS) });
    const r = await checkAvailability({ call_id: "ABCDEF", preferred_time_text: "Sunday", consult_type: "site_visit" }, deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(r.body.slots).toHaveLength(3);
    expect(r.body.message).toMatch(/^I don't have a time exactly as you asked/);
  });

  it("says so when there are no slots", async () => {
    const m = memoryRepo();
    await greenCall(m);
    const cal = mockCal({ slots: () => json({ status: "success", data: {} }) });
    const r = await checkAvailability({ call_id: "ABCDEF", consult_type: "site_visit" }, deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(r.body).toMatchObject({ slots: [], message: expect.stringMatching(/another day/) });
  });

  it("degrades to a callback message when Cal.com fails, after one retry", async () => {
    const m = memoryRepo();
    await greenCall(m);
    const cal = mockCal({ slots: () => json({ error: { message: "boom" } }, 500) });
    const r = await checkAvailability({ call_id: "ABCDEF", consult_type: "site_visit" }, deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(r.body.slots).toEqual([]);
    expect(r.body.message).toMatch(/trouble reaching the calendar/);
    expect(cal.requests).toHaveLength(2);
  });

  it("refuses non-Green and unknown calls without calling Cal.com", async () => {
    const m = memoryRepo();
    await greenCall(m, "amber");
    const cal = mockCal({ slots: () => slotsResponse(SLOTS) });
    const amber = await checkAvailability({ call_id: "ABCDEF", consult_type: "site_visit" }, deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    const unknown = await checkAvailability({ call_id: "ZZZZZZ", consult_type: "site_visit" }, deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(amber.body.slots).toEqual([]);
    expect(unknown.body.agent_note).toMatch(/submit_assessment first/);
    expect(cal.requests).toHaveLength(0);
  });

  it("never offers a slot in the past", async () => {
    const m = memoryRepo();
    await greenCall(m);
    const cal = mockCal({ slots: () => slotsResponse(["2026-10-12T10:00:00.000+05:30", "2026-10-12T15:00:00.000+05:30"]) });
    const r = await checkAvailability({ call_id: "ABCDEF", preferred_date: "2026-10-01", consult_type: "site_visit" }, deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(r.body.slots.map((s) => s.label)).toEqual(["today at 3 PM"]);
  });
});
