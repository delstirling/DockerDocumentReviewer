"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, ChevronRight, Database, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataPanel, SessionData } from "@/components/data-panel";
import { HistoryPanel } from "@/components/history-panel";
import { useRouter } from "next/navigation";

interface AnalysisSidePanelProps {
  sessionId?: number;
}

export function AnalysisSidePanel({ sessionId }: AnalysisSidePanelProps) {
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<"data" | "history">("data");

  const handleSessionCreate = async (data: SessionData) => {
    try {
      // Create FormData to send both metadata and files
      const formData = new FormData();

      // Add metadata as JSON string
      formData.append(
        "metadata",
        JSON.stringify({
          title: data.subjectDocument?.name || "Untitled Document",
          document_type: data.documentType,
          case_type: data.caseType,
          jurisdiction: data.jurisdiction,
          our_clients: data.ourClients || [],
          opposing_parties: data.opposingParties || [],
          context_summary: data.contextSummary,
          ai_mode: data.aiMode || "tools_and_steps",
          metadata: {
            subjectDocumentName: data.subjectDocument?.name,
            contextDocumentCount: data.contextDocuments?.length || 0,
          },
        }),
      );

      // Add files
      if (data.subjectDocument) {
        formData.append("subjectDocument", data.subjectDocument);
      }

      if (data.contextDocuments && data.contextDocuments.length > 0) {
        data.contextDocuments.forEach((doc, index) => {
          formData.append(`contextDocument_${index}`, doc);
        });
      }

      // Create session via API with files
      const response = await fetch("/api/sessions/create", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to create session");
      }

      const result = await response.json();

      // Navigate to new session page where analysis will auto-start
      router.push(`/analysis/${result.sessionId}`);
    } catch (error) {
      console.error("Error creating session:", error);
      throw error;
    }
  };

  const handleSessionSelect = (sessionId: number) => {
    router.push(`/analysis/${sessionId}`);
  };

  return (
    <div
      className={cn(
        "fixed left-0 top-16 h-[calc(100vh-4rem)] border-r border-gray-700 bg-gray-800 transition-all duration-300",
        isCollapsed ? "w-16" : "w-80",
      )}
    >
      {/* Collapse/Expand Button */}
      <div className="absolute -right-3 top-4 z-10">
        <Button
          variant="outline"
          size="icon"
          className="h-6 w-6 rounded-full bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600 hover:text-white"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Expanded State */}
      {!isCollapsed && (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "data" | "history")}
          className="h-full flex flex-col"
        >
          <div className="p-4 border-b border-gray-700">
            <TabsList className="grid w-full grid-cols-2 bg-gray-900 border border-gray-700">
              <TabsTrigger
                value="data"
                className="flex items-center gap-2 text-gray-300 data-[state=active]:bg-gray-700 data-[state=active]:text-white"
              >
                <Database className="h-4 w-4" />
                Data
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="flex items-center gap-2 text-gray-300 data-[state=active]:bg-gray-700 data-[state=active]:text-white"
              >
                <History className="h-4 w-4" />
                History
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="data" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-4">
                <DataPanel
                  sessionId={sessionId}
                  onSessionCreate={handleSessionCreate}
                />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="history" className="flex-1 m-0 overflow-hidden">
            <div className="p-4 h-full">
              <HistoryPanel onSessionSelect={handleSessionSelect} />
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Collapsed State - Show Icons Only */}
      {isCollapsed && (
        <div className="flex flex-col items-center gap-4 py-4 pt-16">
          <Button
            variant={activeTab === "data" ? "default" : "ghost"}
            size="icon"
            className={cn(
              "h-10 w-10",
              activeTab === "data"
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "text-gray-300 hover:bg-gray-700 hover:text-white",
            )}
            onClick={() => {
              setActiveTab("data");
              setIsCollapsed(false);
            }}
            title="Data"
          >
            <Database className="h-5 w-5" />
          </Button>
          <Button
            variant={activeTab === "history" ? "default" : "ghost"}
            size="icon"
            className={cn(
              "h-10 w-10",
              activeTab === "history"
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "text-gray-300 hover:bg-gray-700 hover:text-white",
            )}
            onClick={() => {
              setActiveTab("history");
              setIsCollapsed(false);
            }}
            title="History"
          >
            <History className="h-5 w-5" />
          </Button>
        </div>
      )}
    </div>
  );
}
