/**
 * Settings Service
 * Server-side service for reading/writing database-backed settings
 */

import { db } from "@/db/client";
import { appSettings } from "@/db/schema/settings";
import { organizations, users } from "@/db/schema/auth";
import { analysisSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface SmallModelConfig {
  modelId: string;
  description: string;
  active: boolean;
}

export interface PrimaryModelConfig {
  modelId: string;
  name: string;
  description: string;
}

export interface ProviderConfig {
  provider: "anthropic" | "local" | "fireworks";
  localModelName: string;
  fireworksModelName?: string;
}

export interface GlobalTokenOverride {
  enabled: boolean;
  maxOutputTokens: number;
}

const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "anthropic",
  localModelName: "llama3.3:70b",
};

const DEFAULT_GLOBAL_TOKEN_OVERRIDE: GlobalTokenOverride = {
  enabled: false,
  maxOutputTokens: 50000,
};

const DEFAULT_SMALL_MODEL: SmallModelConfig = {
  modelId: "haiku-4.5",
  description: "Used for citation verification and lightweight tasks",
  active: true,
};

const DEFAULT_PRIMARY_MODEL: PrimaryModelConfig = {
  modelId: "sonnet-4.6",
  name: "Claude Sonnet 4.6",
  description: "Default model for comprehensive legal document analysis",
};

/**
 * Get the configured small model for citation verification
 * Returns default if not configured
 */
export async function getSmallModel(): Promise<SmallModelConfig> {
  try {
    const result = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "verification_small_model"))
      .limit(1);

    if (result.length === 0) {
      return DEFAULT_SMALL_MODEL;
    }

    return result[0].value as SmallModelConfig;
  } catch (error) {
    console.error("Failed to load small model setting:", error);
    return DEFAULT_SMALL_MODEL;
  }
}

/**
 * Set the small model configuration
 */
export async function setSmallModel(config: SmallModelConfig): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "verification_small_model"))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(appSettings).values({
        key: "verification_small_model",
        value: config as any,
        description: "Small model configuration for citation verification",
      });
    } else {
      await db
        .update(appSettings)
        .set({
          value: config as any,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.key, "verification_small_model"));
    }
  } catch (error) {
    console.error("Failed to save small model setting:", error);
    throw new Error("Failed to save small model setting");
  }
}

/**
 * Get the configured primary model for analysis
 * Returns default if not configured
 */
export async function getPrimaryModel(): Promise<PrimaryModelConfig> {
  try {
    const result = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "primary_model"))
      .limit(1);

    if (result.length === 0) {
      return DEFAULT_PRIMARY_MODEL;
    }

    return result[0].value as PrimaryModelConfig;
  } catch (error) {
    console.error("Failed to load primary model setting:", error);
    return DEFAULT_PRIMARY_MODEL;
  }
}

/**
 * Set the primary model configuration
 */
export async function setPrimaryModel(
  config: PrimaryModelConfig,
): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "primary_model"))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(appSettings).values({
        key: "primary_model",
        value: config as unknown as Record<string, unknown>,
        description: "Primary AI model configuration for document analysis",
      });
    } else {
      await db
        .update(appSettings)
        .set({
          value: config as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.key, "primary_model"));
    }
  } catch (error) {
    console.error("Failed to save primary model setting:", error);
    throw new Error("Failed to save primary model setting");
  }
}

/**
 * Get the configured LLM provider
 */
export async function getProviderConfig(): Promise<ProviderConfig> {
  try {
    const result = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "llm_provider"))
      .limit(1);

    if (result.length === 0) {
      return DEFAULT_PROVIDER_CONFIG;
    }

    return result[0].value as ProviderConfig;
  } catch (error) {
    console.error("Failed to load provider setting:", error);
    return DEFAULT_PROVIDER_CONFIG;
  }
}

/**
 * Set the LLM provider configuration
 */
