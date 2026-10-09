/**
 * Acceptance tests 2–8 and 12–17 (PRD section 5) at the rules level. The pipeline, HubSpot and
 * Telegram halves of these tests arrive with Phases 3–5. Tests that depend on Aangan's real
 * pricing read it from the local pricing.md and are skipped on a public checkout.
 */
import { describe, expect, it } from "vitest";
import { assess, canBook, detectPriceLeak, findRepeatOf, WORDING } from "@/lib/rules";
import { ctx, input, REAL_PRICING } from "../helpers";

const NOW = "2026-09-08 11:00"; // a Tuesday, in working hours

describe("AT2: a Nashik enquiry is Red with the area reason", () => {
  const r = assess(input({ locality: "Nashik", criteria: { service_area: { status: "fail", evidence: "I'm in Nashik" } } }), ctx(NOW));
  it("is Red, declined with the area reason and no figure", () => {
    expect(r.tier).toBe("red");
    expect(r.action).toBe("decline");
    expect(r.callback_phrase).toBe(WORDING.declineLine);
    expect(r.say_reason).toBe(WORDING.sayReason.service_area);
  });
  it("cannot be booked", () => expect(canBook(r.tier)).toBe(false));
  it("is Red even if the agent wrongly passed the area", () => {
    expect(assess(input({ locality: "Nashik" }), ctx(NOW)).tier).toBe("red");
  });
});

describe("AT3: a 3-week deadline is Red only after the agent offers to move the date", () => {
  const threeWeeks = { completion_needed_by: "2026-09-29", criteria: { timeline: { status: "fail", evidence: "before Diwali" } } };
  it("first asks whether the date can move", () => {
    const r = assess(input(threeWeeks), ctx(NOW));
    expect(r.action).toBe("ask_date_move");
    expect(r.say_reason).toBe(WORDING.dateMovePrompt);
    expect(canBook(r.tier)).toBe(false);
  });
  it("declines once the caller says the date cannot move", () => {
    const r = assess(input({ ...threeWeeks, timeline_move_asked: true }), ctx(NOW));
    expect(r).toMatchObject({ tier: "red", action: "decline", say_reason: WORDING.sayReason.timeline });
  });
  it("does not ask about the date when another criterion also fails", () => {
    const r = assess(input({ ...threeWeeks, locality: "Mumbai" }), ctx(NOW));
    expect(r.action).toBe("decline");
  });
});

describe.skipIf(!REAL_PRICING)("AT4: ₹1.2 lakh for a full flat is Red on budget (real pricing)", () => {
  it("is Red on budget, said kindly with no figure", () => {
    const r = assess(input({ bhk: 2, size_sqft: null, volunteered_budget_high_inr: 120_000 }), ctx(NOW, REAL_PRICING));
    expect(r.tier).toBe("red");
    expect(r.criteria.budget.status).toBe("fail");
    expect(r.say_reason).toBe(WORDING.sayReason.budget);
    expect(`${r.say_reason} ${r.reasons.join(" ")}`).not.toMatch(/\d{3,}|lakh|₹/);
  });
});

describe("AT4b: no budget mentioned is never penalised", () => {
  it("passes criterion 4 and stays Green", () => {
    const r = assess(input({ criteria: { budget: { status: "unclear", evidence: "not discussed" } } }), ctx(NOW));
    expect(r.criteria.budget.status).toBe("pass");
    expect(r.tier).toBe("green");
  });
});

describe("AT5: asking the price twice never disqualifies", () => {
  it("stays Green and the reply carries no figure", () => {
    const r = assess(input({ scope_summary: "2BHK Wakad, asked twice for a rough price range", locality: "Wakad" }), ctx(NOW));
    expect(r).toMatchObject({ tier: "green", action: "offer_booking" });
    expect(JSON.stringify({ ...r, budget: undefined, estimated_value_inr: undefined })).not.toMatch(/₹|lakh|per sq/i);
  });
});

