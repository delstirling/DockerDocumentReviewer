"use client";

import { useEffect, useState, useRef } from "react";
import {
  Loader2,
  FileText,
  MapPin,
  Users,
  Calendar,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useAnalysisProgress } from "@/hooks/use-analysis-progress";

interface AnalysisSession {
  id: number;
  title: string;
  status: "draft" | "processing" | "complete" | "error";
  documentType?: string;
  caseType?: string;
  jurisdiction?: string;
  ourClients?: string[];
  opposingParties?: string[];
  contextSummary?: string;
  aiMode?: string;
  analysisResult?: any;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
  documentOrigin?: "our_firm" | "opposing" | "neutral" | "unknown";
}

interface Document {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  documentRole: "subject" | "context";
  storageUrl?: string;
  createdAt: string;
}

interface SessionDisplayProps {
  sessionId: number;
}

export function SessionDisplay({ sessionId }: SessionDisplayProps) {
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const streamingEndRef = useRef<HTMLDivElement>(null);

  const [isDocInfoCollapsed, setIsDocInfoCollapsed] = useState(false);
  const [isPartiesCollapsed, setIsPartiesCollapsed] = useState(false);
  const [isContextSummaryCollapsed, setIsContextSummaryCollapsed] =
    useState(false);
  const [isDocumentsCollapsed, setIsDocumentsCollapsed] = useState(false);
  const [isAuditLogCollapsed, setIsAuditLogCollapsed] = useState(true);
  const [isAnalysisResultCollapsed, setIsAnalysisResultCollapsed] =
    useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isGeneratingProfessionalReport, setIsGeneratingProfessionalReport] =
    useState(false);

  const [progressData, setProgressData] = useState<any>(null);
  const [autoResumeCountdown, setAutoResumeCountdown] = useState<number | null>(
    null,
  );
  const [isResuming, setIsResuming] = useState(false);
  const progressPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Real-time progress via SSE (replaces polling for most cases)
  const {
    progress: sseProgress,
    isConnected: sseConnected,
    error: sseError,
  } = useAnalysisProgress(sessionId, {
    enabled: session?.status === "processing",
    onConnect: () => {
      console.log("[SessionDisplay] SSE connected - real-time updates active");
    },
    onDisconnect: () => {
      console.log(
        "[SessionDisplay] SSE disconnected - falling back to polling if needed",
      );
    },
  });

  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    return (
      <Alert variant="destructive" className="bg-red-900/50 border-red-700">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-red-200">
          Invalid session ID provided
        </AlertDescription>
      </Alert>
    );
  }

  useEffect(() => {
    const fetchSession = async () => {
      try {
        setIsLoading(true);
        setError(null);

        if (!Number.isFinite(sessionId) || sessionId <= 0) {
          throw new Error("Invalid session ID");
        }

        const encodedSessionId = encodeURIComponent(String(sessionId));

        const fetchUrl = `/api/sessions/${encodedSessionId}`;
        console.log(`[SessionDisplay] Fetching URL: ${fetchUrl}`);

        const response = await fetch(fetchUrl);

        console.log(
          `[SessionDisplay] Response status: ${response.status} ${response.statusText}`,
        );
        console.log(
          `[SessionDisplay] Response content-type: ${response.headers.get("content-type")}`,
        );

        if (!response.ok) {
          if (response.status === 404 || response.status === 403) {
            console.log(
              `[SessionDisplay] Session not found or unauthorized (${response.status}). Creating new draft session for current user.`,
            );

            const storageKey = `draftSessionData:${sessionId}`;
            localStorage.removeItem(storageKey);

            const createResponse = await fetch("/api/sessions/create-draft", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            });

            if (!createResponse.ok) {
              throw new Error("Failed to create new draft session");
            }

            const createData = await createResponse.json();
            const newSessionId = createData.sessionId;

            console.log(
              `[SessionDisplay] Created new draft session: ${newSessionId}. Redirecting...`,
            );

            window.location.href = `/dashboard/${newSessionId}`;
            return;
          }

          const errorText = await response.text();
          console.error(
            `[SessionDisplay] Error response body:`,
            errorText.substring(0, 500),
          );
          throw new Error(`Failed to fetch session: ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`[SessionDisplay] Successfully fetched session:`, data);
        console.log(
          `[SessionDisplay] DIAGNOSTIC - Session status: "${data.session?.status}"`,
        );
        console.log(
          `[SessionDisplay] DIAGNOSTIC - Documents count: ${data.documents?.length || 0}`,
        );
        console.log(
          `[SessionDisplay] DIAGNOSTIC - Status check: ${data.session?.status === "draft"}`,
        );
        console.log(
          `[SessionDisplay] DIAGNOSTIC - Documents check: ${!!(data.documents && data.documents.length > 0)}`,
        );
        setSession(data.session);
        setDocuments(data.documents || []);

        // Auto-start analysis if session is in draft status and has documents
        if (
          data.session.status === "draft" &&
          data.documents &&
          data.documents.length > 0
        ) {
          console.log(
            "[SessionDisplay] Session is draft with documents - auto-starting analysis",
          );
          startAnalysis(data.session, data.documents).catch((err) => {
            console.error("[SessionDisplay] Auto-start failed:", err);
            setError(
              err instanceof Error
                ? err.message
                : "Failed to start analysis. Please try again.",
            );
            setIsLoading(false);
          });
        } else {
          console.log(
            "[SessionDisplay] DIAGNOSTIC - Auto-start condition NOT met",
            {
              status: data.session?.status,
              documentsLength: data.documents?.length,
              statusIsDraft: data.session?.status === "draft",
              hasDocuments: !!(data.documents && data.documents.length > 0),
            },
          );
        }
      } catch (err) {
        console.error("[SessionDisplay] Error fetching session:", err);
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();
  }, [sessionId]);

  useEffect(() => {
    if (streamingText && streamingEndRef.current) {
      streamingEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamingText]);

  // Update progressData when SSE updates arrive (primary data source)
  useEffect(() => {
    if (sseProgress) {
      console.log("[SessionDisplay] SSE progress update:", {
        currentStep: sseProgress.currentStep,
        totalSteps: sseProgress.totalSteps,
        status: sseProgress.status,
        progressPercentage: sseProgress.progressPercentage,
        stepName: sseProgress.stepName,
      });

      setProgressData({
        currentStep: sseProgress.currentStep,
        totalSteps: sseProgress.totalSteps,
        status: sseProgress.status,
        progressPercentage: sseProgress.progressPercentage,
        message: sseProgress.message,
        isProcessing: sseProgress.status === "processing",
        isComplete: sseProgress.status === "complete",
        isError: sseProgress.status === "error",
      });

      // Update session status when completed
      if (sseProgress.status === "complete" || sseProgress.status === "error") {
        setSession((prev) =>
          prev ? { ...prev, status: sseProgress.status } : prev,
        );
      }
    }
  }, [sseProgress]);

  useEffect(() => {
    if (!session || session.status !== "processing") {
      if (progressPollIntervalRef.current) {
        clearInterval(progressPollIntervalRef.current);
        progressPollIntervalRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setAutoResumeCountdown(null);
      return () => {}; // Return no-op cleanup for consistent return type
    }

    // Use polling as fallback if SSE is not connected OR if SSE appears stale
    // SSE is considered stale if no message received for 30+ seconds during processing
    // IMPORTANT: Only check staleness if we have a valid timestamp (non-zero)
    // If timestamp is 0 or undefined, we can't determine staleness - rely on connection status
    const lastSseUpdate = sseProgress?.timestamp;
    const hasValidTimestamp = lastSseUpdate && lastSseUpdate > 0;
    const timeSinceLastSse = hasValidTimestamp ? Date.now() - lastSseUpdate : 0;
    const sseIsStale =
      sseConnected && hasValidTimestamp && timeSinceLastSse > 30000; // 30 seconds

    const shouldPoll = !sseConnected || sseIsStale;

    if (!shouldPoll) {
      console.log("[SessionDisplay] SSE active and fresh - skipping polling");
      // Clear any existing polling interval
      if (progressPollIntervalRef.current) {
        clearInterval(progressPollIntervalRef.current);
        progressPollIntervalRef.current = null;
      }
      return () => {}; // Return no-op cleanup for consistent return type
    }

    if (sseIsStale) {
      console.log(
        `[SessionDisplay] SSE appears stale (no updates for ${Math.round(timeSinceLastSse / 1000)}s) - activating polling fallback`,
      );
    } else {
      console.log(
        "[SessionDisplay] SSE not available - using fallback polling",
      );
    }

    const pollProgress = async () => {
      try {
        const encodedSessionId = encodeURIComponent(String(sessionId));
        const response = await fetch(
          `/api/sessions/${encodedSessionId}/progress`,
        );

        if (!response.ok) {
          console.error(
            "[SessionDisplay] Failed to fetch progress:",
            response.statusText,
          );
          return;
        }

        const data = await response.json();

        console.log("[SessionDisplay] Progress update received:", {
          currentStep: data.currentStep,
          totalSteps: data.totalSteps,
          status: data.status,
          progressPercentage: data.progressPercentage,
          timestamp: new Date().toISOString(),
        });

        setProgressData(data);

        if (data.status === "complete" || data.status === "error") {
          if (progressPollIntervalRef.current) {
            clearInterval(progressPollIntervalRef.current);
            progressPollIntervalRef.current = null;
          }
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          setAutoResumeCountdown(null);
          setSession((prev) =>
            prev ? { ...prev, status: data.status } : prev,
          );
          return;
        }

        if (data.isProcessing && data.lastActivityAt) {
          const lastActivity = new Date(data.lastActivityAt).getTime();
          const now = Date.now();
          const inactiveMs = now - lastActivity;
          const inactiveThresholdMs = 90 * 1000;

          if (inactiveMs > inactiveThresholdMs && !data.isResuming) {
            if (autoResumeCountdown === null) {
              console.log(
                "[SessionDisplay] Stale heartbeat detected, starting countdown",
              );
              setAutoResumeCountdown(120);

              if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
              }

              countdownIntervalRef.current = setInterval(() => {
                setAutoResumeCountdown((prev) => {
                  if (prev === null || prev <= 1) {
                    if (countdownIntervalRef.current) {
                      clearInterval(countdownIntervalRef.current);
                      countdownIntervalRef.current = null;
                    }
                    triggerAutoResume();
                    return null;
                  }
                  return prev - 1;
                });
              }, 1000);
            }
          } else {
            if (autoResumeCountdown !== null) {
              console.log(
                "[SessionDisplay] Heartbeat recovered, canceling countdown",
              );
              setAutoResumeCountdown(null);
              if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
              }
            }
          }
        }
      } catch (error) {
        console.error("[SessionDisplay] Error polling progress:", error);
      }
    };

    pollProgress();

    // Adaptive polling: 5s during processing for real-time updates, 30s otherwise
    // Only when SSE is not available (fallback mode)
    const pollingInterval = session?.status === "processing" ? 5000 : 30000;
    progressPollIntervalRef.current = setInterval(
      pollProgress,
      pollingInterval,
    );

    return () => {
      if (progressPollIntervalRef.current) {
        clearInterval(progressPollIntervalRef.current);
        progressPollIntervalRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [session?.status, sessionId, autoResumeCountdown, sseConnected]);

  const triggerAutoResume = async () => {
    if (isResuming) {
      console.log("[SessionDisplay] Already resuming, skipping auto-resume");
      return;
    }

    console.log("[SessionDisplay] Auto-resume triggered");
    await resumeAnalysis();
  };

  const resumeAnalysis = async () => {
    if (isResuming) {
      console.log("[SessionDisplay] Already resuming");
      return;
    }

    setIsResuming(true);
    setAutoResumeCountdown(null);

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    const encodedSessionId = encodeURIComponent(String(sessionId));

    try {
      const response = await fetch(`/api/analysis/resume-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: encodedSessionId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Resume failed: ${response.statusText}`,
        );
      }

      console.log("[SessionDisplay] Resume triggered successfully");
    } catch (err) {
      console.error("[SessionDisplay] Error resuming analysis:", err);
      setError(
        err instanceof Error ? err.message : "Failed to resume analysis",
      );
    } finally {
      setIsResuming(false);
    }
  };

  const cancelAutoResume = () => {
    console.log("[SessionDisplay] Auto-resume canceled by user");
    setAutoResumeCountdown(null);
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  };

  const generateFinalReport = async () => {
    setIsGeneratingReport(true);
    try {
      const encodedSessionId = encodeURIComponent(String(sessionId));

      const response = await fetch(
        `/api/sessions/${encodedSessionId}/export-word`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to generate report");
      }

      // Get the blob and download it
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${session?.title?.replace(/[^a-z0-9]/gi, "_") || "analysis"}_report.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("[SessionDisplay] Error generating report:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate report",
      );
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const generateProfessionalReport = async () => {
    setIsGeneratingProfessionalReport(true);
    try {
      const encodedSessionId = encodeURIComponent(String(sessionId));

      const response = await fetch(
        `/api/sessions/${encodedSessionId}/export-professional-report`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to generate professional report");
      }

      // Get the blob and download it
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Professional_Report_${sessionId}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error(
        "[SessionDisplay] Error generating professional report:",
        err,
      );
      setError(
        err instanceof Error
          ? err.message
          : "Failed to generate professional report",
      );
    } finally {
      setIsGeneratingProfessionalReport(false);
    }
  };

  const startAnalysis = async (
    sessionData: AnalysisSession,
    docs: Document[],
  ) => {
    // Define session IDs at function scope so catch block can access
    const encodedSessionId = encodeURIComponent(String(sessionId));

    console.log("[SessionDisplay][startAnalysis] ENTRY", {
      sessionId: encodedSessionId,
      docCount: docs.length,
      sessionStatus: sessionData.status,
    });

    try {
      setAnalysisStarted(true);
      setStreamingText("");
      setError(null); // Clear any previous errors

      setIsDocInfoCollapsed(true);
      setIsPartiesCollapsed(true);
      setIsContextSummaryCollapsed(true);
      setIsDocumentsCollapsed(true);
      setIsAnalysisResultCollapsed(true);

      console.log(
        "[SessionDisplay][startAnalysis] Updating session to processing",
      );
      // Update session status to processing
      const statusResponse = await fetch(`/api/sessions/${encodedSessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "processing" }),
      });

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        console.error(
          "[SessionDisplay][startAnalysis] Status update failed:",
          errorText,
        );
        throw new Error(
          `Failed to update session status: ${statusResponse.statusText}`,
        );
      }

      // Update local session state immediately
      setSession((prev) =>
        prev ? { ...prev, status: "processing" as const } : prev,
      );

      console.log(
        `[SessionDisplay][startAnalysis] Starting analysis with ${docs.length} documents`,
      );

      console.log("[SessionDisplay][startAnalysis] Calling streaming endpoint");
      // Call the analysis streaming endpoint
      const response = await fetch(`/api/analysis/${encodedSessionId}/stream`, {
        method: "POST",
      });

      console.log(
        "[SessionDisplay][startAnalysis] Stream response:",
        response.status,
        response.statusText,
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(
          "[SessionDisplay][startAnalysis] Stream failed:",
          errorData,
        );
        throw new Error(
          errorData.error || `Analysis failed: ${response.statusText}`,
        );
      }

      // Stream the response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          setStreamingText((prev) => prev + chunk);
        }
      }

      console.log(
        "[SessionDisplay][startAnalysis] Stream ended, checking actual session status",
      );

      const statusCheckResponse = await fetch(
        `/api/sessions/${encodedSessionId}`,
      );
      const statusCheckData = await statusCheckResponse.json();
      const actualStatus = statusCheckData?.session?.status;

      console.log(
        "[SessionDisplay][startAnalysis] Actual session status after stream:",
        actualStatus,
      );

      if (actualStatus === "complete") {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: "complete" as const,
                analysisResult: { completedAt: new Date().toISOString() },
              }
            : prev,
        );
        console.log(
          "[SessionDisplay][startAnalysis] SUCCESS - Analysis complete!",
        );
      } else if (actualStatus === "processing") {
        console.log(
          "[SessionDisplay][startAnalysis] Chunk complete, analysis still processing. Orchestrator will continue.",
        );
      } else {
        console.log(
          "[SessionDisplay][startAnalysis] Stream ended with status:",
          actualStatus,
        );
        if (actualStatus) {
          setSession((prev) =>
            prev ? { ...prev, status: actualStatus } : prev,
          );
        }
      }
    } catch (err) {
      console.error("[SessionDisplay][startAnalysis] ERROR caught:", err);
      setError(
        err instanceof Error ? err.message : "Failed to complete analysis",
      );

      // Update session status to error
      try {
        const errorResponse = await fetch(`/api/sessions/${encodedSessionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "error" }),
        });

        if (!errorResponse.ok) {
          console.error(
            "[SessionDisplay][startAnalysis] Failed to update to error status",
          );
        }
      } catch (statusErr) {
        console.error(
          "[SessionDisplay][startAnalysis] Error updating status to error:",
          statusErr,
        );
      }

      // Update local session state
      setSession((prev) =>
        prev ? { ...prev, status: "error" as const } : prev,
      );
    }
  };

  const getStatusBadge = (status: AnalysisSession["status"]) => {
    switch (status) {
      case "draft":
        return <Badge variant="outline">📝 Draft</Badge>;
      case "processing":
        return <Badge variant="secondary">⏳ Processing</Badge>;
      case "complete":
        return <Badge variant="default">✅ Complete</Badge>;
      case "error":
        return <Badge variant="destructive">❌ Error</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <Alert variant="destructive" className="bg-red-900/50 border-red-700">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-red-200">
          {error || "Session not found"}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Session Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-gray-100">
            {session.title}
          </h1>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Calendar className="h-4 w-4" />
            <span>Created {formatDate(session.createdAt)}</span>
            {session.updatedAt !== session.createdAt && (
              <span>• Updated {formatDate(session.updatedAt)}</span>
            )}
          </div>
        </div>
        <div>{getStatusBadge(session.status)}</div>
      </div>

      <Separator className="bg-gray-700" />

      {/* Session Metadata */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-gray-900/80 border-gray-700 backdrop-blur-sm">
          <CardHeader
            className="cursor-pointer hover:bg-gray-800/50 transition-colors"
            onClick={() => setIsDocInfoCollapsed(!isDocInfoCollapsed)}
          >
            <CardTitle className="flex items-center justify-between text-gray-100">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                <div>
                  <div>Document Information</div>
                  {isDocInfoCollapsed && (
                    <div className="text-xs font-normal text-gray-400 mt-1">
                      {[
                        session.documentType
                          ?.replace(/_/g, " ")
                          .substring(0, 30),
                        session.caseType?.replace(/_/g, " ").substring(0, 30),
                        session.jurisdiction,
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                  )}
                </div>
              </div>
              {isDocInfoCollapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </CardTitle>
          </CardHeader>
          {!isDocInfoCollapsed && (
            <CardContent className="space-y-3">
              {session.documentType && (
                <div>
                  <span className="text-sm font-medium text-gray-200">
                    Document Type:
                  </span>
                  <p className="text-sm text-gray-400 mt-1">
                    {session.documentType.replace(/_/g, " ")}
                  </p>
                </div>
              )}
              {session.caseType && (
                <div>
                  <span className="text-sm font-medium text-gray-200">
                    Case Type:
                  </span>
                  <p className="text-sm text-gray-400 mt-1">
                    {session.caseType.replace(/_/g, " ")}
                  </p>
                </div>
              )}
              {session.jurisdiction && (
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 text-gray-400" />
                  <div>
                    <span className="text-sm font-medium text-gray-200">
                      Jurisdiction:
                    </span>
                    <p className="text-sm text-gray-400 mt-1">
                      {session.jurisdiction}
                    </p>
                  </div>
                </div>
              )}
              {session.aiMode && (
                <div>
                  <span className="text-sm font-medium text-gray-200">
                    AI Mode:
                  </span>
                  <p className="text-sm text-gray-400 mt-1">
                    {session.aiMode.replace(/_/g, " ")}
                  </p>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <Card className="bg-gray-900/80 border-gray-700 backdrop-blur-sm">
          <CardHeader
            className="cursor-pointer hover:bg-gray-800/50 transition-colors"
            onClick={() => setIsPartiesCollapsed(!isPartiesCollapsed)}
          >
            <CardTitle className="flex items-center justify-between text-gray-100">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                <div>
                  <div className="flex items-center gap-2">
                    Parties
                    {session?.documentOrigin === "opposing" && (
                      <Badge
                        variant="outline"
                        className="text-xs bg-orange-900/50 text-orange-300 border-orange-600"
                      >
                        Swapped for Offense Mode
                      </Badge>
                    )}
                  </div>
                  {isPartiesCollapsed && (
                    <div className="text-xs font-normal text-gray-400 mt-1">
                      {(() => {
                        // In offense mode, swap the display of parties
                        const isOffenseMode =
                          session?.documentOrigin === "opposing";
                        const effectiveOurClients = isOffenseMode
                          ? session?.opposingParties
                          : session?.ourClients;
                        const effectiveOpposingParties = isOffenseMode
                          ? session?.ourClients
                          : session?.opposingParties;
                        return [
                          effectiveOurClients?.length
                            ? `Our ${effectiveOurClients.length}`
                            : null,
                          effectiveOpposingParties?.length
                            ? `Opp ${effectiveOpposingParties.length}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" • ");
                      })()}
                    </div>
                  )}
                </div>
              </div>
              {isPartiesCollapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </CardTitle>
          </CardHeader>
          {!isPartiesCollapsed && (
            <CardContent className="space-y-3">
              {(() => {
                // In offense mode, swap the display of parties
                const isOffenseMode = session?.documentOrigin === "opposing";
                const effectiveOurClients = isOffenseMode
                  ? session?.opposingParties
                  : session?.ourClients;
                const effectiveOpposingParties = isOffenseMode
                  ? session?.ourClients
                  : session?.opposingParties;

                return (
                  <>
                    {effectiveOurClients && effectiveOurClients.length > 0 && (
                      <div>
                        <span className="text-sm font-medium text-gray-200">
                          Our Clients:
                        </span>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {effectiveOurClients.map((client, idx) => (
                            <Badge
                              key={idx}
                              variant="default"
                              className="bg-blue-600 text-white"
                            >
                              {client}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {effectiveOpposingParties &&
                      effectiveOpposingParties.length > 0 && (
                        <div>
                          <span className="text-sm font-medium text-gray-200">
                            Opposing Parties:
                          </span>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {effectiveOpposingParties.map((party, idx) => (
                              <Badge
                                key={idx}
                                variant="destructive"
                                className="bg-red-700 text-white"
                              >
                                {party}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                  </>
                );
              })()}
            </CardContent>
          )}
        </Card>
      </div>

      {/* Context Summary */}
      {session.contextSummary && (
        <Card className="bg-gray-900/80 border-gray-700 backdrop-blur-sm">
          <CardHeader
            className="cursor-pointer hover:bg-gray-800/50 transition-colors"
            onClick={() =>
              setIsContextSummaryCollapsed(!isContextSummaryCollapsed)
            }
          >
            <CardTitle className="flex items-center justify-between text-gray-100">
              <div>
                <div>Context Summary</div>
                {isContextSummaryCollapsed && (
                  <div className="text-xs font-normal text-gray-400 mt-1">
                    {session.contextSummary?.substring(0, 60)}
                    {session.contextSummary &&
                    session.contextSummary.length > 60
                      ? "..."
                      : ""}
                  </div>
                )}
              </div>
              {isContextSummaryCollapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </CardTitle>
          </CardHeader>
          {!isContextSummaryCollapsed && (
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-gray-300">
                {session.contextSummary}
              </p>
            </CardContent>
          )}
        </Card>
      )}

      {/* Documents */}
      {Array.isArray(documents) && documents.length > 0 && (
        <Card className="bg-gray-900/80 border-gray-700 backdrop-blur-sm">
          <CardHeader
            className="cursor-pointer hover:bg-gray-800/50 transition-colors"
            onClick={() => setIsDocumentsCollapsed(!isDocumentsCollapsed)}
          >
            <CardTitle className="flex items-center justify-between text-gray-100">
              <div>
                <span>Documents ({documents.length})</span>
                {isDocumentsCollapsed ? (
                  <div className="text-xs font-normal text-gray-400 mt-1">
                    {
                      documents.filter((d) => d.documentRole === "subject")
                        .length
                    }{" "}
                    subject •{" "}
                    {
                      documents.filter((d) => d.documentRole === "context")
                        .length
                    }{" "}
                    context
                  </div>
                ) : (
                  <CardDescription className="text-gray-400">
                    Files associated with this analysis
                  </CardDescription>
                )}
              </div>
              {isDocumentsCollapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </CardTitle>
          </CardHeader>
          {!isDocumentsCollapsed && (
            <CardContent>
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-3 border border-gray-700 rounded-md bg-gray-800/50"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-200">
                          {doc.fileName}
                        </p>
                        <p className="text-xs text-gray-400">
                          {doc.fileType.toUpperCase()} •{" "}
                          {formatFileSize(doc.fileSize)} • {doc.documentRole}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="bg-gray-700 border-gray-600 text-gray-200"
                    >
                      {doc.documentRole}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Audit Log */}
      {session.analysisResult?.audit && (
        <Card className="bg-gray-900/80 border-gray-700 backdrop-blur-sm">
          <CardHeader
            className="cursor-pointer hover:bg-gray-800/50 transition-colors"
            onClick={() => setIsAuditLogCollapsed(!isAuditLogCollapsed)}
          >
            <CardTitle className="flex items-center justify-between text-gray-100">
              <div>
                <div>Audit Log</div>
                {isAuditLogCollapsed && (
                  <div className="text-xs font-normal text-gray-400 mt-1">
                    {Object.entries(session.analysisResult.audit.summary.byTool)
                      .map(([tool, count]) => {
                        const category =
                          tool.includes("tavily") || tool.includes("search")
                            ? "Web search"
                            : tool.includes("courtlistener") ||
                                tool.includes("legal")
                              ? "Legal research"
                              : "Other";
                        return `${category}: ${count}`;
                      })
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join(" • ")}{" "}
                    • Total: {session.analysisResult.audit.summary.totalCalls}
                  </div>
                )}
              </div>
              {isAuditLogCollapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </CardTitle>
          </CardHeader>
          {!isAuditLogCollapsed && (
            <CardContent>
              <div className="space-y-4">
                {session.analysisResult.audit.steps.map(
                  (step: any, stepIdx: number) => (
                    <div
                      key={stepIdx}
                      className="border border-gray-700 rounded-md p-4 bg-gray-800/50"
                    >
                      <h4 className="text-sm font-semibold text-gray-200 mb-3">
                        Step {step.stepIndex}: {step.stepName}
                      </h4>
                      <div className="space-y-3">
                        {step.calls.map((call: any, callIdx: number) => (
                          <div
                            key={callIdx}
                            className="border-l-2 border-gray-600 pl-4 py-2"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={
                                    call.status === "success"
                                      ? "default"
                                      : "destructive"
                                  }
                                  className={
                                    call.status === "success"
                                      ? "bg-green-700"
                                      : "bg-red-700"
                                  }
                                >
                                  {call.category === "web_search"
                                    ? "Web Search"
                                    : call.category === "legal_research"
                                      ? "Legal Research"
                                      : "Other"}
                                </Badge>
                                <span className="text-xs text-gray-400">
                                  {call.toolName}
                                </span>
                              </div>
                              <span className="text-xs text-gray-500">
                                {new Date(call.startedAt).toLocaleTimeString()}
                              </span>
                            </div>

                            {call.args && Object.keys(call.args).length > 0 && (
                              <div className="mb-2">
                                <p className="text-xs font-medium text-gray-300 mb-1">
                                  Input:
                                </p>
                                <div className="bg-gray-900/50 p-2 rounded text-xs text-gray-400">
                                  {call.args.query && (
                                    <div>
                                      <span className="text-gray-500">
                                        Query:
                                      </span>{" "}
                                      {call.args.query}
                                    </div>
                                  )}
                                  {call.args.court && (
                                    <div>
                                      <span className="text-gray-500">
                                        Court:
                                      </span>{" "}
                                      {call.args.court}
                                    </div>
                                  )}
                                  {call.args.jurisdiction && (
                                    <div>
                                      <span className="text-gray-500">
                                        Jurisdiction:
                                      </span>{" "}
                                      {call.args.jurisdiction}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {call.resultSummary && (
                              <div className="mb-2">
                                <p className="text-xs font-medium text-gray-300 mb-1">
                                  Summary:
                                </p>
                                <div className="bg-gray-900/50 p-2 rounded text-xs text-gray-400">
                                  {call.resultSummary.totalResults !==
                                    undefined && (
                                    <div>
                                      Found {call.resultSummary.totalResults}{" "}
                                      results
                                    </div>
                                  )}
                                  {call.resultSummary.count !== undefined && (
                                    <div>
                                      Found {call.resultSummary.count} cases
                                    </div>
                                  )}
                                  {call.resultSummary.searchDepth && (
                                    <div>
                                      Search depth:{" "}
                                      {call.resultSummary.searchDepth}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {call.resultSample &&
                              call.resultSample.length > 0 && (
                                <div>
                                  <p className="text-xs font-medium text-gray-300 mb-1">
                                    Top Results:
                                  </p>
                                  <div className="space-y-1">
                                    {call.resultSample.map(
                                      (result: any, resultIdx: number) => (
                                        <div
                                          key={resultIdx}
                                          className="bg-gray-900/50 p-2 rounded text-xs"
                                        >
                                          {result.title && (
                                            <div className="text-gray-300 font-medium">
                                              {result.title}
                                            </div>
                                          )}
                                          {result.caseName && (
                                            <div className="text-gray-300 font-medium">
                                              {result.caseName}
                                            </div>
                                          )}
                                          {result.citation && (
                                            <div className="text-gray-400">
                                              {result.citation}
                                            </div>
                                          )}
                                          {result.url && (
                                            <a
                                              href={result.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-blue-400 hover:text-blue-300 text-xs break-all"
                                            >
                                              {result.url}
                                            </a>
                                          )}
                                          {result.score && (
                                            <div className="text-gray-500">
                                              Relevance:{" "}
                                              {(result.score * 100).toFixed(0)}%
                                            </div>
                                          )}
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </div>
                              )}

                            {call.error && (
                              <div className="mt-2">
                                <p className="text-xs font-medium text-red-400 mb-1">
                                  Error:
                                </p>
                                <div className="bg-red-900/20 p-2 rounded text-xs text-red-300">
                                  {call.error}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Streaming Analysis Panel - Moved to bottom */}
      {analysisStarted && (
        <Card className="bg-gray-900/80 border-gray-700 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-100">
              <Loader2 className="h-5 w-5 animate-spin" />
              {progressData?.totalSteps || 35}-Step Analysis in Progress
              {progressData && progressData.currentStep > 0 && (
                <span className="text-sm font-normal text-gray-400">
                  (Step {progressData.currentStep}/{progressData.totalSteps})
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-gray-400">
              AI is analyzing your document with extensive tool usage
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-950/50 p-4 rounded-md max-h-[600px] overflow-y-auto">
              <pre
                className="text-sm text-gray-300 whitespace-pre-wrap font-mono"
                aria-live="polite"
              >
                {streamingText || "Initializing analysis workflow..."}
              </pre>
              <div ref={streamingEndRef} />
            </div>

            {autoResumeCountdown !== null && (
              <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-700 rounded-md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-yellow-500" />
                    <div>
                      <p className="text-sm font-medium text-yellow-200">
                        Analysis appears stalled
                      </p>
                      <p className="text-xs text-yellow-300 mt-1">
                        Auto-resuming in {Math.floor(autoResumeCountdown / 60)}:
                        {String(autoResumeCountdown % 60).padStart(2, "0")}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={resumeAnalysis}
                      disabled={isResuming}
                      className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-md transition-colors"
                    >
                      {isResuming ? "Resuming..." : "Resume now"}
                    </button>
                    <button
                      onClick={cancelAutoResume}
                      className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {progressData?.isResuming && !autoResumeCountdown && (
              <div className="mt-4 p-4 bg-blue-900/20 border border-blue-700 rounded-md">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  <p className="text-sm text-blue-200">
                    Analysis is resuming...
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Analysis Result */}
      {session.analysisResult && (
        <Card className="bg-gray-900/80 border-gray-700 backdrop-blur-sm">
          <CardHeader
            className="cursor-pointer hover:bg-gray-800/50 transition-colors"
            onClick={() =>
              setIsAnalysisResultCollapsed(!isAnalysisResultCollapsed)
            }
          >
            <CardTitle className="flex items-center justify-between text-gray-100">
              <div>
                <div>Analysis Result</div>
                {isAnalysisResultCollapsed && (
                  <div className="text-xs font-normal text-gray-400 mt-1">
                    Complete analysis • Click to expand
                  </div>
                )}
              </div>
              {isAnalysisResultCollapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </CardTitle>
          </CardHeader>
          {!isAnalysisResultCollapsed && (
            <CardContent className="space-y-4">
              <div className="flex justify-end gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    generateProfessionalReport();
                  }}
                  disabled={isGeneratingProfessionalReport}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center gap-2"
                >
                  {isGeneratingProfessionalReport ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4" />
                      Export Professional Report (Steps 34-35)
                    </>
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    generateFinalReport();
                  }}
                  disabled={isGeneratingReport}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center gap-2"
                >
                  {isGeneratingReport ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating Report...
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4" />
                      Generate Final Report (Word)
                    </>
                  )}
                </button>
              </div>
              <pre className="text-sm whitespace-pre-wrap bg-gray-950/50 text-gray-300 p-4 rounded-md overflow-auto max-h-[600px]">
                {JSON.stringify(session.analysisResult, null, 2)}
              </pre>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
