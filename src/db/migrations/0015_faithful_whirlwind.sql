CREATE TABLE "case_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"text" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"suggested_tool_id" text,
	"origin" text DEFAULT 'ai' NOT NULL,
	"dedup_key" text NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_tasks_status_check" CHECK ("case_tasks"."status" IN ('open','done','dismissed')),
	CONSTRAINT "case_tasks_priority_check" CHECK ("case_tasks"."priority" IN ('high','medium','low')),
	CONSTRAINT "case_tasks_origin_check" CHECK ("case_tasks"."origin" IN ('ai','manual'))
);
--> statement-breakpoint
ALTER TABLE "case_tasks" ADD CONSTRAINT "case_tasks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_tasks_case_id_idx" ON "case_tasks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_tasks_owner_id_idx" ON "case_tasks" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_tasks_case_dedup_idx" ON "case_tasks" USING btree ("case_id","dedup_key");