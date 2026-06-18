const WORKFLOW_CONTEXT_KEY = "workflow-context";

export interface WorkflowContextDocumentRef {
  name: string;
  type?: string;
  size?: number;
}

export interface WorkflowContextData {
  timestamp: number;
  subjectDocument: WorkflowContextDocumentRef | null;
  contextDocuments: WorkflowContextDocumentRef[];
  metadata: {
    documentType: string;
    caseType: string;
    jurisdiction: string;
    ourClients: string[];
    opposingParties: string[];
    contextSummary: string;
  };
}

interface WorkflowContextStorage {
  data: WorkflowContextData;
}

export function loadWorkflowContext(): {
  data: WorkflowContextData | null;
  files: { subjectDocument: File | null; contextDocuments: File[] };
} {
  if (typeof window === "undefined") {
    return {
      data: null,
      files: { subjectDocument: null, contextDocuments: [] },
    };
  }

  try {
    const raw = window.localStorage.getItem(WORKFLOW_CONTEXT_KEY);
    if (!raw) {
      return {
        data: null,
        files: { subjectDocument: null, contextDocuments: [] },
      };
    }

    const parsed = JSON.parse(raw) as Partial<WorkflowContextStorage>;
    if (!parsed.data) {
      return {
        data: null,
        files: { subjectDocument: null, contextDocuments: [] },
      };
    }

    return {
      data: {
        timestamp: parsed.data.timestamp ?? Date.now(),
        subjectDocument: parsed.data.subjectDocument ?? null,
        contextDocuments: parsed.data.contextDocuments ?? [],
        metadata: {
          documentType: parsed.data.metadata?.documentType ?? "",
          caseType: parsed.data.metadata?.caseType ?? "",
          jurisdiction: parsed.data.metadata?.jurisdiction ?? "",
          ourClients: parsed.data.metadata?.ourClients ?? [],
          opposingParties: parsed.data.metadata?.opposingParties ?? [],
          contextSummary: parsed.data.metadata?.contextSummary ?? "",
        },
      },
      files: {
        subjectDocument: null,
        contextDocuments: [],
      },
    };
  } catch {
    return {
      data: null,
      files: { subjectDocument: null, contextDocuments: [] },
    };
  }
}

export function clearWorkflowContext(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(WORKFLOW_CONTEXT_KEY);
}