CREATE TYPE "public"."fault_kind" AS ENUM('transient', 'permanent');--> statement-breakpoint
CREATE TABLE "synthetic_faults" (
	"source_id" text NOT NULL,
	"refund_id" text NOT NULL,
	"kind" "fault_kind" NOT NULL,
	"fail_for_attempts" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "synthetic_faults_source_id_refund_id_pk" PRIMARY KEY("source_id","refund_id"),
	CONSTRAINT "fault_attempt_bound" CHECK ("synthetic_faults"."fail_for_attempts" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "processing_attempts" ADD COLUMN "cycle_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_attempts" ADD COLUMN "cycle_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_attempts" ADD COLUMN "replay_id" uuid;--> statement-breakpoint
ALTER TABLE "processing_attempts" ADD COLUMN "retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "processing_attempts" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "inbox" ADD COLUMN "cycle_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox" ADD COLUMN "cycle_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox" ADD COLUMN "current_replay_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "synthetic_faults" ADD CONSTRAINT "synthetic_faults_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_retry_due" ON "inbox" USING btree ("state","next_attempt_at");--> statement-breakpoint
ALTER TABLE "inbox" ADD CONSTRAINT "inbox_retry_schedule" CHECK (("inbox"."state" = 'retry_scheduled') = ("inbox"."next_attempt_at" is not null));--> statement-breakpoint
UPDATE "inbox" SET "cycle_attempt" = "attempt_number";--> statement-breakpoint
UPDATE "processing_attempts" SET "cycle_attempt" = "number";
