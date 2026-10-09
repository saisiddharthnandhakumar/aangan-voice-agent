import { describe, expect, it } from "vitest";
import { geminiCostInr } from "@/lib/gemini/client";
import { errorSummary, RetryError, withRetry } from "@/lib/http/retry";

const noSleep = async () => {};

describe("withRetry", () => {
  it("retries retryable errors and reports attempts", async () => {
    let n = 0;
    const r = await withRetry(async () => {
      if (++n < 3) throw new Error("503");
      return "ok";
    }, { attempts: 3, baseDelayMs: 1, retryable: () => true, sleep: noSleep });
    expect(r).toEqual({ value: "ok", attempts: 3 });
  });

  it("stops at once on a non-retryable error", async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n++;
        throw new Error("400 bad request");
      }, { attempts: 5, baseDelayMs: 1, retryable: () => false, sleep: noSleep }),
    ).rejects.toBeInstanceOf(RetryError);
    expect(n).toBe(1);
  });

  it("honours a server-provided wait", async () => {
    const waits: number[] = [];
    await withRetry(
      async (attempt) => {
        if (attempt === 1) throw new Error("429");
        return 1;
      },
      { attempts: 2, baseDelayMs: 1, retryable: () => true, retryAfterMs: () => 5000, sleep: async (ms) => void waits.push(ms) },
    );
    expect(waits[0]).toBeGreaterThanOrEqual(5000);
  });
});

describe("errorSummary", () => {
  it("strips URLs, connection strings and keys", () => {
    const s = errorSummary(new Error("failed https://api.example.com/x?key=abc postgresql://u:p@h/db token=xyz AIzaSyA1234567890123456789012345"));
    expect(s).not.toMatch(/example\.com|u:p@|xyz|AIzaSy/);
  });
});

describe("geminiCostInr (P7)", () => {
  it("multiplies tokens by per-million prices, thinking billed as output", () => {
    expect(geminiCostInr({ promptTokens: 1_000_000, outputTokens: 500_000, thoughtsTokens: 100_000 }, 60, 300)).toBe(210);
  });
  it("is null when prices are not configured", () => {
    expect(geminiCostInr({ promptTokens: 1, outputTokens: 1, thoughtsTokens: 0 }, undefined, 1)).toBeNull();
  });
});
