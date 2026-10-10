import { z } from "zod";

/**
 * Environment contract (PRD section 5, plus the extras agreed in Phase 0).
 *
 * Only the database is required in every environment. Integration keys are optional
 * because they arrive after the build: a missing key disables that integration and the
 * pipeline records the step as skipped instead of crashing. In production the login and
 * webhook secrets become required too.
 *
 * Never log the parsed object: it holds secrets.
 */

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalNumber = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "must be a number" });
      return z.NEVER;
    }
    return n;
  });

const numberWithDefault = (fallback: number) =>
  optionalNumber.transform((v) => v ?? fallback);

const postgresUrl = z
  .string()
  .trim()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), "must be a postgres:// URL");

const hhmm = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM (24h, IST)");

const businessDays = z
  .string()
  .trim()
  .regex(/^(mon|tue|wed|thu|fri|sat|sun)(,(mon|tue|wed|thu|fri|sat|sun))*$/i, "comma list such as mon,tue,wed,thu,fri,sat")
  .transform((v) => v.toLowerCase().split(","));

const secret = z.string().min(32, "must be at least 32 characters");

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // Neon
    DATABASE_URL: postgresUrl,
    DATABASE_URL_UNPOOLED: postgresUrl.optional(),

    // Gemini (post-call analysis and its cost)
    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: z.string().trim().default("gemini-3.8-flash"),
    GEMINI_PRICE_IN_PER_MTOK_INR: optionalNumber,
    GEMINI_PRICE_OUT_PER_MTOK_INR: optionalNumber,

    // Vaani
    VAANI_API_KEY: optionalString,
    VAANI_WEBHOOK_SECRET: secret.optional(),
    VAANI_TOOL_SECRET: secret.optional(),
    VAANI_COST_PER_MIN_INR: optionalNumber,
    VAANI_TEST_AGENT_IDS: optionalString.transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [])),

    // Cal.com
    CAL_API_KEY: optionalString,
    CAL_EVENT_TYPE_ID_SITE_VISIT: optionalNumber,
    CAL_EVENT_TYPE_ID_CALL: optionalNumber,
    CAL_API_VERSION_SLOTS: z.string().trim().default("2024-09-04"),
    CAL_API_VERSION_BOOKINGS: z.string().trim().default("2026-02-25"),
    /** Override only for tests and the local mock (scripts/mock-cal.ts). */
    CAL_API_BASE_URL: z.string().trim().url().default("https://api.cal.com"),

    // HubSpot
    HUBSPOT_ACCESS_TOKEN: optionalString,
    HUBSPOT_PORTAL_ID: optionalString,
    HUBSPOT_PIPELINE_ID: optionalString,
    HUBSPOT_STAGE_BOOKED: optionalString,
    HUBSPOT_STAGE_AWAITING: optionalString,
    HUBSPOT_STAGE_LOST: optionalString,

    // Telegram
    TELEGRAM_BOT_TOKEN: optionalString,
    TELEGRAM_CHAT_ID: optionalString,
    TELEGRAM_ESCALATION_CHAT_ID: optionalString,

    // App
    APP_BASE_URL: z.string().trim().url().optional(),
    /**
     * Dashboard login. User decision 2026-10-10: "off" (the default) means NO login: anyone with the web address
     * can open every dashboard page, the CSV, and the Rescue/Cancel/Note actions, and sees callers' names,
     * phone numbers and transcripts. Set DASHBOARD_LOGIN=on to require the two passwords again.
     */
    DASHBOARD_LOGIN: z.enum(["on", "off"]).default("off"),
    SESSION_SECRET: secret.optional(),
    DASHBOARD_DESIGNER_PASSWORD: z.string().min(8).optional(),
    DASHBOARD_FOUNDER_PASSWORD: z.string().min(8).optional(),
    CRON_SECRET: secret.optional(),

    // Config
    STUDIO_PHONE_NUMBER: optionalString,
    ASSUMED_DEAL_VALUE_INR: numberWithDefault(1_100_000),
    BUSINESS_HOURS_START: hhmm.default("10:00"),
    BUSINESS_HOURS_END: hhmm.default("19:00"),
    BUSINESS_DAYS: businessDays.default(["mon", "tue", "wed", "thu", "fri", "sat"]),
    PLACEHOLDER_EMAIL_DOMAIN: z.string().trim().default("example.com"),
    /** Tool endpoint requests per minute per client IP (T4). */
    TOOL_RATE_LIMIT_PER_MIN: numberWithDefault(120),
    AMBER_STALE_HOURS: numberWithDefault(4),
    RETENTION_DAYS: numberWithDefault(90),

    /**
     * Internal pricing figures (floors and estimate rates from pricing.md), as JSON.
     * Kept out of the public repo on purpose. The rules engine reads it in Phase 2.
     */
    PRICING_CONFIG_JSON: optionalString,

    /**
     * rubric.txt, base64-encoded, for the post-call Gemini step. rubric.txt is gitignored (it
     * contains the internal pricing section), so it reaches the server only through this
     * variable. Written by `pnpm rubric:env`. Locally the file itself is used if this is empty.
     */
    RUBRIC_TXT_B64: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    const requiredInProd = [
      ...(env.DASHBOARD_LOGIN === "on" ? (["SESSION_SECRET", "DASHBOARD_DESIGNER_PASSWORD", "DASHBOARD_FOUNDER_PASSWORD"] as const) : []),
      "CRON_SECRET",
      "APP_BASE_URL",
    ] as const;
    for (const key of requiredInProd) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required in production" });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parse an env-like object. Error messages name the variable but never echo its value. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // On Vercel, fall back to the project's production domain (a Vercel system variable).
  const vercelHost = source.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (!source.APP_BASE_URL?.trim() && vercelHost) source = { ...source, APP_BASE_URL: `https://${vercelHost}` };
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Validated environment for server code. Parsed once per process. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Which integrations have their keys. Booleans only, safe to expose on /api/health. */
export function integrationStatus(e: Env = env()) {
  return {
    gemini: Boolean(e.GEMINI_API_KEY),
    vaani_api: Boolean(e.VAANI_API_KEY),
    vaani_webhook: Boolean(e.VAANI_WEBHOOK_SECRET),
    vaani_tools: Boolean(e.VAANI_TOOL_SECRET),
    // Only the design call is booked (decision 2026-10-10); the site-visit event type is unused.
    cal: Boolean(e.CAL_API_KEY && e.CAL_EVENT_TYPE_ID_CALL),
    hubspot: Boolean(e.HUBSPOT_ACCESS_TOKEN),
    telegram: Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID),
    pricing_config: Boolean(e.PRICING_CONFIG_JSON),
    rubric: Boolean(e.RUBRIC_TXT_B64),
  };
}
