"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  getFromLocalStorage,
  setToLocalStorage,
} from "@/hooks/use-local-storage";
import { usePendingInvitationToken } from "@/hooks/use-pending-invitation-token";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function DashboardRedirect() {
  const { data: session, status } = useSession();
  const router = useRouter();
  usePendingInvitationToken();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") {
      console.log("[Dashboard] User not authenticated, redirecting to signin");
      router.push("/auth/signin?callbackUrl=/dashboard");
      return;
    }

    console.log("[Dashboard] User authenticated, checking for recent session");
    const lastLeftAt = getFromLocalStorage<number>("lastLeftAt", 0);
    const lastSessionId = getFromLocalStorage<number>("lastSessionId", 0);
    const now = Date.now();
    const timeSinceLeft = now - lastLeftAt;

    if (timeSinceLeft < 30000 && lastSessionId) {
      console.log(
        `[Dashboard] Resuming recent session: ${lastSessionId} (${timeSinceLeft}ms ago)`,
      );
      router.replace(`/dashboard/${lastSessionId}`);
      return;
    }

    console.log("[Dashboard] Creating new draft session");
    createDraftSession();
  }, [status, router]);

  const createDraftSession = async () => {
    try {
      console.log("[Dashboard] Calling POST /api/sessions/create-draft");
      const response = await fetch("/api/sessions/create-draft", {
        method: "POST",
        credentials: "same-origin",
      });

      console.log(
        `[Dashboard] Response status: ${response.status} ${response.statusText.replace(/[\n\r]/g, "")}`,
      );

      if (response.status === 401) {
        console.error(
          "[Dashboard] 401 Unauthorized - session not established, redirecting to signin",
        );
        setError("Authentication required. Please sign in to continue.");
        setTimeout(() => {
          router.push("/auth/signin?callbackUrl=/dashboard");
        }, 2000);
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(
          "[Dashboard] Failed to create draft session:",
          response.status,
          JSON.stringify(errorData).replace(/[\n\r]/g, ""),
        );
        setError(
          `Failed to create session (${response.status}). Please try again.`,
        );
        return;
      }

      const data = await response.json();
      const sessionId = Number(data.sessionId);

      console.log(`[Dashboard] Draft session created: ${sessionId}`);

      setToLocalStorage("lastSessionId", sessionId);
      setToLocalStorage("lastLeftAt", Date.now());

      router.replace(`/dashboard/${sessionId}`);
    } catch (error) {
      console.error(
        "[Dashboard] Exception creating draft session:",
        String(error).replace(/[\n\r]/g, ""),
      );
      setError(
        "An unexpected error occurred. Please refresh the page and try again.",
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-4">
        {error && (
          <Alert variant="destructive" className="bg-red-900/50 border-red-700">
            <AlertDescription className="text-red-200">
              {error}
            </AlertDescription>
          </Alert>
        )}
        <div className="text-center text-gray-400">
          {error ? "Redirecting..." : "Loading..."}
        </div>
      </div>
    </div>
  );
}
