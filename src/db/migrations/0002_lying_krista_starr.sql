ALTER TABLE "cases" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "ai_summary_model" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "ai_summary_generated_at" timestamp with time zone;