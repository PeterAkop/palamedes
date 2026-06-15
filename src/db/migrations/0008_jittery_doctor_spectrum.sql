CREATE TABLE "firm_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"firm_name" text,
	"address" text,
	"phone" text,
	"email" text,
	"website" text,
	"sra_number" text,
	"vat_number" text,
	"logo_blob_path" text,
	"signatory_name" text,
	"signatory_title" text,
	"signatory_email" text,
	"assisting_fee_earner" text,
	"reference_prefix" text,
	"complaints_footer" text,
	"bank_details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "firm_settings_owner_idx" ON "firm_settings" USING btree ("owner_id");