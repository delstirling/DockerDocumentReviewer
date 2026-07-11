import { NextRequest, NextResponse } from "next/server";
import { streamText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getAnalysisProviderConfig } from "@/lib/llm/model-provider";
import {
  DEFAULT_WORKFLOW,
  getEnabledSteps,
  validateWorkflow,
  type WorkflowConfig,
} from "@/lib/workflow-config";
import { getToolsByIds } from "@/lib/ai-tools";
import { VerificationEnforcer } from "@/lib/verification-enforcer";
import {
  StreamingExampleDetector,
  detectExampleFallback,
  detectAllPieces,
  generateFallbackErrorMessage,
} from "@/lib/fallback-examples";
import {
  validateExtractedText,
  generateValidationErrorMessage,
  type ValidationResult,
} from "@/lib/text-extraction-validator";
import {
  persistProposition,
  upsertCitation,
  assignFootnoteNumber,
  persistContextualAnalysis,
  persistContextualQuotes,
  generateQuoteHash,
  resolveCaseLawUrl,
} from "@/lib/citation-persistence";
import mammoth from "mammoth";
import { extractTextWithClaude } from "@/lib/claude-extract";
import { sanitizeExtractedText } from "@/lib/text-sanitizer";
import { auth } from "@/auth";
import { db } from "@/db/client";
import {
  analysisSessions,
  documents as documentsTable,
  workflowConfigs,
  users,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createLLMClient } from "@/lib/llm";
import {
  ENHANCED_CITATION_ENFORCEMENT_PROMPT,
  CASE_LAW_EXTRACTION_WORKFLOW_PROMPT,
} from "@/lib/citation-enforcement-enhanced";
import { logToolCall } from "@/lib/tool-call-logger";

export const maxDuration = 800;
export const runtime = "nodejs";

const AI_GIBBERISH_ISSUE = "ai_detected_gibberish" as const;

type AiMode = "none" | "tools" | "tools_and_steps";
type ExecutionMode = "step-based" | "phase-based";

function isAiMode(x: unknown): x is AiMode {
  return x === "none" || x === "tools" || x === "tools_and_steps";
}

function isExecutionMode(x: unknown): x is ExecutionMode {
  return x === "step-based" || x === "phase-based";
}

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function getDbErrorInfo(e: unknown): { code?: string; detail?: string } {
  if (typeof e === "object" && e) {
    const o = e as Record<string, unknown>;
    return {
      code: typeof o.code === "string" ? o.code : undefined,
      detail: typeof o.detail === "string" ? o.detail : undefined,
    };
  }
  return {};
}

/**
 * Handle validation result for extracted text.
 * Returns NextResponse with error if validation fails (except for AI gibberish detection).
 * Returns null if validation passes or if only AI gibberish was detected (non-blocking).
 */
function handleValidationResult(
  fileName: string,
  validationResult: ValidationResult,
): NextResponse | null {
  if (validationResult.isValid) return null;

  if (validationResult.issue === AI_GIBBERISH_ISSUE) {
    console.warn(
      "[Document Analysis] AI validation flagged potential quality issues",
      {
        fileName,
        issue: validationResult.issue,
        confidence: validationResult.confidence,
      },
    );
    return null;
  }

  const errorMessage = generateValidationErrorMessage(
    fileName,
    validationResult,
  );
  console.error("[Document Analysis] Text validation failed", {
    fileName,
    issue: validationResult.issue,
    confidence: validationResult.confidence,
  });
  return NextResponse.json({ error: errorMessage }, { status: 400 });
}

const getPdfParse = async (): Promise<
  (dataBuffer: Buffer) => Promise<{ text: string; numpages: number }>
> => {
  const pdfParse = await import("pdf-parse");
  return (pdfParse.default || pdfParse) as (
    dataBuffer: Buffer,
  ) => Promise<{ text: string; numpages: number }>;
};

const SYSTEM_PROMPT = `You are a specialized legal AI assistant. You MUST use the available tools extensively for research.

For each step, use web search to find Kansas court rules, statutes, case law, etc. Make MULTIPLE tool calls per step.`;

