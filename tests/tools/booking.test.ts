import { describe, expect, it } from "vitest";
import { bookConsult } from "@/lib/tools/service";
import { deps, json, memoryRepo, mockCal, slotsResponse } from "./fakes";

const SLOT = "2026-10-13T03:30:00.000Z"; // Tue 9 AM IST

async function setup(tier: "green" | "amber" | "red" | null = "green") {
  const m = memoryRepo();
  await m.repo.createCall({ callRef: "ABCDEF", status: "in_call", tier, fromNumber: "+919876543210", callerName: "Priya" });
  return m;
}

const booked = () => json({ status: "success", data: { id: 1, uid: "bk_123", start: SLOT, end: "2026-10-13T04:30:00.000Z", status: "accepted" } }, 201);
const req = (o: Record<string, unknown> = {}) => ({ call_id: "ABCDEF", slot_start_iso: SLOT, consult_type: "call", site_area: "Kothrud", caller_name: "Priya", phone: "+91 98765 43210", email: null, project_summary: "3BHK full redo", ...o });

describe("T3 book_consult", () => {
  it.each(["green", "amber"] as const)("books a %s call as a design call and reads the time back", async (tier) => {
    const m = await setup(tier);
    const cal = mockCal({ book: booked });
    const r = await bookConsult(req(), deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(r.body).toEqual({
      booked: true,
      spoken_confirmation: "You're booked for a design call with one of our designers tomorrow at 9 AM. The designer will call you on this number at that time.",
    });
    expect(m.bookings[0]).toMatchObject({ status: "accepted", calBookingUid: "bk_123", consultType: "call", eventTypeId: 222, emailIsPlaceholder: true });
    expect(m.calls[0]).toMatchObject({ consultType: "call", siteArea: "Kothrud", tier });
  });

  it("books a design call even if the agent asks for a site visit (only the design call exists)", async () => {
    const m = await setup();
    const cal = mockCal({ book: booked });
    await bookConsult(req({ consult_type: "site_visit" }), deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(cal.requests[0].body).toMatchObject({ eventTypeId: 222 });
    expect(cal.requests[0].body).not.toHaveProperty("location");
    expect(m.bookings[0].consultType).toBe("call");
  });

  it("sends the verified booking shape: version header, attendee, no location, placeholder email", async () => {
    const m = await setup();
    const cal = mockCal({ book: booked });
    await bookConsult(req(), deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    const r = cal.requests[0];
    expect(r.headers["cal-api-version"]).toBe("2026-02-25");
    expect(r.body).toMatchObject({
      start: SLOT,
      eventTypeId: 222,
      attendee: { name: "Priya", email: "abcdef@example.com", timeZone: "Asia/Kolkata", phoneNumber: "+919876543210", language: "en" },
      metadata: { call_ref: "ABCDEF" },
    });
    expect(r.body).not.toHaveProperty("location");
    expect(JSON.stringify(r.body)).not.toMatch(/lakh|₹|per sq/i);
  });

  it("uses the caller's email when valid and sends no location for a call", async () => {
    const m = await setup();
    const cal = mockCal({ book: booked });
    await bookConsult(req({ consult_type: "call", email: "Priya.J @Gmail.com" }), deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(cal.requests[0].body).toMatchObject({ eventTypeId: 222, attendee: { email: "priya.j@gmail.com" } });
    expect(cal.requests[0].body).not.toHaveProperty("location");
    expect(m.bookings[0].emailIsPlaceholder).toBe(false);
  });

  it.each(["red", null] as const)("refuses a %s call without touching Cal.com (AT8 as amended)", async (tier) => {
    const m = await setup(tier);
    const cal = mockCal({ book: booked });
    const r = await bookConsult(req(), deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(r.body.booked).toBe(false);
    expect(r.body.reason).toMatch(/designer will call you back/);
    expect(cal.requests).toHaveLength(0);
    expect(m.bookings).toHaveLength(0);
  });

  it("refuses an unknown call", async () => {
    const r = await bookConsult(req({ call_id: "QQQQQQ" }), deps());
    expect(r.body).toMatchObject({ booked: false, agent_note: "Unknown call_id." });
  });

  it("is idempotent per call: a second request returns the same booking", async () => {
    const m = await setup();
    const cal = mockCal({ book: booked });
    const d = deps({ repo: m.repo, fetchImpl: cal.fetchImpl });
    await bookConsult(req(), d);
    const again = await bookConsult(req({ slot_start_iso: "2026-10-14T03:30:00.000Z" }), d);
    expect(again.body.booked).toBe(true);
    expect(again.body.spoken_confirmation).toMatch(/tomorrow at 9 AM/);
    expect(cal.requests.filter((r) => r.path === "/v2/bookings")).toHaveLength(1);
    expect(m.bookings).toHaveLength(1);
  });

  it("offers fresh slots when the slot was just taken", async () => {
    const m = await setup();
    const cal = mockCal({
      book: () => json({ status: "error", error: { message: "slot unavailable" } }, 400),
      slots: () => slotsResponse(["2026-10-13T09:00:00.000+05:30", "2026-10-13T11:00:00.000+05:30", "2026-10-14T10:00:00.000+05:30"]),
    });
    const r = await bookConsult(req(), deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(r.body.booked).toBe(false);
    expect(r.body.slots?.map((s) => s.label)).toEqual(["tomorrow at 11 AM", "Wednesday the 14th of October at 10 AM"]);
    expect(r.body.reason).toMatch(/^Sorry, that time was just taken\. I have tomorrow at 11 AM or Wednesday/);
    expect(m.bookings[0].status).toBe("failed");
  });

  it("can book again after a failed attempt", async () => {
    const m = await setup();
    let first = true;
    const cal = mockCal({
      book: () => (first ? ((first = false), json({ error: { message: "taken" } }, 409)) : booked()),
      slots: () => slotsResponse([]),
    });
    const d = deps({ repo: m.repo, fetchImpl: cal.fetchImpl });
    expect((await bookConsult(req(), d)).body.booked).toBe(false);
    expect((await bookConsult(req(), d)).body.booked).toBe(true);
    expect(m.bookings).toHaveLength(1);
    expect(m.bookings[0].status).toBe("accepted");
  });

  it("never retries a create after a timeout, and leaves it pending to reconcile", async () => {
    const m = await setup();
    let calls = 0;
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      calls++;
      await new Promise((resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      return booked();
    }) as typeof fetch;
    const r = await bookConsult(req(), deps({ repo: m.repo, fetchImpl }));
    expect(calls).toBe(1);
    expect(r.body).toMatchObject({ booked: false, reason: expect.stringMatching(/confirming that booking/) });
    expect(m.bookings[0].status).toBe("pending");
  }, 5000);

  it("retries a create once after a 429", async () => {
    const m = await setup();
    let n = 0;
    const cal = mockCal({ book: () => (++n === 1 ? json({ error: { message: "slow down" } }, 429) : booked()) });
    const r = await bookConsult(req(), deps({ repo: m.repo, fetchImpl: cal.fetchImpl }));
    expect(r.body.booked).toBe(true);
    expect(n).toBe(2);
  });

  it("rejects a missing or past slot", async () => {
    const m = await setup();
    expect((await bookConsult(req({ slot_start_iso: "" }), deps({ repo: m.repo }))).body.booked).toBe(false);
    expect((await bookConsult(req({ slot_start_iso: "2026-10-01T03:30:00Z" }), deps({ repo: m.repo }))).body.booked).toBe(false);
  });
});
