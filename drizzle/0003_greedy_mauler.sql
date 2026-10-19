CREATE TYPE "public"."receipt_decision" AS ENUM('applied', 'same_version', 'stale');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "completion_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"refund_id" text NOT NULL,
	"action" text DEFAULT 'completion' NOT NULL,
	"inbox_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "completion_action" CHECK ("completion_entries"."action" = 'completion')
);
--> statement-breakpoint
CREATE TABLE "processing_receipts" (
	"inbox_id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"decision" "receipt_decision" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_projections" (
	"source_id" text NOT NULL,
	"refund_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "refund_status" NOT NULL,
	"last_inbox_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_projections_source_id_refund_id_pk" PRIMARY KEY("source_id","refund_id")
);
--> statement-breakpoint
ALTER TABLE "completion_entries" ADD CONSTRAINT "completion_entries_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_entries" ADD CONSTRAINT "completion_entries_inbox_id_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_receipts" ADD CONSTRAINT "processing_receipts_inbox_id_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_receipts" ADD CONSTRAINT "processing_receipts_attempt_id_processing_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."processing_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_projections" ADD CONSTRAINT "refund_projections_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_projections" ADD CONSTRAINT "refund_projections_last_inbox_id_inbox_id_fk" FOREIGN KEY ("last_inbox_id") REFERENCES "public"."inbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "completion_business_identity" ON "completion_entries" USING btree ("source_id","refund_id","action");