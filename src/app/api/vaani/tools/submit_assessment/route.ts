import { submitAssessment, submitFallback } from "@/lib/tools/service";
import { toolRoute } from "@/lib/tools/http";

export const runtime = "nodejs";

/** T1: record the caller's answers, run the rules, return the action (PRD section 4). */
export const POST = toolRoute({
  tool: "submit_assessment",
  run: submitAssessment,
  fallback: (deps) => submitFallback(deps.now(), deps.rules.hours),
});
