CREATE TYPE "public"."processing_state" AS ENUM('received', 'processing', 'retry_scheduled', 'processed', 'ignored_stale', 'dead_lettered');--> statement-breakpoint
CREATE TABLE "inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"raw" text NOT NULL,
	"body_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" "processing_state" DEFAULT 'received' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox" ADD CONSTRAINT "inbox_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_source_event" ON "inbox" USING btree ("source_id","event_id");--> statement-breakpoint
CREATE INDEX "inbox_source_accepted" ON "inbox" USING btree ("source_id","accepted_at");