ALTER TABLE "cases" ADD COLUMN "action_plan_json" jsonb;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "action_plan_generated_at" timestamp with time zone;