import { z } from "zod";

/**
 * submit_assessment body (PRD section 4, T1), the contract with the Vaani system prompt.
 * Lenient on purpose: a voice model may send numbers as strings, "null" as text or omit
 * fields, and a malformed call must still get a speakable answer, not a 400.
 */

export const CALL_CATEGORIES = [
  "enquiry",
  "existing_client",
  "existing_client_complaint",
  "vendor_or_sales",
  "job_seeker",
  "wrong_number",
  "other",
] as const;
export const PROJECT_TYPES = ["home", "office", "clinic", "studio", "retail", "hospitality", "gym", "other"] as const;
export const SCOPE_TYPES = ["full_home", "full_floor", "rooms", "office", "other"] as const;
export const CRITERION_STATUSES = ["pass", "fail", "unclear"] as const;
export const CRITERIA = ["real_project", "service_area", "timeline", "budget", "decision_maker"] as const;

/** Flags the agent may send. The backend adds the computed ones (see ./flags.ts). */
export const AGENT_FLAGS = ["structural_changes", "wants_human", "frustrated_repeat"] as const;
export const FORCING_FLAGS = [
  "structural_changes",
  "size_above_commercial_limit",
  "commercial_below_minimum",
  "small_residential",
  "unlisted_locality",
  "wants_human",
  "tier_conflict",
] as const;
/** Flags that never change the tier. frustrated_repeat raises priority only (proposal e5). */
export const INFO_FLAGS = ["frustrated_repeat", "budget_tight"] as const;

export type CallCategory = (typeof CALL_CATEGORIES)[number];
export type ProjectType = (typeof PROJECT_TYPES)[number];
export type ScopeType = (typeof SCOPE_TYPES)[number];
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];
export type CriterionName = (typeof CRITERIA)[number];
export type Flag = (typeof FORCING_FLAGS)[number] | (typeof INFO_FLAGS)[number];
export type Tier = "green" | "amber" | "red";
export type Action = "offer_booking" | "callback" | "decline" | "escalate" | "close_non_enquiry" | "ask_date_move";

const nullish = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && ["", "null", "none", "n/a", "unknown"].includes(v.trim().toLowerCase()));

const text = z.preprocess((v) => (nullish(v) ? null : typeof v === "string" ? v.trim() : String(v)), z.string().nullable()).default(null);

const num = z
  .preprocess((v) => {
    if (nullish(v)) return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,₹\s]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, z.number().nullable())
  .default(null);

const isoDate = z
  .preprocess((v) => {
    if (nullish(v)) return null;
    const s = String(v).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null;
  }, z.string().nullable())
  .default(null);

const enumOr = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.preprocess((v) => {
    const s = typeof v === "string" ? v.trim().toLowerCase() : v;
    return (values as readonly unknown[]).includes(s) ? s : fallback;
  }, z.enum(values));

const criterion = z
  .preprocess((v) => (typeof v === "string" ? { status: v, evidence: null } : v), z.object({
    status: enumOr(CRITERION_STATUSES, "unclear"),
    evidence: text,
  }))
  .default({ status: "unclear", evidence: null });

