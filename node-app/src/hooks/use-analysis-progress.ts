"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";

export interface AnalysisProgress {
  sessionId: number;
  currentStep: number;
  totalSteps: number;
  status: "draft" | "processing" | "complete" | "error";
  message?: string;
  timestamp: number;
  stepName?: string;
  progressPercentage?: number;
}

interface UseAnalysisProgressOptions {
  /**
   * Enable/disable SSE connection
   * @default true
   */
  enabled?: boolean;

  /**
   * Callback when connection opens
   */
  onConnect?: () => void;

  /**
   * Callback when connection closes
   */
  onDisconnect?: () => void;

  /**
   * Callback on error
   */
  onError?: (error: Event) => void;

  /**
   * Automatically reconnect on connection loss
   * @default true
   */
  autoReconnect?: boolean;
}

/**
 * React Hook for Real-Time Analysis Progress via Server-Sent Events (SSE)
 *
 * Provides live streaming of analysis progress updates, eliminating polling
 * and ensuring UI always reflects current backend state.
 *
 * Features:
 * - Automatic connection management
 * - Reconnection on disconnect (with exponential backoff)
 * - Type-safe progress updates
 * - Memory cleanup on unmount
 *
 * Based on 2025 React + SSE best practices.
 *
 * @example
 * ```tsx
 * function AnalysisView({ sessionId }) {
 *   const { progress, isConnected, error } = useAnalysisProgress(sessionId);
 *
 *   return (
 *     <div>
 *       <p>Status: {isConnected ? 'Connected' : 'Disconnected'}</p>
 *       <p>Progress: {progress?.currentStep} / {progress?.totalSteps}</p>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://www.pedroalonso.net/blog/sse-nextjs-real-time-notifications/
 * @see https://developer.mozilla.org/en-US/docs/Web/API/EventSource
 */
export function useAnalysisProgress(
  sessionId: number,
  options: UseAnalysisProgressOptions = {},
) {
  const { enabled = true, onConnect, onError, autoReconnect = true } = options;

  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // 1 second

  const onConnectRef = useRef(onConnect);
  const onErrorRef = useRef(onError);
  const autoReconnectRef = useRef(autoReconnect);

  useEffect(() => {
    onConnectRef.current = onConnect;
  }, [onConnect]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    autoReconnectRef.current = autoReconnect;
  }, [autoReconnect]);

  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const stableEnabled = useMemo(() => enabled, [enabled]);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      console.log(
        `[useAnalysisProgress] Closing connection for session ${String(sessionIdRef.current)}...`,
      );
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!stableEnabled || eventSourceRef.current) {
      return;
    }

    const sid = sessionIdRef.current;

    try {
      console.log(
        `[useAnalysisProgress] Connecting to SSE for session ${String(sid)}...`,
      );

      const url = `/api/analysis/${sid}/progress-stream`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log(
          `[useAnalysisProgress] Connected to session ${String(sid)}...`,
        );
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        onConnectRef.current?.();
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "close") {
            console.log(
              `[useAnalysisProgress] Server closed connection: ${data.reason}`,
            );
            cleanup();
            return;
          }

          setProgress(data as AnalysisProgress);
          setError(null);
        } catch (err) {
          console.error("[useAnalysisProgress] Error parsing message:", err);
          setError("Failed to parse progress update");
        }
      };

      eventSource.onerror = (event) => {
        console.error(
          `[useAnalysisProgress] SSE error for session ${String(sid)}...`,
          event,
        );

        setIsConnected(false);

        if (eventSource.readyState === EventSource.CLOSED) {
          console.error(
            "[useAnalysisProgress] SSE connection closed. Polling fallback should activate automatically.",
          );
          cleanup();

          if (
            autoReconnectRef.current &&
            reconnectAttemptsRef.current < maxReconnectAttempts
          ) {
            const delay =
              baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
            console.log(
              `[useAnalysisProgress] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})...`,
            );

            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectAttemptsRef.current++;
              connect();
            }, delay);
          } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
            setError(
              `Failed to reconnect after ${maxReconnectAttempts} attempts`,
            );
          }
        }

        onErrorRef.current?.(event);
      };
    } catch (err) {
      console.error("[useAnalysisProgress] Error creating EventSource:", err);
      setError(
        err instanceof Error ? err.message : "Failed to create SSE connection",
      );
      cleanup();
    }
  }, [stableEnabled, cleanup]);

  useEffect(() => {
    if (!stableEnabled || !sessionId) {
      cleanup();
      return;
    }

    connect();

    return () => {
      cleanup();
    };
  }, [sessionId, stableEnabled, connect, cleanup]);

  return {
    progress,
    isConnected,
    error,
    reconnect: connect,
  };
}
