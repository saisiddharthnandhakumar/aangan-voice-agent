import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Data model from PRD section 5. Times are timestamptz (stored UTC, shown in IST).
 * Money is numeric INR. Columns marked "extra" are not named in the PRD but are needed
 * by agreed behaviour (see docs/PLATFORM_NOTES.md and the Phase 1 report).
 */

export const callCategory = pgEnum("call_category", [
  "enquiry",
  "existing_client",
  "existing_client_complaint",
  "vendor_or_sales",
  "job_seeker",
  "wrong_number",
  "other",
]);

export const callStatus = pgEnum("call_status", [
  "in_call",
  "processing",
  "booked",
  "awaiting_designer",
  "unqualified_verified",
  "escalated",
  "dropped",
  "non_enquiry",
  "failed",
]);

export const reviewState = pgEnum("review_state", ["none", "approved", "rescued", "discarded"]);
export const endReason = pgEnum("end_reason", ["completed", "dropped", "failed"]);
export const tier = pgEnum("tier", ["green", "amber", "red"]);
export const priority = pgEnum("priority", ["high", "normal"]);
export const consultType = pgEnum("consult_type", ["site_visit", "call"]);
export const bookingStatus = pgEnum("booking_status", ["pending", "accepted", "failed", "cancelled"]);
export const stepStatus = pgEnum("step_status", ["pending", "running", "succeeded", "failed", "skipped"]);
export const reviewAction = pgEnum("review_action", ["approve", "rescue", "discard", "note"]);
export const actorRole = pgEnum("actor_role", ["designer", "founder"]);

const inr = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: a tool call may arrive before the webhook tells us Vaani's call ID.
    vaaniCallId: text("vaani_call_id"),
    vaaniAgentId: text("vaani_agent_id"), // extra: test-agent detection
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    callerName: text("caller_name"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }), // extra: time-to-answer metric
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    calledAfterHours: boolean("called_after_hours"),
    callCategory: callCategory("call_category"),
    status: callStatus("status").notNull().default("in_call"),
    reviewState: reviewState("review_state").notNull().default("none"),
    endReason: endReason("end_reason"),
    tier: tier("tier"),
    tierReasons: jsonb("tier_reasons").$type<string[]>(),
    tierConflict: boolean("tier_conflict").notNull().default(false),
    priority: priority("priority"),
    estimatedValueInr: inr("estimated_value_inr"),
    budgetLowInr: inr("budget_low_inr"),
    budgetHighInr: inr("budget_high_inr"),
    budgetFloorInr: inr("budget_floor_inr"),
    budgetTight: boolean("budget_tight").notNull().default(false),
    priceLeak: boolean("price_leak").notNull().default(false),
    criteriaAgent: jsonb("criteria_agent"),
    criteriaGemini: jsonb("criteria_gemini"),
    facts: jsonb("facts"),
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    completionNeededBy: date("completion_needed_by"),
    siteReadyText: text("site_ready_text"),
    consultType: consultType("consult_type"),
    siteArea: text("site_area"),
    referralSource: text("referral_source"),
    existingProjectDesigner: text("existing_project_designer"),
    repeatOfCallId: uuid("repeat_of_call_id"),
    transcript: text("transcript"),
    recordingUrl: text("recording_url"),
    summary: text("summary"),
    handoffNote: text("handoff_note"),
    openQuestions: jsonb("open_questions").$type<string[]>(),
    hubspotContactId: text("hubspot_contact_id"),
    hubspotCallId: text("hubspot_call_id"),
    hubspotDealId: text("hubspot_deal_id"),
    telegramSentAt: timestamp("telegram_sent_at", { withTimezone: true }),
    telegramChatId: text("telegram_chat_id"), // extra: edit the alert on a redial (AT15)
    telegramMessageId: text("telegram_message_id"), // extra: same
    vaaniCostInr: inr("vaani_cost_inr"),
    geminiCostInr: inr("gemini_cost_inr"),
    totalCostInr: inr("total_cost_inr"),
    geminiTokensIn: integer("gemini_tokens_in"),
    geminiTokensOut: integer("gemini_tokens_out"),
    isTest: boolean("is_test").notNull().default(false),
    rawWebhook: jsonb("raw_webhook"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("calls_vaani_call_id_uq").on(t.vaaniCallId),
    index("calls_started_at_idx").on(t.startedAt),
    index("calls_status_idx").on(t.status),
    index("calls_tier_idx").on(t.tier),
    index("calls_from_number_started_idx").on(t.fromNumber, t.startedAt),
    index("calls_repeat_of_idx").on(t.repeatOfCallId),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "restrict" }),
    calBookingUid: text("cal_booking_uid"),
    eventTypeId: integer("event_type_id"),
    consultType: consultType("consult_type").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    attendeeEmail: text("attendee_email"),
    emailIsPlaceholder: boolean("email_is_placeholder").notNull().default(false),
    status: bookingStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One booking per call (T3 idempotency).
    uniqueIndex("bookings_call_id_uq").on(t.callId),
    uniqueIndex("bookings_cal_uid_uq").on(t.calBookingUid),
    index("bookings_start_at_idx").on(t.startAt),
  ],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "restrict" }),
    tool: text("tool").notNull(),
    request: jsonb("request"),
    response: jsonb("response"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("tool_calls_call_id_idx").on(t.callId), index("tool_calls_created_at_idx").on(t.createdAt)],
);

export const pipelineSteps = pgTable(
  "pipeline_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "restrict" }),
    step: text("step").notNull(),
    status: stepStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("pipeline_steps_call_step_uq").on(t.callId, t.step),
    index("pipeline_steps_status_idx").on(t.status),
  ],
);

export const reviewActions = pgTable(
  "review_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "restrict" }),
    actorRole: actorRole("actor_role").notNull(),
    action: reviewAction("action").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("review_actions_call_id_idx").on(t.callId, t.createdAt)],
);

export const tableNames = ["calls", "bookings", "tool_calls", "pipeline_steps", "review_actions"] as const;
