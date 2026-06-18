"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface EnvStatus {
  anthropic: boolean;
  courtlistener: boolean;
  tavily: boolean;
  browserless: boolean;
  loading: boolean;
}

export default function EnvCheck() {
  const [status, setStatus] = useState<EnvStatus>({
    anthropic: false,
    courtlistener: false,
    tavily: false,
    browserless: false,
    loading: true,
  });

  useEffect(() => {
    async function checkEnvVars() {
      try {
        const response = await fetch("/api/check-env");
        const data = await response.json();
        setStatus({
          anthropic: data.anthropic,
          courtlistener: data.courtlistener,
          tavily: data.tavily,
          browserless: data.browserless,
          loading: false,
        });
      } catch (error) {
        console.error("[v0] Failed to check environment variables:", error);
        setStatus((prev) => ({ ...prev, loading: false }));
      }
    }

    void checkEnvVars();
  }, []);

  if (status.loading) {
    return null;
  }

  const missingVars = [];
  if (!status.anthropic) missingVars.push("ANTHROPIC_API_KEY");
  if (!status.courtlistener) missingVars.push("COURTLISTENER_API_KEY");
  if (!status.tavily) missingVars.push("TAVILY_API_KEY");
  if (!status.browserless) missingVars.push("BROWSERLESS_API_KEY");

  if (missingVars.length === 0) {
    return (
      <Alert className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        <AlertTitle className="text-green-900 dark:text-green-100">
          All API Keys Configured
        </AlertTitle>
        <AlertDescription className="text-green-800 dark:text-green-200">
          Your environment is ready for legal analysis.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Missing API Keys</AlertTitle>
      <AlertDescription>
        <p className="mb-2">The following environment variables are not set:</p>
        <ul className="list-disc list-inside space-y-1 mb-3">
          {missingVars.map((varName) => (
            <li key={varName} className="font-mono text-sm">
              {varName}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          <strong>To fix this:</strong> Click the sidebar on the left → Go to{" "}
          <strong>Vars</strong> section → Add your API keys
        </p>
      </AlertDescription>
    </Alert>
  );
}
