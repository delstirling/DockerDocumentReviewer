DO $$
BEGIN
  CREATE TYPE organization_tier AS ENUM ('user', 'admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "users"
ALTER COLUMN "organization_tier" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "users"
ALTER COLUMN "organization_tier"
TYPE organization_tier
USING (
  CASE
    WHEN lower(coalesce("organization_tier", '')) = 'admin' THEN 'admin'::organization_tier
    ELSE 'user'::organization_tier
  END
);
--> statement-breakpoint
ALTER TABLE "users"
ALTER COLUMN "organization_tier" SET DEFAULT 'user';
