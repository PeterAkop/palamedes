ALTER TABLE "sources" ADD COLUMN "analysis_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "analysis_output_tokens" integer DEFAULT 0 NOT NULL;