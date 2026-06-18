"use client";

import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function AnalysisError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AnalysisError] Client-side error caught:", error);
    console.error("[AnalysisError] Error stack:", error.stack);
    console.error("[AnalysisError] Error digest:", error.digest);
  }, [error]);

  return (
    <div className="container mx-auto py-8 bg-gray-950 min-h-screen">
      <div className="max-w-2xl mx-auto mt-20">
        <Alert variant="destructive" className="bg-red-900/50 border-red-700">
          <AlertCircle className="h-5 w-5" />
          <AlertTitle className="text-lg font-semibold text-red-200">
            Error Loading Analysis Page
          </AlertTitle>
          <AlertDescription className="mt-2 text-red-200">
            <p className="mb-4">
              An error occurred while loading the analysis page. This could be
              due to:
            </p>
            <ul className="list-disc list-inside mb-4 space-y-1">
              <li>Invalid session ID in the URL</li>
              <li>Session not found or expired</li>
              <li>Network connectivity issues</li>
              <li>Authentication problems</li>
            </ul>
            <p className="mb-4 font-mono text-sm bg-red-950/50 p-2 rounded">
              {error.message}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => reset()}
                variant="outline"
                className="bg-red-800 hover:bg-red-700 text-white border-red-600"
              >
                Try Again
              </Button>
              <Button
                onClick={() => (window.location.href = "/dashboard")}
                variant="outline"
                className="bg-gray-800 hover:bg-gray-700 text-white border-gray-600"
              >
                Return to Dashboard
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
