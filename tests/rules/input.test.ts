import { describe, expect, it } from "vitest";
import { assessmentInputSchema } from "@/lib/rules";

describe("submit_assessment input (lenient for a voice model)", () => {
  it("fills defaults for an almost empty body", () => {
    const r = assessmentInputSchema.parse({ call_id: "x" });
    expect(r.call_category).toBe("enquiry");
    expect(r.criteria.timeline.status).toBe("unclear");
    expect(r.flags).toEqual([]);
    expect(r.timeline_move_asked).toBe(false);
  });
  it("coerces numbers, nulls and enum case", () => {
    const r = assessmentInputSchema.parse({
      call_id: 42,
      call_category: "ENQUIRY",
      project_type: "Home",
      size_sqft: "1,400",
      bhk: "3",
      volunteered_budget_high_inr: "₹ 20,00,000",
      locality: "null",
      completion_needed_by: "2027-03-01T00:00:00Z",
      criteria: { budget: { status: "PASS", evidence: "" } },
      timeline_move_asked: "true",
    });
    expect(r).toMatchObject({
      call_id: "42",
      call_category: "enquiry",
      project_type: "home",
      size_sqft: 1400,
      bhk: 3,
      volunteered_budget_high_inr: 2_000_000,
      locality: null,
      completion_needed_by: "2027-03-01",
      timeline_move_asked: true,
    });
    expect(r.criteria.budget.status).toBe("pass");
  });
  it("maps unknown values to safe fallbacks", () => {
    const r = assessmentInputSchema.parse({
      call_id: "x",
      call_category: "spam",
      project_type: "spaceship",
      completion_needed_by: "March",
      criteria: { timeline: { status: "maybe" } },
      flags: ["WANTS_HUMAN", "not_a_flag"],
    });
    expect(r.call_category).toBe("other");
    expect(r.project_type).toBe("other");
    expect(r.completion_needed_by).toBeNull();
    expect(r.criteria.timeline.status).toBe("unclear");
    expect(r.flags).toEqual(["wants_human"]);
  });
});

describe("flat criteria fields (Vaani tool form)", () => {
  it("builds criteria from *_status / *_evidence and reads flags as text", () => {
    const r = assessmentInputSchema.parse({
      call_id: "x",
      real_project_status: "pass",
      real_project_evidence: "redo everything",
      service_area_status: "PASS",
      timeline_status: "unclear",
      decision_maker_status: "fail",
      decision_maker_evidence: "parents decide",
      flags: "wants_human, frustrated_repeat",
    });
    expect(r.criteria.real_project).toEqual({ status: "pass", evidence: "redo everything" });
    expect(r.criteria.service_area.status).toBe("pass");
    expect(r.criteria.timeline.status).toBe("unclear");
    expect(r.criteria.budget.status).toBe("unclear");
    expect(r.criteria.decision_maker).toEqual({ status: "fail", evidence: "parents decide" });
    expect(r.flags).toEqual(["wants_human", "frustrated_repeat"]);
    expect(r).not.toHaveProperty("real_project_status");
  });
  it("accepts criteria as a JSON string or bare status strings", () => {
    const a = assessmentInputSchema.parse({ call_id: "x", criteria: '{"timeline":{"status":"fail","evidence":"3 weeks"}}' });
    expect(a.criteria.timeline).toEqual({ status: "fail", evidence: "3 weeks" });
    const b = assessmentInputSchema.parse({ call_id: "x", criteria: { real_project: "pass" } });
    expect(b.criteria.real_project.status).toBe("pass");
  });
  it("an empty flags string means no flags", () => {
    expect(assessmentInputSchema.parse({ call_id: "x", flags: "" }).flags).toEqual([]);
  });
});
