import { submitAssessment, submitFallback } from "@/lib/tools/service";
import { toolRoute } from "@/lib/tools/http";

export const runtime = "nodejs";

/** T1: record the caller's answers, run the rules, return the action (PRD section 4). */
const handler = toolRoute({
  tool: "submit_assessment",
  run: submitAssessment,
  fallback: (deps) => submitFallback(deps.now(), deps.rules.hours),
});

// POST is the contract; GET and PUT are accepted too because Vaani's request method is UNVERIFIED.
export const POST = handler;
export const GET = handler;
export const PUT = handler;
