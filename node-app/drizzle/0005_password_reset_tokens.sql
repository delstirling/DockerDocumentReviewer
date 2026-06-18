CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "token_hash" varchar(255) NOT NULL,
  "used" boolean DEFAULT false NOT NULL,
  "used_at" timestamp,
  "expires" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens"
ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk"
FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_idx"
ON "password_reset_tokens" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_expires_idx"
ON "password_reset_tokens" ("expires");
