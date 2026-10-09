import { RULES_CONFIG, WORDING } from "./config";
import { checkBudget, checkRealProject, checkServiceArea, checkTimeline, designedAreaSqft, isCommercial, normaliseBudget } from "./criteria";
import type { PricingConfig } from "./pricing";
import { callbackWhen, isWithinBusinessHours, type BusinessHours } from "./time";
import {
  FORCING_FLAGS,
  type Action,
  type AssessmentInput,
  type AssessmentResult,
  type CriteriaResult,
  type CriterionName,
  type Flag,
  type Tier,
} from "./types";

export interface AssessContext {
  now: Date;
  pricing: PricingConfig | null;
  hours: BusinessHours;
  assumedDealValueInr: number;
}

/** Flags computed from the facts (PRD section 3, step 4), plus the agent's own flags. */
export function computeFlags(input: AssessmentInput, unlistedLocality: boolean, budgetTight: boolean): Flag[] {
  const flags = new Set<Flag>(input.flags as Flag[]);
  if (isCommercial(input) && input.size_sqft) {
    if (input.size_sqft > RULES_CONFIG.commercial.maxSqft) flags.add("size_above_commercial_limit");
    if (input.size_sqft < RULES_CONFIG.commercial.minSqft) flags.add("commercial_below_minimum");
  }
  if (!isCommercial(input) && input.scope_type === "full_home" && input.bhk && input.bhk < RULES_CONFIG.residential.minFullHomeBhk) {
    flags.add("small_residential");
  }
  if (unlistedLocality) flags.add("unlisted_locality");
  if (budgetTight) flags.add("budget_tight");
  return [...flags];
}

/**
 * The tier (PRD section 3, step 5). First matching rule wins:
 * not an enquiry → none; any of 1–4 fails → Red; 5 fails, any of 1–3 unclear, or a forcing flag → Amber; else Green.
 */
export function computeTier(category: AssessmentInput["call_category"], criteria: CriteriaResult, flags: readonly Flag[]): Tier | null {
  if (category !== "enquiry") return null;
  const failed = (c: CriterionName) => criteria[c].status === "fail";
  if (failed("real_project") || failed("service_area") || failed("timeline") || failed("budget")) return "red";
  const unclear = (c: CriterionName) => criteria[c].status === "unclear";
  const forcing = flags.some((f) => (FORCING_FLAGS as readonly string[]).includes(f));
  if (failed("decision_maker") || unclear("real_project") || unclear("service_area") || unclear("timeline") || forcing) return "amber";
  return "green";
}

/**
 * Second opinion (P4): if the agent's tier and Gemini's tier differ, the lead is Amber with
 * tier_conflict, because a wrong Red sends no alert. Non-enquiry calls have no tier either way.
 */
export function reconcileTiers(agent: Tier | null, gemini: Tier | null): { tier: Tier | null; conflict: boolean } {
  if (agent === gemini) return { tier: agent, conflict: false };
  if (agent === null && gemini === null) return { tier: null, conflict: false };
  return { tier: "amber", conflict: true };
}

/** T3: book_consult refuses any call whose stored tier is not Green (rule 4). */
export function canBook(storedTier: Tier | null | undefined): boolean {
  return storedTier === "green";
}

/** Estimated project value (PRD section 3, step 6). Always labelled an estimate wherever it is shown. */
export function estimateValue(input: AssessmentInput, pricing: PricingConfig | null, assumedDealValueInr: number): number {
  const low = normaliseBudget(input.volunteered_budget_low_inr);
  const high = normaliseBudget(input.volunteered_budget_high_inr);
  if (low != null && high != null) return Math.round((low + high) / 2);
  if (low != null || high != null) return (low ?? high) as number;
  if (pricing) {
    if (isCommercial(input) && input.size_sqft) return Math.round(input.size_sqft * pricing.commercialEstimatePerSqft);
    if (input.scope_type === "rooms" && input.rooms_in_scope) return Math.round(input.rooms_in_scope * pricing.roomEstimateInr);
    if (!isCommercial(input) && (input.scope_type === "full_home" || input.scope_type === "full_floor")) {
      const area = designedAreaSqft(input);
      if (area) return Math.round(area * pricing.residentialEstimatePerSqft);
    }
  }
  return assumedDealValueInr;
}

