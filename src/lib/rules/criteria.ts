import { RULES_CONFIG, SERVICE_AREA } from "./config";
import type { PricingConfig } from "./pricing";
import type { AssessmentInput, BudgetCheck, CriterionResult } from "./types";
import { daysUntil } from "./time";

/** Lowercase, strip punctuation, collapse spaces. */
export function normalisePlace(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPlace(haystack: string, place: string): boolean {
  return new RegExp(`(^|[\\s-])${place.replace(/[-\s]/g, "[\\s-]")}($|[\\s-])`).test(haystack);
}

export type ServiceAreaMatch = "excluded" | "listed" | "extended" | "generic" | "pincode" | "unlisted" | "unknown";

/** Classify a locality string against services.md and the extended list. */
export function classifyLocality(locality: string | null): ServiceAreaMatch {
  if (!locality) return "unknown";
  const n = normalisePlace(locality);
  if (!n) return "unknown";
  if (SERVICE_AREA.excluded.some((p) => containsPlace(n, p))) return "excluded";
  if (SERVICE_AREA.listed.some((p) => containsPlace(n, p))) return "listed";
  if (SERVICE_AREA.extended.some((p) => containsPlace(n, p))) return "extended";
  const pin = n.match(/\b(\d{6})\b/);
  if (pin) return pin[1].startsWith(SERVICE_AREA.punePincodePrefix) ? "pincode" : "unlisted";
  if ((SERVICE_AREA.generic as readonly string[]).includes(n)) return "generic";
  return "unlisted";
}

/**
 * Criterion 2. Code overrides the agent where the place is known: an excluded place fails and a
 * listed one passes. An unknown name keeps the agent's status; if the agent passed it, the lead
 * is flagged unlisted_locality (Amber).
 */
export function checkServiceArea(input: AssessmentInput): { result: CriterionResult; unlisted: boolean } {
  const agent = input.criteria.service_area;
  const match = classifyLocality(input.locality);
  switch (match) {
    case "excluded":
      return { result: { ...agent, status: "fail", override: agent.status === "fail" ? undefined : "outside Pune and PCMC" }, unlisted: false };
    case "listed":
    case "extended":
    case "pincode":
    case "generic":
      return { result: { ...agent, status: "pass", override: agent.status === "pass" ? undefined : "locality is in Pune or PCMC" }, unlisted: false };
    case "unlisted":
      return { result: agent, unlisted: agent.status === "pass" };
    default:
      return { result: agent, unlisted: false };
  }
}

const isCommercial = (input: AssessmentInput) =>
  (RULES_CONFIG.commercialProjectTypes as readonly string[]).includes(input.project_type) || input.scope_type === "office";

export { isCommercial };

/** Criterion 1. Retail, hospitality and gym projects fail whatever the agent recorded (services.md). */
export function checkRealProject(input: AssessmentInput): CriterionResult {
  const agent = input.criteria.real_project;
  if ((RULES_CONFIG.outOfScopeProjectTypes as readonly string[]).includes(input.project_type)) {
    return { ...agent, status: "fail", override: agent.status === "fail" ? undefined : `${input.project_type} projects are out of scope` };
  }
  return agent;
}

/**
 * Criterion 3 (PRD section 3, step 2). Where a completion date is known, code decides:
 * under 6 weeks fails, 6 to 10 weeks is unclear (Amber), 10 weeks or more passes. A possession
 * or site-ready date is never a deadline, so without a completion date the agent's status stands.
 */
export function checkTimeline(input: AssessmentInput, now: Date): CriterionResult & { weeks: number | null } {
  const agent = input.criteria.timeline;
  if (!input.completion_needed_by) return { ...agent, weeks: null };
  const weeks = daysUntil(input.completion_needed_by, now) / 7;
  const { failUnderWeeks, amberUnderWeeks } = RULES_CONFIG.timeline;
  const status = weeks < failUnderWeeks ? "fail" : weeks < amberUnderWeeks ? "unclear" : "pass";
  const label =
    status === "fail"
      ? `completion needed in under ${failUnderWeeks} weeks`
      : status === "unclear"
        ? `completion needed in ${failUnderWeeks} to ${amberUnderWeeks} weeks`
        : `completion not needed within ${amberUnderWeeks} weeks`;
  return { ...agent, status, weeks, override: status === agent.status ? undefined : label };
}

/** A voice model may say "1.5" meaning 1.5 lakh. */
export function normaliseBudget(v: number | null): number | null {
  if (v == null) return null;
  return v < RULES_CONFIG.budget.lakhInterpretationBelow ? v * 100_000 : v;
}

export function designedAreaSqft(input: AssessmentInput): number | null {
  if (input.size_sqft) return input.size_sqft;
  if (input.bhk) {
    const table = RULES_CONFIG.budget.assumedSqftByBhk;
    const key = Math.min(Math.max(Math.round(input.bhk), 1), 4);
    return table[key] ?? null;
  }
  return null;
}

/** Floor for the described scope (PRD section 3, step 3). Null when the scope is not known well enough. */
export function budgetFloor(input: AssessmentInput, pricing: PricingConfig): number | null {
  if (isCommercial(input)) {
    return input.size_sqft ? input.size_sqft * pricing.commercialFloorPerSqft : null;
  }
  if (input.scope_type === "rooms") {
    return input.rooms_in_scope ? input.rooms_in_scope * pricing.roomFloorInr : null;
  }
  if (input.scope_type === "full_home" || input.scope_type === "full_floor") {
    const area = designedAreaSqft(input);
    return area ? area * pricing.residentialFloorPerSqft : null;
  }
  return null;
}

/**
 * Criterion 4. Never asked: with no volunteered number it passes. Under 70% of the floor fails;
 * 70% to 100% passes with budget_tight. The backend always overrides the agent here (PRD 4, T1).
 */
export function checkBudget(input: AssessmentInput, pricing: PricingConfig | null): BudgetCheck {
  const low = normaliseBudget(input.volunteered_budget_low_inr);
  const high = normaliseBudget(input.volunteered_budget_high_inr);
  const top = high ?? low;
  if (top == null) return { topInr: null, floorInr: null, ratio: null, tight: false, status: "pass", note: null };
  if (!pricing) {
    return { topInr: top, floorInr: null, ratio: null, tight: false, status: "pass", note: "budget volunteered; pricing config missing, not checked" };
  }
  const floor = budgetFloor(input, pricing);
  if (!floor) {
    return { topInr: top, floorInr: null, ratio: null, tight: false, status: "pass", note: "budget volunteered; scope too vague to check" };
  }
  const ratio = top / floor;
  if (ratio < RULES_CONFIG.budget.failBelowRatio) {
    return { topInr: top, floorInr: floor, ratio, tight: false, status: "fail", note: "volunteered budget clearly below the scope" };
  }
  if (ratio < 1) {
    return { topInr: top, floorInr: floor, ratio, tight: true, status: "pass", note: "budget tight for the scope; designer to discuss" };
  }
  return { topInr: top, floorInr: floor, ratio, tight: false, status: "pass", note: null };
}
