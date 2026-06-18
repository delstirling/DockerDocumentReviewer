ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "users"
ADD CONSTRAINT "users_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
ON DELETE set null ON UPDATE no action;
