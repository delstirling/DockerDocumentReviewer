import { db } from "@/db/client";
import { organizations } from "@/db/schema/auth";

export async function ensureDefaultOrganizationId(): Promise<number> {
  const [existingOrganization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .limit(1);

  if (existingOrganization) {
    return existingOrganization.id;
  }

  const now = new Date();
  const [newOrganization] = await db
    .insert(organizations)
    .values({
      name: "Default Organization",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: organizations.id });

  return newOrganization.id;
}