export async function POST(req: NextRequest) {
  console.log("[Document Analysis] POST handler called");

  try {
    // SECURITY: Authenticate BEFORE processing any documents.
    // Previously, auth was checked after document parsing (PDFs, DOCX),
    // allowing unauthenticated users to consume server resources.
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "API key missing" }, { status: 500 });
    }

    const providerConfig = await getAnalysisProviderConfig();
    const anthropic =
      providerConfig.fireworksProvider ??
      providerConfig.anthropicProvider ??
      createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    const isAnthropic = providerConfig.isAnthropic;
    console.log(
      `[Document Analysis] Provider: ${providerConfig.providerType}, Model: ${providerConfig.modelName}, isAnthropic: ${isAnthropic}`,
    );

    const validationClient = createLLMClient();

    const validationModel =
      process.env.CLAUDE_MODEL || process.env.CLAUDE;

    const contentType = req.headers.get("content-type") || "";
    const isJsonRequest = contentType.includes("application/json");

    let documentType: string | null = null;
    let caseType: string | null = null;
    let jurisdiction: string | null = null;
    let ourClients: string[] = [];
    let opposingParties: string[] = [];
    let contextSummary: string | null = null;
    let aiMode: string | null = null;
    let executionMode: string | null = null;
    let customWorkflow: WorkflowConfig | null = null;
    let documentOrigin: "our_firm" | "opposing" | "neutral" | "unknown" =
      "unknown";

    // This array will hold the normalized documents that will be processed
    // later in the handler. It is populated from either the legacy `documents`
    // field or the newer `subjectDocument`/`contextDocuments` shape.
    const documents: Array<{
      name: string;
      type: "text" | "pdf";
      content?: string;
      data?: string;
      mimeType?: string;
    }> = [];

    if (isJsonRequest) {
      console.log(
        "[Document Analysis] Processing JSON request (client-side extraction)",
      );

      const jsonData = await req.json();

        // Basic metadata fields expected from the UI
        documentType = jsonData.documentType || null;
        caseType = jsonData.caseType || null;
        jurisdiction = jsonData.jurisdiction || null;
        ourClients = jsonData.ourClients || [];
        opposingParties = jsonData.opposingParties || [];
        contextSummary = jsonData.contextSummary || null;
        aiMode = jsonData.aiMode || null;
        executionMode = jsonData.executionMode || null;
        customWorkflow = jsonData.workflow_config || null;
        documentOrigin = jsonData.documentOrigin || "unknown";

        // ---------------------------------------------------------------------
        // The UI (data‑panel.ts) sends a payload with `subjectDocument` and
        // `contextDocuments` instead of a flat `documents` array. Older versions of
        // the backend expected `documents`. To maintain backward compatibility we
        // normalise the payload here into a temporary `incomingDocs` array.
        // ---------------------------------------------------------------------
        // Include optional mimeType for each incoming document (used later when persisting)
        let incomingDocs: Array<{ name: string; type: "text" | "pdf"; content?: string; mimeType?: string }> = [];

        if (Array.isArray(jsonData.documents)) {
          incomingDocs = jsonData.documents;
        } else {
          // Build documents from the newer shape
          if (jsonData.subjectDocument) {
            incomingDocs.push({
              name: jsonData.subjectDocument.name ?? "subject",
              type: "text",
              content: jsonData.subjectDocument.content,
            });
          }
          if (Array.isArray(jsonData.contextDocuments)) {
            for (const ctx of jsonData.contextDocuments) {
              incomingDocs.push({
                name: ctx.name ?? "context",
                type: "text",
                content: ctx.content,
              });
            }
          }
        }

        if (!incomingDocs.length) {
          return NextResponse.json(
            { error: "Missing documents array in JSON payload" },
            { status: 400 },
          );
        }

        for (const doc of incomingDocs) {
          // `doc.content` can be undefined for non‑text payloads; default to an empty string
          const validationResult = await validateExtractedText(
            doc.content ?? "",
            doc.name,
            validationClient,
            validationModel,
          );

        // If the extracted text is too short we only warn (client‑side extraction
        // often yields short snippets) instead of aborting with a 400.
        if (!validationResult.isValid && validationResult.issue === "insufficient_text") {
          console.warn(
            `[Document Analysis] Validation warning for ${doc.name}: ${validationResult.details}`,
          );
        } else {
          const validationError = handleValidationResult(
            doc.name,
            validationResult,
          );
          if (validationError) return validationError;
        }

        console.log(
          `[Document Analysis] Validated document: ${doc.name} (${doc.content?.length ?? 0} chars)`,
        );
        // Add the validated document to the main `documents` array for later use
        documents.push({
          name: doc.name,
          type: doc.type,
          content: doc.content,
          mimeType: doc.mimeType,
        });
      }
    } else {
      console.log(
        "[Document Analysis] Processing FormData request (legacy server-side extraction)",
      );

      const formData = await req.formData();

      documentType = formData.get("documentType") as string | null;
      caseType = formData.get("caseType") as string | null;
      jurisdiction = formData.get("jurisdiction") as string | null;
      const ourClientsJson = formData.get("ourClients") as string | null;
      const opposingPartiesJson = formData.get("opposingParties") as
        | string
        | null;
      contextSummary = formData.get("contextSummary") as string | null;
      aiMode = formData.get("aiMode") as string | null;
      executionMode = formData.get("executionMode") as string | null;

      ourClients = ourClientsJson ? JSON.parse(ourClientsJson) : [];
      opposingParties = opposingPartiesJson
        ? JSON.parse(opposingPartiesJson)
        : [];

      const workflowConfigJson = formData.get("workflow_config");
      customWorkflow = workflowConfigJson
        ? JSON.parse(workflowConfigJson as string)
        : null;

      // Extract files: subjectDocument and contextDocument0, contextDocument1, etc.
      for (const [key, value] of formData.entries()) {
        if (
          (key === "subjectDocument" || key.startsWith("contextDocument")) &&
          value instanceof File
        ) {
          const fileName = value.name.toLowerCase();
          const mimeType = value.type;

          const isPDF =
            mimeType === "application/pdf" || fileName.endsWith(".pdf");
          const isDOCX =
            mimeType ===
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
            fileName.endsWith(".docx");

          try {
            if (isPDF) {
              const arrayBuffer = await value.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);

              try {
                const pdfParseFunc = await getPdfParse();
                const pdfData = await pdfParseFunc(buffer);
                const extractedText = pdfData.text.trim();

                if (extractedText.length < 50) {
                  console.warn(
                    `[Document Analysis] PDF extraction yielded very short text (${extractedText.length} chars): ${value.name}`,
                  );
                }

                const validationResult = await validateExtractedText(
                  extractedText,
                  value.name,
                  validationClient,
                  validationModel,
                );

                const validationError = handleValidationResult(
                  value.name,
                  validationResult,
                );
                if (validationError) return validationError;

                documents.push({
                  name: value.name,
                  type: "text",
                  content: extractedText,
                });
                console.log(
                  `[Document Analysis] Extracted PDF: ${value.name} (${extractedText.length} chars from ${pdfData.numpages} pages)`,
                );
              } catch (pdfError: unknown) {
                const errorMessage = getErrorMessage(pdfError);
                console.error(
                  `[Document Analysis] PDF extraction failed for ${value.name}:`,
                  errorMessage,
                );

                console.log(
                  `[Document Analysis] Attempting Claude fallback for ${value.name}...`,
                );
                try {
                  const claudeResult = await extractTextWithClaude(
                    buffer,
                    value.name,
                    mimeType,
                  );

                  if (claudeResult.success && claudeResult.text.length >= 50) {
                    const extractedText = claudeResult.text;

                    const validationResult = await validateExtractedText(
                      extractedText,
                      value.name,
                      validationClient,
                      validationModel,
                    );

                    const validationError = handleValidationResult(
                      value.name,
                      validationResult,
                    );
                    if (validationError) return validationError;

                    documents.push({
                      name: value.name,
                      type: "text",
                      content: extractedText,
                    });
                    console.log(
                      `[Document Analysis] Claude fallback succeeded: ${value.name} (${extractedText.length} chars)`,
                    );
                    continue;
                  } else {
                    console.warn(
                      `[Document Analysis] Claude fallback failed: ${claudeResult.error || "insufficient text"}`,
                    );
                  }
                } catch (claudeError: unknown) {
                  console.error(
                    `[Document Analysis] Claude fallback error:`,
                    getErrorMessage(claudeError),
                  );
                }

                return NextResponse.json(
                  {
                    error: `Failed to extract text from PDF: ${value.name}. The file may be encrypted, corrupted, or contain only images.`,
                  },
                  { status: 400 },
                );
              }
            } else if (isDOCX) {
              const arrayBuffer = await value.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);

              try {
                const result = await mammoth.extractRawText({ buffer });
                const extractedText = result.value.trim();

                if (extractedText.length < 50) {
                  console.warn(
                    `[Document Analysis] DOCX extraction yielded very short text (${extractedText.length} chars): ${value.name}`,
                  );
                }

                const validationResult = await validateExtractedText(
                  extractedText,
                  value.name,
                  validationClient,
                  validationModel,
                );

                const validationError = handleValidationResult(
                  value.name,
                  validationResult,
                );
                if (validationError) return validationError;

                documents.push({
                  name: value.name,
                  type: "text",
                  content: extractedText,
                });
                console.log(
                  `[Document Analysis] Extracted DOCX: ${value.name} (${extractedText.length} chars)`,
                );
              } catch (docxError: unknown) {
                const errorMessage = getErrorMessage(docxError);
                console.error(
                  `[Document Analysis] DOCX extraction failed for ${value.name}:`,
                  errorMessage,
                );
                return NextResponse.json(
                  {
                    error: `Failed to extract text from DOCX: ${value.name}. The file may be encrypted, corrupted, or in an unsupported format.`,
                  },
                  { status: 400 },
                );
              }
            } else {
              const text = await value.text();

              const validationResult = await validateExtractedText(
                text,
                value.name,
                validationClient,
                validationModel,
              );

              const validationError = handleValidationResult(
                value.name,
                validationResult,
              );
              if (validationError) return validationError;

              documents.push({
                name: value.name,
                type: "text",
                content: text,
              });
              console.log(
                `[Document Analysis] Loaded text file: ${value.name} (${text.length} chars)`,
              );
            }
          } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            console.error(
              `[Document Analysis] Error processing ${value.name}:`,
              errorMessage,
            );
            return NextResponse.json(
              {
                error: `Failed to process document: ${value.name}. ${errorMessage}`,
              },
              { status: 400 },
            );
          }
        }
      }
    }

    if (documents.length === 0) {
      return NextResponse.json(
        { error: "No documents uploaded" },
        { status: 400 },
      );
    }

    // Auth already checked at the top of this handler

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!user || !user.organizationId) {
      console.error(
        `[Document Analysis] User ${session.user.id} not found or has no organization`,
      );
      // Return a 400 Bad Request so the client can surface the error message
      // to the user instead of a generic server error.
      return NextResponse.json(
        { error: "User organization not found" },
        { status: 400 },
      );
    }

    console.log(
      `[Document Analysis] User organization: ${user.organizationId}`,
    );

    let workflow: WorkflowConfig = DEFAULT_WORKFLOW;
    if (!customWorkflow) {
      try {
        const activeConfig = await db
          .select()
          .from(workflowConfigs)
          .where(
            and(
              eq(workflowConfigs.organizationId, user.organizationId),
              eq(workflowConfigs.isActive, true),
            ),
          )
          .limit(1);

        if (activeConfig.length > 0 && activeConfig[0].config) {
          const validation = validateWorkflow(
            activeConfig[0].config as WorkflowConfig,
          );
          if (validation.valid) {
            workflow = activeConfig[0].config as WorkflowConfig;
            console.log(
              `[Document Analysis] Using active workflow config for org ${user.organizationId}: ${activeConfig[0].name}`,
            );
          } else {
            console.warn(
              `[Document Analysis] Active workflow config is invalid, using DEFAULT_WORKFLOW. Errors:`,
              validation.errors,
            );
          }
        } else {
          console.log(
            `[Document Analysis] No active workflow config found for org ${user.organizationId}, using DEFAULT_WORKFLOW`,
          );
        }
      } catch (error) {
        console.error(
          `[Document Analysis] Error loading workflow config, using DEFAULT_WORKFLOW:`,
          error,
        );
      }
    } else {
      workflow = customWorkflow;
      console.log(`[Document Analysis] Using custom workflow from request`);
    }

    const steps = getEnabledSteps(workflow);

    console.log(`[Document Analysis] Using ${steps.length} workflow steps`);

    const now = new Date();
    const subjectDocName = documents[0]?.name || "Untitled Document";
    let sessionId: number;

    const aiModeFinal: AiMode = isAiMode(aiMode) ? aiMode : "tools_and_steps";
    const executionModeFinal: ExecutionMode = isExecutionMode(executionMode)
      ? executionMode
      : "step-based";

    try {
      const [createdSession] = await db
        .insert(analysisSessions)
        .values({
          userId: session.user.id,
          organizationId: user.organizationId,
          title: subjectDocName,
          status: "draft",
          documentType: documentType || null,
          caseType: caseType || null,
          jurisdiction: jurisdiction || null,
          ourClients: ourClients,
          opposingParties: opposingParties,
          contextSummary: contextSummary || null,
          documentOrigin: documentOrigin,
          aiMode: aiModeFinal,
          executionMode: executionModeFinal,
          metadata: {
            documentCount: documents.length,
            documentNames: documents.map((d) => d.name),
          },
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: analysisSessions.id });

      if (!createdSession) {
        throw new Error("Session insert returned no row");
      }

      sessionId = createdSession.id;

      console.log(
        `[Document Analysis] Created session ${sessionId} for user ${session.user.id}`,
      );

      const [verifySession] = await db
        .select()
        .from(analysisSessions)
        .where(eq(analysisSessions.id, sessionId))
        .limit(1);

      if (!verifySession) {
        console.error(
          `[Document Analysis] CRITICAL: Session ${sessionId} was inserted but cannot be found in database!`,
        );
        return NextResponse.json(
          { error: "Failed to create session - database verification failed" },
          { status: 500 },
        );
      }

      console.log(
        `[Document Analysis] Verified session ${sessionId} exists in database with userId: ${verifySession.userId}`,
      );
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const dbErrorInfo = getDbErrorInfo(error);
      console.error(
        `[Document Analysis] Failed to create session:`,
        errorMessage,
      );
      if (dbErrorInfo.code || dbErrorInfo.detail) {
        console.error(
          `[Document Analysis] Error code: ${dbErrorInfo.code}, detail: ${dbErrorInfo.detail}`,
        );
      }
      return NextResponse.json(
        { error: `Failed to create session: ${errorMessage}` },
        { status: 500 },
      );
    }

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      // Sanitize text to remove NUL bytes and other problematic characters
      // that PostgreSQL text columns cannot store
      const extractedText = sanitizeExtractedText(doc.content || "");
      const fileSize = Buffer.byteLength(extractedText, "utf8");

      const documentRole = i === 0 ? "subject" : "context";

      await db.insert(documentsTable).values({
        analysisSessionId: sessionId,
        fileName: doc.name,
        fileType: doc.mimeType || "application/octet-stream",
        fileSize: fileSize,
        documentRole: documentRole,
        storageType: "base64",
        extractedText: extractedText,
        extractedTextPreview: extractedText.slice(0, 1000),
        wordCount: extractedText.split(/\s+/).filter(Boolean).length,
        extractionMethod: "client-side",
        extractionStatus: "success",
        createdAt: now,
        updatedAt: now,
      });

      console.log(
        `[Document Analysis] Persisted ${documentRole} document: ${doc.name} (${extractedText.length} chars)`,
      );
    }

    console.log(
      `[Document Analysis] Session ${sessionId} created with ${documents.length} documents. Returning session ID for client-side analysis start.`,
    );

    return new Response(null, {
      status: 200,
      headers: {
        "X-Session-Id": String(sessionId),
      },
    });

    /*
    const documentText = documents
      .map((d) => `=== ${d.name} ===\n${d.content}`)
      .join("\n\n");

    if (documentText.trim().length < 100) {
      console.error(
        `[Document Analysis] Extracted text is suspiciously short (${documentText.length} chars)`,
      );
      return NextResponse.json(
        {
          error:
            "Document extraction produced insufficient text. Please verify your files are readable and contain text content.",
        },
        { status: 400 },
      );
    }

    console.log(
      `[Document Analysis] Total extracted text: ${documentText.length} chars from ${documents.length} document(s)`,
    );

    console.log(`[Document Analysis] AI Mode: ${aiMode || "tools_and_steps"}`);

    let allAvailableTools: Record<string, any> = {};
    let allToolIds: Set<string> = new Set<string>(); // BUGFIX: Declare at function scope

    if (aiMode === "tools") {
      const { TOOL_REGISTRY } = await import("@/lib/ai-tools");
      const toolIds = Object.keys(TOOL_REGISTRY) as string[];
      toolIds.forEach((id) => allToolIds.add(id)); // Populate the set
      allAvailableTools = getToolsByIds(toolIds);
      console.log(
        `[Document Analysis] AI + Tools mode: Providing all ${Object.keys(allAvailableTools).length} available tools for dynamic selection`,
      );
    } else if (aiMode === "tools_and_steps") {
      steps.forEach((step) =>
        step.availableTools.forEach((id) => allToolIds.add(id)),
      );
      allAvailableTools = getToolsByIds(Array.from(allToolIds) as string[]);
      console.log(
        `[Document Analysis] AI + Tools + Steps mode: Using ${Object.keys(allAvailableTools).length} predefined tools from workflow steps`,
      );
    } else if (aiMode === "none") {
      allAvailableTools = {};
      console.log(
        `[Document Analysis] No tools mode: Analysis will proceed without tool access`,
      );
    } else {
      steps.forEach((step) =>
        step.availableTools.forEach((id) => allToolIds.add(id)),
      );
      allAvailableTools = getToolsByIds(Array.from(allToolIds) as string[]);
      console.log(
        `[Document Analysis] Default mode: Using ${Object.keys(allAvailableTools).length} predefined tools from workflow steps`,
      );
    }

    // Create a custom readable stream for progressive results
    const encoder = new TextEncoder();
    let fullAnalysis = "";
    const allToolCalls: unknown[] = [];
    const allToolResults: unknown[] = [];
    let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const enforcer = new VerificationEnforcer();
    const allContextualAnalyses: unknown[] = [];
    const allVerifiedAuthorities: unknown[] = [];
    const allVerificationStats = {
      total: 0,
      verified: 0,
      failed: 0,
      fallback: 0,
    };
    const stepResults: Array<{
      stepId: string;
      stepName: string;
      content: string;
      toolCalls: number;
    }> = [];

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial status
          controller.enqueue(
            encoder.encode(
              `[Starting analysis with ${steps.length} steps...]\n\n`,
            ),
          );

          // Process each step sequentially
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            console.log(
              `[Analysis] Step ${i + 1}/${steps.length}: ${step.name}`,
            );

            // Send progress update
            controller.enqueue(
              encoder.encode(
                `\n\n=== STEP ${i + 1}/${steps.length}: ${step.name} ===\n\n`,
              ),
            );

            // Get tools for this step based on AI mode
            let stepTools: Record<string, any> = {};

            if (aiMode === "tools") {
              stepTools = allAvailableTools;
            } else if (aiMode === "tools_and_steps") {
              stepTools = getToolsByIds(step.availableTools);
            } else if (aiMode === "none") {
              stepTools = {};
            } else {
              stepTools = getToolsByIds(step.availableTools);
            }

            try {
              const subjectDoc = documents.find((d, idx) => idx === 0);
              const subjectDocName = subjectDoc?.name || "the subject document";
              const contextDocs = documents.slice(1);

              let caseContextText = `IMPORTANT: Your primary focus is the analysis of the document with file name '${subjectDocName}' and everything else is context to help you understand the document.\n\n`;

              if (contextDocs.length > 0) {
                const contextFileNames = contextDocs
                  .map((d) => d.name)
                  .join(", ");
                caseContextText += `The following document(s) are provided for the express purpose of giving you greater context and understanding of the subject document, which is '${subjectDocName}.' Please read the context documents with that in mind: ${contextFileNames}\n\n`;
              }

              if (contextSummary) {
                caseContextText += `The following text is a summary that the user has provided for the express purpose of giving you greater context and understanding of the subject document, which is '${subjectDocName}.' Please read the summary with that in mind:\n${contextSummary}\n\n`;
              }

              if (ourClients && ourClients.length > 0) {
                caseContextText += `For the sake of context, the user's client(s) are: ${ourClients.join(", ")}\n\n`;
              }

              if (opposingParties && opposingParties.length > 0) {
                caseContextText += `For the sake of context, the opposing part(ies) in this matter are: ${opposingParties.join(", ")}\n\n`;
              }

              const caseContextParts = [];
              if (documentType)
                caseContextParts.push(`Document Type: ${documentType}`);
              if (caseType) caseContextParts.push(`Case Type: ${caseType}`);
              if (jurisdiction)
                caseContextParts.push(`Jurisdiction: ${jurisdiction}`);

              if (caseContextParts.length > 0) {
                caseContextText += `CASE METADATA:\n${caseContextParts.map((part) => `- ${part}`).join("\n")}\n\n`;
              }

              const caseContext = caseContextText;

              // Check for case law tools availability (used in stepInstructionsMessage below)
              const hasCaseLawTools = step.availableTools?.includes('courtlistener-search') && 
                                      step.availableTools?.includes('programmatic-quote-extraction');
              
              if (step.verificationSettings?.legalAuthorityVerification?.enabled) {
                console.log(
                  `[Analysis] Step ${i + 1}: Injecting enhanced citation enforcement prompt into user message`,
                );
              }
              
              if (hasCaseLawTools) {
                console.log(
                  `[Analysis] Step ${i + 1}: Injecting case law extraction workflow prompt`,
                );
              }

              const toolCallTracker = new Map<
                string,
                {
                  toolName: string;
                  toolInput: unknown;
                  startedAt: Date;
                  toolCategory?: string;
                }
              >();

              // ============================================================
              // CAG (Cache Augmented Generation) Optimization
              // ============================================================
              // Structure prompts for optimal Anthropic prompt caching:
              // 1. System prompt (stable across all steps) - CACHE BREAKPOINT
              // 2. Document content (large, static) - CACHE BREAKPOINT
              // 3. Step-specific instructions (changes each step)
              //
              // By placing cache breakpoints on stable content, Anthropic can
              // reuse cached tokens across all steps, reducing cost by up to
              // 90% and latency by up to 85%.
              // ============================================================

              // Separate document content from step instructions for optimal caching
              const documentContextMessage = `${caseContext}DOCUMENTS:\n${documentText}`;
              const stepInstructionsMessage = `STEP ${i + 1} of ${steps.length}: ${step.name}\n\n${step.description}\n\n${step.systemPrompt}${
                step.verificationSettings?.legalAuthorityVerification?.enabled
                  ? `\n\n${ENHANCED_CITATION_ENFORCEMENT_PROMPT}`
                  : ""
              }${hasCaseLawTools ? `\n\n${CASE_LAW_EXTRACTION_WORKFLOW_PROMPT}` : ""}\n\nAnalyze the documents according to this step's instructions. Use tools extensively.`;

              // CAG Optimization: System prompt is now in messages array with cacheControl
              // Do NOT use the `system:` parameter - it would duplicate the system prompt
              const result = streamText({
                model: anthropic(providerConfig.modelName),
                messages: [
                  {
                    role: "system" as const,
                    content: SYSTEM_PROMPT,
                    ...(isAnthropic && {
                      providerOptions: {
                        anthropic: {
                          cacheControl: { type: "ephemeral" },
                        },
                      },
                    }),
                  },
                  {
                    role: "user" as const,
                    content: documentContextMessage,
                    ...(isAnthropic && {
                      providerOptions: {
                        anthropic: {
                          cacheControl: { type: "ephemeral" },
                        },
                      },
                    }),
                  },
                  {
                    role: "user" as const,
                    content: stepInstructionsMessage,
                  },
                ],
                tools:
                  Object.keys(stepTools).length > 0 ? stepTools : undefined,
                temperature: step.modelParams.temperature || 0.7,
                maxOutputTokens: step.modelParams.maxTokens || 4096,
                onChunk: ({ chunk }) => {
                  if (chunk.type === "tool-call") {
                    const toolInput =
                      (chunk as { args?: unknown; input?: unknown }).args || (chunk as { args?: unknown; input?: unknown }).input;
                    console.log(`[Analysis] Step ${i + 1} tool call:`, {
                      toolName: chunk.toolName,
                      toolCallId: chunk.toolCallId,
                      args: toolInput,
                    });

                    toolCallTracker.set(chunk.toolCallId, {
                      toolName: chunk.toolName,
                      toolInput: toolInput,
                      startedAt: new Date(),
                      toolCategory: undefined,
                    });

                    const toolMsg = `\n🔧 Using tool: ${chunk.toolName}\n`;
                    controller.enqueue(encoder.encode(toolMsg));
                  } else if (chunk.type === "tool-result") {
                    const toolOutput =
                      (chunk as { result?: unknown; output?: unknown }).result || (chunk as { result?: unknown; output?: unknown }).output;
                    // Safely stringify toolOutput to prevent "Cannot read properties of undefined (reading 'substring')" errors
                    const outputJson =
                      typeof toolOutput === "string"
                        ? toolOutput
                        : JSON.stringify(toolOutput ?? {});
                    console.log(`[Analysis] Step ${i + 1} tool result:`, {
                      toolCallId: chunk.toolCallId,
                      toolName: chunk.toolName,
                      resultLength: outputJson.length,
                    });

                    const trackedCall = toolCallTracker.get(chunk.toolCallId);
                    if (trackedCall) {
                      const completedAt = new Date();

                      logToolCall(
                        {
                          analysisSessionId: sessionId,
                          stepIndex: i,
                          stepName: step.name,
                        },
                        trackedCall.toolName,
                        trackedCall.toolCategory,
                        trackedCall.toolInput,
                        toolOutput,
                        trackedCall.startedAt,
                        completedAt,
                        {
                          httpStatusCode:
                            typeof toolOutput === "object" &&
                            toolOutput !== null &&
                            "status" in toolOutput
                              ? typeof toolOutput === "object" && toolOutput && "status" in toolOutput ? (toolOutput as { status?: unknown }).status
                              : undefined,
                        },
                      ).catch((err) => {
                        console.error(
                          `[Analysis] Failed to log tool call for ${trackedCall.toolName}:`,
                          err,
                        );
                      });

                      toolCallTracker.delete(chunk.toolCallId);
                    }

                    const resultMsg = `\n✓ Tool result received\n`;
                    controller.enqueue(encoder.encode(resultMsg));
                  }
                },
              });

              let stepText = "";
              let toolCallCount = 0;
              const exampleDetector = new StreamingExampleDetector();

              for await (const chunk of result.textStream) {
                stepText += chunk;

                const exampleMatch = exampleDetector.addChunk(chunk);
                if (exampleMatch) {
                  const allMatches = detectAllPieces(exampleDetector["buffer"]);
                  const errorMsg = generateFallbackErrorMessage(
                    exampleMatch,
                    allMatches,
                  );
                  console.error(
                    `[Analysis] Example fallback detected in step ${i + 1}:`,
                    exampleMatch,
                  );
                  controller.enqueue(
                    encoder.encode(`\n\n❌ ERROR: ${errorMsg}\n\n`),
                  );
                  throw new Error(
                    `EXAMPLE_FALLBACK_DETECTED: ${exampleMatch.token}`,
                  );
                }
              }

              const allMatches = detectAllPieces(stepText);
              if (allMatches.length > 0) {
                const postStepMatch = allMatches[0];
                const errorMsg = generateFallbackErrorMessage(
                  postStepMatch,
                  allMatches,
                );
                console.error(
                  `[Analysis] Example fallback detected in step ${i + 1} (post-step check):`,
                  postStepMatch,
                );
                controller.enqueue(
                  encoder.encode(`\n\n❌ ERROR: ${errorMsg}\n\n`),
                );
                throw new Error(
                  `EXAMPLE_FALLBACK_DETECTED: ${postStepMatch.token}`,
                );
              }

              // Apply verification enforcement if enabled for this step
              if (
                step.verificationSettings?.legalAuthorityVerification?.enabled
              ) {
                const maxRetries =
                  step.verificationSettings.legalAuthorityVerification
                    .maxRetries || 5;

                const hasCitationsJSON = stepText.includes("<CitationsJSON>");
                console.log(`[Analysis] Step ${i + 1} verification check:`, {
                  stepLength: stepText.length,
                  hasCitationsJSON,
                  citationsJSONPreview: hasCitationsJSON
                    ? stepText.substring(
                        stepText.indexOf("<CitationsJSON>"),
                        stepText.indexOf("<CitationsJSON>") + 200,
                      )
                    : "NOT FOUND",
                });

                controller.enqueue(
                  encoder.encode(`\n[Verifying citations...]\n`),
                );

                const enforcementResult = await enforcer.enforceVerification(
                  stepText,
                  step.verificationSettings,
                  maxRetries,
                );

                console.log(`[Analysis] Step ${i + 1} enforcement result:`, {
                  success: enforcementResult.success,
                  attempts: enforcementResult.attempts,
                  verifiedCount: enforcementResult.verifiedCitations.length,
                  failedCount: enforcementResult.failedCitations.length,
                  opponentErrorsCount:
                    enforcementResult.opponentCitationErrors.length,
                });

                if (
                  enforcementResult.contextualAnalyses &&
                  enforcementResult.contextualAnalyses.length > 0
                ) {
                  allContextualAnalyses.push(
                    ...enforcementResult.contextualAnalyses,
                  );
                }

                if (enforcementResult.verifiedCitations.length > 0) {
                  for (const citation of enforcementResult.verifiedCitations) {
                    for (const authority of citation.authorities) {
                      allVerificationStats.total++;
                      allVerificationStats.verified++;
                      allVerifiedAuthorities.push({
                        citation: authority.citation,
                        url: authority.url,
                        verified: true,
                        quote: authority.quote,
                        type: authority.type,
                        attribution: authority.attribution,
                      });
                    }
                  }
                }

                if (enforcementResult.failedCitations.length > 0) {
                  for (const citation of enforcementResult.failedCitations) {
                    for (const authority of citation.authorities) {
                      allVerificationStats.total++;
                      allVerificationStats.failed++;
                      allVerifiedAuthorities.push({
                        citation: authority.citation,
                        url: authority.url,
                        verified: false,
                        quote: authority.quote,
                        type: authority.type,
                        attribution: authority.attribution,
                        note: "Failed verification after maximum retries",
                      });
                    }
                  }
                }

                if (enforcementResult.opponentCitationErrors.length > 0) {
                  for (const citation of enforcementResult.opponentCitationErrors) {
                    for (const authority of citation.authorities) {
                      if (authority.attribution === "opposing") {
                        allVerificationStats.total++;
                        allVerificationStats.fallback++;
                        allVerifiedAuthorities.push({
                          citation: authority.citation,
                          url: authority.url,
                          verified: false,
                          fallback_flag: true,
                          quote: authority.quote,
                          type: authority.type,
                          attribution: authority.attribution,
                          note: "Opponent citation error - potential vulnerability",
                        });
                      }
                    }
                  }
                }

                if (
                  !enforcementResult.success &&
                  enforcementResult.failedCitations.length > 0
                ) {
                  controller.enqueue(
                    encoder.encode(
                      `\n⚠️ Warning: ${enforcementResult.failedCitations.length} citations failed verification after ${enforcementResult.attempts} attempts\n`,
                    ),
                  );
                }

                const { transformedText, referencesSection } =
                  enforcer.injectCitations(
                    stepText,
                    enforcementResult.verifiedCitations,
                    enforcementResult.verificationScores,
                  );

                stepText = transformedText + referencesSection;

                try {
                  const propositions = enforcer.extractPropositions(stepText);

                  if (propositions.size > 0) {
                    controller.enqueue(
                      encoder.encode(
                        `\n💾 Persisting ${propositions.size} propositions...\n`,
                      ),
                    );

                    const propositionIdMap = new Map<string, string>();

                    for (const [propId, propText] of propositions.entries()) {
                      try {
                        const dbPropositionId = await persistProposition(
                          sessionId,
                          user.organizationId,
                          i,
                          step.id,
                          step.name,
                          propText,
                          propositionIdMap.size,
                        );
                        propositionIdMap.set(propId, dbPropositionId);
                      } catch (error) {
                        console.error(
                          `[Citation Persistence] Failed to persist proposition ${propId}:`,
                          error,
                        );
                      }
                    }

                    const citations = enforcer.parseCitationsJSON(stepText);
                    if (citations && citations.length > 0) {
                      controller.enqueue(
                        encoder.encode(
                          `\n💾 Persisting citations for ${citations.length} propositions...\n`,
                        ),
                      );

                      const citationIdMap = new Map<string, string>();

                      for (const citation of citations) {
                        const dbPropositionId = propositionIdMap.get(
                          citation.proposition_id,
                        );
                        if (!dbPropositionId) {
                          console.warn(
                            `[Citation Persistence] No DB proposition ID for ${citation.proposition_id}`,
                          );
                          continue;
                        }

                        for (const authority of citation.authorities) {
                          try {
                            // CRITICAL FIX: For case law authorities, perform server-side CourtListener resolution
                            // This removes AI from URL generation entirely - the backend searches CourtListener
                            // using the citation text and matches the response's caseName to find the correct URL
                            const resolvedUrl = await resolveCaseLawUrl(authority);
                            if (authority.authority_type === "case_law" && !resolvedUrl) {
                              // Case law could not be resolved via CourtListener - skip this citation
                              console.warn(
                                `[Citation Persistence] SKIPPED case law citation - could not resolve CourtListener URL for "${authority.citation}" (proposition ${citation.proposition_id})`,
                              );
                              continue;
                            }
                            // Create authority object with resolved URL for persistence (avoid mutating original)
                            // Also store opinionId and confidence in metadata for future reference
                            const authorityForPersistence = resolvedUrl
                              ? {
                                  ...authority,
                                  url: resolvedUrl.url,
                                  metadata: {
                                    ...(authority as any).metadata,
                                    opinionId: resolvedUrl.opinionId,
                                    resolvedCaseName: resolvedUrl.resolvedCaseName,
                                    resolutionConfidence: resolvedUrl.confidence,
                                  },
                                }
                              : authority;

                            const verifier = enforcer["verifier"] as unknown;
                            const normalizedQuote = verifier?.normalizeText
                              ? verifier.normalizeText(authority.quote)
                              : authority.quote
                                  .toLowerCase()
                                  .replace(/\s+/g, " ")
                                  .trim();
                            const quoteHash =
                              generateQuoteHash(normalizedQuote);

                            const citationId = await upsertCitation(
                              sessionId,
                              user.organizationId,
                              dbPropositionId,
                              authorityForPersistence,
                              normalizedQuote,
                              quoteHash,
                              undefined,
                            );

                            const citationKey = `${authorityForPersistence.citation}|${authorityForPersistence.url}|${quoteHash}`;
                            citationIdMap.set(citationKey, citationId);

                            const color = enforcer.assignColor();
                            await assignFootnoteNumber(
                              sessionId,
                              user.organizationId,
                              dbPropositionId,
                              citationId,
                              color,
                            );
                          } catch (error) {
                            console.error(
                              `[Citation Persistence] Failed to persist citation for ${citation.proposition_id}:`,
                              error,
                            );
                          }
                        }
                      }

                      const contextualAnalyses =
                        enforcer.parseContextJSON(stepText);
                      if (contextualAnalyses && contextualAnalyses.length > 0) {
                        controller.enqueue(
                          encoder.encode(
                            `\n💾 Persisting ${contextualAnalyses.length} contextual analyses...\n`,
                          ),
                        );

                        for (const context of contextualAnalyses) {
                          try {
                            const matchingCitation = citations
                              .flatMap((c) => c.authorities)
                              .find(
                                (a) =>
                                  a.citation === context.authority_citation,
                              );

                            if (!matchingCitation) {
                              console.warn(
                                `[Citation Persistence] No matching citation for contextual analysis: ${context.authority_citation}`,
                              );
                              continue;
                            }

                            const verifier = enforcer["verifier"] as unknown;
                            const normalizedQuote = verifier?.normalizeText
                              ? verifier.normalizeText(matchingCitation.quote)
                              : matchingCitation.quote
                                  .toLowerCase()
                                  .replace(/\s+/g, " ")
                                  .trim();
                            const quoteHash =
                              generateQuoteHash(normalizedQuote);
                            const citationKey = `${matchingCitation.citation}|${matchingCitation.url}|${quoteHash}`;
                            const citationId = citationIdMap.get(citationKey);

                            if (!citationId) {
                              console.warn(
                                `[Citation Persistence] No citation ID for contextual analysis: ${context.authority_citation}`,
                              );
                              continue;
                            }

                            const contextualAnalysisId =
                              await persistContextualAnalysis(
                                citationId,
                                user.organizationId,
                                context,
                              );

                            const normalizeTextFn = verifier?.normalizeText
                              ? verifier.normalizeText.bind(verifier)
                              : (text: string) =>
                                  text
                                    .toLowerCase()
                                    .replace(/\s+/g, " ")
                                    .trim();

                            await persistContextualQuotes(
                              contextualAnalysisId,
                              user.organizationId,
                              "preceding",
                              context.preceding_context.quotes,
                              normalizeTextFn,
                            );

                            await persistContextualQuotes(
                              contextualAnalysisId,
                              user.organizationId,
                              "subsequent",
                              context.subsequent_development.quotes,
                              normalizeTextFn,
                            );

                            await persistContextualQuotes(
                              contextualAnalysisId,
                              user.organizationId,
                              "qualifications",
                              context.qualifications_limitations.quotes,
                              normalizeTextFn,
                            );
                          } catch (error) {
                            console.error(
                              `[Citation Persistence] Failed to persist contextual analysis:`,
                              error,
                            );
                          }
                        }
                      }

                      controller.enqueue(
                        encoder.encode(`\n✅ Citation persistence complete\n`),
                      );
                    }
                  }
                } catch (persistError: unknown) {
                  console.error(
                    `[Analysis] Failed to persist step ${i + 1} citations:`,
                    persistError,
                  );
                  controller.enqueue(
                    encoder.encode(
                      `\n⚠️ Warning: Failed to save citations to database\n`,
                    ),
                  );
                }
              }

              controller.enqueue(encoder.encode(stepText));

              fullAnalysis += stepText + "\n\n";

              // Get final result with tool calls (AI SDK v5: these are now promises)
              const finalResult = await result;
              const toolCalls = await finalResult.toolCalls;
              const toolResults = await finalResult.toolResults;
              const usage = await finalResult.usage;

              if (toolCalls) {
                toolCallCount = toolCalls.length;
                allToolCalls.push(...toolCalls);
              }
              if (toolResults) {
                allToolResults.push(...toolResults);
              }
              if (usage) {
                // AI SDK v5 uses inputTokens/outputTokens instead of promptTokens/completionTokens
                totalUsage.promptTokens += usage.inputTokens || 0;
                totalUsage.completionTokens += usage.outputTokens || 0;
                totalUsage.totalTokens += usage.totalTokens || 0;
              }

              stepResults.push({
                stepId: step.id,
                stepName: step.name,
                content: stepText,
                toolCalls: toolCallCount,
              });

              // Send step completion message
              controller.enqueue(
                encoder.encode(
                  `\n✅ Step ${i + 1} complete (${toolCallCount} tool calls, ${stepText.length} chars)\n`,
                ),
              );

              console.log(
                `[Analysis] Step ${i + 1} complete: ${stepText.length} chars, ${toolCallCount} tool calls`,
              );
            } catch (stepError: unknown) {
              const errorMsg = `\n\n[ERROR in step ${i + 1}: ${stepError.message}]\n\n`;
              console.error(`[Analysis] Step ${i + 1} error:`, stepError);
              controller.enqueue(encoder.encode(errorMsg));
              fullAnalysis += errorMsg;
            }
          }

          controller.enqueue(
            encoder.encode(
              `\n\n<VERIFICATION_DATA>${JSON.stringify({ verifiedAuthorities: allVerifiedAuthorities, verificationStats: allVerificationStats })}</VERIFICATION_DATA>\n\n`,
            ),
          );

          // Send completion message
          controller.enqueue(
            encoder.encode(
              `\n\n[Analysis complete! Processed ${steps.length} steps with ${allToolCalls.length} tool calls]\n`,
            ),
          );

          const executiveSummaryStep = stepResults.find(
            (s) => s.stepId === "step-34-executive-summary",
          );
          const paralegalChecklistStep = stepResults.find(
            (s) => s.stepId === "step-35-paralegal-checklist",
          );

          const citationIndex = enforcer.getCitationIndex();

          // Update session status to complete and save result
          await db
            .update(analysisSessions)
            .set({
              status: "complete",
              analysisResult: {
                documentType: documentType || undefined,
                jurisdiction: jurisdiction || undefined,
                executiveSummary: executiveSummaryStep?.content || undefined,
                fullAnalysis,
                timestamp: new Date().toISOString(),
                steps: stepResults,
                verifiedAuthorities: allVerifiedAuthorities,
                verificationStats: allVerificationStats,
                citationIndex: {
                  nextNumber: citationIndex.nextNumber,
                  lastColor: citationIndex.lastColor,
                  citations: Array.from(citationIndex.citations.entries()).map(
                    ([num, cit]) => ({
                      number: num,
                      citation: cit.citation,
                      quote: cit.quote,
                      url: cit.url,
                      color: cit.color,
                    }),
                  ),
                },
                contextualAnalyses: allContextualAnalyses,
                usage: totalUsage,
                toolCalls: allToolCalls.length,
              },
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where({ id: sessionId });

          console.log(
            `[Document Analysis] Updated session ${sessionId} to complete`,
          );

          // Save transcript
          const transcript = {
            sessionId,
            timestamp: new Date().toISOString(),
            documents: documents.map((d) => ({
              name: d.name,
              length: d.content?.length || 0,
            })),
            workflow: {
              version: workflow.version,
              stepsEnabled: steps.length,
              steps: steps.map((s) => ({ id: s.id, name: s.name })),
            },
            toolsAvailable: Array.from(allToolIds),
            toolCallsMade: allToolCalls.map((tc) => ({
              toolName: tc.toolName,
              args: tc.args,
            })),
            toolResults: allToolResults.map((tr) => ({
              toolName: tr.toolName,
              result:
                typeof tr.result === "string"
                  ? tr.result.substring(0, 1000)
                  : JSON.stringify(tr.result).substring(0, 1000),
            })),
            verifiedAuthorities: allVerifiedAuthorities,
            verificationStats: allVerificationStats,
            citationIndex: {
              nextNumber: citationIndex.nextNumber,
              citations: Array.from(citationIndex.citations.entries()).map(
                ([num, cit]) => ({
                  number: num,
                  ...cit,
                }),
              ),
            },
            contextualAnalyses: allContextualAnalyses,
            usage: totalUsage,
            finishReason: "stop",
            fullResponse: fullAnalysis,
          };

          try {
            const baseUrl = req.nextUrl.origin;
            const headers: HeadersInit = { "Content-Type": "application/json" };

            if (process.env.INTERNAL_API_TOKEN) {
              headers["x-internal-api-token"] =
                process.env.INTERNAL_API_TOKEN;
            }

            await fetch(`${baseUrl}/api/analysis-transcript`, {
              method: "POST",
              headers,
              body: JSON.stringify(transcript),
            });
            console.log(
              `[Analysis] Transcript saved with ${allToolCalls.length} tool calls`,
            );
          } catch (e) {
            console.error("[Analysis] Failed to save transcript:", e);
          }

          controller.close();
        } catch (error: unknown) {
          console.error("[Analysis] Stream error:", error);
          controller.enqueue(encoder.encode(`\n\n[ERROR: ${error.message}]\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Workflow-Steps": steps.length.toString(),
        "X-Tools-Available": Array.from(allToolIds).length.toString(),
        "X-Session-Id": sessionId,
      },
    });
    */
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    console.error("[Document Analysis] Error:", errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
