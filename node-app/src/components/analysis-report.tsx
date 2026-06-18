"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  ListChecks,
  RotateCcw,
  Download,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatReport,
  getFileExtension,
  getMimeType,
} from "@/lib/report-formatter";
import { useToast } from "@/hooks/use-toast";
import { VerifiedAuthorityCard } from "@/components/verified-authority-card";

interface AnalysisData {
  documentType?: string;
  jurisdiction?: string;
  overallStatus?: "compliant" | "needs-review";
  executiveSummary?: string;
  fullAnalysis?: string;
  timestamp?: string;
  steps?: Array<{
    stepId: string;
    stepName: string;
    content: string;
    toolCalls: number;
  }>;
  verifiedAuthorities?: Array<{
    citation: string;
    url: string;
    verified: boolean;
    fallback_flag?: boolean;
    confidence_score?: number;
    note?: string;
  }>;
  verificationStats?: {
    total: number;
    verified: number;
    failed: number;
    fallback: number;
  };
  citationIndex?: {
    nextNumber: number;
    lastColor?: string | null;
    citations: Array<{
      number: number;
      citation: string;
      quote: string;
      url: string;
      color: string;
    }>;
  };
  contextualAnalyses?: Array<{
    authority_citation: string;
    preceding_context: {
      summary: string;
      quotes: string[];
    };
    statement_function: string;
    subsequent_development: {
      summary: string;
      quotes: string[];
    };
    qualifications_limitations: {
      summary: string;
      quotes: string[];
    };
    alignment_verification: string;
  }>;
}

interface AnalysisReportProps {
  data: AnalysisData;
  onReset: () => void;
}

