"use client";

import { useEffect, useRef } from "react";

interface UIState {
  currentStep: number;
  status: string;
  lastUpdated: string;
}

interface SyncCheckResult {
  health: "healthy" | "degraded" | "critical";
  comparison: {
    ui: UIState;
    backend: {
      currentStep: number;
      totalSteps: number;
      status: string;
      lastUpdated: Date;
    };
    drift: {
      steps: number;
      statusMismatch: boolean;
      timeSeconds: number | null;
    };
  };
  issues: string[] | null;
  recommendations: string[] | null;
}

/**
 * useUIBackendSync Hook
 *
 * Automatically monitors for coordination issues between UI state and backend state.
 * Reports discrepancies and can trigger automatic recovery actions.
 *
 * Usage:
 * ```typescript
 * const { health, drift, forceSync } = useUIBackendSync({
 *   sessionId: "xxx",
 *   currentStep: 4,
 *   status: "processing",
 *   lastUpdated: new Date(),
 *   onCriticalDrift: () => {
 *     // Auto-refresh or show warning
 *     window.location.reload();
 *   }
 * });
 * ```
 */
export function useUIBackendSync({
  sessionId,
  currentStep,
  status,
  lastUpdated,
  enabled = true,
  checkInterval = 10000, // Check every 10 seconds
  onCriticalDrift,
  onDegraded,
}: {
  sessionId: number;
  currentStep: number;
  status: string;
  lastUpdated: Date;
  enabled?: boolean;
  checkInterval?: number;
  onCriticalDrift?: (result: SyncCheckResult) => void;
  onDegraded?: (result: SyncCheckResult) => void;
}) {
  const lastCheckRef = useRef<SyncCheckResult | null>(null);
  const criticalAlertShownRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const checkSync = async () => {
      try {
        const response = await fetch("/api/monitoring/ui-backend-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            uiState: {
              currentStep,
              status,
              lastUpdated: lastUpdated.toISOString(),
            },
          }),
        });

        const result: SyncCheckResult = await response.json();
        lastCheckRef.current = result;

        // Handle critical drift
        if (result.health === "critical") {
          console.error(
            "[UI-Backend Sync] CRITICAL DRIFT DETECTED:",
            JSON.stringify(result).replace(/[\n\r]/g, ""),
          );

          // Only show alert once to avoid spam
          if (!criticalAlertShownRef.current) {
            criticalAlertShownRef.current = true;

            if (onCriticalDrift) {
              onCriticalDrift(result);
            } else {
              // Default behavior: show alert and offer to refresh
              const shouldRefresh = confirm(
                `⚠️ UI OUT OF SYNC\n\n` +
                  `The page is showing outdated information:\n` +
                  `- UI shows: Step ${result.comparison.ui.currentStep}\n` +
                  `- Actual: Step ${result.comparison.backend.currentStep}\n\n` +
                  `Click OK to refresh and see current progress.`,
              );

              if (shouldRefresh) {
                window.location.reload();
              }
            }
          }
        } else {
          // Reset critical alert flag when healthy/degraded
          criticalAlertShownRef.current = false;
        }

        // Handle degraded state
        if (result.health === "degraded" && onDegraded) {
          onDegraded(result);
        }

        // Log all non-healthy states to console
        if (result.health !== "healthy") {
          console.warn("[UI-Backend Sync] Coordination issue detected:", {
            health: result.health,
            issues: result.issues,
            drift: result.comparison.drift,
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const sanitizedError = errorMsg.replace(/[\r\n]/g, "");
        console.error("[UI-Backend Sync] Check failed:", sanitizedError);
      }
    };

    // Initial check
    checkSync();

    // Periodic checks
    const interval = setInterval(checkSync, checkInterval);

    return () => clearInterval(interval);
  }, [
    sessionId,
    currentStep,
    status,
    lastUpdated,
    enabled,
    checkInterval,
    onCriticalDrift,
    onDegraded,
  ]);

  return {
    health: lastCheckRef.current?.health || "unknown",
    drift: lastCheckRef.current?.comparison?.drift,
    issues: lastCheckRef.current?.issues,
    recommendations: lastCheckRef.current?.recommendations,
    forceSync: async () => {
      // Manual sync check - useful for debugging
      const response = await fetch("/api/monitoring/ui-backend-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          uiState: {
            currentStep,
            status,
            lastUpdated: lastUpdated.toISOString(),
          },
        }),
      });
      return response.json();
    },
  };
}

/**
 * Debug component that shows UI/Backend sync status
 * Add this to your analysis page during development
 */
export function UIBackendSyncDebug({
  sessionId,
  currentStep,
  status,
  lastUpdated,
}: {
  sessionId: number;
  currentStep: number;
  status: string;
  lastUpdated: Date;
}) {
  const { health, drift, issues, recommendations } = useUIBackendSync({
    sessionId,
    currentStep,
    status,
    lastUpdated,
    enabled: true,
    checkInterval: 5000,
  });

  if (health === "healthy" || health === "unknown") {
    return null; // Don't show anything when healthy
  }

  const bgColor =
    health === "critical"
      ? "bg-red-100 border-red-500"
      : "bg-yellow-100 border-yellow-500";
  const textColor = health === "critical" ? "text-red-900" : "text-yellow-900";

  return (
    <div
      className={`fixed bottom-4 right-4 max-w-md p-4 border-2 rounded-lg shadow-lg ${bgColor} ${textColor} z-50`}
    >
      <div className="flex items-start gap-2">
        <div className="text-2xl">{health === "critical" ? "🔴" : "⚠️"}</div>
        <div className="flex-1">
          <h3 className="font-bold mb-2">
            {health === "critical"
              ? "Critical UI Sync Issue"
              : "UI Sync Warning"}
          </h3>

          {drift && (
            <div className="text-sm mb-2">
              <p>Step drift: {drift.steps} steps</p>
              {drift.timeSeconds && (
                <p>Data age: {Math.round(drift.timeSeconds)}s</p>
              )}
            </div>
          )}

          {issues && (
            <ul className="text-sm mb-2 list-disc list-inside">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}

          {recommendations && (
            <div className="text-xs mt-2">
              <p className="font-semibold">Recommended actions:</p>
              <ul className="list-disc list-inside">
                {recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-3 py-1 bg-white rounded text-sm font-medium hover:bg-gray-100"
          >
            Refresh Page
          </button>
        </div>
      </div>
    </div>
  );
}
