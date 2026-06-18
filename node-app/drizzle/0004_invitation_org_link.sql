ALTER TABLE "invitation_tokens"
ADD COLUMN IF NOT EXISTS "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "invitation_tokens"
ADD CONSTRAINT "invitation_tokens_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
ON DELETE set null ON UPDATE no action;
