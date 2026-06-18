"use client";

import { useEffect, useState } from "react";
import {
  loadWorkflowContext,
  clearWorkflowContext,
  type WorkflowContextData,
} from "@/lib/workflow-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Users,
  MapPin,
  Scale,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface WorkflowContextDisplayProps {
  onDocumentsLoaded?: (files: File[]) => void;
  onClearContext?: () => void;
}

export function WorkflowContextDisplay({
  onDocumentsLoaded,
  onClearContext,
}: WorkflowContextDisplayProps) {
  const [contextData, setContextData] = useState<WorkflowContextData | null>(
    null,
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const [showDetails, setShowDetails] = useState(true);

  useEffect(() => {
    // Load workflow context from localStorage
    const { data, files } = loadWorkflowContext();

    if (data) {
      setContextData(data);
      setIsLoaded(true);

      // Notify parent component about loaded documents
      if (onDocumentsLoaded) {
        const allFiles: File[] = [];
        if (files.subjectDocument) allFiles.push(files.subjectDocument);
        allFiles.push(...files.contextDocuments);
        onDocumentsLoaded(allFiles);
      }
    }
  }, [onDocumentsLoaded]);

  const handleClear = () => {
    clearWorkflowContext();
    setContextData(null);
    setIsLoaded(false);
    if (onClearContext) {
      onClearContext();
    }
  };

  if (!contextData) {
    return null;
  }

  const hasMetadata =
    contextData.metadata.documentType ||
    contextData.metadata.caseType ||
    contextData.metadata.jurisdiction ||
    contextData.metadata.ourClients.length > 0 ||
    contextData.metadata.opposingParties.length > 0;

  const totalDocuments =
    (contextData.subjectDocument ? 1 : 0) + contextData.contextDocuments.length;

  const ageInHours = Math.floor(
    (Date.now() - contextData.timestamp) / (1000 * 60 * 60),
  );
  const isRecent = ageInHours < 1;

  return (
    <Card className="border-2 border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div>
              <CardTitle className="text-lg">Workflow Context Loaded</CardTitle>
              <CardDescription className="text-xs mt-1">
                {isRecent
                  ? "Just now"
                  : `${ageInHours} hour${ageInHours > 1 ? "s" : ""} ago`}{" "}
                from workflow configuration
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? "Hide" : "Show"} Details
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {showDetails && (
        <CardContent className="space-y-4">
          {/* Documents Section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4" />
              <span>Documents ({totalDocuments})</span>
            </div>
            <div className="pl-6 space-y-1">
              {contextData.subjectDocument && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Subject Document:
                  </span>
                  <Badge variant="secondary" className="font-normal">
                    {contextData.subjectDocument.name}
                  </Badge>
                </div>
              )}
              {contextData.contextDocuments.length > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Context Documents:
                  </span>
                  <div className="flex flex-wrap gap-1 max-w-md justify-end">
                    {contextData.contextDocuments.map((doc, idx) => (
                      <Badge
                        key={idx}
                        variant="outline"
                        className="font-normal text-xs"
                      >
                        {doc.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Metadata Section */}
          {hasMetadata && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Scale className="h-4 w-4" />
                <span>Case Information</span>
              </div>
              <div className="pl-6 space-y-2">
                {contextData.metadata.documentType && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground min-w-[120px]">
                      Document Type:
                    </span>
                    <Badge variant="default">
                      {contextData.metadata.documentType}
                    </Badge>
                  </div>
                )}
                {contextData.metadata.caseType && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground min-w-[120px]">
                      Case Type:
                    </span>
                    <Badge variant="default">
                      {contextData.metadata.caseType}
                    </Badge>
                  </div>
                )}
                {contextData.metadata.jurisdiction && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground min-w-[100px]">
                      Jurisdiction:
                    </span>
                    <span className="font-medium">
                      {contextData.metadata.jurisdiction}
                    </span>
                  </div>
                )}
                {contextData.metadata.ourClients.length > 0 && (
                  <div className="flex items-start gap-2 text-sm">
                    <Users className="h-3 w-3 text-muted-foreground mt-0.5" />
                    <span className="text-muted-foreground min-w-[100px]">
                      Our Clients:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {contextData.metadata.ourClients.map((client, idx) => (
                        <Badge
                          key={idx}
                          variant="outline"
                          className="font-normal"
                        >
                          {client}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {contextData.metadata.opposingParties.length > 0 && (
                  <div className="flex items-start gap-2 text-sm">
                    <Users className="h-3 w-3 text-muted-foreground mt-0.5" />
                    <span className="text-muted-foreground min-w-[100px]">
                      Opposing Parties:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {contextData.metadata.opposingParties.map(
                        (party, idx) => (
                          <Badge
                            key={idx}
                            variant="destructive"
                            className="font-normal"
                          >
                            {party}
                          </Badge>
                        ),
                      )}
                    </div>
                  </div>
                )}
                {contextData.metadata.contextSummary && (
                  <div className="mt-2 p-3 bg-muted rounded-md text-sm">
                    <div className="font-medium text-xs text-muted-foreground mb-1">
                      Context Summary:
                    </div>
                    <div className="text-foreground">
                      {contextData.metadata.contextSummary}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Ready to Process Alert */}
          <Alert className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-900 dark:text-green-100">
              All documents and case information have been loaded and are ready
              for analysis. Click "Start Analysis" when ready.
            </AlertDescription>
          </Alert>
        </CardContent>
      )}
    </Card>
  );
}