export function computePriority(estimatedValueInr: number, flags: readonly Flag[]): "high" | "normal" {
  return estimatedValueInr >= RULES_CONFIG.priority.highValueInr || flags.includes("frustrated_repeat") ? "high" : "normal";
}

function sayReasonFor(criteria: CriteriaResult): string | null {
  const order: Array<keyof typeof WORDING.sayReason> = ["service_area", "real_project", "timeline", "budget"];
  const reasons = order.filter((c) => criteria[c].status === "fail").map((c) => WORDING.sayReason[c]);
  return reasons.length ? reasons.join(" ") : null;
}

function reasonList(criteria: CriteriaResult, flags: readonly Flag[], budgetNote: string | null): string[] {
  const out: string[] = [];
  for (const [name, c] of Object.entries(criteria)) {
    if (c.status !== "pass") out.push(`${name.replace("_", " ")}: ${c.status}${c.override ? ` (${c.override})` : ""}`);
    else if (c.override) out.push(`${name.replace("_", " ")}: pass (${c.override})`);
  }
  for (const f of flags) out.push(`flag: ${f}`);
  if (budgetNote) out.push(budgetNote);
  if (out.length === 0) out.push("all five criteria pass");
  return out;
}

/** Run the PRD section 3 rules on a submit_assessment body. Pure: no I/O. */
export function assess(input: AssessmentInput, ctx: AssessContext): AssessmentResult {
  const calledAfterHours = !isWithinBusinessHours(ctx.now, ctx.hours);
  const callback = callbackWhen(ctx.now, ctx.hours);
  const callbackPhrase = callback.withinHour ? WORDING.callbackWithinHour : WORDING.callbackLater(callback.when);

  const area = checkServiceArea(input);
  const timeline = checkTimeline(input, ctx.now);
  const budget = checkBudget(input, ctx.pricing);
  const criteria: CriteriaResult = {
    real_project: checkRealProject(input),
    service_area: area.result,
    timeline: { status: timeline.status, evidence: timeline.evidence, override: timeline.override },
    budget: {
      status: budget.status,
      evidence: input.criteria.budget.evidence,
      override: budget.status !== input.criteria.budget.status ? budget.note ?? "no budget volunteered" : undefined,
    },
    decision_maker: input.criteria.decision_maker,
  };

  const base = { criteria, budget, called_after_hours: calledAfterHours };

  // Step 1: categories other than enquiry get no tier.
  if (input.call_category !== "enquiry") {
    const action: Action =
      input.call_category === "existing_client_complaint"
        ? "escalate"
        : input.call_category === "existing_client"
          ? "callback"
          : "close_non_enquiry";
    const phrase =
      action === "escalate" ? WORDING.escalate : action === "callback" ? WORDING.existingClientCallback : WORDING.closeNonEnquiry;
    return {
      ...base,
      tier: null,
      action,
      callback_phrase: phrase,
      say_reason: null,
      reasons: [`category: ${input.call_category}`],
      flags: input.flags.includes("wants_human") ? ["wants_human"] : [],
      estimated_value_inr: null,
      priority: input.flags.includes("frustrated_repeat") ? "high" : null,
    };
  }

  const flags = computeFlags(input, area.unlisted, budget.tight);
  const tier = computeTier(input.call_category, criteria, flags) as Tier;
  const estimated = estimateValue(input, ctx.pricing, ctx.assumedDealValueInr);
  const priority = computePriority(estimated, flags);
  const reasons = reasonList(criteria, flags, budget.note);

  let action: Action;
  let sayReason: string | null = null;
  let phrase: string | null = null;
  if (tier === "green") {
    action = "offer_booking";
  } else if (tier === "amber") {
    action = "callback";
    phrase = callbackPhrase;
  } else {
    sayReason = sayReasonFor(criteria);
    // V8 / AT3: when timing is the only failure, the agent must first ask whether the date can move.
    const onlyTimeline =
      criteria.timeline.status === "fail" &&
      (["real_project", "service_area", "budget"] as const).every((c) => criteria[c].status !== "fail");
    if (onlyTimeline && !input.timeline_move_asked) {
      action = "ask_date_move";
      sayReason = WORDING.dateMovePrompt;
    } else {
      action = "decline";
      phrase = WORDING.declineLine;
    }
  }

  return {
    ...base,
    tier,
    action,
    callback_phrase: phrase,
    say_reason: sayReason,
    reasons,
    flags,
    estimated_value_inr: estimated,
    priority,
  };
}
