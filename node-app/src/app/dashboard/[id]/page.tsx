"use client";

import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText } from "lucide-react";
import { AnalysisLayout } from "@/components/analysis-layout";
import { TopTitleBar } from "@/components/top-title-bar";
import { setToLocalStorage } from "@/hooks/use-local-storage";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params?.id ? Number(params.id) : 0;

  // Redirect to signin if not authenticated
  useEffect(() => {
    if (status === "unauthenticated" && sessionId) {
      router.push(`/auth/signin?callbackUrl=/dashboard/${sessionId}`);
    }
  }, [status, router, sessionId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setToLocalStorage("lastLeftAt", Date.now());
        setToLocalStorage("lastSessionId", sessionId);
      }
    };

    const handleBeforeUnload = () => {
      setToLocalStorage("lastLeftAt", Date.now());
      setToLocalStorage("lastSessionId", sessionId);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [sessionId]);

  // Show loading while checking auth
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  // Don't render if not authenticated
  if (status === "unauthenticated") {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <TopTitleBar />

      {/* Layout with sidebar under header */}
      <AnalysisLayout sessionId={sessionId}>
        <div className="flex-1 bg-gray-950">
          <main
            id="data-panel"
            className="container mx-auto px-4 py-8 relative z-10"
          >
          <div className="max-w-4xl mx-auto space-y-6">
            <Card className="bg-gray-900/80 border-gray-700 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-100">
                  Legal Document Analysis
                </CardTitle>
                <CardDescription className="text-gray-400">
                  Use the side panel to upload and configure your legal
                  documents for AI-powered analysis. The Data tab provides
                  document upload and metadata extraction, while the History tab
                  shows your previous analysis sessions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert className="bg-gray-800/50 border-gray-700">
                  <FileText className="h-4 w-4 text-blue-400" />
                  <AlertDescription className="text-gray-300">
                    <strong className="text-gray-100">Getting Started:</strong>
                    <ol className="mt-2 ml-4 list-decimal space-y-1">
                      <li>
                        Open the Data panel on the left (if not already visible)
                      </li>
                      <li>Upload your subject document</li>
                      <li>
                        Add context documents (optional) to provide additional
                        background
                      </li>
                      <li>
                        Click "Get Summary" or "Get Parties" to extract metadata
                        from your documents
                      </li>
                      <li>
                        Review and edit the extracted information as needed
                      </li>
                      <li>
                        Click "Start Analysis" to begin comprehensive legal
                        analysis
                      </li>
                    </ol>
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            <Card className="bg-gray-900/80 border-gray-700 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-100">
                  Analysis Process
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-400">
                <p>
                  The AI will perform a meticulous multi-step analysis
                  including:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Document identification and classification</li>
                  <li>Formatting and structural compliance review</li>
                  <li>Party information verification</li>
                  <li>Factual foundation analysis</li>
                  <li>Legal authority and compliance assessment</li>
                  <li>Legal elements and claims evaluation</li>
                  <li>Relief sought analysis</li>
                  <li>Persuasive effectiveness review</li>
                  <li>Ethical and procedural considerations</li>
                  <li>Document-specific requirements check</li>
                  <li>Technical quality and citation review</li>
                  <li>Comprehensive evaluation and recommendations</li>
                  <li>Final compliance and efficacy report</li>
                  <li>Paralegal action checklist generation</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </main>
        </div>
      </AnalysisLayout>
    </div>
  );
}
