import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { analysisSessions, documents } from "@/db/schema";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { ensureDefaultOrganizationId } from "@/lib/default-organization";
import {
  createSessionSchema,
  validateInput,
} from "@/lib/validations/session-schemas";

async function saveUploadToLocal(
  sessionId: number,
  bucket: "subject" | "context",
  file: File,
): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueName = `${Date.now()}-${safeName}`;
  const relativeDir = path.join("uploads", "sessions", `${sessionId}`, bucket);
  const absoluteDir = path.join(process.cwd(), "public", relativeDir);
  const absoluteFilePath = path.join(absoluteDir, uniqueName);

  await mkdir(absoluteDir, { recursive: true });
  const data = Buffer.from(await file.arrayBuffer());
  await writeFile(absoluteFilePath, data);

  return `/${path.join(relativeDir, uniqueName).replace(/\\/g, "/")}`;
}

/**
 * NOTE: Multi-table operations without transactions
 *
 * This route creates a session and then uploads documents. The Neon HTTP driver
 * does NOT support interactive transactions. To mitigate data integrity risks:
 * 1. Session is created first (required for document foreign key)
 * 2. Document uploads are independent operations
 * 3. Partial failures leave orphaned sessions (acceptable - can be cleaned up)
 * 4. Each document insert is atomic
 *
 * For true ACID guarantees, consider using Neon WebSocket driver with Pool/Client.
 */
export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse FormData (contains files + metadata)
    const formData = await req.formData();

    // Extract metadata JSON
    const metadataStr = formData.get("metadata") as string;
    if (!metadataStr) {
      return NextResponse.json(
        { error: "Metadata is required" },
        { status: 400 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = JSON.parse(metadataStr);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in metadata" },
        { status: 400 },
      );
    }

    // Validate input using Zod schema
    const validation = validateInput(createSessionSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: `Validation failed: ${validation.error}` },
        { status: 400 },
      );
    }

    const body = validation.data;

    // Create new analysis session
    const now = new Date();
    const authenticatedUserId = Number(session.user.id);
    const organizationId = await ensureDefaultOrganizationId();

    const [newSession] = await db
      .insert(analysisSessions)
      .values({
        userId: authenticatedUserId,
        organizationId,
        title: body.title,
        status: "draft",
        documentType: body.document_type || null,
        caseType: body.case_type || null,
        jurisdiction: body.jurisdiction || null,
        ourClients: body.our_clients || [],
        opposingParties: body.opposing_parties || [],
        contextSummary: body.context_summary || null,
        aiMode: body.ai_mode || "tools_and_steps",
        workflowConfigId: body.workflow_config_id || null,
        metadata: { ...(body.metadata || {}), origin: "ui" },
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const sessionId = newSession.id;

    // Upload and store documents
    const uploadedDocuments = [];

    // Handle subject document
    const subjectDoc = formData.get("subjectDocument") as File | null;
    if (subjectDoc) {
      console.log(
        `[Session Create] Uploading subject document: ${subjectDoc.name}`,
      );

      const localUrl = await saveUploadToLocal(sessionId, "subject", subjectDoc);

      // Create document record
      const [docRecord] = await db
        .insert(documents)
        .values({
          analysisSessionId: sessionId,
          fileName: subjectDoc.name,
          fileType: subjectDoc.type || "application/pdf",
          fileSize: subjectDoc.size,
          documentRole: "subject",
          storageType: "local_file",
          storageUrl: localUrl,
          createdAt: now,
        })
        .returning();

      uploadedDocuments.push(docRecord);
    }

    // Handle context documents
    for (let i = 0; ; i++) {
      const contextDoc = formData.get(`contextDocument_${i}`) as File | null;
      if (!contextDoc) break;

      console.log(
        `[Session Create] Uploading context document ${i}: ${contextDoc.name}`,
      );

      const localUrl = await saveUploadToLocal(sessionId, "context", contextDoc);

      const [docRecord] = await db
        .insert(documents)
        .values({
          analysisSessionId: sessionId,
          fileName: contextDoc.name,
          fileType: contextDoc.type || "application/pdf",
          fileSize: contextDoc.size,
          documentRole: "context",
          storageType: "local_file",
          storageUrl: localUrl,
          createdAt: now,
        })
        .returning();

      uploadedDocuments.push(docRecord);
    }

    console.log(
      `[Session Create] Created session ${sessionId} with ${uploadedDocuments.length} documents`,
    );

    return NextResponse.json({
      success: true,
      sessionId: newSession.id,
      session: newSession,
      documents: uploadedDocuments,
    });
  } catch (error) {
    console.error("Error creating analysis session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 },
    );
  }
}
