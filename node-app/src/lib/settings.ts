/**
 * Settings Management Library
 * Handles application settings with localStorage persistence
 * Future: Will be migrated to database for multi-tenant support
 */

export interface AppSettings {
  lawFirmName: string;
  documentAuthor: {
    name: string;
    email: string;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  lawFirmName: "",
  documentAuthor: {
    name: "",
    email: "",
  },
};

const SETTINGS_KEY = "app_settings";

/**
 * Load settings from localStorage
 * Returns default settings if none are saved
 */
export function loadSettings(): AppSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(stored);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      documentAuthor: {
        ...DEFAULT_SETTINGS.documentAuthor,
        ...(parsed.documentAuthor || {}),
      },
    };
  } catch (error) {
    console.error("Failed to load settings:", error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save settings to localStorage
 */
export function saveSettings(settings: AppSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to save settings:", error);
    throw new Error("Failed to save settings");
  }
}

/**
 * Reset settings to defaults
 */
export function resetSettings(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch (error) {
    console.error("Failed to reset settings:", error);
  }
}
