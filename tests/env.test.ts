import { describe, expect, it } from "vitest";
import { integrationStatus, parseEnv } from "@/env";

const DB = "postgresql://u:p@ep-x-pooler.example.neon.tech/aangan?sslmode=require";
const S = "a".repeat(64);

describe("environment validation", () => {
  it("needs only the database in development and fills defaults", () => {
    const e = parseEnv({ DATABASE_URL: DB });
    expect(e.NODE_ENV).toBe("development");
    expect(e.GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(e.CAL_API_VERSION_SLOTS).toBe("2024-09-04");
    expect(e.CAL_API_VERSION_BOOKINGS).toBe("2026-02-25");
    expect(e.BUSINESS_DAYS).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
    expect(e.ASSUMED_DEAL_VALUE_INR).toBe(1_100_000);
    expect(e.RETENTION_DAYS).toBe(90);
  });

  it("rejects a missing or non-postgres DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
  });

  it("treats empty integration keys as not configured", () => {
    const e = parseEnv({ DATABASE_URL: DB, GEMINI_API_KEY: "", TELEGRAM_BOT_TOKEN: "  " });
    expect(e.GEMINI_API_KEY).toBeUndefined();
    expect(integrationStatus(e)).toMatchObject({ gemini: false, telegram: false, hubspot: false, cal: false });
  });

  it("parses numbers and rejects junk", () => {
    expect(parseEnv({ DATABASE_URL: DB, VAANI_COST_PER_MIN_INR: "4.5" }).VAANI_COST_PER_MIN_INR).toBe(4.5);
    expect(() => parseEnv({ DATABASE_URL: DB, VAANI_COST_PER_MIN_INR: "four" })).toThrow(/VAANI_COST_PER_MIN_INR/);
  });

  it("validates business hours and days", () => {
    expect(() => parseEnv({ DATABASE_URL: DB, BUSINESS_HOURS_START: "25:00" })).toThrow(/BUSINESS_HOURS_START/);
    expect(parseEnv({ DATABASE_URL: DB, BUSINESS_DAYS: "Mon,Tue" }).BUSINESS_DAYS).toEqual(["mon", "tue"]);
    expect(() => parseEnv({ DATABASE_URL: DB, BUSINESS_DAYS: "monday" })).toThrow(/BUSINESS_DAYS/);
  });

  it("requires login and cron secrets in production", () => {
    expect(() => parseEnv({ DATABASE_URL: DB, NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
    const ok = parseEnv({
      DATABASE_URL: DB,
      NODE_ENV: "production",
      SESSION_SECRET: S,
      CRON_SECRET: S,
      DASHBOARD_DESIGNER_PASSWORD: "designer-pass",
      DASHBOARD_FOUNDER_PASSWORD: "founder-pass",
      APP_BASE_URL: "https://example.vercel.app",
    });
    expect(ok.NODE_ENV).toBe("production");
  });

  it("rejects short secrets", () => {
    expect(() => parseEnv({ DATABASE_URL: DB, VAANI_TOOL_SECRET: "short" })).toThrow(/VAANI_TOOL_SECRET/);
  });

  it("never echoes a value in the error message", () => {
    const secretish = "postgresql-but-not-really://super-secret-password";
    try {
      parseEnv({ DATABASE_URL: secretish });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain("super-secret-password");
    }
  });
});
