"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Brain, AlertTriangle, Check, X } from "lucide-react";

export interface KGConfirmationRequest {
  id: string;
  type: "preference" | "fact" | "delete";
  message: string;
  data: {
    category?: string;
    preference?: string;
    subject?: string;
    predicate?: string;
    object?: string;
    context?: string;
    confidence?: number;
  };
  onConfirm: () => Promise<void>;
  onReject: () => void;
}

interface KnowledgeGraphConfirmDialogProps {
  request: KGConfirmationRequest | null;
  onClose: () => void;
}

export function KnowledgeGraphConfirmDialog({
  request,
  onClose,
}: KnowledgeGraphConfirmDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!request) return;

    setIsProcessing(true);
    try {
      await request.onConfirm();
      onClose();
    } catch (error) {
      console.error("Failed to store in knowledge graph:", error);
      alert("Failed to save to knowledge graph. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [request, onClose]);

  const handleReject = useCallback(() => {
    if (!request) return;
    request.onReject();
    onClose();
  }, [request, onClose]);

  if (!request) return null;

  const isDeleteRequest = request.type === "delete";
  const isPreference = request.type === "preference";
  const isFact = request.type === "fact";

  return (
    <Dialog open={!!request} onOpenChange={() => !isProcessing && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDeleteRequest ? (
              <>
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Confirm Deletion
              </>
            ) : (
              <>
                <Brain className="h-5 w-5 text-primary" />
                Remember This?
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isDeleteRequest
              ? "This action cannot be undone."
              : "Add this to your knowledge graph for future reference."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Display based on type */}
          {isPreference && request.data.category && request.data.preference && (
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium text-muted-foreground">
                  Category
                </span>
                <p className="text-base">{request.data.category}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-muted-foreground">
                  Preference
                </span>
                <p className="text-base">{request.data.preference}</p>
              </div>
              {request.data.context && (
                <div>
                  <span className="text-sm font-medium text-muted-foreground">
                    Context
                  </span>
                  <p className="text-sm text-muted-foreground">
                    {request.data.context}
                  </p>
                </div>
              )}
            </div>
          )}

          {isFact &&
            request.data.subject &&
            request.data.predicate &&
            request.data.object && (
              <div className="space-y-3">
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="text-base">
                    <span className="font-semibold">
                      {request.data.subject}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {request.data.predicate}
                    </span>{" "}
                    <span className="font-semibold">{request.data.object}</span>
                  </p>
                </div>
                {request.data.confidence !== undefined && (
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">
                      Confidence
                    </span>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${request.data.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium">
                        {(request.data.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

          {isDeleteRequest && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="ml-2">
                {request.message}
              </AlertDescription>
            </Alert>
          )}

          {!isDeleteRequest && (
            <Alert>
              <Brain className="h-4 w-4" />
              <AlertDescription className="ml-2">
                This will be saved to your cloud knowledge graph and synced
                across all your devices.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={isProcessing}
          >
            <X className="mr-2 h-4 w-4" />
            {isDeleteRequest ? "Cancel" : "No, Don't Save"}
          </Button>
          <Button
            variant={isDeleteRequest ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <span className="mr-2 h-4 w-4 animate-spin">⏳</span>
                Processing...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                {isDeleteRequest ? "Yes, Delete" : "Yes, Remember This"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook for managing KG confirmation requests
 */
export function useKnowledgeGraphConfirmation() {
  const [request, setRequest] = useState<KGConfirmationRequest | null>(null);

  const confirmPreference = useCallback(
    (
      category: string,
      preference: string,
      context?: string,
    ): Promise<boolean> => {
      return new Promise((resolve) => {
        setRequest({
          id: Math.random().toString(36),
          type: "preference",
          message: "Would you like me to remember this preference?",
          data: { category, preference, context },
          onConfirm: async () => {
            resolve(true);
          },
          onReject: () => {
            resolve(false);
          },
        });
      });
    },
    [],
  );

  const confirmFact = useCallback(
    (
      subject: string,
      predicate: string,
      object: string,
      confidence?: number,
    ): Promise<boolean> => {
      return new Promise((resolve) => {
        setRequest({
          id: Math.random().toString(36),
          type: "fact",
          message: "I learned something new! Should I remember this?",
          data: { subject, predicate, object, confidence },
          onConfirm: async () => {
            resolve(true);
          },
          onReject: () => {
            resolve(false);
          },
        });
      });
    },
    [],
  );

  const confirmDeletion = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setRequest({
        id: Math.random().toString(36),
        type: "delete",
        message,
        data: {},
        onConfirm: async () => {
          resolve(true);
        },
        onReject: () => {
          resolve(false);
        },
      });
    });
  }, []);

  const clearRequest = useCallback(() => {
    setRequest(null);
  }, []);

  return {
    request,
    confirmPreference,
    confirmFact,
    confirmDeletion,
    clearRequest,
  };
}
