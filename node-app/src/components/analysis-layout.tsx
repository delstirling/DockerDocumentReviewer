"use client";

import { ReactNode } from "react";
import { AnalysisSidePanel } from "@/components/analysis-side-panel";

interface AnalysisLayoutProps {
  children: ReactNode;
  sessionId?: number;
}

export function AnalysisLayout({ children, sessionId }: AnalysisLayoutProps) {
  return (
    <div className="flex flex-1">
      {/* Side Panel */}
      <AnalysisSidePanel sessionId={sessionId} />

      {/* Main Content */}
      <div className="flex-1 ml-80 overflow-auto">{children}</div>
    </div>
  );
}
