"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ChevronLeft, ChevronRight, Database, History } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidePanelProps {
  children?: React.ReactNode;
  defaultTab?: "data" | "history";
  defaultCollapsed?: boolean;
}

export function SidePanel({
  children,
  defaultTab = "data",
  defaultCollapsed = false,
}: SidePanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [activeTab, setActiveTab] = useState<"data" | "history">(defaultTab);
  const [isMobile, setIsMobile] = useState(false);

  // Check for mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      // Auto-collapse on mobile
      if (window.innerWidth < 768) {
        setIsCollapsed(true);
      }
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Load panel state from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTab = localStorage.getItem("sidePanel_activeTab");
      const savedCollapsed = localStorage.getItem("sidePanel_collapsed");

      if (savedTab === "data" || savedTab === "history") {
        setActiveTab(savedTab);
      }

      if (savedCollapsed !== null && !isMobile) {
        setIsCollapsed(savedCollapsed === "true");
      }
    }
  }, [isMobile]);

  // Save panel state to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("sidePanel_activeTab", activeTab);
      localStorage.setItem("sidePanel_collapsed", String(isCollapsed));
    }
  }, [activeTab, isCollapsed]);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div
      className={cn(
        "relative flex h-full flex-col border-r bg-background transition-all duration-300",
        isCollapsed ? "w-0 md:w-12" : "w-80 md:w-96",
      )}
    >
      {/* Collapse/Expand Button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "absolute -right-3 top-4 z-50 h-6 w-6 rounded-full border bg-background shadow-md",
          isCollapsed && "rotate-180",
        )}
        onClick={toggleCollapse}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>

      {/* Panel Content - Hidden when collapsed */}
      {!isCollapsed && (
        <div className="flex h-full flex-col">
          {/* Header with Tabs */}
          <div className="border-b p-4">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "data" | "history")}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="data" className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Data
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  className="flex items-center gap-2"
                >
                  <History className="h-4 w-4" />
                  History
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Scrollable Content Area */}
          <ScrollArea className="flex-1">
            <div className="p-4">
              {activeTab === "data" && (
                <div id="data-panel-content">
                  {/* Data panel content will be injected here */}
                  <div className="text-sm text-muted-foreground">
                    Data panel content loading...
                  </div>
                </div>
              )}
              {activeTab === "history" && (
                <div id="history-panel-content">
                  {/* History panel content will be injected here */}
                  <div className="text-sm text-muted-foreground">
                    History panel content loading...
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Collapsed State - Show Icons Only */}
      {isCollapsed && (
        <div className="hidden md:flex flex-col items-center gap-4 py-4">
          <Button
            variant={activeTab === "data" ? "default" : "ghost"}
            size="icon"
            className="h-10 w-10"
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
            className="h-10 w-10"
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
