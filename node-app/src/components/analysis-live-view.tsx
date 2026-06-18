"use client";

import { useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Wrench,
  Brain,
  AlertCircle,
  Download,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  name: string;
  order: number;
  status: "pending" | "in_progress" | "completed" | "error";
}

interface AnalysisLiveViewProps {
  documents: File[];
  onComplete?: (transcript: any) => void;
  onError?: (error: string) => void;
}

export default function AnalysisLiveView({
  documents,
  onComplete,
  onError,
}: AnalysisLiveViewProps) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [streamText, setStreamText] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [toolCallCount, setToolCallCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamText]);

  // Load workflow steps
  useEffect(() => {
    fetch("/api/workflow")
      .then((res) => res.json())
      .then((data) => {
        const workflowSteps = data.steps.map((s: any) => ({
          id: s.id,
          name: s.name,
          order: s.order,
          status: "pending" as const,
        }));
        setSteps(workflowSteps);
      })
      .catch((err) => {
        console.error("Failed to load workflow:", err);
      });
  }, []);

  const updateStepStatus = (stepNumber: number, status: Step["status"]) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.order === stepNumber ? { ...step, status } : step,
      ),
    );
  };

  const appendText = (text: string) => {
    setStreamText((prev) => prev + text);
  };

  useEffect(() => {
    if (documents.length === 0 || isRunning) return;

    const runAnalysis = async () => {
      setIsRunning(true);
      setStreamText("");
      setToolCallCount(0);

      // Reset all steps
      setSteps((prev) =>
        prev.map((s) => ({ ...s, status: "pending" as const })),
      );

      const formData = new FormData();
      documents.forEach((doc, i) => {
        formData.append(`document_${i}`, doc);
      });

      try {
        const response = await fetch("/api/document-analysis", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Analysis failed: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error("No response stream");
        }

        let buffer = "";
        let currentStepNum = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          appendText(chunk);

          // Parse special markers
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            // Step start
            if (line.includes("=== STEP")) {
              const match = line.match(/=== STEP (\d+)\/\d+:/);
              if (match) {
                const stepNum = parseInt(match[1]);

                if (currentStepNum > 0) {
                  updateStepStatus(currentStepNum, "completed");
                }

                currentStepNum = stepNum;
                setCurrentStep(stepNum);
                updateStepStatus(stepNum, "in_progress");
              }
            }
            // Tool calls
            else if (line.includes("🔧 Using tool:")) {
              setToolCallCount((prev) => prev + 1);
            }
          }
        }

        // Mark final step as complete
        if (currentStepNum > 0) {
          updateStepStatus(currentStepNum, "completed");
        }

        // Fetch transcript
        setTimeout(async () => {
          try {
            const transcriptResp = await fetch("/api/analysis-transcript");
            const data = await transcriptResp.json();

            if (data.transcripts && data.transcripts.length > 0) {
              onComplete?.(data.transcripts[0]);
            }
          } catch (e) {
            console.error("Failed to fetch transcript:", e);
          }
        }, 2000);
      } catch (error: any) {
        console.error("Analysis error:", error);
        appendText(`\n\n❌ Error: ${error.message}\n`);
        onError?.(error.message);

        if (currentStep) {
          updateStepStatus(currentStep, "error");
        }
      } finally {
        setIsRunning(false);
        setCurrentStep(null);
      }
    };

    runAnalysis();
  }, [documents]); // eslint-disable-line react-hooks/exhaustive-deps

  const getStepIcon = (status: Step["status"]) => {
    switch (status) {
      case "completed":
        return (
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        );
      case "in_progress":
        return (
          <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />
        );
      case "error":
        return (
          <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
        );
      default:
        return <Circle className="h-4 w-4 text-gray-400" />;
    }
  };

  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const progress = steps.length > 0 ? (completedSteps / steps.length) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isRunning && (
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            )}
            {!isRunning &&
              completedSteps === steps.length &&
              steps.length > 0 && (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              )}
            <h3 className="font-semibold">
              {isRunning
                ? "Analysis in Progress"
                : completedSteps === steps.length && steps.length > 0
                  ? "Analysis Complete"
                  : "Ready to Analyze"}
            </h3>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {completedSteps}/{steps.length} steps • {toolCallCount} tool calls
          </div>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </Card>

      {/* Main monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Steps checklist */}
        <Card className="p-4">
          <h4 className="font-semibold mb-4 text-sm">Steps</h4>
          <ScrollArea className="h-[500px]">
            <div className="space-y-1.5">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-md text-xs transition-colors",
                    step.status === "in_progress" &&
                      "bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800",
                    step.status === "completed" &&
                      "bg-green-50 dark:bg-green-950",
                  )}
                >
                  {getStepIcon(step.status)}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-500 dark:text-gray-400">
                      {step.order}/{steps.length}
                    </div>
                    <div className="truncate text-xs">{step.name}</div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>

        {/* Stream output */}
        <Card className="p-4 lg:col-span-2">
          <h4 className="font-semibold mb-4 text-sm">Live Output</h4>
          <ScrollArea className="h-[500px]" ref={scrollRef}>
            <pre className="text-xs font-mono whitespace-pre-wrap break-words">
              {streamText || "Waiting for analysis to start..."}
            </pre>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
