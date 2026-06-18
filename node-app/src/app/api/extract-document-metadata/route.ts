import { POST as documentAnalysisPOST } from "../document-analysis/route";

/**
 * API endpoint `/api/extract-document-metadata`.
 *
 * The UI expects this route to exist. The original implementation lives in
 * `src/app/api/document-analysis/route.ts` which performs the full document
 * analysis, including metadata extraction. To avoid duplicating logic we simply
 * re‑export the POST handler from that module.
 */
export const POST = documentAnalysisPOST;

// The Next.js app router also supports a GET handler for health checks, but the
// UI only uses POST. Providing a minimal GET avoids 405 responses if accessed
// inadvertently.
export async function GET() {
  return new Response(JSON.stringify({ message: "extract-document-metadata endpoint" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