export async function setProviderConfig(config: ProviderConfig): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "llm_provider"))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(appSettings).values({
        key: "llm_provider",
        value: config as unknown as Record<string, unknown>,
        description:
          "LLM provider configuration (anthropic, fireworks, or local)",
      });
    } else {
      await db
        .update(appSettings)
        .set({
          value: config as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.key, "llm_provider"));
    }
  } catch (error) {
    console.error("Failed to save provider setting:", error);
    throw new Error("Failed to save provider setting");
  }
}

/**
 * Get the global token override configuration
 * When enabled, this overrides the per-step maxTokens for all workflow steps
 */
export async function getGlobalTokenOverride(): Promise<GlobalTokenOverride> {
  try {
    const result = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "global_token_override"))
      .limit(1);

    if (result.length === 0) {
      return DEFAULT_GLOBAL_TOKEN_OVERRIDE;
    }

    return result[0].value as GlobalTokenOverride;
  } catch (error) {
    console.error("Failed to load global token override:", error);
    return DEFAULT_GLOBAL_TOKEN_OVERRIDE;
  }
}

/**
 * Set the global token override configuration
 */
export async function setGlobalTokenOverride(
  config: GlobalTokenOverride,
): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "global_token_override"))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(appSettings).values({
        key: "global_token_override",
        value: config as unknown as Record<string, unknown>,
        description: "Global max output tokens override for all workflow steps",
      });
    } else {
      await db
        .update(appSettings)
        .set({
          value: config as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.key, "global_token_override"));
    }
  } catch (error) {
    console.error("Failed to save global token override:", error);
    throw new Error("Failed to save global token override");
  }
}

/**
 * Get the model ID for URL case verification
 * This is a convenience function that returns just the model ID string
 * for use with the AI SDK
 */
export async function getVerificationModel(): Promise<string> {
  const config = await getSmallModel();
  return config.modelId;
}

/**
 * Initialize default settings if they don't exist
 */
export async function initializeDefaultSettings(): Promise<void> {
  try {
    const smallModel = await getSmallModel();
    if (smallModel === DEFAULT_SMALL_MODEL) {
      await setSmallModel(DEFAULT_SMALL_MODEL);
    }
  } catch (error) {
    console.error("Failed to initialize default settings:", error);
  }
}

/**
 * Organization settings interface for server-side use
 */
export interface OrganizationSettings {
  lawFirmName: string;
  documentAuthor: {
    name: string;
    email: string;
  };
}

const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  lawFirmName: "Legal Analysis Report",
  documentAuthor: {
    name: "",
    email: "",
  },
};

/**
 * Get organization settings by user ID (server-side)
 * Fetches law firm name and document author from the organizations table
 * Returns defaults if not found
 */
export async function getOrganizationSettingsByUserId(
  userId: string,
): Promise<OrganizationSettings> {
  try {
    // Single JOIN query instead of 2 sequential queries
    const [result] = await db
      .select({
        orgName: organizations.name,
        userName: users.name,
        userEmail: users.email,
      })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(eq(users.id, Number(userId)))
      .limit(1);

    if (!result) {
      console.warn(
        `[Settings] User ${userId} has no organization or organization not found, using defaults`,
      );
      return DEFAULT_ORGANIZATION_SETTINGS;
    }

    return {
      lawFirmName: result.orgName || DEFAULT_ORGANIZATION_SETTINGS.lawFirmName,
      documentAuthor: {
        name: result.userName || "",
        email: result.userEmail || "",
      },
    };
  } catch (error) {
    console.error("[Settings] Failed to load organization settings:", error);
    return DEFAULT_ORGANIZATION_SETTINGS;
  }
}

