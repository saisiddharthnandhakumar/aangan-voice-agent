import { z } from "zod";
import { redactMoney } from "@/lib/rules/price-leak";
import { EXTRACTION_INSTRUCTIONS, extractionJsonSchema } from "./extraction";

/**
 * Post-call analysis (PRD P3), one Gemini call per call with rubric.txt and the transcript.
 * Under the user's decision of 2026-10-10 Gemini decides NOTHING: the tier is the voice agent's.
 * Gemini writes the summary, the designer handoff note and open questions, records its own reading
 * of the criteria (shown to designers as a reference, never used for the tier), and gives a
 * second opinion on whether the agent said a price (P5).
 */

const SUMMARY_MAX = 600;

export const postCallJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "At most 600 characters. Plain facts of the call for the designer." },
    handoff_note: { type: "string", description: "What the designer should know or do next, in 1 to 3 sentences." },
    open_questions: { type: "array", items: { type: "string" }, maxItems: 6 },
    has_project_details: {
      type: "boolean",
      description: "True if the caller described any project at all (type, area, scope or timing).",
    },
    price_leak: {
      type: "object",
      properties: {
        leaked: { type: "boolean" },
        evidence: { type: ["string", "null"], description: "The agent's words, briefly. null if none." },
      },
      required: ["leaked", "evidence"],
      additionalProperties: false,
    },
    extraction: extractionJsonSchema,
  },
  required: ["summary", "handoff_note", "open_questions", "has_project_details", "price_leak", "extraction"],
  additionalProperties: false,
} as const;

export const postCallShape = z
  .object({
    summary: z.string(),
    handoff_note: z.string(),
    open_questions: z.array(z.string()).default([]),
    has_project_details: z.boolean(),
    price_leak: z.object({ leaked: z.boolean(), evidence: z.string().nullable().optional() }),
    extraction: z
      .object({
        call_category: z.string(),
        criteria: z.record(z.string(), z.object({ status: z.string() }).passthrough()),
      })
      .passthrough(),
  })
  .passthrough();

export type PostCallRaw = z.infer<typeof postCallShape>;

export interface PostCallResult {
  summary: string;
  handoffNote: string;
  openQuestions: string[];
  hasProjectDetails: boolean;
  priceLeak: { leaked: boolean; evidence: string | null };
  /** Gemini's reading of the criteria and facts. Reference only; never sets the tier. */
  extraction: Record<string, unknown>;
}

const POSTCALL_INSTRUCTIONS = `You review one finished phone call between Aangan Studio's AI phone assistant
(AGENT) and a caller (USER). Your output goes to the studio's designers.

Write:
- summary: what the caller wants and what was agreed, in plain sentences, at most 600 characters.
- handoff_note: what the designer should know or do next (1 to 3 sentences).
- open_questions: facts the designer still needs to ask (may be empty).
- has_project_details: true if the caller described any project at all.
- price_leak: leaked = true if the AGENT (never the caller) said any price, rate, range, per-sq-ft
  figure, estimate, "starting from" figure or cost comparison, or confirmed a figure the caller
  suggested. The fixed line "Pricing depends on the site, the materials you choose, and the
  scope..." is NOT a leak. evidence = the agent's words, briefly, or null.
- extraction: the caller's facts and the five criteria, as described below.

The studio's first meeting is always a short design call (video or phone) with a designer, never a
site visit: refer to it that way.
Never write any rupee amount, rate or budget figure in summary, handoff_note or open_questions:
say "volunteered a budget" instead. Do not judge whether the lead qualifies; the call already
decided that.`;

export function postCallPrompt(rubric: string, today: string): string {
  return `${POSTCALL_INSTRUCTIONS}\n\nHOW TO FILL extraction\n${EXTRACTION_INSTRUCTIONS}\n\nToday's date in India is ${today}.\n\nTHE RUBRIC\n${rubric}`;
}

/** Clean the model's output: length caps and money redaction, so nothing priced reaches alerts or HubSpot. */
export function normalisePostCall(raw: PostCallRaw): PostCallResult {
  const clean = (t: string, max: number) => redactMoney(t.trim()).slice(0, max);
  return {
    summary: clean(raw.summary, SUMMARY_MAX),
    handoffNote: clean(raw.handoff_note, 600),
    openQuestions: raw.open_questions.map((q) => clean(q, 200)).filter(Boolean).slice(0, 6),
    hasProjectDetails: raw.has_project_details,
    priceLeak: {
      leaked: raw.price_leak.leaked,
      // Stored for the founder; digits are masked so the stored evidence never holds a figure.
      evidence: raw.price_leak.evidence ? raw.price_leak.evidence.replace(/\d/g, "#").slice(0, 200) : null,
    },
    extraction: raw.extraction as Record<string, unknown>,
  };
}
