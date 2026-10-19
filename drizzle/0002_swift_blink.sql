CREATE TYPE "public"."attempt_outcome" AS ENUM('running', 'abandoned', 'processed', 'ignored_stale', 'dead_lettered', 'retry_scheduled');--> statement-breakpoint
CREATE TABLE "processing_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inbox_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"worker_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" "attempt_outcome" DEFAULT 'running' NOT NULL,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "inbox" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "inbox" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox" ADD COLUMN "attempt_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "processing_attempts" ADD CONSTRAINT "processing_attempts_inbox_id_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_event_number" ON "processing_attempts" USING btree ("inbox_id","number");--> statement-breakpoint
CREATE INDEX "inbox_claim_due" ON "inbox" USING btree ("state","lease_until","accepted_at");--> statement-breakpoint
ALTER TABLE "inbox" ADD CONSTRAINT "inbox_processing_lease" CHECK (("inbox"."state" = 'processing' and "inbox"."lease_token" is not null and "inbox"."lease_until" is not null) or ("inbox"."state" <> 'processing' and "inbox"."lease_token" is null and "inbox"."lease_until" is null));