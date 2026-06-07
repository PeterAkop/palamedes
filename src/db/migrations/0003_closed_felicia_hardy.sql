CREATE TABLE "generation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_messages_role_check" CHECK ("generation_messages"."role" IN ('user','assistant'))
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generations_status_check" CHECK ("generations"."status" IN ('running','complete','failed'))
);
--> statement-breakpoint
ALTER TABLE "generation_messages" ADD CONSTRAINT "generation_messages_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_messages_generation_id_idx" ON "generation_messages" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "generations_case_id_idx" ON "generations" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "generations_owner_id_idx" ON "generations" USING btree ("owner_id");