CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content_preview" text,
	"source_received_at" timestamp with time zone,
	"metadata" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"ai_summary" text,
	"ai_summary_model" text,
	"blob_path" text,
	"anthropic_file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_kind_check" CHECK ("sources"."kind" IN ('whatsapp','email','file','note','scan')),
	CONSTRAINT "sources_status_check" CHECK ("sources"."status" IN ('queued','processing','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sources_case_id_idx" ON "sources" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "sources_owner_id_idx" ON "sources" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "sources_status_idx" ON "sources" USING btree ("status");