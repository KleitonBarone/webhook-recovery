CREATE TABLE "replay_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"inbox_id" uuid NOT NULL,
	"operator_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"reason" text NOT NULL,
	"cycle_number" integer NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replay_reason_length" CHECK (length("replay_requests"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "replay_requests" ADD CONSTRAINT "replay_requests_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_requests" ADD CONSTRAINT "replay_requests_inbox_id_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "replay_operator_key" ON "replay_requests" USING btree ("source_id","operator_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "replay_event_cycle" ON "replay_requests" USING btree ("inbox_id","cycle_number");--> statement-breakpoint
ALTER TABLE "processing_attempts" ADD CONSTRAINT "processing_attempts_replay_id_replay_requests_id_fk" FOREIGN KEY ("replay_id") REFERENCES "public"."replay_requests"("id") ON DELETE no action ON UPDATE no action;