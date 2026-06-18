CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"label" text,
	"value" text,
	"fact_date" text,
	"confidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facts_type_check" CHECK ("facts"."type" IN ('party','date','address','reference','money','evidence','key_fact','action_item','document_type'))
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "facts_model" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "facts_extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facts_case_id_idx" ON "facts" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "facts_source_id_idx" ON "facts" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "facts_owner_id_idx" ON "facts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "facts_case_type_idx" ON "facts" USING btree ("case_id","type");