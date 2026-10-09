ALTER TABLE "calls" ADD COLUMN "call_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "calls_call_ref_uq" ON "calls" USING btree ("call_ref");--> statement-breakpoint
CREATE INDEX "calls_created_at_idx" ON "calls" USING btree ("created_at");