export default function AnalysisReport({ data, onReset }: AnalysisReportProps) {
  const [downloadFormat, setDownloadFormat] = useState<
    "json" | "markdown" | "txt" | "docx"
  >("markdown");
  const [copied, setCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  const downloadReport = useCallback(
    async (format: "json" | "markdown" | "txt" | "docx") => {
      if (typeof window === "undefined") return;

      try {
        setIsDownloading(true);

        if (format === "docx") {
          const response = await fetch("/api/export-word", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fullAnalysis: data.fullAnalysis || "",
              timestamp: data.timestamp || new Date().toISOString(),
              documentNames: ["Document"],
              citationIndex: {
                nextNumber: data.citationIndex?.nextNumber || 1,
                lastColor: data.citationIndex?.lastColor || null,
                citations: data.citationIndex?.citations || [],
              },
              contextualAnalyses: data.contextualAnalyses || [],
            }),
          });

          if (!response.ok) {
            throw new Error("Failed to generate Word document");
          }

          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `legal-analysis-report.docx`;
          a.click();
          URL.revokeObjectURL(url);

          toast({
            title: "Report Downloaded",
            description: "Report downloaded as Word document",
          });
        } else {
          const reportText = formatReport(data, format);
          const blob = new Blob([reportText], { type: getMimeType(format) });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `legal-analysis-report.${getFileExtension(format)}`;
          a.click();
          URL.revokeObjectURL(url);

          toast({
            title: "Report Downloaded",
            description: `Report downloaded as ${format.toUpperCase()} format`,
          });
        }
      } catch (error) {
        console.error("Download error:", error);
        toast({
          title: "Download Failed",
          description: "Failed to download report. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsDownloading(false);
      }
    },
    [data, toast],
  );

  const copyReport = useCallback(async () => {
    try {
      const reportText = formatReport(data, "markdown");

      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(reportText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);

        toast({
          title: "Report Copied",
          description: "Report copied to clipboard in Markdown format",
        });
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = reportText;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);

        setCopied(true);
        setTimeout(() => setCopied(false), 2000);

        toast({
          title: "Report Copied",
          description: "Report copied to clipboard in Markdown format",
        });
      }
    } catch (error) {
      console.error("Copy error:", error);
      toast({
        title: "Copy Failed",
        description: "Failed to copy report. Please try again.",
        variant: "destructive",
      });
    }
  }, [data, toast]);

  const handleDownloadChecklist = useCallback(() => {
    // Safety check for browser environment
    if (typeof window === "undefined") return;

    const checklistElement = document.querySelector('[value="checklist"]');
    const checklistText = checklistElement?.textContent || "";
    const blob = new Blob([checklistText], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paralegal-checklist.txt";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Analysis Complete
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Comprehensive legal document review finished
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={copyReport}>
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy Report
              </>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Download Report
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => downloadReport("docx")}
                disabled={isDownloading}
              >
                <FileText className="mr-2 h-4 w-4" />
                Word Document (.docx)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => downloadReport("markdown")}
                disabled={isDownloading}
              >
                <FileText className="mr-2 h-4 w-4" />
                Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => downloadReport("txt")}
                disabled={isDownloading}
              >
                <FileText className="mr-2 h-4 w-4" />
                Plain Text (.txt)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => downloadReport("json")}
                disabled={isDownloading}
              >
                <FileText className="mr-2 h-4 w-4" />
                JSON (.json)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={onReset}>
            <RotateCcw className="mr-2 h-4 w-4" />
            New Analysis
          </Button>
        </div>
      </div>

      <Tabs defaultValue="summary" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="summary">Executive Summary</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="issues">Critical Issues</TabsTrigger>
          <TabsTrigger value="authorities">Verified Authorities</TabsTrigger>
          <TabsTrigger value="checklist">Paralegal Checklist</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Executive Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Document Type</p>
                  <p className="text-lg font-semibold text-foreground mt-1">
                    {data?.documentType || "Motion"}
                  </p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Jurisdiction</p>
                  <p className="text-lg font-semibold text-foreground mt-1">
                    {data?.jurisdiction || "Kansas Federal"}
                  </p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    Overall Status
                  </p>
                  <Badge
                    variant={
                      data?.overallStatus === "compliant"
                        ? "default"
                        : "destructive"
                    }
                    className="mt-1"
                  >
                    {data?.overallStatus || "Needs Review"}
                  </Badge>
                </div>
              </div>

              <div className="prose prose-sm max-w-none">
                <p className="text-foreground leading-relaxed">
                  {data?.executiveSummary ||
                    "This document has been analyzed for compliance with Kansas state and federal court requirements. The analysis identified several areas requiring attention before filing."}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Compliance Assessment</CardTitle>
              <CardDescription>
                Detailed analysis of document compliance with applicable rules
                and regulations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  area: "Formatting Requirements",
                  status: "pass",
                  details: "Document meets Kansas court formatting standards",
                },
                {
                  area: "Party Information",
                  status: "pass",
                  details:
                    "All parties properly identified with correct legal names",
                },
                {
                  area: "Legal Citations",
                  status: "warning",
                  details:
                    "Some citations need Bluebook formatting corrections",
                },
                {
                  area: "Procedural Requirements",
                  status: "pass",
                  details: "Complies with local court rules",
                },
                {
                  area: "Ethical Standards",
                  status: "pass",
                  details: "No ethical concerns identified",
                },
              ].map((item, index) => (
                <div
                  key={`compliance-${index}`}
                  className="flex items-start gap-3 p-4 border border-border rounded-lg"
                >
                  {item.status === "pass" ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{item.area}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {item.details}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="issues" className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Critical Issues Identified</AlertTitle>
            <AlertDescription>
              The following issues require immediate attention before filing
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Priority Issues</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  priority: "high",
                  title: "Missing Legal Authority",
                  description:
                    "Document cites KSA 60-212 but does not include the full statutory text or proper analysis of its application to the facts.",
                  recommendation:
                    "Add comprehensive analysis of KSA 60-212 with specific application to case facts.",
                },
                {
                  priority: "medium",
                  title: "Citation Format Issues",
                  description:
                    "Several case citations do not follow proper Bluebook format for Kansas state courts.",
                  recommendation:
                    "Review and correct all citations to comply with Kansas citation standards.",
                },
                {
                  priority: "medium",
                  title: "Factual Gaps",
                  description:
                    "The chronology of events is unclear between March 15 and April 2, 2024.",
                  recommendation:
                    "Provide detailed timeline of events with supporting documentation.",
                },
              ].map((issue, index) => (
                <div
                  key={`issue-${index}`}
                  className="p-4 border border-border rounded-lg space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        issue.priority === "high" ? "destructive" : "default"
                      }
                    >
                      {issue.priority.toUpperCase()}
                    </Badge>
                    <h3 className="font-semibold text-foreground">
                      {issue.title}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {issue.description}
                  </p>
                  <div className="pt-2 border-t border-border">
                    <p className="text-sm font-medium text-foreground">
                      Recommendation:
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {issue.recommendation}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="authorities" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Verified Legal Authorities</CardTitle>
              <CardDescription>
                Citations verified against authoritative sources with quote
                verification
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data?.verificationStats && (
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">Total</p>
                    <p className="text-2xl font-bold text-foreground mt-1">
                      {data.verificationStats.total}
                    </p>
                  </div>
                  <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                    <p className="text-sm text-muted-foreground">Verified</p>
                    <p className="text-2xl font-bold text-green-600 mt-1">
                      {data.verificationStats.verified}
                    </p>
                  </div>
                  <div className="p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      Non-Searchable
                    </p>
                    <p className="text-2xl font-bold text-yellow-600 mt-1">
                      {data.verificationStats.fallback}
                    </p>
                  </div>
                  <div className="p-4 bg-red-50 dark:bg-red-950 rounded-lg">
                    <p className="text-sm text-muted-foreground">Failed</p>
                    <p className="text-2xl font-bold text-red-600 mt-1">
                      {data.verificationStats.failed}
                    </p>
                  </div>
                </div>
              )}

              {data?.verifiedAuthorities &&
              data.verifiedAuthorities.length > 0 ? (
                <div className="space-y-4">
                  {data.verifiedAuthorities.map((authority, index) => (
                    <VerifiedAuthorityCard
                      key={`authority-${index}`}
                      citation={authority.citation}
                      url={authority.url}
                      verified={authority.verified}
                      fallback_flag={authority.fallback_flag}
                      confidence_score={authority.confidence_score}
                      note={authority.note}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>
                    No authority verification data available. The AI will use
                    verification tools when analyzing citations in the document.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checklist" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5" />
                Paralegal Action Checklist
              </CardTitle>
              <CardDescription>
                Actionable items for paralegal staff to address identified
                issues
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
                    <span className="inline-block w-3 h-3 rounded-full bg-red-500"></span>
                    TIER 1 - CRITICAL (Immediate/Today)
                  </h3>
                  <ul className="space-y-2 ml-5">
                    <li className="text-sm text-foreground">
                      <input type="checkbox" className="mr-2" />
                      Research and obtain full text of KSA 60-212 and prepare
                      analysis memo
                    </li>
                    <li className="text-sm text-foreground">
                      <input type="checkbox" className="mr-2" />
                      Verify all party names against court records and correct
                      any discrepancies
                    </li>
                    <li className="text-sm text-foreground">
                      <input type="checkbox" className="mr-2" />
                      Obtain missing documentation for March 15 - April 2, 2024
                      timeline gap
                    </li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
                    <span className="inline-block w-3 h-3 rounded-full bg-yellow-500"></span>
                    TIER 2 - HIGH PRIORITY (24-48 hours)
                  </h3>
                  <ul className="space-y-2 ml-5">
                    <li className="text-sm text-foreground">
                      <input type="checkbox" className="mr-2" />
                      Review and correct all case citations to Bluebook format
                    </li>
                    <li className="text-sm text-foreground">
                      <input type="checkbox" className="mr-2" />
                      Shepardize all cited cases to ensure they are still good
                      law
                    </li>
                    <li className="text-sm text-foreground">
                      <input type="checkbox" className="mr-2" />
                      Verify court filing requirements and deadlines
                    </li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
                    <span className="inline-block w-3 h-3 rounded-full bg-green-500"></span>
                    TIER 3 - IMPORTANT (Within 1 week)
                  </h3>
                  <ul className="space-y-2 ml-5">
                    <li className="text-sm text-foreground">
                      <input type="checkbox" className="mr-2" />
                      Prepare exhibit binders with proper labeling and indexing
                    </li>
                    <li className="text-sm text-foreground">
                      <input type="checkbox" className="mr-2" />
                      Draft certificate of service with correct service method
                    </li>
                    <li className="text-sm text-foreground">
                      <input type="checkbox" className="mr-2" />
                      Final proofread for grammar, spelling, and formatting
                      consistency
                    </li>
                  </ul>
                </div>
              </div>

              <Button className="w-full" onClick={handleDownloadChecklist}>
                <Download className="mr-2 h-4 w-4" />
                Download Checklist
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
