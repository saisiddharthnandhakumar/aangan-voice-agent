import { z } from "zod";
import { AGENT_FLAGS, CALL_CATEGORIES, CRITERION_STATUSES, PROJECT_TYPES, SCOPE_TYPES } from "@/lib/rules/types";

/**
 * Criteria extraction: Gemini reads a transcript and records the same fields the voice agent
 * sends to submit_assessment. It never decides the tier; the rules engine does. Used by
 * `pnpm eval` now, and by the post-call step (Phase 4) as the second opinion.
 */

const nullable = (type: "string" | "number") => ({ type: [type, "null"] });
const criterion = {
  type: "object",
  properties: {
    status: { type: "string", enum: [...CRITERION_STATUSES] },
    evidence: { type: ["string", "null"], description: "The caller's own words, quoted briefly" },
  },
  required: ["status", "evidence"],
  additionalProperties: false,
};

export const extractionJsonSchema = {
  type: "object",
  properties: {
    call_category: { type: "string", enum: [...CALL_CATEGORIES] },
    caller_name: nullable("string"),
    project_type: { type: "string", enum: [...PROJECT_TYPES] },
    scope_type: { type: "string", enum: [...SCOPE_TYPES] },
    rooms_in_scope: nullable("number"),
    property_detail: nullable("string"),
    bhk: nullable("number"),
    size_sqft: nullable("number"),
    locality: nullable("string"),
    scope_summary: nullable("string"),
    completion_needed_by: { type: ["string", "null"], description: "YYYY-MM-DD" },
    timeline_text: nullable("string"),
    site_ready_text: nullable("string"),
    volunteered_budget_low_inr: nullable("number"),
    volunteered_budget_high_inr: nullable("number"),
    referral_source: nullable("string"),
    existing_project_designer: nullable("string"),
    issue_summary: nullable("string"),
    criteria: {
      type: "object",
      properties: {
        real_project: criterion,
        service_area: criterion,
        timeline: criterion,
        budget: criterion,
        decision_maker: criterion,
      },
      required: ["real_project", "service_area", "timeline", "budget", "decision_maker"],
      additionalProperties: false,
    },
    flags: { type: "array", items: { type: "string", enum: [...AGENT_FLAGS] } },
    timeline_move_asked: { type: "boolean" },
  },
  required: [
    "call_category", "caller_name", "project_type", "scope_type", "rooms_in_scope", "bhk", "size_sqft", "locality",
    "scope_summary", "completion_needed_by", "timeline_text", "site_ready_text", "volunteered_budget_low_inr",
    "volunteered_budget_high_inr", "referral_source", "criteria", "flags", "timeline_move_asked",
  ],
  additionalProperties: false,
} as const;

/** Loose check of the model's output shape; assessmentInputSchema does the full coercion afterwards. */
export const extractionShape = z
  .object({
    call_category: z.string(),
    criteria: z.object({
      real_project: z.object({ status: z.string() }).passthrough(),
      service_area: z.object({ status: z.string() }).passthrough(),
      timeline: z.object({ status: z.string() }).passthrough(),
      budget: z.object({ status: z.string() }).passthrough(),
      decision_maker: z.object({ status: z.string() }).passthrough(),
    }),
  })
  .passthrough();

export const EXTRACTION_INSTRUCTIONS = `You are the note-taker for Aangan Studio, an interior design studio in Pune.
You read one enquiry (a phone transcript, a WhatsApp thread or a web form) and record what the
person said against the studio's rubric below. You do NOT decide whether the lead qualifies:
the studio's code does that from your notes. Record facts and the caller's own words only.

How to fill the fields:
- call_category: "enquiry" for a prospective project. "existing_client_complaint" for a current
  client unhappy with their project. "existing_client" for any other current client. Otherwise
  vendor_or_sales, job_seeker, wrong_number or other (a missed call with no conversation is other).
- project_type: home for any residence; office, clinic or studio for workplaces (a coworking
  space counts as office); retail, hospitality (restaurants, hotels) or gym when that is the project.
- scope_type: full_home (whole flat or house), full_floor, rooms (specific rooms; set rooms_in_scope,
  counting a kitchen as a room), office (any commercial fit-out), or other when unknown.
- size_sqft: carpet area if stated. bhk: the flat's BHK if stated.
- locality: the area of the SITE as stated (e.g. "Kothrud", "Talegaon Dabhade, near Pune").
- completion_needed_by: only when the person says when the project must be COMPLETE (move-in,
  operational, guests arriving, a festival). Use YYYY-MM-DD. A month without a day means the
  1st of that month; "three weeks" means today plus 21 days. A possession or handover date is
  NOT a completion date: put it in site_ready_text. Starting dates are not completion dates.
- volunteered_budget_low_inr / high_inr: ONLY a number the person volunteered, in rupees
  (1.5 lakh = 150000; one number goes in both). "Prefer not to say", "reasonable" or "budget
  bhi hai" without a number means null.
- criteria, each pass, fail or unclear, with brief evidence in the person's words:
  real_project: pass if they want design AND execution (one room with full execution counts);
    fail if advice, ideas, styling, Vastu or furniture sourcing only, or if they will execute
    themselves, or a retail, restaurant, hotel or gym project; unclear if not established.
  service_area: pass inside Pune city or PCMC; fail for another city or a place the rubric
    excludes; unclear if the area was never stated.
  timeline: pass if no deadline, "no rush", or a completion date comfortably far away; fail if
    completion is needed within about 6 weeks; unclear if never discussed, vague, or still open
    after the person said they would think about a new date.
  budget: pass if no number was volunteered; otherwise record the number and mark pass (the
    code checks it).
  decision_maker: pass if they decide or are authorised; fail ONLY if they are clearly just
    researching for someone else who will decide; unclear if not mentioned.
- flags: structural_changes if they want walls moved or structural work; wants_human if they
  insist on a person; frustrated_repeat if they are upset about an earlier unanswered enquiry.
- timeline_move_asked: true if the studio already asked or discussed whether the date could move.
- Never invent a fact. Leave a field null rather than guess.`;

export function extractionPrompt(rubric: string, today: string): string {
  return `${EXTRACTION_INSTRUCTIONS}\n\nToday's date in India is ${today}.\n\nTHE RUBRIC\n${rubric}`;
}
