/**
 * Hand-written content for the demo calls, keyed by the call's 1-based position in SPECS (src/lib/seed-data.ts):
 * demo-001 is key 1. Everything here is invented: no caller, number or figure is real, and no studio pricing
 * figure or budget figure of any kind may appear.
 */
export type CriterionStatus = "pass" | "fail" | "unclear";

export interface CriterionContent {
  status: CriterionStatus;
  /** The caller's own words, short. null when the call never reached the point (and always null for budget). */
  evidence: string | null;
}

export interface ScenarioContent {
  /**
   * The whole call in Vaani's format: "[hh:mm:ss] AGENT: text" and "[hh:mm:ss] USER: text", one blank line
   * between turns, timestamps increasing and ending inside the call's duration. It follows the live system
   * prompt turn by turn: the exact opening line, one question at a time, each rubric check asked or heard,
   * the pricing deflection if asked, then the booking flow, the kind decline, the callback or the escalation.
   */
  transcript: string;
  /** One or two plain sentences for the designer's list card (at most about 200 characters). */
  summary: string;
  /** What the designer should know before calling or meeting; empty for calls with nothing to hand over. */
  handoffNote: string | null;
  openQuestions: string[];
  /** One line on why the agent chose this tier; null when there is no tier. Never contains a budget figure. */
  tierReason: string | null;
  criteria: {
    real_project: CriterionContent;
    service_area: CriterionContent;
    timeline: CriterionContent;
    budget: CriterionContent;
    decision_maker: CriterionContent;
  } | null;
}

export type ScenarioContentMap = Record<number, ScenarioContent>;
