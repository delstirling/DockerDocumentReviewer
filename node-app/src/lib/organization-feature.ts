import { sql } from "drizzle-orm";
import { db } from "@/db/client";

let cachedAvailability: boolean | null = null;

async function tableExists(tableName: string): Promise<boolean> {
  const result = await db.execute(sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${tableName}
    ) as "exists"
  `);

  return Boolean(result.rows?.[0]?.exists);
}

async function columnExists(
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ${tableName}
        and column_name = ${columnName}
    ) as "exists"
  `);

  return Boolean(result.rows?.[0]?.exists);
}

export async function isOrganizationFeatureAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) {
    return cachedAvailability;
  }

  try {
    const [hasOrganizationsTable, hasUsersOrganizationColumn, hasUsersOrganizationTierColumn] =
      await Promise.all([
        tableExists("organizations"),
        columnExists("users", "organization_id"),
        columnExists("users", "organization_tier"),
      ]);

    cachedAvailability =
      hasOrganizationsTable &&
      hasUsersOrganizationColumn &&
      hasUsersOrganizationTierColumn;
    return cachedAvailability;
  } catch (error) {
    console.error("Failed to verify organization feature availability:", error);
    cachedAvailability = false;
    return cachedAvailability;
  }
}

export function clearOrganizationFeatureAvailabilityCache() {
  cachedAvailability = null;
}
