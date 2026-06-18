"use client";

import { useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Wrench,
  Brain,
  FileText,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  name: string;
  order: number;
  status: "pending" | "in_progress" | "completed" | "error";
}

interface StreamMessage {
  type:
    | "step-start"
    | "step-complete"
    | "tool-call"
    | "tool-result"
    | "text"
    | "error";
  step?: number;
  stepName?: string;
  toolName?: string;
  toolArgs?: any;
  content?: string;
  result?: string;
  error?: string;
}

interface LiveAnalysisMonitorProps {
  steps: Step[];
  onAnalysisComplete?: (transcript: any) => void;
}

export default function LiveAnalysisMonitor({
  steps: initialSteps,
  onAnalysisComplete,
}: LiveAnalysisMonitorProps) {
  const [steps, setSteps] = useState<Step[]>(initialSteps);
  const [streamMessages, setStreamMessages] = useState<
    Array<{
      id: string;
      message: StreamMessage;
      timestamp: Date;
    }>
  >([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamMessages]);

  const addStreamMessage = (message: StreamMessage) => {
    setStreamMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-${Math.random()}`,
        message,
        timestamp: new Date(),
      },
    ]);
  };

  const updateStepStatus = (stepNumber: number, status: Step["status"]) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.order === stepNumber ? { ...step, status } : step,
      ),
    );
  };

  const startAnalysis = async (documents: File[]) => {
    setIsRunning(true);
    setStreamMessages([]);

    // Reset all steps to pending
    setSteps((prev) => prev.map((s) => ({ ...s, status: "pending" })));

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
        throw new Error("No response stream available");
      }

      let buffer = "";
      let currentStepNum = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Parse the stream for special markers
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          // Check for step markers
          if (line.includes("=== STEP")) {
            const match = line.match(/=== STEP (\d+)\/\d+: (.+) ===/);
            if (match) {
              const stepNum = parseInt(match[1]);
              const stepName = match[2];

              // Mark previous step as complete
              if (currentStepNum > 0) {
                updateStepStatus(currentStepNum, "completed");
                addStreamMessage({
                  type: "step-complete",
                  step: currentStepNum,
                  content: `Step ${currentStepNum} completed`,
                });
              }

              currentStepNum = stepNum;
              setCurrentStep(stepNum);
              updateStepStatus(stepNum, "in_progress");
              addStreamMessage({
                type: "step-start",
                step: stepNum,
                stepName,
                content: line,
              });
            }
          }
          // Check for tool usage (you'll need to add markers in the backend)
          else if (line.includes("🔧 Using tool:")) {
            const match = line.match(/🔧 Using tool: ([a-z-]+)/);
            if (match) {
              addStreamMessage({
                type: "tool-call",
                toolName: match[1],
                content: line,
              });
            }
          }
          // Check for tool results
          else if (line.includes("✓ Tool result:")) {
            addStreamMessage({
              type: "tool-result",
              content: line,
            });
          }
          // Regular text
          else if (line.trim()) {
            addStreamMessage({
              type: "text",
              content: line,
            });
          }
        }
      }

      // Mark final step as complete
      if (currentStepNum > 0) {
        updateStepStatus(currentStepNum, "completed");
      }

      addStreamMessage({
        type: "text",
        content: "\n✅ Analysis complete! Downloading transcript...",
      });

      // Fetch the transcript
      setTimeout(async () => {
        try {
          const transcriptResp = await fetch("/api/analysis-transcript");
          const transcript = await transcriptResp.json();
          onAnalysisComplete?.(transcript);
        } catch (e) {
          console.error("Failed to fetch transcript:", e);
        }
      }, 2000);
    } catch (error: any) {
      console.error("Analysis error:", error);
      addStreamMessage({
        type: "error",
        error: error.message,
        content: `❌ Error: ${error.message}`,
      });
    } finally {
      setIsRunning(false);
      setCurrentStep(null);
    }
  };

  const getStepIcon = (status: Step["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "in_progress":
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
      case "error":
        return <Circle className="h-4 w-4 text-red-600" />;
      default:
        return <Circle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getMessageIcon = (type: StreamMessage["type"]) => {
    switch (type) {
      case "tool-call":
        return <Wrench className="h-4 w-4 text-orange-600" />;
      case "tool-result":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "step-start":
      case "step-complete":
        return <Brain className="h-4 w-4 text-blue-600" />;
      case "error":
        return <Circle className="h-4 w-4 text-red-600" />;
      default:
        return <FileText className="h-4 w-4 text-gray-600" />;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[600px]">
      {/* Left panel: Step checklist */}
      <Card className="p-4 lg:col-span-1">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5" />
          Analysis Progress
        </h3>
        <ScrollArea className="h-[520px]">
          <div className="space-y-2">
            {steps.map((step) => (
              <div
                key={step.id}
                className={cn(
                  "flex items-start gap-2 p-2 rounded-md text-sm transition-colors",
                  step.status === "in_progress" &&
                    "bg-blue-50 dark:bg-blue-950",
                  step.status === "completed" &&
                    "bg-green-50 dark:bg-green-950",
                )}
              >
                {getStepIcon(step.status)}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs text-gray-500">
                    Step {step.order}/{steps.length}
                  </div>
                  <div className="truncate">{step.name}</div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </Card>

      {/* Right panel: Live stream */}
      <Card className="p-4 lg:col-span-2">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          {isRunning && (
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          )}
          {!isRunning && <FileText className="h-5 w-5" />}
          Analysis Stream
          {currentStep && (
            <span className="ml-auto text-sm text-gray-500">
              Step {currentStep}/{steps.length}
            </span>
          )}
        </h3>

        <ScrollArea className="h-[520px]" ref={scrollRef}>
          <div className="space-y-3 font-mono text-sm">
            {streamMessages.length === 0 && (
              <div className="text-gray-500 text-center py-8">
                Waiting for analysis to start...
              </div>
            )}

            {streamMessages.map(({ id, message }) => (
              <div
                key={id}
                className={cn(
                  "flex items-start gap-2 p-2 rounded-md",
                  message.type === "tool-call" &&
                    "bg-orange-50 dark:bg-orange-950",
                  message.type === "tool-result" &&
                    "bg-green-50 dark:bg-green-950",
                  message.type === "step-start" &&
                    "bg-blue-50 dark:bg-blue-950 font-semibold",
                  message.type === "error" && "bg-red-50 dark:bg-red-950",
                )}
              >
                {getMessageIcon(message.type)}
                <div className="flex-1 whitespace-pre-wrap break-words">
                  {message.content}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
