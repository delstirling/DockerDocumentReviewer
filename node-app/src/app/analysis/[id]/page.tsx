import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { SessionDisplay } from "@/components/session-display";
import { AnalysisLayout } from "@/components/analysis-layout";
import { Loader2 } from "lucide-react";

export default async function AnalysisSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/signin");
  }

  // Await params to extract the id (Next.js 15/16 breaking change)
  let id: string;
  try {
    const resolvedParams = await params;
    const rawId = resolvedParams.id;

    if (typeof rawId !== "string" || !rawId) {
      throw new Error("Invalid params.id");
    }

    console.log(
      `[AnalysisPage] Raw params.id: "${rawId}" (length: ${rawId.length}, last char code: ${rawId.charCodeAt(rawId.length - 1)})`,
    );

    const decodedId = decodeURIComponent(rawId);
    id = decodedId.trim();

    console.log(`[AnalysisPage] Decoded params.id: "${decodedId}"`);
    console.log(
      `[AnalysisPage] Sanitized params.id: "${id}" (length: ${id.length})`,
    );
  } catch (error) {
    console.error("[AnalysisPage] Error extracting params:", error);
    throw error;
  }

  const sessionId = Number.parseInt(id, 10);

  return (
    <div className="container mx-auto py-8 bg-gray-950 min-h-screen relative">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-[50vh]">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        }
      >
        <div className="relative z-10">
          <SessionDisplay sessionId={sessionId} />
        </div>
      </Suspense>
    </div>
  );
}
