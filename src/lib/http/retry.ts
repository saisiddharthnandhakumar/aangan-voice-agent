/**
 * Shared retry with exponential backoff and jitter for every external call.
 * `retryable` decides which errors are worth another attempt (timeouts, 429, 5xx).
 */
export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  retryable: (err: unknown) => boolean;
  /** Honour a server-provided wait (Retry-After, Telegram retry_after), in ms. */
  retryAfterMs?: (err: unknown) => number | undefined;
  sleep?: (ms: number) => Promise<void>;
}

export class RetryError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(message);
    this.name = "RetryError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<{ value: T; attempts: number }> {
  const sleep = opts.sleep ?? defaultSleep;
  let last: unknown;
  let made = 0;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    made = attempt;
    try {
      return { value: await fn(attempt), attempts: attempt };
    } catch (err) {
      last = err;
      if (attempt === opts.attempts || !opts.retryable(err)) break;
      const backoff = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs ?? 30_000);
      const jitter = Math.random() * backoff * 0.25;
      await sleep(Math.max(opts.retryAfterMs?.(err) ?? 0, backoff + jitter));
    }
  }
  // attempts = the attempts actually made (a non-retryable error stops early).
  throw new RetryError(errorSummary(last), made, last);
}

/** A short, safe error description for pipeline_steps.last_error: no URLs, keys or payloads. */
export function errorSummary(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/postgres(ql)?:\/\/\S+/g, "[db-url]")
    .replace(/\b(key|token|secret|password)=\S+/gi, "$1=[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "[api-key]")
    .slice(0, 300);
}

export function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError" || /timed? ?out|aborted/i.test(err.message));
}
