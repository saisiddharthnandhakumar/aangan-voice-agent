CREATE TYPE "public"."actor_role" AS ENUM('designer', 'founder');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'accepted', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."call_category" AS ENUM('enquiry', 'existing_client', 'existing_client_complaint', 'vendor_or_sales', 'job_seeker', 'wrong_number', 'other');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('in_call', 'processing', 'booked', 'awaiting_designer', 'unqualified_verified', 'escalated', 'dropped', 'non_enquiry', 'failed');--> statement-breakpoint
CREATE TYPE "public"."consult_type" AS ENUM('site_visit', 'call');--> statement-breakpoint
CREATE TYPE "public"."end_reason" AS ENUM('completed', 'dropped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('high', 'normal');--> statement-breakpoint
CREATE TYPE "public"."review_action" AS ENUM('approve', 'rescue', 'discard', 'note');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('none', 'approved', 'rescued', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('green', 'amber', 'red');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"cal_booking_uid" text,
	"event_type_id" integer,
	"consult_type" "consult_type" NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"attendee_email" text,
	"email_is_placeholder" boolean DEFAULT false NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vaani_call_id" text,
	"vaani_agent_id" text,
	"from_number" text,
	"to_number" text,
	"caller_name" text,
	"started_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"called_after_hours" boolean,
	"call_category" "call_category",
	"status" "call_status" DEFAULT 'in_call' NOT NULL,
	"review_state" "review_state" DEFAULT 'none' NOT NULL,
	"end_reason" "end_reason",
	"tier" "tier",
	"tier_reasons" jsonb,
	"tier_conflict" boolean DEFAULT false NOT NULL,
	"priority" "priority",
	"estimated_value_inr" numeric(14, 2),
	"budget_low_inr" numeric(14, 2),
	"budget_high_inr" numeric(14, 2),
	"budget_floor_inr" numeric(14, 2),
	"budget_tight" boolean DEFAULT false NOT NULL,
	"price_leak" boolean DEFAULT false NOT NULL,
	"criteria_agent" jsonb,
	"criteria_gemini" jsonb,
	"facts" jsonb,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"completion_needed_by" date,
	"site_ready_text" text,
	"consult_type" "consult_type",
	"site_area" text,
	"referral_source" text,
	"existing_project_designer" text,
	"repeat_of_call_id" uuid,
	"transcript" text,
	"recording_url" text,
	"summary" text,
	"handoff_note" text,
	"open_questions" jsonb,
	"hubspot_contact_id" text,
	"hubspot_call_id" text,
	"hubspot_deal_id" text,
	"telegram_sent_at" timestamp with time zone,
	"telegram_chat_id" text,
	"telegram_message_id" text,
	"vaani_cost_inr" numeric(14, 2),
	"gemini_cost_inr" numeric(14, 2),
	"total_cost_inr" numeric(14, 2),
	"gemini_tokens_in" integer,
	"gemini_tokens_out" integer,
	"is_test" boolean DEFAULT false NOT NULL,
	"raw_webhook" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"actor_role" "actor_role" NOT NULL,
	"action" "review_action" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid,
	"tool" text NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_call_id_uq" ON "bookings" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_cal_uid_uq" ON "bookings" USING btree ("cal_booking_uid");--> statement-breakpoint
CREATE INDEX "bookings_start_at_idx" ON "bookings" USING btree ("start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_vaani_call_id_uq" ON "calls" USING btree ("vaani_call_id");--> statement-breakpoint
CREATE INDEX "calls_started_at_idx" ON "calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "calls_status_idx" ON "calls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "calls_tier_idx" ON "calls" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "calls_from_number_started_idx" ON "calls" USING btree ("from_number","started_at");--> statement-breakpoint
CREATE INDEX "calls_repeat_of_idx" ON "calls" USING btree ("repeat_of_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_steps_call_step_uq" ON "pipeline_steps" USING btree ("call_id","step");--> statement-breakpoint
CREATE INDEX "pipeline_steps_status_idx" ON "pipeline_steps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "review_actions_call_id_idx" ON "review_actions" USING btree ("call_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_calls_call_id_idx" ON "tool_calls" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "tool_calls_created_at_idx" ON "tool_calls" USING btree ("created_at");