CREATE TABLE "mailbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"conversation_id" text,
	"from_address" text,
	"from_name" text,
	"subject" text,
	"received_at" timestamp with time zone,
	"snippet" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_case_id" uuid,
	"suggested_case_id" uuid,
	"suggestion_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_messages_provider_check" CHECK ("mailbox_messages"."provider" IN ('outlook')),
	CONSTRAINT "mailbox_messages_status_check" CHECK ("mailbox_messages"."status" IN ('pending','assigned','ignored'))
);
--> statement-breakpoint
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_assigned_case_id_cases_id_fk" FOREIGN KEY ("assigned_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_suggested_case_id_cases_id_fk" FOREIGN KEY ("suggested_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_messages_owner_external_idx" ON "mailbox_messages" USING btree ("owner_id","external_id");--> statement-breakpoint
CREATE INDEX "mailbox_messages_owner_status_idx" ON "mailbox_messages" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "mailbox_messages_owner_conversation_idx" ON "mailbox_messages" USING btree ("owner_id","conversation_id");