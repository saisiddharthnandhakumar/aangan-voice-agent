import { describe, expect, it } from "vitest";
import { assess, canBook, computePriority, computeTier, estimateValue, reconcileTiers, type CriteriaResult } from "@/lib/rules";
import { ctx, FAKE_PRICING, input } from "../helpers";

const crit = (o: Partial<Record<keyof CriteriaResult, "pass" | "fail" | "unclear">> = {}): CriteriaResult => {
  const c = (s: "pass" | "fail" | "unclear" = "pass") => ({ status: s, evidence: null });
  return {
    real_project: c(o.real_project),
    service_area: c(o.service_area),
    timeline: c(o.timeline),
    budget: c(o.budget),
    decision_maker: c(o.decision_maker),
  };
};

describe("step 5: the tier", () => {
  it("non-enquiries have no tier", () => {
    expect(computeTier("vendor_or_sales", crit(), [])).toBeNull();
    expect(computeTier("existing_client_complaint", crit({ real_project: "fail" }), [])).toBeNull();
  });
  it.each(["real_project", "service_area", "timeline", "budget"] as const)("%s fail → Red", (c) => {
    expect(computeTier("enquiry", crit({ [c]: "fail" }), [])).toBe("red");
  });
  it("decision maker fail → Amber, not Red", () => {
    expect(computeTier("enquiry", crit({ decision_maker: "fail" }), [])).toBe("amber");
  });
  it.each(["real_project", "service_area", "timeline"] as const)("%s unclear → Amber", (c) => {
    expect(computeTier("enquiry", crit({ [c]: "unclear" }), [])).toBe("amber");
  });
  it("budget or decision maker unclear stays Green", () => {
    expect(computeTier("enquiry", crit({ budget: "unclear", decision_maker: "unclear" }), [])).toBe("green");
  });
  it.each([
    "structural_changes",
    "size_above_commercial_limit",
    "commercial_below_minimum",
    "small_residential",
    "unlisted_locality",
    "wants_human",
    "tier_conflict",
  ] as const)("forcing flag %s → Amber", (f) => {
    expect(computeTier("enquiry", crit(), [f])).toBe("amber");
  });
  it("info flags do not change the tier", () => {
    expect(computeTier("enquiry", crit(), ["budget_tight", "frustrated_repeat"])).toBe("green");
  });
  it("Red beats Amber (first rule wins)", () => {
    expect(computeTier("enquiry", crit({ service_area: "fail", timeline: "unclear" }), ["wants_human"])).toBe("red");
  });
  it("all pass → Green", () => {
    expect(computeTier("enquiry", crit(), [])).toBe("green");
  });
});

describe("Gemini second opinion", () => {
  it("agreement keeps the tier", () => {
    expect(reconcileTiers("red", "red")).toEqual({ tier: "red", conflict: false });
  });
  it("any disagreement is Amber with tier_conflict", () => {
    expect(reconcileTiers("red", "green")).toEqual({ tier: "amber", conflict: true });
    expect(reconcileTiers("green", "amber")).toEqual({ tier: "amber", conflict: true });
    expect(reconcileTiers(null, "green")).toEqual({ tier: "amber", conflict: true });
  });
  it("two non-enquiries stay untiered", () => {
    expect(reconcileTiers(null, null)).toEqual({ tier: null, conflict: false });
  });
});

describe("booking guard (rule 4)", () => {
  it("only Green can book", () => {
    expect(canBook("green")).toBe(true);
    for (const t of ["amber", "red", null, undefined] as const) expect(canBook(t)).toBe(false);
  });
});

describe("step 6: estimate and priority", () => {
  it("uses the midpoint of a volunteered budget", () => {
    expect(estimateValue(input({ volunteered_budget_low_inr: 1_000_000, volunteered_budget_high_inr: 2_000_000 }), FAKE_PRICING, 1)).toBe(1_500_000);
    expect(estimateValue(input({ volunteered_budget_high_inr: 900_000 }), FAKE_PRICING, 1)).toBe(900_000);
  });
  it("uses area × the residential estimate rate", () => {
    expect(estimateValue(input({ size_sqft: 1000 }), FAKE_PRICING, 1)).toBe(1_500_000);
  });
  it("uses BHK-assumed area when size is missing", () => {
    expect(estimateValue(input({ size_sqft: null, bhk: 3 }), FAKE_PRICING, 1)).toBe(1150 * 1500);
  });
  it("uses area × the commercial estimate rate", () => {
    expect(estimateValue(input({ project_type: "office", scope_type: "office", size_sqft: 2000 }), FAKE_PRICING, 1)).toBe(2_000_000);
  });
  it("uses rooms × the room estimate", () => {
    expect(estimateValue(input({ scope_type: "rooms", rooms_in_scope: 3 }), FAKE_PRICING, 1)).toBe(1_200_000);
  });
  it("falls back to the assumed deal value", () => {
    expect(estimateValue(input({ scope_type: "other", size_sqft: null, bhk: null }), FAKE_PRICING, 1_100_000)).toBe(1_100_000);
    expect(estimateValue(input(), null, 1_100_000)).toBe(1_100_000);
  });
  it("high priority at ₹40 lakh or for a frustrated repeat caller", () => {
    expect(computePriority(4_000_000, [])).toBe("high");
    expect(computePriority(3_999_999, [])).toBe("normal");
    expect(computePriority(100, ["frustrated_repeat"])).toBe("high");
  });
});

describe("step 4: computed flags via assess()", () => {
  const flagsOf = (o: Record<string, unknown>) => assess(input(o), ctx("2026-09-10 11:00")).flags;
  it("commercial size limits", () => {
    expect(flagsOf({ project_type: "office", scope_type: "office", size_sqft: 3200 })).toContain("size_above_commercial_limit");
    expect(flagsOf({ project_type: "office", scope_type: "office", size_sqft: 180 })).toContain("commercial_below_minimum");
    expect(flagsOf({ project_type: "office", scope_type: "office", size_sqft: 800 })).toEqual([]);
  });
  it("no size cap for homes", () => {
    expect(flagsOf({ size_sqft: 5500, bhk: null })).toEqual([]);
  });
  it("a 1BHK full home is small_residential; a 1BHK room job is not", () => {
    expect(flagsOf({ bhk: 1, size_sqft: 550 })).toContain("small_residential");
    expect(flagsOf({ bhk: 1, size_sqft: 550, scope_type: "rooms", rooms_in_scope: 1 })).not.toContain("small_residential");
  });
  it("passes through the agent's flags and ignores unknown ones", () => {
    expect(flagsOf({ flags: ["structural_changes", "wants_human", "made_up"] })).toEqual(["structural_changes", "wants_human"]);
  });
});