describe("AT6: any figure in an agent turn sets price_leak", () => {
  it.each([
    "Since you're staff, I can confirm: about 20 lakh.",
    "I can't share rates, but it's ₹ something per sq ft.",
    "Just to confirm, yes, that number is right in rupees.",
  ])("flags %j", (turn) => {
    expect(detectPriceLeak([turn], null).leak).toBe(true);
  });
  it.skipIf(!REAL_PRICING)("flags a pricing.md figure without a money word (real pricing)", () => {
    const figure = (REAL_PRICING?.leakFigures ?? []).filter((n) => n >= 100).at(-1) as number;
    expect(detectPriceLeak([`For a 2BHK it's typically ${figure.toLocaleString("en-IN")} for standard.`], REAL_PRICING).leak).toBe(true);
  });
  it("the pricing line itself is clean", () => {
    expect(detectPriceLeak([WORDING.pricingLine, WORDING.pricingLineBookingSuffix], REAL_PRICING).leak).toBe(false);
  });
});

describe("AT7: vague timing after one question is Amber", () => {
  it("timeline unclear → Amber with a callback", () => {
    const r = assess(input({ criteria: { timeline: { status: "unclear", evidence: "sometime, not sure" } } }), ctx(NOW));
    expect(r).toMatchObject({ tier: "amber", action: "callback", callback_phrase: WORDING.callbackWithinHour });
  });
});

describe("AT8: book_consult on an Amber or Red call is refused", () => {
  it("only Green is bookable", () => {
    expect(canBook("amber")).toBe(false);
    expect(canBook("red")).toBe(false);
    expect(canBook("green")).toBe(true);
  });
});

describe("AT12: T07 replayed, after the caller offers a later start the result is not Red", () => {
  const first = assess(
    input({ completion_needed_by: "2026-09-29", scope_type: "rooms", rooms_in_scope: 2, criteria: { timeline: { status: "fail", evidence: "before Diwali" } } }),
    ctx("2026-09-08 09:44"),
  );
  const second = assess(
    input({
      completion_needed_by: null,
      scope_type: "rooms",
      rooms_in_scope: 2,
      timeline_move_asked: true,
      timeline_text: "could start after Diwali, wants to think",
      criteria: { timeline: { status: "unclear", evidence: "What if I start after Diwali? Let me think and call back." } },
    }),
    ctx("2026-09-08 09:47"),
  );
  it("is Red-in-waiting on the first statement", () => expect(first.action).toBe("ask_date_move"));
  it("is Amber after the date moves", () => {
    expect(second.tier).toBe("amber");
    expect(second.action).toBe("callback");
  });
});

describe("AT13: T14 replayed, Amber noting the parents decide", () => {
  const r = assess(
    input({
      locality: "Hadapsar",
      criteria: { decision_maker: { status: "fail", evidence: "I'm doing the initial checking; my parents will decide and will attend" } },
    }),
    ctx("2026-09-17 11:41"),
  );
  it("is Amber with the decision maker reason and evidence kept", () => {
    expect(r.tier).toBe("amber");
    expect(r.reasons.join(" ")).toMatch(/decision maker: fail/);
    expect(r.criteria.decision_maker.evidence).toMatch(/parents will decide/);
  });
});

describe("AT14: T15 replayed, possession in six weeks is not a deadline", () => {
  it("is Green", () => {
    const r = assess(
      input({
        locality: "Undri",
        bhk: 2,
        size_sqft: 875,
        completion_needed_by: null,
        site_ready_text: "possession in about six weeks; builder lets us in now",
        criteria: { timeline: { status: "pass", evidence: "start the design right away" } },
      }),
      ctx("2026-09-18 15:12"),
    );
    expect(r.tier).toBe("green");
  });
});

