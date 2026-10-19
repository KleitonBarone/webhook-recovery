CREATE TYPE "public"."operator_role" AS ENUM('viewer', 'operator');--> statement-breakpoint
CREATE TABLE "operator_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"role" "operator_role" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_sessions" ADD CONSTRAINT "operator_sessions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;