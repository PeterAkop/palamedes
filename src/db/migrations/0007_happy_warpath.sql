ALTER TABLE "generations" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "sent_to" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "sent_to_client" boolean DEFAULT false NOT NULL;