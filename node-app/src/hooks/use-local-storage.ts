import { useState, useEffect } from "react";

/**
 * Custom hook for localStorage with SSR safety
 * Automatically syncs state with localStorage
 *
 * @param key - localStorage key
 * @param initialValue - default value if key doesn't exist
 * @returns [storedValue, setValue] - similar to useState
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((val: T) => T)) => void] {
  // Initialize state with a function to avoid SSR issues
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  // Update localStorage when state changes
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const replacer = (key: string, value: any) => {
        if (typeof File !== "undefined" && value instanceof File) {
          return undefined;
        }
        if (
          Array.isArray(value) &&
          value.length > 0 &&
          typeof File !== "undefined" &&
          value[0] instanceof File
        ) {
          return undefined;
        }
        return value;
      };
      window.localStorage.setItem(key, JSON.stringify(storedValue, replacer));
    } catch (error) {}
  }, [key, storedValue]);

  // Wrapper to support both direct values and updater functions
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
    } catch (error) {}
  };

  return [storedValue, setValue];
}

/**
 * Hook to sync state across browser tabs
 * Listens to localStorage 'storage' event
 *
 * @param key - localStorage key to sync
 * @param callback - function to call when value changes in another tab
 */
export function useStorageSync<T>(
  key: string,
  callback: (newValue: T | null) => void,
) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          const newValue = JSON.parse(e.newValue) as T;
          callback(newValue);
        } catch (error) {}
      } else if (e.key === key && e.newValue === null) {
        callback(null);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [key, callback]);
}

/**
 * Remove a specific key from localStorage
 *
 * @param key - localStorage key to remove
 */
export function removeFromLocalStorage(key: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {}
  }
}

/**
 * Clear all localStorage (use with caution!)
 */
export function clearLocalStorage(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.clear();
    } catch (error) {}
  }
}

/**
 * Get a value from localStorage without using hooks
 * Useful for one-time reads
 *
 * @param key - localStorage key
 * @param defaultValue - value to return if key doesn't exist
 * @returns parsed value or defaultValue
 */
export function getFromLocalStorage<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") {
    return defaultValue;
  }

  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    return defaultValue;
  }
}

/**
 * Set a value in localStorage without using hooks
 * Useful for one-time writes
 *
 * @param key - localStorage key
 * @param value - value to store
 */
export function setToLocalStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const replacer = (key: string, value: any) => {
      if (typeof File !== "undefined" && value instanceof File) {
        return undefined;
      }
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        typeof File !== "undefined" &&
        value[0] instanceof File
      ) {
        return undefined;
      }
      return value;
    };
    window.localStorage.setItem(key, JSON.stringify(value, replacer));
  } catch (error) {}
}
