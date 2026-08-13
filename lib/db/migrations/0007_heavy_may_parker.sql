CREATE TABLE "chatbot"."auth_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chatbot"."auth_verification_tokens" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS auth_verification_tokens_lookup_idx
  ON chatbot.auth_verification_tokens (email, used_at, expires_at DESC);
