import { describe, expect, it } from "vitest";
import { checkBudget, checkRealProject, checkServiceArea, checkTimeline, classifyLocality, normaliseBudget } from "@/lib/rules";
import { FAKE_PRICING, input, ist } from "../helpers";

describe("criterion 1: real project", () => {
  it("keeps the agent's status for homes", () => {
    expect(checkRealProject(input({ criteria: { real_project: { status: "unclear", evidence: "x" } } })).status).toBe("unclear");
  });
  it.each(["retail", "hospitality", "gym"])("fails %s whatever the agent said", (project_type) => {
    const r = checkRealProject(input({ project_type }));
    expect(r.status).toBe("fail");
    expect(r.override).toMatch(/out of scope/);
  });
});

describe("criterion 2: service area", () => {
  it.each([
    ["Dahanukar Colony, Kothrud", "listed"],
    ["Pimple Saudagar", "listed"],
    ["Kharadi", "extended"],
    ["Nanded City", "extended"],
    ["Pune", "generic"],
    ["411038", "pincode"],
    ["Talegaon Dabhade, near Pune", "excluded"],
    ["Nashik", "excluded"],
    ["Lonavala", "excluded"],
    ["Chakan", "unlisted"],
    ["412105", "unlisted"],
    [null, "unknown"],
  ])("%s → %s", (loc, expected) => {
    expect(classifyLocality(loc)).toBe(expected);
  });

  it("does not match a place inside another word", () => {
    expect(classifyLocality("Susmita Apartments")).toBe("unlisted");
  });

  it("fails an excluded place even if the agent passed it", () => {
    const r = checkServiceArea(input({ locality: "Talegaon" }));
    expect(r.result.status).toBe("fail");
    expect(r.unlisted).toBe(false);
  });

  it("passes a listed place even if the agent was unsure", () => {
    const r = checkServiceArea(input({ locality: "Baner", criteria: { service_area: { status: "unclear", evidence: "" } } }));
    expect(r.result.status).toBe("pass");
  });

  it("flags an unknown name the agent passed", () => {
    const r = checkServiceArea(input({ locality: "Chakan" }));
    expect(r.result.status).toBe("pass");
    expect(r.unlisted).toBe(true);
  });

  it("keeps unclear when no locality was given", () => {
    const r = checkServiceArea(input({ locality: null, criteria: { service_area: { status: "unclear", evidence: "" } } }));
    expect(r.result.status).toBe("unclear");
    expect(r.unlisted).toBe(false);
  });
});

describe("criterion 3: timeline", () => {
  const now = ist("2026-09-03 14:41");
  const at = (completion_needed_by: string | null, status = "pass") =>
    checkTimeline(input({ completion_needed_by, criteria: { timeline: { status, evidence: "" } } }), now);

  it("fails under 6 weeks", () => {
    expect(at("2026-09-24").status).toBe("fail");
    expect(at("2026-10-14").status).toBe("fail"); // 41 days
  });
  it("is unclear (Amber) from 6 to under 10 weeks", () => {
    expect(at("2026-10-15").status).toBe("unclear"); // 42 days = 6 weeks
    expect(at("2026-11-01").status).toBe("unclear"); // T02: November ≈ 8.4 weeks
    expect(at("2026-11-11").status).toBe("unclear"); // 69 days
  });
  it("passes at 10 weeks or more", () => {
    expect(at("2026-11-12").status).toBe("pass"); // 70 days
    expect(at("2027-03-01").status).toBe("pass");
  });
  it("overrides the agent when a date is known", () => {
    expect(at("2027-03-01", "unclear").status).toBe("pass");
    expect(at("2026-09-24", "pass").override).toMatch(/under 6 weeks/);
  });
  it("keeps the agent's status without a completion date (possession is not a deadline)", () => {
    expect(at(null, "pass").status).toBe("pass");
    expect(at(null, "unclear").status).toBe("unclear");
  });
  it("uses the IST calendar date", () => {
    // 23:30 IST on 3 Sep is still 3 Sep in India, though already 18:00 UTC.
    const late = checkTimeline(input({ completion_needed_by: "2026-10-15" }), ist("2026-09-03 23:30"));
    expect(late.status).toBe("unclear");
  });
});

