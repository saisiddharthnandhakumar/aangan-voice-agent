import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

describe("database schema (PRD section 5)", () => {
  const tables = [schema.calls, schema.bookings, schema.toolCalls, schema.pipelineSteps, schema.reviewActions];

  it("defines exactly the five PRD tables", () => {
    expect(tables.map((t) => getTableConfig(t).name).sort()).toEqual([...schema.tableNames].sort());
  });

  it("has every calls column the PRD names", () => {
    const cols = new Set(getTableConfig(schema.calls).columns.map((c) => c.name));
    const prd = `vaani_call_id from_number to_number caller_name started_at ended_at duration_seconds called_after_hours
      call_category status review_state end_reason tier tier_reasons tier_conflict priority estimated_value_inr
      budget_low_inr budget_high_inr budget_floor_inr budget_tight price_leak criteria_agent criteria_gemini facts flags
      completion_needed_by site_ready_text consult_type site_area referral_source existing_project_designer
      repeat_of_call_id transcript recording_url summary handoff_note open_questions hubspot_contact_id hubspot_call_id
      hubspot_deal_id telegram_sent_at vaani_cost_inr gemini_cost_inr total_cost_inr gemini_tokens_in gemini_tokens_out
      is_test raw_webhook`.split(/\s+/).filter(Boolean);
    expect(prd.filter((c) => !cols.has(c))).toEqual([]);
  });

  it("has the PRD columns on the other tables", () => {
    const has = (t: Parameters<typeof getTableConfig>[0], names: string) => {
      const cols = new Set(getTableConfig(t).columns.map((c) => c.name));
      return names.split(" ").filter((n) => !cols.has(n));
    };
    expect(has(schema.bookings, "call_id cal_booking_uid event_type_id consult_type start_at end_at attendee_email email_is_placeholder status")).toEqual([]);
    expect(has(schema.toolCalls, "call_id tool request response latency_ms created_at")).toEqual([]);
    expect(has(schema.pipelineSteps, "call_id step status attempts last_error updated_at")).toEqual([]);
    expect(has(schema.reviewActions, "call_id actor_role action note created_at")).toEqual([]);
  });

  it("uses the PRD enum values", () => {
    expect(schema.callStatus.enumValues).toEqual([
      "in_call", "processing", "booked", "awaiting_designer", "unqualified_verified", "escalated", "dropped", "non_enquiry", "failed",
    ]);
    expect(schema.reviewState.enumValues).toEqual(["none", "approved", "rescued", "discarded"]);
    expect(schema.endReason.enumValues).toEqual(["completed", "dropped", "failed"]);
    expect(schema.reviewAction.enumValues).toEqual(["approve", "rescue", "discard", "note"]);
  });

  it("enforces idempotency keys", () => {
    const uniques = (t: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(t).indexes.filter((i) => i.config.unique).map((i) => i.config.name);
    expect(uniques(schema.calls)).toContain("calls_vaani_call_id_uq");
    expect(uniques(schema.bookings)).toContain("bookings_call_id_uq");
    expect(uniques(schema.pipelineSteps)).toContain("pipeline_steps_call_step_uq");
  });
});
