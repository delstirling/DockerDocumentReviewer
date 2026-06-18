import type { NextRequest } from "next/server";

export function getBaseUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host) {
    return `${proto}://${host}`;
  }

  return req.nextUrl.origin;
}

export async function triggerOrchestratorNow(
  baseUrl: string,
  sessionId: unknown,
  reason: unknown,
  bypassSecret?: string,
): Promise<void> {
  const sessionIdText = String(sessionId ?? "");
  const reasonText = String(reason ?? "orchestrator-trigger");
  const url = `${baseUrl.replace(/\/$/, "")}/api/analysis/${sessionIdText}/orchestrate`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (bypassSecret) {
    headers["x-internal-api-token"] = bypassSecret;
  }

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: reasonText }),
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      `[OrchestratorTrigger] Failed triggering session ${sessionId}:`,
      error,
    );
  }
}
