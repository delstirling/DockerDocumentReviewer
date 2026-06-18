ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "organization_tier" varchar(20) DEFAULT 'user' NOT NULL;
