import { describe, expect, it } from "vitest";
import { assess, callbackWhen, isWithinBusinessHours, WORDING } from "@/lib/rules";
import { ctx, HOURS, input, ist } from "../helpers";

describe("business hours and callback wording (IST)", () => {
  it.each([
    ["2026-10-12 11:00", true, "within the hour"], // Monday
    ["2026-10-12 18:30", false, "tomorrow morning"], // under an hour left
    ["2026-10-12 21:00", false, "tomorrow morning"],
    ["2026-10-13 07:00", false, "later this morning"], // Tuesday early
    ["2026-10-17 20:00", false, "on Monday morning"], // Saturday night
    ["2026-10-18 12:00", false, "tomorrow morning"], // Sunday noon → Monday
  ])("%s → %s", (when, within, phrase) => {
    const r = callbackWhen(ist(when), HOURS);
    expect(r).toEqual({ withinHour: within, when: phrase });
  });

  it("after-hours flag", () => {
    expect(isWithinBusinessHours(ist("2026-10-12 10:00"), HOURS)).toBe(true);
    expect(isWithinBusinessHours(ist("2026-10-12 19:00"), HOURS)).toBe(false);
    expect(isWithinBusinessHours(ist("2026-10-11 12:00"), HOURS)).toBe(false); // Sunday
  });

  it("Amber gets the callback phrase", () => {
    const r = assess(input({ criteria: { timeline: { status: "unclear", evidence: "" } } }), ctx("2026-10-12 21:00"));
    expect(r.action).toBe("callback");
    expect(r.callback_phrase).toBe("A designer will call you back tomorrow morning.");
  });
});

describe("nothing spoken contains a figure", () => {
  it("fixed wording has no digits or money words", () => {
    const all = [
      WORDING.pricingLine,
      WORDING.pricingLineBookingSuffix,
      WORDING.declineLine,
      WORDING.callbackWithinHour,
      WORDING.escalate,
      WORDING.existingClientCallback,
      WORDING.dateMovePrompt,
      ...Object.values(WORDING.sayReason),
    ].join(" ");
    expect(all).not.toMatch(/\d|₹|lakh|rupee|per sq/i);
  });

  it("say_reason and reasons never carry a figure, even on a budget decline", () => {
    const r = assess(input({ volunteered_budget_high_inr: 150_000 }), ctx("2026-09-11 14:04"));
    expect(r.tier).toBe("red");
    expect(r.say_reason).toBe(WORDING.sayReason.budget);
    for (const s of [r.say_reason ?? "", ...r.reasons]) expect(s).not.toMatch(/₹|lakh|\d{4,}/);
  });
});
