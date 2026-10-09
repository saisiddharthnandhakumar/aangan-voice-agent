import { RULES_CONFIG } from "./config";

export interface PriorCall {
  id: string;
  fromNumber: string | null;
  startedAt: Date | null;
  repeatOfCallId: string | null;
}

/**
 * P6: a call from the same number within 24 hours links to the earlier call, so one lead gets
 * one alert. Chains point at the first call of the run. Returns the call ID to link to, or null.
 */
export function findRepeatOf(
  priorCalls: readonly PriorCall[],
  fromNumber: string | null,
  startedAt: Date,
  windowHours: number = RULES_CONFIG.repeat.windowHours,
): string | null {
  if (!fromNumber) return null;
  const windowStart = startedAt.getTime() - windowHours * 3_600_000;
  const candidates = priorCalls
    .filter((c) => c.fromNumber === fromNumber && c.startedAt && c.startedAt.getTime() < startedAt.getTime() && c.startedAt.getTime() >= windowStart)
    .sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime());
  const latest = candidates[0];
  return latest ? (latest.repeatOfCallId ?? latest.id) : null;
}