export const assessmentInputObject = z.object({
  call_id: z.preprocess((v) => (v == null ? "" : String(v).trim()), z.string()),
  call_category: enumOr(CALL_CATEGORIES, "other").default("enquiry"),
  caller_name: text,
  phone: text,
  project_type: enumOr(PROJECT_TYPES, "other").default("other"),
  scope_type: enumOr(SCOPE_TYPES, "other").default("other"),
  rooms_in_scope: num,
  property_detail: text,
  bhk: num,
  size_sqft: num,
  locality: text,
  scope_summary: text,
  completion_needed_by: isoDate,
  timeline_text: text,
  site_ready_text: text,
  volunteered_budget_low_inr: num,
  volunteered_budget_high_inr: num,
  referral_source: text,
  existing_project_designer: text,
  issue_summary: text,
  criteria: z
    .object({
      real_project: criterion,
      service_area: criterion,
      timeline: criterion,
      budget: criterion,
      decision_maker: criterion,
    })
    .default({
      real_project: { status: "unclear", evidence: null },
      service_area: { status: "unclear", evidence: null },
      timeline: { status: "unclear", evidence: null },
      budget: { status: "unclear", evidence: null },
      decision_maker: { status: "unclear", evidence: null },
    }),
  flags: z
    .preprocess(
      (v) =>
        Array.isArray(v)
          ? v.map((f) => String(f).trim().toLowerCase())
          : typeof v === "string"
            ? v.split(/[,;\s]+/).map((f) => f.trim().toLowerCase()).filter(Boolean)
            : [],
      z.array(z.string()),
    )
    .transform((fs) => fs.filter((f): f is (typeof AGENT_FLAGS)[number] => (AGENT_FLAGS as readonly string[]).includes(f)))
    .default([]),
  /** Extra field (proposal e4): the agent has already asked whether the date can move (V8, AT3). */
  timeline_move_asked: z
    .preprocess((v) => v === true || v === "true" || v === "yes", z.boolean())
    .default(false),
});

/**
 * Flat field names accepted alongside the nested `criteria` object, because some tool runners
 * (Vaani's custom tools among them, UNVERIFIED) handle flat parameters more reliably:
 * real_project_status / real_project_evidence, ... decision_maker_status / decision_maker_evidence.
 */
export const FLAT_CRITERIA_FIELDS = CRITERIA.flatMap((c) => [`${c}_status`, `${c}_evidence`]);

function normaliseAssessmentBody(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const body = { ...(v as Record<string, unknown>) };
  let criteria: Record<string, unknown> = {};
  if (typeof body.criteria === "string") {
    try {
      criteria = JSON.parse(body.criteria);
    } catch {
      criteria = {};
    }
  } else if (body.criteria && typeof body.criteria === "object") {
    criteria = { ...(body.criteria as Record<string, unknown>) };
  }
  let flat = false;
  for (const c of CRITERIA) {
    const status = body[`${c}_status`];
    const evidence = body[`${c}_evidence`];
    if (status !== undefined || evidence !== undefined) {
      flat = true;
      const existing = (criteria[c] && typeof criteria[c] === "object" ? criteria[c] : {}) as Record<string, unknown>;
      criteria[c] = { ...existing, ...(status !== undefined ? { status } : {}), ...(evidence !== undefined ? { evidence } : {}) };
    }
    delete body[`${c}_status`];
    delete body[`${c}_evidence`];
  }
  if (flat || Object.keys(criteria).length) body.criteria = criteria;
  return body;
}

export const assessmentInputSchema = z.preprocess(normaliseAssessmentBody, assessmentInputObject);

export type AssessmentInput = z.infer<typeof assessmentInputObject>;

export interface CriterionResult {
  status: CriterionStatus;
  evidence: string | null;
  /** Why the backend changed the agent's status, if it did. Never contains a pricing figure. */
  override?: string;
}

export type CriteriaResult = Record<CriterionName, CriterionResult>;

export interface BudgetCheck {
  /** Top of the volunteered budget in INR, or null when none was volunteered. */
  topInr: number | null;
  /** INTERNAL. Never spoken or displayed. */
  floorInr: number | null;
  /** top / floor. INTERNAL. */
  ratio: number | null;
  tight: boolean;
  status: CriterionStatus;
  note: string | null;
}

export interface AssessmentResult {
  tier: Tier | null;
  action: Action;
  callback_phrase: string | null;
  say_reason: string | null;
  /** Plain-language reasons for the dashboard and the agent. No pricing figures. */
  reasons: string[];
  criteria: CriteriaResult;
  flags: Flag[];
  budget: BudgetCheck;
  estimated_value_inr: number | null;
  priority: "high" | "normal" | null;
  called_after_hours: boolean;
}