/**
 * Get organization settings by session ID (server-side)
 * Looks up the user from the analysis session, then fetches their organization settings
 *
 * Priority for law firm name resolution:
 * 1. DocumentReviewer organization settings (set via /settings UI) - USER CHOICE TAKES PRIORITY
 * 2. chatuserinterface override (from X-Law-Firm-Name header)
 * 3. Default fallback
 *
 * This ensures the law firm name set in DocumentReviewer's /settings page
 * is always used in reports, regardless of whether the session was initiated
 * from chatuserinterface or directly.
 *
 * Returns defaults if not found
 */
export async function getOrganizationSettingsBySessionId(
  sessionId: string,
): Promise<OrganizationSettings> {
  const sessionIdNum = Number(sessionId);
  try {
    const [session] = await db
      .select({
        userId: analysisSessions.userId,
        lawFirmNameOverride: analysisSessions.lawFirmNameOverride,
        documentAuthorNameOverride: analysisSessions.documentAuthorNameOverride,
        sourceSystem: analysisSessions.sourceSystem,
      })
      .from(analysisSessions)
      .where(eq(analysisSessions.id, sessionIdNum))
      .limit(1);

    if (!session) {
      console.warn(`[Settings] Session ${sessionId} not found, using defaults`);
      return DEFAULT_ORGANIZATION_SETTINGS;
    }

    // For ALL sessions (including chatuserinterface), prefer DocumentReviewer
    // organization settings if the session has a linked userId.
    // The user sets their law firm name via the /settings page, and that
    // should be the source of truth for report branding.
    if (session.userId) {
      const orgSettings = await getOrganizationSettingsByUserId(
        String(session.userId),
      );

      // If DocumentReviewer org has a real name (not the default), use it
      if (
        orgSettings.lawFirmName &&
        orgSettings.lawFirmName !== DEFAULT_ORGANIZATION_SETTINGS.lawFirmName
      ) {
        // For chatuserinterface sessions, use the override for document author
        // if the org settings don't have one
        if (session.sourceSystem === "chatuserinterface") {
          const finalSettings: OrganizationSettings = {
            lawFirmName: orgSettings.lawFirmName,
            documentAuthor: {
              name:
                orgSettings.documentAuthor.name ||
                session.documentAuthorNameOverride ||
                DEFAULT_ORGANIZATION_SETTINGS.documentAuthor.name,
              email:
                orgSettings.documentAuthor.email ||
                DEFAULT_ORGANIZATION_SETTINGS.documentAuthor.email,
            },
          };

          console.log(
            `[Settings] Using DocumentReviewer org settings for chatuserinterface session ${sessionId}: lawFirmName="${finalSettings.lawFirmName}", documentAuthor="${finalSettings.documentAuthor.name}"`,
          );

          return finalSettings;
        }

        return orgSettings;
      }
    }

    // Fallback for chatuserinterface sessions: use override values
    if (session.sourceSystem === "chatuserinterface") {
      const settings: OrganizationSettings = {
        lawFirmName:
          session.lawFirmNameOverride ||
          DEFAULT_ORGANIZATION_SETTINGS.lawFirmName,
        documentAuthor: {
          name:
            session.documentAuthorNameOverride ||
            DEFAULT_ORGANIZATION_SETTINGS.documentAuthor.name,
          email: DEFAULT_ORGANIZATION_SETTINGS.documentAuthor.email,
        },
      };

      console.log(
        `[Settings] Using chatuserinterface overrides for session ${sessionId}: lawFirmName="${settings.lawFirmName}", documentAuthor="${settings.documentAuthor.name}"`,
      );

      return settings;
    }

    // No userId and not chatuserinterface
    if (!session.userId) {
      console.warn(
        `[Settings] Session ${sessionId} has no user, using defaults`,
      );
      return DEFAULT_ORGANIZATION_SETTINGS;
    }

    return getOrganizationSettingsByUserId(String(session.userId));
  } catch (error) {
    console.error(
      "[Settings] Failed to load organization settings by session:",
      error,
    );
    return DEFAULT_ORGANIZATION_SETTINGS;
  }
}
