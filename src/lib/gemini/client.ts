import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { z } from "zod";
import { isTimeout, withRetry } from "@/lib/http/retry";

/**
 * Gemini Flash with strict JSON output (docs/PLATFORM_NOTES.md section 5).
 * Field names verified against @google/genai 2.28 typings: responseMimeType + responseJsonSchema,
 * thinkingConfig.thinkingLevel, abortSignal, httpOptions.timeout. temperature is not sent
 * (deprecated on Gemini 3.x). Output is re-validated with zod because unsupported schema
 * keywords are silently ignored by the API.
 */

export interface GeminiUsage {
  promptTokens: number;
  /** candidates + thinking, both billed at the output rate */
  outputTokens: number;
  thoughtsTokens: number;
}

export interface GeminiJsonResult<T> {
  data: T;
  usage: GeminiUsage;
  model: string;
  attempts: number;
}

export interface GeminiJsonRequest<T> {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  validate: z.ZodType<T>;
  maxOutputTokens?: number;
  timeoutMs?: number;
  attempts?: number;
}

export class GeminiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiOutputError";
  }
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryableGeminiError(err: unknown): boolean {
  if (err instanceof ApiError) return RETRY_STATUSES.has(err.status);
  if (err instanceof GeminiOutputError) return true; // a malformed answer is worth one more try
  return isTimeout(err) || (err instanceof TypeError && /fetch/i.test(err.message));
}

const clients = new Map<string, GoogleGenAI>();
function client(apiKey: string): GoogleGenAI {
  let c = clients.get(apiKey);
  if (!c) {
    // Retries are ours (withRetry), so the SDK's own are turned off to avoid doubling them.
    c = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
    clients.set(apiKey, c);
  }
  return c;
}

export async function generateJson<T>(req: GeminiJsonRequest<T>): Promise<GeminiJsonResult<T>> {
  const timeoutMs = req.timeoutMs ?? 30_000;
  const { value, attempts } = await withRetry(
    async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        const res = await client(req.apiKey).models.generateContent({
          model: req.model,
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: req.jsonSchema,
            maxOutputTokens: req.maxOutputTokens ?? 4096,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            abortSignal: abort.signal,
            httpOptions: { timeout: timeoutMs },
          },
        });
        const text = res.text;
        if (!text) throw new GeminiOutputError("empty response");
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new GeminiOutputError("response was not valid JSON");
        }
        const checked = req.validate.safeParse(parsed);
        if (!checked.success) throw new GeminiOutputError(`response failed validation: ${checked.error.issues[0]?.path.join(".")}`);
        const u = res.usageMetadata;
        const thoughts = u?.thoughtsTokenCount ?? 0;
        return {
          data: checked.data,
          usage: { promptTokens: u?.promptTokenCount ?? 0, outputTokens: (u?.candidatesTokenCount ?? 0) + thoughts, thoughtsTokens: thoughts },
          model: res.modelVersion ?? req.model,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    { attempts: req.attempts ?? 3, baseDelayMs: 1000, maxDelayMs: 8000, retryable: isRetryableGeminiError },
  );
  return { ...value, attempts };
}

/** Cost in INR from token usage × configured per-million rates (P7). */
export function geminiCostInr(usage: GeminiUsage, priceInPerMtokInr?: number, priceOutPerMtokInr?: number): number | null {
  if (priceInPerMtokInr == null || priceOutPerMtokInr == null) return null;
  const cost = (usage.promptTokens * priceInPerMtokInr + usage.outputTokens * priceOutPerMtokInr) / 1_000_000;
  return Math.round(cost * 10_000) / 10_000;
}
