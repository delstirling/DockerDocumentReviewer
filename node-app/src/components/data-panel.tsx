"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  Users,
  MapPin,
  FileCheck2,
  Loader2,
  Sparkles,
  X,
  Shield,
  Swords,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useToast } from "@/hooks/use-toast";
import TextExtractingOverlay from "@/components/TextExtractingOverlay";
import { useExtractingOverlay } from "@/hooks/use-extracting-overlay";
import {
  extractTextFromFile,
  calculatePayloadSize,
  formatBytes,
  type ExtractedDocument,
} from "@/lib/client-extract";

interface DataPanelProps {
  sessionId?: number;
  onSessionCreate?: (data: SessionData) => void;
}

export interface SessionData {
  subjectDocument: File | null;
  contextDocuments: File[];
  documentType: string;
  caseType: string;
  jurisdiction: string;
  ourClients: string[];
  opposingParties: string[];
  contextSummary: string;
  aiMode: "none" | "tools" | "tools_and_steps";
  executionMode: "step-based" | "phase-based";
  hasSubjectDocument: boolean;
  documentOrigin?: "our_firm" | "opposing" | "neutral" | "unknown";
}

export function DataPanel({ sessionId, onSessionCreate }: DataPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const storageKey = sessionId
    ? `draftSessionData:${sessionId}`
    : "draftSessionData";
  const [draftData, setDraftData] = useLocalStorage<Partial<SessionData>>(
    storageKey,
    {
      aiMode: "tools_and_steps",
      executionMode: "step-based",
      hasSubjectDocument: false,
    },
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingField, setLoadingField] = useState<
    "documentType" | "caseType" | "jurisdiction" | "parties" | "summary" | null
  >(null);
  const [status, setStatus] = useState<"draft" | "processing" | "complete">(
    "draft",
  );
  const [extractionConfidence, setExtractionConfidence] = useState<
    string | null
  >(null);
  const {
    isExtracting: isAnalyzing,
    setIsExtracting: setIsAnalyzing,
    substatus,
  } = useExtractingOverlay();

  useEffect(() => {
    const fetchSessionData = async (retryCount = 0) => {
      if (!sessionId) return;

      const sessionIdParam = String(sessionId);
      const maxRetries = 2;
      const retryDelayMs = 500;

      try {
        console.log(
          `[DataPanel] Fetching session data for ${sessionIdParam}${retryCount > 0 ? ` (retry ${retryCount})` : ""}`,
        );
        const response = await fetch(`/api/sessions/${sessionIdParam}`);

        if (!response.ok) {
          if (response.status === 404 && retryCount < maxRetries) {
            console.log(
              `[DataPanel] Session not found (404), retrying in ${retryDelayMs}ms...`,
            );
            await new Promise((r) => setTimeout(r, retryDelayMs));
            return fetchSessionData(retryCount + 1);
          }
          console.error(
            "[DataPanel] Failed to fetch session data:",
            response.status,
          );
          return;
        }

        const data = await response.json();
        console.log("[DataPanel] Fetched session data:", data);

        if (data.success && data.session) {
          const session = data.session;
          const hasDocuments = data.documents && data.documents.length > 0;
          const hasSubjectDoc =
            hasDocuments &&
            data.documents.some(
              (doc: { documentRole: string }) => doc.documentRole === "subject",
            );

          console.log(
            `[DataPanel] Session has ${data.documents?.length || 0} documents, hasSubjectDoc: ${hasSubjectDoc}`,
          );

          if (
            session.status === "processing" ||
            session.status === "complete" ||
            session.status === "draft"
          ) {
            setStatus(session.status);
          }

          setDraftData((prev) => {
            const localHasFiles = !!(
              prev.subjectDocument instanceof File ||
              (prev.contextDocuments?.some((f) => f instanceof File) ?? false)
            );

            console.log(
              `[DataPanel] Local file selection state: localHasFiles=${localHasFiles}, hasSubjectDocFromDB=${hasSubjectDoc}`,
            );

            return {
              ...prev,
              documentType: session.documentType || prev.documentType || "",
              caseType: session.caseType || prev.caseType || "",
              jurisdiction: session.jurisdiction || prev.jurisdiction || "",
              ourClients: session.ourClients || prev.ourClients || [],
              opposingParties:
                session.opposingParties || prev.opposingParties || [],
              contextSummary:
                session.contextSummary || prev.contextSummary || "",
              hasSubjectDocument: localHasFiles ? true : hasSubjectDoc,
            };
          });
        }
      } catch (error) {
        console.error("[DataPanel] Error fetching session data:", error);
      }
    };

    fetchSessionData();
  }, [sessionId]); // Re-run when sessionId changes

  useEffect(() => {
    // When creating a new session (no sessionId), always start with clean state
    // This prevents stale data from previous sessions appearing in new sessions
    if (!sessionId) {
      const hasStaleData =
        (draftData.ourClients && draftData.ourClients.length > 0) ||
        (draftData.opposingParties && draftData.opposingParties.length > 0) ||
        draftData.contextSummary ||
        draftData.documentType ||
        draftData.caseType ||
        draftData.jurisdiction;

      if (hasStaleData) {
        console.log(
          "[DataPanel] Clearing stale data for new session - no sessionId provided",
        );
        setDraftData({
          aiMode: "tools_and_steps",
          executionMode: "step-based",
          hasSubjectDocument: false,
          ourClients: [],
          opposingParties: [],
          contextSummary: "",
          documentType: "",
          caseType: "",
          jurisdiction: "",
        });
      }
    } else if (draftData.hasSubjectDocument === false) {
      // For existing sessions, only clear if no subject document
      const hasStaleData =
        (draftData.ourClients && draftData.ourClients.length > 0) ||
        (draftData.opposingParties && draftData.opposingParties.length > 0) ||
        draftData.contextSummary ||
        draftData.documentType ||
        draftData.caseType ||
        draftData.jurisdiction;

      if (hasStaleData) {
        console.log(
          "[DataPanel] Sanitizing stale data - no subject document present",
        );
        setDraftData((prev) => ({
          ...prev,
          ourClients: [],
          opposingParties: [],
          contextSummary: "",
          documentType: "",
          caseType: "",
          jurisdiction: "",
        }));
      }
    }
  }, [sessionId]); // Re-run when sessionId changes

  // Safely extract an error message from a fetch Response without consuming the
  // body multiple times. Reads the body once as text, then attempts JSON parse.
  const parseErrorResponse = async (response: Response): Promise<string> => {
    try {
      const raw = await response.text();
      try {
        const jsonData = JSON.parse(raw);
        if (jsonData && typeof jsonData === "object") {
          return (
            jsonData.error ||
            jsonData.message ||
            jsonData.details ||
            "Unknown error occurred"
          );
        }
      } catch {
        // Not JSON – return trimmed raw text if present.
        if (raw && raw.length > 0) {
          return raw.length > 200 ? raw.substring(0, 200) + "..." : raw;
        }
      }
    } catch (err) {
      console.error("[Error Parsing] Failed to read response body:", err);
    }
    console.error(
      "[Error Parsing] Unable to parse error response, returning generic message",
    );
    return "Unknown error occurred";
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const truncateFileName = (
    fileName: string,
    maxLength: number = 25,
  ): string => {
    if (fileName.length <= maxLength) return fileName;
    return fileName.substring(0, maxLength) + "...";
  };

  const calculateTotalSize = (): number => {
    let total = 0;
    if (draftData.subjectDocument) {
      total += draftData.subjectDocument.size;
    }
    if (draftData.contextDocuments) {
      draftData.contextDocuments.forEach((doc) => {
        total += doc.size;
      });
    }
    return total;
  };

  const handleRemoveSubjectDocument = () => {
    setDraftData((prev) => ({
      ...prev,
      subjectDocument: null,
      hasSubjectDocument: false,
      ourClients: [],
      opposingParties: [],
      contextSummary: "",
      documentType: "",
      caseType: "",
      jurisdiction: "",
    }));
    setExtractionConfidence(null);
  };

  const handleRemoveContextDocument = (index: number) => {
    setDraftData((prev) => ({
      ...prev,
      contextDocuments: prev.contextDocuments?.filter((_, i) => i !== index),
    }));
  };

  // Extract metadata from document using AI
  const extractMetadata = async (file: File) => {
    const sanitize = (str: string) => str.replace(/[\n\r]/g, "");
    setLoadingField("summary");
    setExtractionConfidence(null);
    setIsAnalyzing(true); // Show "Extracting Text..." overlay

    try {
      // STEP 1: Extract text client-side from subject document (like handleGetParties does)
      console.log("[ExtractMetadata] Starting client-side text extraction...");
      const subjectDoc = await extractTextFromFile(file, "subject");
      console.log(
        `[ExtractMetadata] Extracted ${subjectDoc.content.length} chars from subject document`,
      );

      // STEP 2: Extract text from context documents if present
      const contextDocs: ExtractedDocument[] = [];
      if (draftData.contextDocuments && draftData.contextDocuments.length > 0) {
        for (const contextFile of draftData.contextDocuments.slice(0, 10)) {
          const contextDoc = await extractTextFromFile(contextFile, "context");
          contextDocs.push(contextDoc);
        }
        console.log(
          `[ExtractMetadata] Extracted text from ${contextDocs.length} context documents`,
        );
      }

      // STEP 3: Build payload with extracted text (JSON, not FormData)
      const payload = {
        subjectDocument: {
          name: subjectDoc.name,
          content: subjectDoc.content,
        },
        contextDocuments: contextDocs.map((doc) => ({
          name: doc.name,
          content: doc.content,
        })),
        contextSummary: draftData.contextSummary || "",
      };

      // STEP 3.5: Validate payload size BEFORE sending
      const allDocs = [subjectDoc, ...contextDocs];
      const payloadSize = calculatePayloadSize(allDocs);
      const maxPayloadSize = 4.5 * 1024 * 1024; // 4.5 MB limit

      console.log(
        `[ExtractMetadata] Payload size: ${formatBytes(payloadSize)} / ${formatBytes(maxPayloadSize)}`,
      );
      if (payloadSize > maxPayloadSize) {
        setLoadingField(null);
        setIsAnalyzing(false);
        toast({
          title: "Content Too Large",
          description: `Extracted text size (${formatBytes(payloadSize)}) exceeds the ${formatBytes(maxPayloadSize)} limit. Please remove some documents or use shorter documents.`,
          variant: "destructive",
        });
        return;
      }

      // STEP 4: Send extracted text to API (JSON, not FormData)
      console.log("[ExtractMetadata] Sending extracted text to API...");
      const response = await fetch("/api/extract-document-metadata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      // Read the raw response body once to avoid consuming the stream multiple times.
      const rawResponse = await response.text();
      if (!response.ok) {
        const errorMessage = await parseErrorResponse({
          // Create a mock Response-like object with the raw body for parsing.
          ...response,
          text: async () => rawResponse,
          json: async () => JSON.parse(rawResponse),
        } as any);
        const sanitizedErrorMessage = errorMessage.replace(/[\n\r]/g, " ");
        console.error(
          `[ExtractMetadata] API error (${response.status}):`,
          sanitizedErrorMessage,
        );
        throw new Error(sanitizedErrorMessage || "Failed to extract metadata");
      }

      let data: any;
      try {
        data = JSON.parse(rawResponse);
      } catch (jsonErr) {
        console.error('[ExtractMetadata] Failed to parse JSON response:', jsonErr);
        throw new Error(rawResponse || 'Failed to parse server response');
      }
      const sanitizedDataStr = JSON.stringify(data, null, 2).replace(/[\n\r]/g, "");
      console.log("[🔍 DIAGNOSTIC] ✅ API Response for metadata:", sanitizedDataStr);

      if (data.success && data.metadata) {
        const meta = data.metadata;
        setDraftData((prev) => ({
          ...prev,
          jurisdiction: meta.jurisdiction,
          ourClients: meta.our_clients || [],
          opposingParties: meta.opposing_parties || [],
          contextSummary: meta.summary || prev.contextSummary || "",
          documentOrigin: meta.document_origin || "unknown",
        }));

        setExtractionConfidence(meta.confidence);
      } else {
        toast({
          title: "Extraction Failed",
          description:
            "Failed to extract metadata. Please try again or fill manually.",
          variant: "destructive",
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ExtractMetadata] Error:", sanitize(message));
      toast({
        title: "Extraction Error",
        description:
          message ||
          "Failed to extract metadata. Please try again or fill manually.",
        variant: "destructive",
      });
    } finally {
      setLoadingField(null);
      setIsAnalyzing(false);
    }
  };

  // Handle file uploads
  const handleSubjectDocumentUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      setDraftData((prev) => ({
        ...prev,
        subjectDocument: file,
        hasSubjectDocument: true,
      }));
    }
  };

  const handleGenerateSummary = async () => {
    if (!draftData.subjectDocument) {
      toast({
        title: "No Document",
        description: "Please upload a subject document first",
        variant: "destructive",
      });
      return;
    }
    await extractMetadata(draftData.subjectDocument);
  };

  const handleGetParties = async () => {
    console.log(
      `[handleGetParties] Starting - subjectDocument type: ${typeof draftData.subjectDocument}, instanceof File: ${draftData.subjectDocument instanceof File}, name: ${draftData.subjectDocument instanceof File ? draftData.subjectDocument.name : "N/A"}`,
    );

    if (!draftData.subjectDocument) {
      toast({
        title: "No Document",
        description: "Please upload a subject document first",
        variant: "destructive",
      });
      return;
    }

    if (
      !(draftData.subjectDocument instanceof File) ||
      typeof draftData.subjectDocument.arrayBuffer !== "function"
    ) {
      console.error(
        `[handleGetParties] Invalid File object - typeof: ${typeof draftData.subjectDocument}, instanceof File: ${draftData.subjectDocument instanceof File}`,
      );
      toast({
        title: "Document Reference Invalid",
        description:
          "Please re-upload the subject document. File references don't survive page refresh.",
        variant: "destructive",
      });
      return;
    }

    setLoadingField("parties");
    setIsAnalyzing(true); // Show "Extracting Text..." overlay
    try {
      // STEP 1: Extract text client-side from subject document
      const sanitizedName = draftData.subjectDocument.name.replace(
        /[\n\r]/g,
        "",
      );
      const sanitizedType = draftData.subjectDocument.type.replace(
        /[\n\r]/g,
        "",
      );
      console.log(
        `[GetParties] Starting client-side text extraction for: ${sanitizedName} (${sanitizedType})`,
      );
      const subjectDoc = await extractTextFromFile(
        draftData.subjectDocument,
        "subject",
      );
      console.log(
        `[GetParties] Successfully extracted ${subjectDoc.content.length} chars from subject document using ${draftData.subjectDocument.type.includes("pdf") ? "PDF.js" : draftData.subjectDocument.type.includes("word") ? "mammoth" : "plain text"} extraction`,
      );

      // STEP 2: Extract text from context documents if present
      const contextDocs: ExtractedDocument[] = [];
      if (draftData.contextDocuments && draftData.contextDocuments.length > 0) {
        for (const contextFile of draftData.contextDocuments.slice(0, 10)) {
          if (
            !(contextFile instanceof File) ||
            typeof contextFile.arrayBuffer !== "function"
          ) {
            toast({
              title: "Context Document Reference Invalid",
              description:
                "Please re-upload context documents. File references don't survive page refresh.",
              variant: "destructive",
            });
            setLoadingField(null);
            setIsAnalyzing(false);
            return;
          }
          const contextDoc = await extractTextFromFile(contextFile, "context");
          contextDocs.push(contextDoc);
        }
        console.log(
          `[GetParties] Extracted text from ${contextDocs.length} context documents`,
        );
      }

      // STEP 3: Build payload with extracted text
      const payload = {
        subjectDocument: {
          name: subjectDoc.name,
          content: subjectDoc.content,
        },
        contextDocuments: contextDocs.map((doc) => ({
          name: doc.name,
          content: doc.content,
        })),
        contextSummary: draftData.contextSummary || "",
      };

      // STEP 3.5: Validate payload size BEFORE sending
      const allDocs = [subjectDoc, ...contextDocs];
      const payloadSize = calculatePayloadSize(allDocs);
      const maxPayloadSize = 4.5 * 1024 * 1024; // 4.5 MB limit
      console.log(
        `[GetParties] Payload size: ${formatBytes(payloadSize)} / ${formatBytes(maxPayloadSize)}`,
      );

      if (payloadSize > maxPayloadSize) {
        setLoadingField(null);
        setIsAnalyzing(false);
        toast({
          title: "Content Too Large",
          description: `Extracted text size (${formatBytes(payloadSize)}) exceeds the ${formatBytes(maxPayloadSize)} limit. Please remove some documents or use shorter documents.`,
          variant: "destructive",
        });
        return;
      }

      // STEP 4: Send extracted text to API
      console.log("[GetParties] Sending extracted text to API...");
      const response = await fetch("/api/extract-document-metadata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response);
        const sanitizedErrorMessage = errorMessage.replace(/[\n\r]/g, "");
        console.error(
          `[GetParties] API error (${response.status}):`,
          sanitizedErrorMessage,
        );
        throw new Error(sanitizedErrorMessage || "Failed to extract parties");
      }

      const data = await response.json();
      const rawResponseString = JSON.stringify(data, null, 2);
      const sanitizedResponseString = rawResponseString.replace(/[\n\r]/g, "");
      console.log(
        "[🔍 DIAGNOSTIC] ✅ API Response for parties:",
        sanitizedResponseString,
      );

      const meta = data.metadata;
      const sanitizedMetaOurClients = (meta.our_clients || []).map((c: string) =>
        c.replace(/[\n\r]/g, ""),
      );
      const sanitizedMetaOpposingParties = (meta.opposing_parties || []).map(
        (c: string) => c.replace(/[\n\r]/g, ""),
      );
      console.log("[🔍 DIAGNOSTIC] meta.our_clients:", sanitizedMetaOurClients);
      console.log(
        "[🔍 DIAGNOSTIC] meta.opposing_parties:",
        sanitizedMetaOpposingParties,
      );

      // 🔧 CRITICAL Fix: Update BOTH fields in a SINGLE setState call
      // Previously had TWO separate setDraftData calls which caused race condition
      // The second call would sometimes overwrite the first
      const hasClients = meta.our_clients && meta.our_clients.length > 0;
      const hasParties =
        meta.opposing_parties && meta.opposing_parties.length > 0;

      if (hasClients || hasParties) {
        console.log(
          "[🔍 DIAGNOSTIC] ⚠️ ATTEMPTING STATE UPDATE with parties data:",
          { hasClients, hasParties },
        );

        setDraftData((prev) => {
          console.log("[🔍 DIAGNOSTIC] Inside setDraftData for BOTH parties");
          console.log("[🔍 DIAGNOSTIC] Previous ourClients:", prev.ourClients);
          console.log(
            "[🔍 DIAGNOSTIC] Previous opposingParties:",
            prev.opposingParties,
          );

          const newState = { ...prev };

          if (hasClients) {
            const newClients = Array.from(
              new Set([...(prev.ourClients || []), ...meta.our_clients]),
            );
            const sanitizedNewClients = newClients.map((c: string) =>
              c.replace(/[\n\r]/g, ""),
            );
            console.log("[🔍 DIAGNOSTIC] New ourClients:", sanitizedNewClients);
            newState.ourClients = newClients;
          }

          if (hasParties) {
            const newParties = Array.from(
              new Set([
                ...(prev.opposingParties || []),
                ...meta.opposing_parties,
              ]),
            );
            const sanitizedNewOpposingParties = newParties.map((c: string) =>
              c.replace(/[\n\r]/g, ""),
            );
            console.log(
              "[🔍 DIAGNOSTIC] New opposingParties:",
              sanitizedNewOpposingParties,
            );
            newState.opposingParties = newParties;
          }

          // Also update documentOrigin if returned by the API
          if (meta.document_origin) {
            const sanitizedDocumentOrigin = meta.document_origin.replace(
              /[\n\r]/g,
              "",
            );
            console.log(
              "[🔍 DIAGNOSTIC] Setting documentOrigin:",
              sanitizedDocumentOrigin,
            );
            newState.documentOrigin = meta.document_origin;
          }

          return newState;
        });
      } else {
        console.log(
          "[🔍 DIAGNOSTIC] ❌ Both our_clients and opposing_parties are empty",
        );
        toast({
          title: "No Parties Found",
          description:
            "Could not identify any parties in the document. The document may be a scanned image without text, or the content may not clearly identify parties. Please enter the parties manually.",
          variant: "destructive",
        });
      }

      console.log("[GetParties] Successfully extracted parties");
    } catch (error: unknown) {
      console.error("[GetParties] Error:", error);
        toast({
          title: "Extraction Failed",
          description:
            (error as Error).message ||
            "Failed to extract parties. Please try again or enter them manually.",
          variant: "destructive",
        });
    } finally {
      setLoadingField(null);
      setIsAnalyzing(false); // Hide overlay
    }
  };

  const handleGetDocumentType = async () => {
    console.log("[🔍 DIAGNOSTIC] handleGetDocumentType called");
    const sanitizedDraftData = JSON.stringify(draftData, null, 2).replace(
      /[\n\r]/g,
      "",
    );
    console.log("[🔍 DIAGNOSTIC] Current draftData state:", sanitizedDraftData);

    if (!draftData.subjectDocument) {
      console.log("[🔍 DIAGNOSTIC] No subject document found, aborting");
      toast({
        title: "No Document",
        description: "Please upload a subject document first",
        variant: "destructive",
      });
      return;
    }

    if (
      !(draftData.subjectDocument instanceof File) ||
      typeof draftData.subjectDocument.arrayBuffer !== "function"
    ) {
      toast({
        title: "Document Reference Invalid",
        description:
          "Please re-upload the subject document. File references don't survive page refresh.",
        variant: "destructive",
      });
      return;
    }

    console.log(
      "[🔍 DIAGNOSTIC] Subject document exists:",
      draftData.subjectDocument.name,
    );
    setLoadingField("documentType");
    setIsAnalyzing(true);
    try {
      const sanitizedSubjectName = draftData.subjectDocument.name.replace(
        /[\r\n]/g,
        "",
      );
      const sanitizedSubjectType = draftData.subjectDocument.type.replace(
        /[\r\n]/g,
        "",
      );
      console.log(
        `[GetDocType] Starting client-side text extraction for: \
        ${sanitizedSubjectName} (${sanitizedSubjectType})`,
      );
      const subjectDoc = await extractTextFromFile(
        draftData.subjectDocument,
        "subject",
      );
      console.log(
        `[GetDocType] Extracted ${subjectDoc.content.length} chars from subject document`,
      );
      console.log("[🔍 DIAGNOSTIC] Subject doc extracted successfully");

      // STEP 2: Extract text from context documents if present
      const contextDocs: ExtractedDocument[] = [];
      if (draftData.contextDocuments && draftData.contextDocuments.length > 0) {
        console.log(
          `[🔍 DIAGNOSTIC] Processing ${draftData.contextDocuments.length} context documents`,
        );
        for (const contextFile of draftData.contextDocuments.slice(0, 10)) {
          if (
            !(contextFile instanceof File) ||
            typeof contextFile.arrayBuffer !== "function"
          ) {
            toast({
              title: "Context Document Reference Invalid",
              description:
                "Please re-upload context documents. File references don't survive page refresh.",
              variant: "destructive",
            });
            setLoadingField(null);
            setIsAnalyzing(false);
            return;
          }
          const contextDoc = await extractTextFromFile(contextFile, "context");
          contextDocs.push(contextDoc);
        }
        console.log(
          `[GetDocType] Extracted text from ${contextDocs.length} context documents`,
        );
      } else {
        console.log("[🔍 DIAGNOSTIC] No context documents to process");
      }

      // STEP 3: Build payload with extracted text
      const payload = {
        subjectDocument: {
          name: subjectDoc.name,
          content: subjectDoc.content,
        },
        contextDocuments: contextDocs.map((doc) => ({
          name: doc.name,
          content: doc.content,
        })),
        contextSummary: draftData.contextSummary || "",
      };

      console.log("[🔍 DIAGNOSTIC] Payload constructed:", {
        subjectDocName: payload.subjectDocument.name,
        subjectDocLength: payload.subjectDocument.content.length,
        contextDocsCount: payload.contextDocuments.length,
        hasContextSummary: !!payload.contextSummary,
      });

      // STEP 3.5: Validate payload size BEFORE sending
      const allDocs = [subjectDoc, ...contextDocs];
      const payloadSize = calculatePayloadSize(allDocs);
      const maxPayloadSize = 4.5 * 1024 * 1024; // 4.5 MB limit

      console.log(
        `[GetDocType] Payload size: ${formatBytes(payloadSize)} / ${formatBytes(maxPayloadSize)}`,
      );

      if (payloadSize > maxPayloadSize) {
        console.log("[🔍 DIAGNOSTIC] Payload too large, aborting");
        setLoadingField(null);
        setIsAnalyzing(false);
        toast({
          title: "Content Too Large",
          description: `Extracted text size (${formatBytes(payloadSize)}) exceeds the ${formatBytes(maxPayloadSize)} limit. Please remove some documents or use shorter documents.`,
          variant: "destructive",
        });
        return;
      }

      // STEP 4: Send extracted text to API
      console.log("[GetDocType] Sending extracted text to API...");
      console.log("[🔍 DIAGNOSTIC] Fetch URL: /api/extract-document-metadata");
      console.log("[🔍 DIAGNOSTIC] Fetch method: POST");
      const response = await fetch("/api/extract-document-metadata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      const rawResponse = await response.text();
      console.log("[🔍 DIAGNOSTIC] Response status:", response.status);
      console.log("[🔍 DIAGNOSTIC] Response ok:", response.ok);

      if (!response.ok) {
        const errorMessage = await parseErrorResponse({
          ...response,
          text: async () => rawResponse,
          json: async () => JSON.parse(rawResponse),
        } as any);
        const sanitizedErrorMessage = errorMessage.replace(/[^\S\r\n]/g, " ");
        console.error(
          `[GetDocType] API error (${response.status}):`,
          sanitizedErrorMessage,
        );
        throw new Error(sanitizedErrorMessage || "Failed to extract document type");
      }

      let data: any;
      try {
        data = JSON.parse(rawResponse);
      } catch (jsonErr) {
        console.error('[GetDocType] Failed to parse JSON response:', jsonErr);
        throw new Error(rawResponse || 'Failed to parse server response');
      }
      const meta = data.metadata;
      const sanitizedDocumentType =
        meta.document_type?.replace(/[\n\r]/g, " ") || "";
      const sanitizedDocumentOrigin =
        meta.document_origin?.replace(/[\n\r]/g, " ") || "";

      const sanitizedMeta = {
        ...meta,
        document_type: sanitizedDocumentType,
        document_origin: sanitizedDocumentOrigin,
      };

      const sanitizedData = {
        ...data,
        metadata: sanitizedMeta,
      };

      console.log("[🔍 DIAGNOSTIC] ✅ API Response received successfully");
      console.log(
        "[🔍 DIAGNOSTIC] Full API response:",
        JSON.stringify(sanitizedData, null, 2),
      );
      console.log(
        "[🔍 DIAGNOSTIC] Metadata object:",
        JSON.stringify(sanitizedMeta, null, 2),
      );
      console.log(
        "[🔍 DIAGNOSTIC] meta.document_type value:",
        sanitizedDocumentType,
      );
      console.log(
        "[🔍 DIAGNOSTIC] meta.document_origin value:",
        sanitizedDocumentOrigin,
      );
      console.log(
        "[🔍 DIAGNOSTIC] meta.document_type type:",
        typeof meta.document_type,
      );
      console.log(
        "[🔍 DIAGNOSTIC] meta.document_type truthiness:",
        !!meta.document_type,
      );

      if (meta.document_type) {
        console.log(
          "[🔍 DIAGNOSTIC] ⚠️ ATTEMPTING STATE UPDATE with document_type:",
          sanitizedDocumentType,
        );
        console.log(
          "[🔍 DIAGNOSTIC] Current draftData.documentType BEFORE update:",
          draftData.documentType,
        );

        setDraftData((prev) => {
          console.log("[🔍 DIAGNOSTIC] 🔄 Inside setDraftData callback");
          console.log(
            "[🔍 DIAGNOSTIC] Previous state:",
            JSON.stringify(prev, null, 2),
          );

          const newState = {
            ...prev,
            documentType: meta.document_type,
            // Also update documentOrigin if returned by the API
            ...(meta.document_origin && {
              documentOrigin: meta.document_origin,
            }),
          };

          console.log(
            "[🔍 DIAGNOSTIC] New state to be set:",
            JSON.stringify(newState, null, 2),
          );
          console.log(
            "[🔍 DIAGNOSTIC] ✅ Returning new state from setDraftData",
          );
          if (meta.document_origin) {
            console.log(
              "[🔍 DIAGNOSTIC] Setting documentOrigin:",
              sanitizedDocumentOrigin,
            );
          }

          return newState;
        });

        console.log("[🔍 DIAGNOSTIC] ✅ setDraftData called successfully");

        // Force a small delay and log the updated state
        setTimeout(() => {
          console.log("[🔍 DIAGNOSTIC] 🕐 Post-update check (100ms delay)");
          console.log(
            "[🔍 DIAGNOSTIC] draftData.documentType AFTER update:",
            draftData.documentType,
          );
        }, 100);
      } else {
        console.log(
          "[🔍 DIAGNOSTIC] ❌ meta.document_type is falsy, NOT updating state",
        );
        toast({
          title: "No Document Type Found",
          description:
            "Could not determine the document type. The document may be a scanned image without text, or the content may not clearly indicate a document type. Please enter the document type manually.",
          variant: "destructive",
        });
      }

      console.log(
        "[GetDocType] Successfully extracted document type:",
        sanitizedDocumentType,
      );
    } catch (error: unknown) {
      console.error("[GetDocType] Error:", error);
        toast({
          title: "Extraction Failed",
          description:
            (error instanceof Error ? error.message : null) ||
            "Failed to extract document type. Please try again or select manually.",
          variant: "destructive",
        });
    } finally {
      setLoadingField(null);
      setIsAnalyzing(false); // Hide overlay
    }
  };

  const handleGetCaseType = async () => {
    if (!draftData.subjectDocument) {
      toast({
        title: "No Document",
        description: "Please upload a subject document first",
        variant: "destructive",
      });
      return;
    }

    if (
      !(draftData.subjectDocument instanceof File) ||
      typeof draftData.subjectDocument.arrayBuffer !== "function"
    ) {
      toast({
        title: "Document Reference Invalid",
        description:
          "Please re-upload the subject document. File references don't survive page refresh.",
        variant: "destructive",
      });
      return;
    }

    setLoadingField("caseType");
    setIsAnalyzing(true);
    try {
      const sanitizedSubjectName = draftData.subjectDocument.name.replace(
        /[\r\n]/g,
        "",
      );
      const sanitizedSubjectType = draftData.subjectDocument.type.replace(
        /[\r\n]/g,
        "",
      );
      console.log(
        `[GetCaseType] Starting client-side text extraction for: ${sanitizedSubjectName} (${sanitizedSubjectType})`,
      );
      const subjectDoc = await extractTextFromFile(
        draftData.subjectDocument,
        "subject",
      );
      console.log(
        `[GetCaseType] Successfully extracted ${subjectDoc.content.length} chars from subject document`,
      );

      // STEP 2: Extract text from context documents if present
      const contextDocs: ExtractedDocument[] = [];
      if (draftData.contextDocuments && draftData.contextDocuments.length > 0) {
        for (const contextFile of draftData.contextDocuments.slice(0, 10)) {
          if (
            !(contextFile instanceof File) ||
            typeof contextFile.arrayBuffer !== "function"
          ) {
            toast({
              title: "Context Document Reference Invalid",
              description:
                "Please re-upload context documents. File references don't survive page refresh.",
              variant: "destructive",
            });
            setLoadingField(null);
            setIsAnalyzing(false);
            return;
          }
          const contextDoc = await extractTextFromFile(contextFile, "context");
          contextDocs.push(contextDoc);
        }
        console.log(
          `[GetCaseType] Extracted text from ${contextDocs.length} context documents`,
        );
      }

      // STEP 3: Build payload with extracted text
      const payload = {
        subjectDocument: {
          name: subjectDoc.name,
          content: subjectDoc.content,
        },
        contextDocuments: contextDocs.map((doc) => ({
          name: doc.name,
          content: doc.content,
        })),
        contextSummary: draftData.contextSummary || "",
      };

      // STEP 3.5: Validate payload size BEFORE sending
      const allDocs = [subjectDoc, ...contextDocs];
      const payloadSize = calculatePayloadSize(allDocs);
      const maxPayloadSize = 4.5 * 1024 * 1024; // 4.5 MB limit

      console.log(
        `[GetCaseType] Payload size: ${formatBytes(payloadSize)} / ${formatBytes(maxPayloadSize)}`,
      );
      if (payloadSize > maxPayloadSize) {
        setLoadingField(null);
        setIsAnalyzing(false);
        toast({
          title: "Content Too Large",
          description: `Extracted text size (${formatBytes(payloadSize)}) exceeds the ${formatBytes(maxPayloadSize)} limit. Please remove some documents or use shorter documents.`,
          variant: "destructive",
        });
        return;
      }

      // STEP 4: Send extracted text to API
      console.log("[GetCaseType] Sending extracted text to API...");
      const response = await fetch("/api/extract-document-metadata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response);
        const sanitizedErrorMessage = String(errorMessage)
          .replace(/[^-]/g, "")
          .replace(/[\n\r]/g, "");
        console.error(
          `[GetCaseType] API error (${response.status}):`,
          sanitizedErrorMessage,
        );
        throw new Error(errorMessage || "Failed to extract case type");
      }

      const data = await response.json();
      const rawResponseData = JSON.stringify(data, null, 2);
      const sanitizedResponseData = rawResponseData.replace(/[\n\r]/g, "");
      console.log(
        "[🔍 DIAGNOSTIC] ✅ API Response for case type:",
        sanitizedResponseData,
      );

      const meta = data.metadata;
      const sanitizedCaseType = String(meta.case_type).replace(/[\n\r]/g, "");
      const sanitizedDocumentOrigin = meta.document_origin
        ? String(meta.document_origin).replace(/[\n\r]/g, "")
        : undefined;
      console.log("[🔍 DIAGNOSTIC] meta.case_type value:", sanitizedCaseType);

      if (meta.case_type) {
        console.log(
          "[🔍 DIAGNOSTIC] ⚠️ ATTEMPTING STATE UPDATE with case_type:",
          sanitizedCaseType,
        );

        setDraftData((prev) => {
          console.log("[🔍 DIAGNOSTIC] Inside setDraftData for caseType");
          const newState = {
            ...prev,
            caseType: meta.case_type,
            // Also update documentOrigin if returned by the API
            ...(meta.document_origin && {
              documentOrigin: meta.document_origin,
            }),
          };
          console.log("[🔍 DIAGNOSTIC] New caseType state:", sanitizedCaseType);
          if (meta.document_origin) {
            console.log(
              "[🔍 DIAGNOSTIC] Setting documentOrigin:",
              sanitizedDocumentOrigin,
            );
          }
          return newState;
        });
      } else {
        console.log(
          "[🔍 DIAGNOSTIC] ❌ meta.case_type is falsy, NOT updating state",
        );
        toast({
          title: "No Case Type Found",
          description:
            "Could not determine the case type. The document may be a scanned image without text, or the content may not clearly indicate a case type. Please enter the case type manually.",
          variant: "destructive",
        });
      }

      console.log(
        "[GetCaseType] Successfully extracted case type:",
        sanitizedCaseType,
      );
    } catch (error: unknown) {
      console.error("[GetCaseType] Error:", error);
        toast({
          title: "Extraction Failed",
          description:
            (error instanceof Error ? error.message : null) ||
            "Failed to extract case type. Please try again or select manually.",
          variant: "destructive",
        });
    } finally {
      setLoadingField(null);
      setIsAnalyzing(false); // Hide overlay
    }
  };

  const handleGetJurisdiction = async () => {
    if (!draftData.subjectDocument) {
      toast({
        title: "No Document",
        description: "Please upload a subject document first",
        variant: "destructive",
      });
      return;
    }

    if (
      !(draftData.subjectDocument instanceof File) ||
      typeof draftData.subjectDocument.arrayBuffer !== "function"
    ) {
      toast({
        title: "Document Reference Invalid",
        description:
          "Please re-upload the subject document. File references don't survive page refresh.",
        variant: "destructive",
      });
      return;
    }

    setLoadingField("jurisdiction");
    setIsAnalyzing(true);
    try {
      console.log(
        `[GetJurisdiction] Starting client-side text extraction for: ${draftData.subjectDocument.name.replace(/[^\S\n\r]/g, "")} (${draftData.subjectDocument.type.replace(/[^\S\n\r]/g, "")})`,
      );
      const subjectDoc = await extractTextFromFile(
        draftData.subjectDocument,
        "subject",
      );
      console.log(
        `[GetJurisdiction] Successfully extracted ${subjectDoc.content.length} chars from subject document`,
      );

      // STEP 2: Extract text from context documents if present
      const contextDocs: ExtractedDocument[] = [];
      if (draftData.contextDocuments && draftData.contextDocuments.length > 0) {
        for (const contextFile of draftData.contextDocuments.slice(0, 10)) {
          if (
            !(contextFile instanceof File) ||
            typeof contextFile.arrayBuffer !== "function"
          ) {
            toast({
              title: "Context Document Reference Invalid",
              description:
                "Please re-upload context documents. File references don't survive page refresh.",
              variant: "destructive",
            });
            setLoadingField(null);
            setIsAnalyzing(false);
            return;
          }
          const contextDoc = await extractTextFromFile(contextFile, "context");
          contextDocs.push(contextDoc);
        }
        console.log(
          `[GetJurisdiction] Extracted text from ${contextDocs.length} context documents`,
        );
      }

      // STEP 3: Build payload with extracted text
      const payload = {
        subjectDocument: {
          name: subjectDoc.name,
          content: subjectDoc.content,
        },
        contextDocuments: contextDocs.map((doc) => ({
          name: doc.name,
          content: doc.content,
        })),
        contextSummary: draftData.contextSummary || "",
      };

      // STEP 3.5: Validate payload size BEFORE sending
      const allDocs = [subjectDoc, ...contextDocs];
      const payloadSize = calculatePayloadSize(allDocs);
      const maxPayloadSize = 4.5 * 1024 * 1024; // 4.5 MB limit

      console.log(
        `[GetJurisdiction] Payload size: ${formatBytes(payloadSize)} / ${formatBytes(maxPayloadSize)}`,
      );
      if (payloadSize > maxPayloadSize) {
        setLoadingField(null);
        setIsAnalyzing(false);
        toast({
          title: "Content Too Large",
          description: `Extracted text size (${formatBytes(payloadSize)}) exceeds the ${formatBytes(maxPayloadSize)} limit. Please remove some documents or use shorter documents.`,
          variant: "destructive",
        });
        return;
      }

      // STEP 4: Send extracted text to API
      console.log("[GetJurisdiction] Sending extracted text to API...");
      const response = await fetch("/api/extract-document-metadata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response);
        console.error(
          `[GetJurisdiction] API error (${response.status}):`,
          String(errorMessage).replace(/[\n\r]/g, ""),
        );
        throw new Error(errorMessage || "Failed to extract jurisdiction");
      }

      const data = await response.json();
      console.log(
        "[🔍 DIAGNOSTIC] ✅ API Response for jurisdiction:",
        JSON.stringify(data, null, 2).replace(/[\n\r]/g, ""),
      );

      const meta = data.metadata;
      console.log(
        "[🔍 DIAGNOSTIC] meta.jurisdiction value:",
        String(meta.jurisdiction).replace(/[\n\r]/g, ""),
      );

      if (meta.jurisdiction) {
        console.log(
          "[🔍 DIAGNOSTIC] ⚠️ ATTEMPTING STATE UPDATE with jurisdiction:",
          String(meta.jurisdiction).replace(/[\n\r]/g, ""),
        );

        setDraftData((prev) => {
          console.log("[🔍 DIAGNOSTIC] Inside setDraftData for jurisdiction");
          const newState = {
            ...prev,
            jurisdiction: meta.jurisdiction,
            // Also update documentOrigin if returned by the API
            ...(meta.document_origin && {
              documentOrigin: meta.document_origin,
            }),
          };
          console.log(
            "[🔍 DIAGNOSTIC] New jurisdiction state:",
            String(newState.jurisdiction).replace(/[\n\r]/g, ""),
          );
          if (meta.document_origin) {
            console.log(
              "[🔍 DIAGNOSTIC] Setting documentOrigin:",
              String(meta.document_origin).replace(/[\n\r]/g, ""),
            );
          }
          return newState;
        });
      } else {
        console.log(
          "[🔍 DIAGNOSTIC] ❌ meta.jurisdiction is falsy, NOT updating state",
        );
        toast({
          title: "No Jurisdiction Found",
          description:
            "Could not determine the jurisdiction. The document may be a scanned image without text, or the content may not clearly indicate a jurisdiction. Please enter the jurisdiction manually.",
          variant: "destructive",
        });
      }

      console.log(
        "[GetJurisdiction] Successfully extracted jurisdiction:",
        String(meta.jurisdiction).replace(/[^\S\n\r]/g, ""),
      );
    } catch (error: unknown) {
      console.error("[GetJurisdiction] Error:", error);
      const message = error instanceof Error ? error.message : String(error);
        toast({
          title: "Extraction Failed",
          description:
            message ||
            "Failed to extract jurisdiction. Please try again or enter manually.",
          variant: "destructive",
        });
    } finally {
      setLoadingField(null);
      setIsAnalyzing(false); // Hide overlay
    }
  };

  const handleContextDocumentsUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(e.target.files || []);
    // Use functional update to avoid stale state and append to existing documents
    setDraftData((prev) => {
      const existingDocs = prev.contextDocuments || [];
      const combined = [...existingDocs, ...files];
      const maxFiles = 10;
      if (combined.length > maxFiles) {
        const added = maxFiles - existingDocs.length;
        if (added > 0) {
          toast({
            title: "File Limit Reached",
            description: `Added ${added} file(s). Maximum of ${maxFiles} context documents allowed.`,
            variant: "default",
          });
        } else {
          toast({
            title: "File Limit Reached",
            description: `Maximum of ${maxFiles} context documents already uploaded.`,
            variant: "destructive",
          });
        }
        return { ...prev, contextDocuments: combined.slice(0, maxFiles) };
      }
      return { ...prev, contextDocuments: combined };
    });
  };

  // Drag-and-drop handlers for subject document
  const onDropSubject = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setDraftData((prev) => ({
        ...prev,
        subjectDocument: file,
        hasSubjectDocument: true,
      }));
      toast({
        title: "Document Uploaded",
        description: `${file.name} uploaded successfully`,
      });
    }
  };

  const {
    getRootProps: getSubjectRootProps,
    getInputProps: getSubjectInputProps,
    isDragActive: isSubjectDragActive,
  } = useDropzone({
    onDrop: onDropSubject,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
      "text/plain": [".txt"],
    },
    multiple: false,
    disabled: isSubmitting,
  });

  const onDropContext = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setDraftData((prev) => {
        const existingDocs = prev.contextDocuments || [];
        const combined = [...existingDocs, ...acceptedFiles];
        const maxFiles = 10;

        if (combined.length > maxFiles) {
          const added = Math.min(
            acceptedFiles.length,
            maxFiles - existingDocs.length,
          );
          if (added > 0) {
            toast({
              title: "File Limit Reached",
              description: `Added ${added} file(s). Maximum of ${maxFiles} context documents allowed.`,
            });
          } else {
            toast({
              title: "File Limit Reached",
              description: `Maximum of ${maxFiles} context documents already uploaded.`,
              variant: "destructive",
            });
          }
          return { ...prev, contextDocuments: combined.slice(0, maxFiles) };
        }

        toast({
          title: "Documents Uploaded",
          description: `${acceptedFiles.length} document(s) uploaded successfully`,
        });
        return { ...prev, contextDocuments: combined };
      });
    }
  };

  const {
    getRootProps: getContextRootProps,
    getInputProps: getContextInputProps,
    isDragActive: isContextDragActive,
  } = useDropzone({
    onDrop: onDropContext,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
      "text/plain": [".txt"],
    },
    multiple: true,
    maxFiles: 10,
    disabled: isSubmitting,
  });

  // Handle text input changes
  const updateField = <K extends keyof SessionData>(
    field: K,
    value: SessionData[K],
  ): void => {
    console.log("[🔍 DIAGNOSTIC] updateField called");
    console.log("[🔍 DIAGNOSTIC] Field to update:", field);
    console.log("[🔍 DIAGNOSTIC] New value:", value);
    console.log(
      "[🔍 DIAGNOSTIC] Current draftData:",
      JSON.stringify(draftData, null, 2),
    );

    // ⚠️ CRITICAL FIX: Use functional update to avoid stale state
    setDraftData((prev) => {
      console.log("[🔍 DIAGNOSTIC] Inside updateField setDraftData callback");
      console.log(
        "[🔍 DIAGNOSTIC] Previous state:",
        JSON.stringify(prev, null, 2),
      );

      const newState = { ...prev, [field]: value };

      console.log(
        "[🔍 DIAGNOSTIC] New state:",
        JSON.stringify(newState, null, 2),
      );
      console.log(
        "[🔍 DIAGNOSTIC] Updated field value in new state:",
        newState[field],
      );

      return newState;
    });

    console.log("[🔍 DIAGNOSTIC] updateField setDraftData called");
  };

  // Handle array inputs (clients, parties)
  const handleArrayInput = (
    field: "ourClients" | "opposingParties",
    value: string,
  ) => {
    const items = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    updateField(field, items);
  };

  // Submit and trigger analysis with client-side text extraction
  const handleSubmit = async () => {
    console.log(
      "[DataPanel][handleSubmit] ENTRY - Starting submission process",
    );

    if (!draftData.subjectDocument) {
      console.log(
        "[DataPanel][handleSubmit] VALIDATION FAILED - No subject document",
      );
      toast({
        title: "No Document",
        description: "Please upload a subject document",
        variant: "destructive",
      });
      return;
    }

    console.log("[DataPanel][handleSubmit] Validation passed, setting states");
    setIsSubmitting(true);
    setIsAnalyzing(true);
    setStatus("processing");

    try {
      const documents: ExtractedDocument[] = [];

      console.log(
        "[DataPanel][handleSubmit] EXTRACTION START - Subject document",
      );
      console.log("[DataPanel][handleSubmit] Subject file:", {
        name: draftData.subjectDocument.name,
        size: draftData.subjectDocument.size,
        type: draftData.subjectDocument.type,
      });

      const subjectDoc = await extractTextFromFile(
        draftData.subjectDocument,
        "subject",
      );
      documents.push(subjectDoc);

      console.log(
        "[DataPanel][handleSubmit] EXTRACTION COMPLETE - Subject document",
        {
          textLength: subjectDoc.content.length,
          textPreview: subjectDoc.content.substring(0, 200),
          fileName: subjectDoc.name,
          fileType: subjectDoc.mimeType,
        },
      );

      if (draftData.contextDocuments && draftData.contextDocuments.length > 0) {
        console.log(
          `[DataPanel][handleSubmit] EXTRACTION START - ${draftData.contextDocuments.length} context documents`,
        );

        for (const contextFile of draftData.contextDocuments) {
          console.log("[DataPanel][handleSubmit] Extracting context file:", {
            name: contextFile.name,
            size: contextFile.size,
            type: contextFile.type,
          });

          const contextDoc = await extractTextFromFile(contextFile, "context");
          documents.push(contextDoc);

          console.log(
            "[DataPanel][handleSubmit] Context extraction complete:",
            {
              textLength: contextDoc.content.length,
              fileName: contextDoc.name,
            },
          );
        }
      }

      const payloadSize = calculatePayloadSize(documents);
      const maxPayloadSize = 4.5 * 1024 * 1024;

      console.log("[DataPanel][handleSubmit] PAYLOAD SIZE CHECK:", {
        payloadSize,
        maxPayloadSize,
        payloadSizeMB: (payloadSize / (1024 * 1024)).toFixed(2),
        maxPayloadSizeMB: (maxPayloadSize / (1024 * 1024)).toFixed(2),
        withinLimit: payloadSize <= maxPayloadSize,
      });

      if (payloadSize > maxPayloadSize) {
        console.log("[DataPanel][handleSubmit] PAYLOAD TOO LARGE - Aborting");
        toast({
          title: "Payload Too Large",
          description: `Extracted text size (${formatBytes(payloadSize)}) exceeds the ${formatBytes(maxPayloadSize)} limit. Please remove some documents or use shorter documents.`,
          variant: "destructive",
        });
        setStatus("draft");
        setIsSubmitting(false);
        setIsAnalyzing(false);
        return;
      }

      const payload = {
        documentType: draftData.documentType || "",
        caseType: draftData.caseType || "",
        jurisdiction: draftData.jurisdiction || "",
        ourClients: draftData.ourClients || [],
        opposingParties: draftData.opposingParties || [],
        contextSummary: draftData.contextSummary || "",
        aiMode: draftData.aiMode || "tools_and_steps",
        executionMode: draftData.executionMode || "step-based",
        documentOrigin: draftData.documentOrigin || "unknown",
        documents,
      };

      console.log(
        "[DataPanel][handleSubmit] API CALL START - /api/document-analysis",
      );
      console.log("[DataPanel][handleSubmit] Payload summary:", {
        documentType: payload.documentType,
        caseType: payload.caseType,
        jurisdiction: payload.jurisdiction,
        ourClientsCount: payload.ourClients.length,
        opposingPartiesCount: payload.opposingParties.length,
        documentsCount: payload.documents.length,
        aiMode: payload.aiMode,
        executionMode: payload.executionMode,
      });

      const response = await fetch("/api/document-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      console.log("[DataPanel][handleSubmit] API RESPONSE:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: {
          contentType: response.headers.get("Content-Type"),
          sessionId: response.headers.get("X-Session-Id"),
        },
      });

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response);
        console.error("[DataPanel][handleSubmit] API ERROR:", {
          status: response.status,
          errorMessage,
        });
        throw new Error(errorMessage || "Failed to start analysis");
      }

      const returnedSessionId = response.headers.get("X-Session-Id");
      console.log("[DataPanel][handleSubmit] SESSION ID RECEIVED:", {
        raw: returnedSessionId,
        length: returnedSessionId?.length || 0,
        lastCharCode: returnedSessionId
          ? returnedSessionId.charCodeAt(returnedSessionId.length - 1)
          : "N/A",
      });

      if (returnedSessionId) {
        const sanitizedSessionId = returnedSessionId
          .replace(/[\n\r]/g, "")
          .trim();
        const encodedSessionId = encodeURIComponent(sanitizedSessionId);

        console.log("[DataPanel][handleSubmit] SESSION ID PROCESSED:", {
          sanitized: sanitizedSessionId,
          encoded: encodedSessionId,
        });

        const navigationUrl = `/analysis/${encodedSessionId}`;
        console.log("[DataPanel][handleSubmit] NAVIGATION START:", {
          url: navigationUrl,
          sessionId: encodedSessionId,
        });

        localStorage.removeItem(storageKey);
        console.log("[DataPanel][handleSubmit] Local storage cleared");

        setStatus("complete");
        console.log("[DataPanel][handleSubmit] Status set to complete");

        console.log("[DataPanel][handleSubmit] Calling router.push()");
        router.push(navigationUrl);
        console.log("[DataPanel][handleSubmit] SUCCESS - Navigation initiated");
      } else {
        console.log("[DataPanel][handleSubmit] ERROR - No sessionId returned");
        throw new Error("No sessionId returned from analysis");
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to start analysis. Please try again.";
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error("[DataPanel][handleSubmit] CAUGHT ERROR:", {
        message: errorMessage,
        stack: errorStack,
        error,
      });

      setStatus("draft");
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      console.log("[DataPanel][handleSubmit] FINALLY - Cleaning up");
      setIsSubmitting(false);
      setIsAnalyzing(false);
      console.log("[DataPanel][handleSubmit] EXIT");
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Indicator */}
      <Alert className="bg-gray-700/50 border-gray-600">
        <FileCheck2 className="h-4 w-4 text-blue-400" />
        <AlertDescription className="text-gray-200">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              Status: {status === "draft" && "📝 Draft"}
              {status === "processing" && "⏳ Processing"}
              {status === "complete" && "✅ Complete"}
            </span>
            {loadingField !== null && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                AI extracting metadata...
              </span>
            )}
            {extractionConfidence && loadingField === null && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-yellow-500" />
                AI confidence: {extractionConfidence}
              </span>
            )}
          </div>
        </AlertDescription>
      </Alert>

      {/* Subject Document Upload */}
      <div className="space-y-2">
        <Label
          htmlFor="subject-document"
          className="flex items-center gap-2 text-gray-200"
        >
          <FileText className="h-4 w-4" />
          Subject Document *
        </Label>
        <div
          {...getSubjectRootProps()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            isSubjectDragActive
              ? "border-blue-500 bg-blue-500/10"
              : "border-gray-600 bg-gray-900 hover:border-gray-500"
          } ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <input {...getSubjectInputProps()} />
          <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
          {isSubjectDragActive ? (
            <p className="text-sm text-blue-400">Drop the file here...</p>
          ) : (
            <div className="text-sm text-gray-400">
              <p>Drag and drop a PDF, DOCX, or TXT file here</p>
              <p className="text-xs mt-1">or click to browse</p>
            </div>
          )}
        </div>
        {draftData.subjectDocument && (
          <div className="flex items-center gap-2 mt-2">
            <Badge
              variant="secondary"
              className="bg-gray-700 text-gray-200 max-w-full flex items-center gap-2"
              title={draftData.subjectDocument.name}
            >
              <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                {truncateFileName(draftData.subjectDocument.name)}
              </span>
              <button
                type="button"
                onClick={handleRemoveSubjectDocument}
                className="ml-1 hover:bg-gray-600 rounded-full p-0.5"
                aria-label="Remove subject document"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
            <span className="text-xs text-gray-400">
              {formatFileSize(draftData.subjectDocument.size)}
            </span>
          </div>
        )}
      </div>

      {/* Context Documents Upload */}
      <div className="space-y-2">
        <Label
          htmlFor="context-documents"
          className="flex items-center gap-2 text-gray-200"
        >
          <Upload className="h-4 w-4" />
          Context Documents (up to 10)
        </Label>
        <div
          {...getContextRootProps()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            isContextDragActive
              ? "border-blue-500 bg-blue-500/10"
              : "border-gray-600 bg-gray-900 hover:border-gray-500"
          } ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <input {...getContextInputProps()} />
          <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
          {isContextDragActive ? (
            <p className="text-sm text-blue-400">Drop the files here...</p>
          ) : (
            <div className="text-sm text-gray-400">
              <p>Drag and drop PDF, DOCX, or TXT files here</p>
              <p className="text-xs mt-1">
                or click to browse (up to 10 files)
              </p>
            </div>
          )}
        </div>
        {draftData.contextDocuments &&
          draftData.contextDocuments.length > 0 && (
            <div className="space-y-2 mt-2">
              <div className="flex flex-wrap gap-2">
                {draftData.contextDocuments.map((doc, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <Badge
                      variant="outline"
                      className="text-xs bg-gray-700 border-gray-600 text-gray-200 max-w-full flex items-center gap-2"
                      title={doc.name}
                    >
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                        {truncateFileName(doc.name)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveContextDocument(idx)}
                        className="ml-1 hover:bg-gray-600 rounded-full p-0.5"
                        aria-label={`Remove ${doc.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                    <span className="text-xs text-gray-400">
                      {formatFileSize(doc.size)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-400">
                Total size: {formatFileSize(calculateTotalSize())}
              </div>
            </div>
          )}
      </div>

      {/* Document Type */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap">
          <Label
            htmlFor="document-type"
            className="text-gray-200 flex-1 min-w-0"
          >
            Document Type
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGetDocumentType}
            disabled={loadingField !== null || isSubmitting}
            className="bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700 shrink-0"
          >
            {loadingField === "documentType" ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <FileText className="mr-2 h-3 w-3" />
                Get Document Type
              </>
            )}
          </Button>
        </div>
        <Input
          id="document-type"
          placeholder="e.g., Motion to Dismiss, Complaint, Brief"
          value={draftData.documentType || ""}
          onChange={(e) => updateField("documentType", e.target.value)}
          disabled={isSubmitting}
          className="bg-gray-900 border-gray-600 text-gray-200 placeholder:text-gray-500"
        />
      </div>

      {/* Case Type */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap">
          <Label htmlFor="case-type" className="text-gray-200 flex-1 min-w-0">
            Case Type
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGetCaseType}
            disabled={loadingField !== null || isSubmitting}
            className="bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700 shrink-0"
          >
            {loadingField === "caseType" ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <FileText className="mr-2 h-3 w-3" />
                Get Case Type
              </>
            )}
          </Button>
        </div>
        <Input
          id="case-type"
          placeholder="e.g., Employment Discrimination, Civil Rights, Contract Dispute"
          value={draftData.caseType || ""}
          onChange={(e) => updateField("caseType", e.target.value)}
          disabled={isSubmitting}
          className="bg-gray-900 border-gray-600 text-gray-200 placeholder:text-gray-500"
        />
      </div>

      {/* Jurisdiction */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap">
          <Label
            htmlFor="jurisdiction"
            className="text-gray-200 flex-1 min-w-0"
          >
            Jurisdiction
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGetJurisdiction}
            disabled={loadingField !== null || isSubmitting}
            className="bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700 shrink-0"
          >
            {loadingField === "jurisdiction" ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <MapPin className="mr-2 h-3 w-3" />
                Get Jurisdiction
              </>
            )}
          </Button>
        </div>
        <Input
          id="jurisdiction"
          placeholder="e.g., Kansas, Federal - 10th Circuit"
          value={draftData.jurisdiction || ""}
          onChange={(e) => updateField("jurisdiction", e.target.value)}
          disabled={isSubmitting}
          className="bg-gray-900 border-gray-600 text-gray-200 placeholder:text-gray-500"
        />
      </div>

      {/* Document Origin Toggle */}
      <div className="space-y-2">
        <Label className="text-gray-200">Document Origin</Label>
        <div
          className={`p-3 rounded-lg border transition-colors ${
            draftData.documentOrigin === "opposing"
              ? "bg-orange-900/30 border-orange-600"
              : "bg-gray-700/50 border-gray-600"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {draftData.documentOrigin === "opposing" ? (
                <Swords className="h-4 w-4 text-orange-400 shrink-0" />
              ) : (
                <Shield className="h-4 w-4 text-blue-400 shrink-0" />
              )}
              <div className="min-w-0">
                <span className="text-sm font-medium block truncate">
                  {draftData.documentOrigin === "opposing"
                    ? "Opposing Party Document"
                    : "Our Firm's Document"}
                </span>
                <span className="text-xs text-gray-400 block">
                  {draftData.documentOrigin === "opposing"
                    ? "Offense mode: analyzing for weaknesses"
                    : "Defense mode: quality assurance review"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-gray-400">
                {draftData.documentOrigin === "opposing"
                  ? "Opposing"
                  : "Our Firm"}
              </span>
              <Switch
                checked={draftData.documentOrigin === "opposing"}
                onCheckedChange={(checked) =>
                  updateField(
                    "documentOrigin",
                    checked ? "opposing" : "our_firm",
                  )
                }
                disabled={isSubmitting}
                className="data-[state=checked]:bg-orange-600"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Our Clients */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap">
          <Label
            htmlFor="our-clients"
            className="flex items-center gap-2 text-gray-200 flex-1 min-w-0"
          >
            <Users className="h-4 w-4" />
            Our Clients
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGetParties}
            disabled={loadingField !== null || isSubmitting}
            className="bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700 shrink-0"
          >
            {loadingField === "parties" ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Users className="mr-2 h-3 w-3" />
                Get Parties
              </>
            )}
          </Button>
        </div>
        <Input
          id="our-clients"
          placeholder="Comma-separated: John Doe, Jane Smith"
          value={draftData.ourClients?.join(", ") || ""}
          onChange={(e) => handleArrayInput("ourClients", e.target.value)}
          disabled={isSubmitting}
          className="bg-gray-900 border-gray-600 text-gray-200 placeholder:text-gray-500"
        />
        {draftData.ourClients && draftData.ourClients.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {draftData.ourClients.map((client, idx) => (
              <Badge
                key={idx}
                variant="default"
                className="bg-blue-600 text-white"
              >
                {client}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Opposing Parties */}
      <div className="space-y-2">
        <Label htmlFor="opposing-parties" className="text-gray-200">
          Opposing Parties
        </Label>
        <Input
          id="opposing-parties"
          placeholder="Comma-separated: Acme Corp, Bob Johnson"
          value={draftData.opposingParties?.join(", ") || ""}
          onChange={(e) => handleArrayInput("opposingParties", e.target.value)}
          disabled={isSubmitting}
          className="bg-gray-900 border-gray-600 text-gray-200 placeholder:text-gray-500"
        />
        {draftData.opposingParties && draftData.opposingParties.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {draftData.opposingParties.map((party, idx) => (
              <Badge
                key={idx}
                variant="destructive"
                className="bg-red-700 text-white"
              >
                {party}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Context Summary */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap">
          <Label
            htmlFor="context-summary"
            className="text-gray-200 flex-1 min-w-0 truncate"
          >
            Context Summary
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGenerateSummary}
            disabled={loadingField !== null || isSubmitting}
            className="bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700 shrink-0"
          >
            {loadingField === "summary" ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-3 w-3" />
                Get Summary
              </>
            )}
          </Button>
        </div>
        <Textarea
          id="context-summary"
          placeholder="Provide context about the case or click 'Get Summary' to auto-fill..."
          rows={4}
          value={draftData.contextSummary || ""}
          onChange={(e) => updateField("contextSummary", e.target.value)}
          disabled={isSubmitting}
          className="bg-gray-900 border-gray-600 text-gray-200 placeholder:text-gray-500 resize-y whitespace-pre-wrap break-words min-w-0"
        />
      </div>

      {/* AI Mode Selector */}
      <div className="space-y-2">
        <Label htmlFor="ai-mode" className="text-gray-200">
          AI Mode
        </Label>
        <Select
          value={draftData.aiMode || "tools_and_steps"}
          onValueChange={(value) =>
            updateField("aiMode", value as SessionData["aiMode"])
          }
          disabled={isSubmitting}
        >
          <SelectTrigger
            id="ai-mode"
            className="bg-gray-900 border-gray-600 text-gray-200"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-900 border-gray-700">
            <SelectItem
              value="none"
              className="text-gray-200 focus:bg-gray-800 focus:text-white"
            >
              None (Manual)
            </SelectItem>
            <SelectItem
              value="tools"
              className="text-gray-200 focus:bg-gray-800 focus:text-white"
            >
              AI + Tools
            </SelectItem>
            <SelectItem
              value="tools_and_steps"
              className="text-gray-200 focus:bg-gray-800 focus:text-white"
            >
              AI + Tools + Steps
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Execution Mode Selector */}
      <div className="space-y-2">
        <Label className="text-gray-200">Execution Mode</Label>
        <div className="flex flex-col space-y-2">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="radio"
              name="executionMode"
              value="step-based"
              checked={draftData.executionMode === "step-based"}
              onChange={(e) =>
                updateField(
                  "executionMode",
                  e.target.value as SessionData["executionMode"],
                )
              }
              disabled={isSubmitting}
              className="w-4 h-4 text-blue-600 bg-gray-900 border-gray-600 focus:ring-blue-500"
            />
            <span className="text-gray-200 text-sm">
              Step-based (default) — Stable, current behavior
            </span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="radio"
              name="executionMode"
              value="phase-based"
              checked={draftData.executionMode === "phase-based"}
              onChange={(e) =>
                updateField(
                  "executionMode",
                  e.target.value as SessionData["executionMode"],
                )
              }
              disabled={isSubmitting}
              className="w-4 h-4 text-blue-600 bg-gray-900 border-gray-600 focus:ring-blue-500"
            />
            <span className="text-gray-200 text-sm">
              Phase-based (experimental) — Structured phases with Claude
              autonomy
            </span>
          </label>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Phase-based groups the workflow into 8 logical phases where Claude has
          full autonomy within each phase.{" "}
          <a
            href="https://github.com/JurisTechLLC/DocumentReviewer/blob/main/problem_solving.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            Learn more
          </a>
        </p>
      </div>

      {/* Visual Requirement Indicator - Evidence-based UX improvement */}
      {!draftData.subjectDocument && (
        <Alert className="bg-yellow-900/20 border-yellow-700">
          <FileText className="h-4 w-4 text-yellow-400" />
          <AlertDescription className="text-yellow-200">
            <strong>Required:</strong> Upload a subject document to start
            analysis
          </AlertDescription>
        </Alert>
      )}

      {/* Submit Button with Tooltip - Evidence-based accessibility improvement */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                size="lg"
                onClick={handleSubmit}
                disabled={
                  isSubmitting ||
                  loadingField !== null ||
                  !draftData.subjectDocument
                }
                aria-disabled={!draftData.subjectDocument}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Session...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Start Analysis
                  </>
                )}
              </Button>
            </div>
          </TooltipTrigger>
          {!draftData.subjectDocument && (
            <TooltipContent>
              <p>Upload a subject document to start analysis</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      {extractionConfidence && (
        <p className="text-xs text-center text-gray-400">
          AI has pre-filled fields. Review and edit before starting.
        </p>
      )}

      {isAnalyzing && (
        <TextExtractingOverlay
          status="Text Extracting…"
          substatus={substatus}
        />
      )}
    </div>
  );
}
