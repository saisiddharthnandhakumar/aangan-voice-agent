import { db } from "@/db";
import { env } from "@/env";
import { findBookings } from "@/lib/cal/client";
import { hubspotApi } from "@/lib/hubspot/client";
import { editMessage, sendMessage } from "@/lib/telegram/client";
import { generateJson } from "@/lib/gemini/client";
import { normalisePostCall, postCallJsonSchema, postCallPrompt, postCallShape } from "@/lib/gemini/postcall";
import { loadRubric } from "@/lib/rubric/runtime";
import { parsePricingConfig } from "@/lib/rules";
import { findCallInHistory } from "@/lib/vaani/history";
import { drizzlePipelineRepo } from "./repo";
import type { PipelineDeps } from "./types";

/** Production dependencies from the environment. A missing key disables that step (skipped). */
export function pipelineDeps(): PipelineDeps {
  const e = env();
  const rubric = loadRubric(e.RUBRIC_TXT_B64);
  const geminiKey = e.GEMINI_API_KEY;
  return {
    repo: drizzlePipelineRepo(db()),
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    config: {
      pricing: parsePricingConfig(e.PRICING_CONFIG_JSON),
      hours: { start: e.BUSINESS_HOURS_START, end: e.BUSINESS_HOURS_END, days: e.BUSINESS_DAYS },
      vaaniCostPerMinInr: e.VAANI_COST_PER_MIN_INR,
      testAgentIds: e.VAANI_TEST_AGENT_IDS,
      geminiPriceInPerMtokInr: e.GEMINI_PRICE_IN_PER_MTOK_INR,
      geminiPriceOutPerMtokInr: e.GEMINI_PRICE_OUT_PER_MTOK_INR,
      reconcileAfterMs: 2 * 60_000,
      appBaseUrl: e.APP_BASE_URL,
    },
    telegram:
      e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID
        ? {
            designersChatId: e.TELEGRAM_CHAT_ID,
            founderChatId: e.TELEGRAM_ESCALATION_CHAT_ID ?? null,
            send: (o) => sendMessage({ botToken: e.TELEGRAM_BOT_TOKEN as string }, o),
            edit: (o) => editMessage({ botToken: e.TELEGRAM_BOT_TOKEN as string }, o),
          }
        : null,
    hubspot: e.HUBSPOT_ACCESS_TOKEN
      ? {
          api: hubspotApi({ accessToken: e.HUBSPOT_ACCESS_TOKEN }),
          ids: {
            pipelineId: e.HUBSPOT_PIPELINE_ID ?? "default",
            stageBooked: e.HUBSPOT_STAGE_BOOKED ?? null,
            stageAwaiting: e.HUBSPOT_STAGE_AWAITING ?? null,
            stageLost: e.HUBSPOT_STAGE_LOST ?? null,
            portalId: e.HUBSPOT_PORTAL_ID ?? null,
          },
        }
      : null,
    history: e.VAANI_API_KEY ? (id) => findCallInHistory({ apiKey: e.VAANI_API_KEY as string, pages: 1 }, id) : null,
    analyse:
      geminiKey && rubric
        ? async (transcript, today) => {
            const res = await generateJson({
              apiKey: geminiKey,
              model: e.GEMINI_MODEL,
              system: postCallPrompt(rubric, today),
              user: `TRANSCRIPT\n\n${transcript}`,
              jsonSchema: postCallJsonSchema as unknown as Record<string, unknown>,
              validate: postCallShape,
              maxOutputTokens: 6144,
              // Worst case ≈ 2 × 30 s: the designers' alert (about 2 minutes after the call) comes right after.
              timeoutMs: 30_000,
              attempts: 2,
            });
            return { result: normalisePostCall(res.data), usage: res.usage, model: res.model, attempts: res.attempts };
          }
        : null,
    calLookup: e.CAL_API_KEY
      ? (q) =>
          findBookings(
            { apiKey: e.CAL_API_KEY as string, baseUrl: e.CAL_API_BASE_URL, versionSlots: e.CAL_API_VERSION_SLOTS, versionBookings: e.CAL_API_VERSION_BOOKINGS },
            q,
          )
      : null,
  };
}