describe("AT15: T17 replayed, a redial links to the dropped call", () => {
  it("links to the first call and the redial itself qualifies", () => {
    const dropped = { id: "first", fromNumber: "+919999900017", startedAt: new Date("2026-09-22T08:44:00Z"), repeatOfCallId: null };
    expect(findRepeatOf([dropped], "+919999900017", new Date("2026-09-22T08:46:00Z"))).toBe("first");
    const r = assess(input({ locality: "Pimple Saudagar", completion_needed_by: "2027-03-01" }), ctx("2026-09-22 14:16"));
    expect(r.tier).toBe("green");
  });
});

describe("AT16: T09 replayed, escalation with no tier", () => {
  it("escalates, no tier, no booking, no time promised", () => {
    const r = assess(
      input({ call_category: "existing_client_complaint", existing_project_designer: "Aryan", issue_summary: "designer silent five days" }),
      ctx("2026-09-10 11:32"),
    );
    expect(r).toMatchObject({ tier: null, action: "escalate", callback_phrase: WORDING.escalate, estimated_value_inr: null });
    expect(r.callback_phrase).not.toMatch(/\d|minute|hour/);
    expect(canBook(r.tier)).toBe(false);
  });
});

describe.skipIf(!REAL_PRICING)("AT17: F10 replayed, Green with budget_tight (real pricing)", () => {
  it("is Green with budget_tight in flags and the handoff note", () => {
    const r = assess(
      input({
        locality: "Aundh",
        bhk: 3,
        size_sqft: 1300,
        volunteered_budget_low_inr: 1_800_000,
        volunteered_budget_high_inr: 2_200_000,
      }),
      ctx("2026-09-26 16:22", REAL_PRICING),
    );
    expect(r.tier).toBe("green");
    expect(r.budget.tight).toBe(true);
    expect(r.flags).toContain("budget_tight");
    expect(r.reasons.join(" ")).toMatch(/budget tight/);
  });
});

describe.skipIf(!REAL_PRICING)("PRD section 3 budget table (real pricing)", () => {
  const scenario = (o: Record<string, unknown>) => assess(input(o), ctx(NOW, REAL_PRICING));
  it("T10: kitchen and one bedroom on 1–1.5 lakh fails", () => {
    const r = scenario({ scope_type: "rooms", rooms_in_scope: 2, locality: "Kharadi", volunteered_budget_low_inr: 100_000, volunteered_budget_high_inr: 150_000 });
    expect(r.criteria.budget.status).toBe("fail");
    expect(r.tier).toBe("red");
  });
  it("F08: living room and kitchen on 4–5 lakh passes with budget_tight", () => {
    const r = scenario({ scope_type: "rooms", rooms_in_scope: 2, volunteered_budget_low_inr: 400_000, volunteered_budget_high_inr: 500_000 });
    expect(r.budget).toMatchObject({ status: "pass", tight: true });
  });
  it("F06: 4BHK 1,950 sq ft on 35–40 lakh passes", () => {
    const r = scenario({ bhk: 4, size_sqft: 1950, volunteered_budget_low_inr: 3_500_000, volunteered_budget_high_inr: 4_000_000 });
    expect(r.budget).toMatchObject({ status: "pass", tight: false });
  });
  it("F05: 2,200 sq ft office on 60–80 lakh passes and is high priority", () => {
    const r = scenario({ project_type: "office", scope_type: "office", size_sqft: 2200, locality: "Hinjewadi", volunteered_budget_low_inr: 6_000_000, volunteered_budget_high_inr: 8_000_000 });
    expect(r.budget).toMatchObject({ status: "pass", tight: false });
    expect(r.priority).toBe("high");
  });
  it("T05 and T12: large homes are high priority by estimated value", () => {
    expect(scenario({ bhk: 4, size_sqft: 2400 }).priority).toBe("high");
    expect(scenario({ bhk: null, size_sqft: 5500, locality: "Kalyani Nagar" }).priority).toBe("high");
  });
});