describe("criterion 4: budget", () => {
  it("passes when no budget was volunteered, whatever the agent said", () => {
    const b = checkBudget(input({ criteria: { budget: { status: "fail", evidence: "" } } }), FAKE_PRICING);
    expect(b.status).toBe("pass");
    expect(b.topInr).toBeNull();
  });

  it("uses size for a full home: under 70% of the floor fails", () => {
    // 1,200 sq ft × 1,000 = 12,00,000 floor; 8,00,000 is 67%.
    const b = checkBudget(input({ volunteered_budget_high_inr: 800_000 }), FAKE_PRICING);
    expect(b.status).toBe("fail");
  });

  it("70% to 100% passes with budget_tight", () => {
    const b = checkBudget(input({ volunteered_budget_low_inr: 700_000, volunteered_budget_high_inr: 840_000 }), FAKE_PRICING);
    expect(b).toMatchObject({ status: "pass", tight: true });
    expect(b.ratio).toBeCloseTo(0.7);
  });

  it("at or above the floor passes without a note", () => {
    expect(checkBudget(input({ volunteered_budget_high_inr: 1_200_000 }), FAKE_PRICING)).toMatchObject({ status: "pass", tight: false, note: null });
  });

  it("compares the top of the range", () => {
    expect(checkBudget(input({ volunteered_budget_low_inr: 100_000, volunteered_budget_high_inr: 1_300_000 }), FAKE_PRICING).status).toBe("pass");
    expect(checkBudget(input({ volunteered_budget_low_inr: 1_300_000 }), FAKE_PRICING).status).toBe("pass");
  });

  it("assumes carpet area from BHK when size is missing", () => {
    // 2BHK → 900 sq ft × 1,000 = 9,00,000 floor.
    const b = checkBudget(input({ size_sqft: null, bhk: 2, volunteered_budget_high_inr: 600_000 }), FAKE_PRICING);
    expect(b.floorInr).toBe(900_000);
    expect(b.status).toBe("fail");
  });

  it("uses rooms × the room floor; a kitchen counts as a room", () => {
    const b = checkBudget(input({ scope_type: "rooms", rooms_in_scope: 2, volunteered_budget_high_inr: 150_000 }), FAKE_PRICING);
    expect(b.floorInr).toBe(400_000);
    expect(b.status).toBe("fail");
  });

  it("uses the commercial floor for offices", () => {
    const b = checkBudget(input({ project_type: "office", scope_type: "office", size_sqft: 1000, volunteered_budget_high_inr: 600_000 }), FAKE_PRICING);
    expect(b.floorInr).toBe(800_000);
    expect(b).toMatchObject({ status: "pass", tight: true });
  });

  it("passes with a note when the scope is too vague to check", () => {
    const b = checkBudget(input({ scope_type: "rooms", rooms_in_scope: null, volunteered_budget_high_inr: 100_000 }), FAKE_PRICING);
    expect(b.status).toBe("pass");
    expect(b.note).toMatch(/too vague/);
  });

  it("passes with a note when the pricing config is missing", () => {
    expect(checkBudget(input({ volunteered_budget_high_inr: 1 }), null).note).toMatch(/pricing config missing/);
  });

  it("reads small numbers as lakh", () => {
    expect(normaliseBudget(1.5)).toBe(150_000);
    expect(normaliseBudget(150_000)).toBe(150_000);
  });

  it("never puts a figure in its note", () => {
    for (const b of [800_000, 840_000, 1_200_000]) {
      const note = checkBudget(input({ volunteered_budget_high_inr: b }), FAKE_PRICING).note ?? "";
      expect(note).not.toMatch(/\d/);
    }
  });
});
