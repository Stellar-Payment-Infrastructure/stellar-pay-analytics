CREATE TABLE IF NOT EXISTS "ingest_state" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"updated_since" text NOT NULL,
	"last_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"amount" numeric(39, 0) NOT NULL,
	"token" varchar(56) NOT NULL,
	"settle_mode" varchar(8) NOT NULL,
	"fee_bps" integer,
	"fee" numeric(39, 0),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agg_payments_merchant_created_idx" ON "payments" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agg_payments_status_created_idx" ON "payments" USING btree ("status","created_at");