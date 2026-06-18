"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";

interface AnalysisRunnerProps {
  sessionId: number;
  children: React.ReactNode;
}

interface SessionData {
  id: number;
  status: "draft" | "processing" | "complete" | "error";
  title: string;
  metadata?: {
    subjectDocumentName?: string;
  };
}

export function AnalysisRunner({ sessionId, children }: AnalysisRunnerProps) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasStartedAnalysis = useRef(false);

  // Fetch session data
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}`);
        if (!response.ok) throw new Error("Failed to fetch session");

        const data = await response.json();
        setSession(data.session);
      } catch (err) {
        console.error("Error fetching session:", err);
        setError("Failed to load session");
      }
    };

    fetchSession();
  }, [sessionId]);

  // Auto-trigger analysis if session is in draft status
  useEffect(() => {
    if (!session || session.status !== "draft" || hasStartedAnalysis.current) {
      return;
    }

    const startAnalysis = async () => {
      hasStartedAnalysis.current = true;
      setIsAnalyzing(true);
      setError(null);

      try {
        console.log(
          `[AnalysisRunner] Starting analysis for session ${sessionId}`,
        );

        // Update session status to processing
        await fetch(`/api/sessions/${sessionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "processing" }),
        });

        // Create FormData with a placeholder document
        // TODO: Retrieve actual documents from session/database
        const formData = new FormData();

        // For now, create a text file from the session title as a demo
        const placeholderContent = `Document: ${session.title}\n\nThis is a placeholder. The actual document upload flow needs to be implemented.`;
        const blob = new Blob([placeholderContent], { type: "text/plain" });
        const file = new File(
          [blob],
          session.metadata?.subjectDocumentName || "document.txt",
          {
            type: "text/plain",
          },
        );

        formData.append("document_0", file);

        // Start the analysis
        const response = await fetch("/api/document-analysis", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Analysis failed: ${response.statusText}`);
        }

        // Stream the response
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error("No response stream");
        }

        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          setStreamingText(fullText);

          // Parse step progress
          const stepMatch = chunk.match(/STEP (\d+)\/(\d+): ([^\n]+)/);
          if (stepMatch) {
            const current = parseInt(stepMatch[1]);
            const total = parseInt(stepMatch[2]);
            setCurrentStep(stepMatch[3]);
            setAnalysisProgress((current / total) * 100);
          }
        }

        console.log(`[AnalysisRunner] Analysis complete`);

        // Update session with results
        await fetch(`/api/sessions/${sessionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "complete",
            analysisResult: {
              fullText,
              completedAt: new Date().toISOString(),
            },
          }),
        });

        setSession((prev) => (prev ? { ...prev, status: "complete" } : null));
      } catch (err) {
        console.error("[AnalysisRunner] Analysis error:", err);
        setError(err instanceof Error ? err.message : "Analysis failed");

        // Update session to error state
        await fetch(`/api/sessions/${sessionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "error" }),
        });
      } finally {
        setIsAnalyzing(false);
      }
    };

    startAnalysis();
  }, [session, sessionId]);

  // Show analysis in progress
  if (isAnalyzing) {
    return (
      <div className="space-y-6">
        <Card className="bg-gray-900/80 border-gray-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-100">
              <Sparkles className="h-5 w-5 text-yellow-500 animate-pulse" />
              AI Analysis in Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-400">
                <span>{currentStep || "Initializing..."}</span>
                <span>{Math.round(analysisProgress)}%</span>
              </div>
              <Progress value={analysisProgress} className="h-2" />
            </div>

            {streamingText && (
              <div className="mt-4">
                <div className="bg-gray-950/50 rounded-lg p-4 max-h-96 overflow-y-auto">
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                    {streamingText}
                  </pre>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show error
  if (error) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive" className="bg-red-900/50 border-red-700">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-red-200">{error}</AlertDescription>
        </Alert>
        {children}
      </div>
    );
  }

  // Show completion
  if (session?.status === "complete") {
    return (
      <div className="space-y-6">
        <Alert className="bg-green-900/50 border-green-700">
          <CheckCircle2 className="h-4 w-4 text-green-400" />
          <AlertDescription className="text-green-200">
            Analysis completed successfully!
          </AlertDescription>
        </Alert>
        {children}
      </div>
    );
  }

  // Default: just show children
  return <>{children}</>;
}
