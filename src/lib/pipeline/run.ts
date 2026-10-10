import { errorSummary, RetryError, withRetry } from "@/lib/http/retry";
import { STEPS, type StepOutcome } from "./steps";
import { PIPELINE_STEPS, type PipelineDeps, type StepName } from "./types";

/**
 * Runs the post-call steps in order and records each in pipeline_steps (PRD P2): status,
 * cumulative attempts, last error. A failed step does not stop the others (Gemini failing must not
 * hold back the alert, P3), except `save`, without which nothing else is meaningful.
 *
 * Retries: steps that call an external API retry inside their client (Gemini, Vaani, Cal.com:
 * timeouts, 429 and 5xx with backoff). The DB-only steps get one extra attempt here for a
 * transient Neon error. A failed step can be re-run later with runPipeline(..., {from: step}).
 */

/** Runner-level attempts; external steps retry inside their own clients. */
const RUNNER_ATTEMPTS: Record<StepName, number> = {
  save: 2,
  enrich: 1,
  booking: 1,
  gemini: 1,
  tier: 2,
  leak_check: 2,
  cost: 2,
  hubspot_log: 1,
  hubspot_deal: 1,
  telegram: 1,
};

export interface StepReport {
  step: StepName;
  status: "succeeded" | "skipped" | "failed";
  attempts: number;
  note: string | null;
}

export interface RunOptions {
  /** Start from this step (a retry re-runs it and everything after it). Default: the first. */
  from?: StepName;
  /** Run only this one step. */
  only?: StepName;
}

export async function runStep(callId: string, step: StepName, deps: PipelineDeps): Promise<StepReport & { halt: boolean }> {
  const prior = (await deps.repo.getSteps(callId)).find((s) => s.step === step);
  const before = prior?.attempts ?? 0;
  await deps.repo.upsertStep(callId, step, { status: "running", attempts: before, lastError: prior?.lastError ?? null });
  try {
    const { value, attempts } = await withRetry<StepOutcome>(() => STEPS[step](callId, deps), {
      attempts: RUNNER_ATTEMPTS[step],
      baseDelayMs: 500,
      maxDelayMs: 2000,
      retryable: () => true,
      sleep: deps.sleep,
    });
    const made = Math.max(attempts, value.attempts ?? 1);
    const note = value.note ?? null;
    await deps.repo.upsertStep(callId, step, {
      status: value.status,
      attempts: before + made,
      lastError: value.status === "skipped" ? note : null,
    });
    return { step, status: value.status, attempts: before + made, note, halt: value.halt === true };
  } catch (err) {
    const inner = err instanceof RetryError ? err.lastError : err;
    const made = inner instanceof RetryError ? inner.attempts : err instanceof RetryError ? err.attempts : 1;
    const lastError = errorSummary(inner);
    await deps.repo.upsertStep(callId, step, { status: "failed", attempts: before + made, lastError }).catch(() => undefined);
    return { step, status: "failed", attempts: before + made, note: lastError, halt: step === "save" };
  }
}

export async function runPipeline(callId: string, deps: PipelineDeps, opts: RunOptions = {}): Promise<StepReport[]> {
  const steps: readonly StepName[] = opts.only
    ? [opts.only]
    : PIPELINE_STEPS.slice(opts.from ? PIPELINE_STEPS.indexOf(opts.from) : 0);
  const reports: StepReport[] = [];
  for (const step of steps) {
    const { halt, ...report } = await runStep(callId, step, deps);
    reports.push(report);
    if (halt) break;
  }
  return reports;
}

export function isStepName(v: unknown): v is StepName {
  return typeof v === "string" && (PIPELINE_STEPS as readonly string[]).includes(v);
}
