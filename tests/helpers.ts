import { existsSync, readFileSync } from "node:fs";
import { assessmentInputSchema, derivePricingConfig, type AssessContext, type AssessmentInput, type PricingConfig } from "@/lib/rules";

/**
 * Synthetic pricing for unit tests. Deliberately NOT Aangan's figures (the repo is public):
 * round numbers that make the arithmetic easy to read.
 */
export const FAKE_PRICING: PricingConfig = {
  residentialFloorPerSqft: 1000,
  commercialFloorPerSqft: 800,
  roomFloorInr: 200_000,
  residentialEstimatePerSqft: 1500,
  commercialEstimatePerSqft: 1000,
  roomEstimateInr: 400_000,
  leakFigures: [800, 1000, 1500, 2000],
};

/** Aangan's real pricing, read from the local (gitignored) pricing.md. Null on a public checkout. */
export const REAL_PRICING: PricingConfig | null = existsSync("docs/source/pricing.md")
  ? derivePricingConfig(readFileSync("docs/source/pricing.md", "utf8"))
  : null;

export const HOURS = { start: "10:00", end: "19:00", days: ["mon", "tue", "wed", "thu", "fri", "sat"] };

/** IST wall-clock → Date. "2026-09-02 10:23" */
export const ist = (s: string) => new Date(`${s.replace(" ", "T")}:00+05:30`);

export function ctx(now: string, pricing: PricingConfig | null = FAKE_PRICING): AssessContext {
  return { now: ist(now), pricing, hours: HOURS, assumedDealValueInr: 1_100_000 };
}

const PASS = (evidence = "test") => ({ status: "pass" as const, evidence });

/** A clean Green enquiry; override what a test needs. */
export function input(overrides: Record<string, unknown> = {}): AssessmentInput {
  const { criteria, ...rest } = overrides as { criteria?: Record<string, unknown> };
  return assessmentInputSchema.parse({
    call_id: "test-call",
    call_category: "enquiry",
    caller_name: "Test",
    phone: "+919999900001",
    project_type: "home",
    scope_type: "full_home",
    bhk: 3,
    size_sqft: 1200,
    locality: "Kothrud",
    scope_summary: "Full home redesign",
    completion_needed_by: null,
    criteria: {
      real_project: PASS(),
      service_area: PASS(),
      timeline: PASS("no rush"),
      budget: PASS("not mentioned"),
      decision_maker: PASS(),
      ...criteria,
    },
    ...rest,
  });
}
