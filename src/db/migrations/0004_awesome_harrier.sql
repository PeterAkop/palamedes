CREATE TABLE "integration_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"scope" text,
	"account_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_tokens_provider_check" CHECK ("integration_tokens"."provider" IN ('outlook'))
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_tokens_owner_provider_idx" ON "integration_tokens" USING btree ("owner_id","provider");--> statement-breakpoint
CREATE INDEX "sources_case_external_idx" ON "sources" USING btree ("case_id","external_id");