"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Clock, FileText, Search, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AnalysisSession {
  id: number;
  title: string;
  status: "draft" | "processing" | "complete" | "error";
  createdAt: string;
  updatedAt: string;
  documentType?: string;
  jurisdiction?: string;
}

interface HistoryPanelProps {
  onSessionSelect?: (sessionId: number) => void;
}

export function HistoryPanel({ onSessionSelect }: HistoryPanelProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState<AnalysisSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const ITEMS_PER_PAGE = 20;

  // Fetch sessions from API
  const fetchSessions = async (
    pageNum: number = 1,
    append: boolean = false,
  ) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `/api/sessions/list?page=${pageNum}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(searchQuery)}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch sessions: ${response.statusText}`);
      }

      const data = await response.json();

      if (append) {
        setSessions((prev) => [...prev, ...data.sessions]);
      } else {
        setSessions(data.sessions);
      }

      setHasMore(data.hasMore);
      setPage(pageNum);
    } catch (err) {
      console.error("Error fetching sessions:", err);
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchSessions(1, false);
  }, [searchQuery]);

  // Handle session click
  const handleSessionClick = (sessionId: number) => {
    if (onSessionSelect) {
      onSessionSelect(sessionId);
    } else {
      router.push(`/analysis/${sessionId}`);
    }
  };

  // Load more sessions
  const handleLoadMore = () => {
    if (!isLoading && hasMore) {
      fetchSessions(page + 1, true);
    }
  };

  // Format date/time
  const formatDateTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  // Status badge styling
  const getStatusBadge = (status: AnalysisSession["status"]) => {
    switch (status) {
      case "draft":
        return <Badge variant="outline">📝 Draft</Badge>;
      case "processing":
        return <Badge variant="secondary">⏳ Processing</Badge>;
      case "complete":
        return <Badge variant="default">✅ Complete</Badge>;
      case "error":
        return <Badge variant="destructive">❌ Error</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Search Input */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Sessions List */}
      <ScrollArea className="flex-1">
        <div className="space-y-2">
          {isLoading && sessions.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-sm">No analysis sessions found</p>
              <p className="text-xs mt-1">Upload a document to get started</p>
            </div>
          ) : (
            <>
              {sessions.map((session, index) => (
                <div key={session.id}>
                  <button
                    onClick={() => handleSessionClick(session.id)}
                    className="w-full text-left p-3 rounded-md hover:bg-white dark:hover:bg-white transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="h-4 w-4 flex-shrink-0 text-gray-300 group-hover:text-gray-900" />
                          <span className="text-sm font-medium truncate text-gray-300 group-hover:text-gray-900">
                            {session.title || "Untitled Document"}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{formatDateTime(session.createdAt)}</span>
                        </div>

                        {session.documentType && (
                          <div className="mt-1">
                            <Badge variant="outline" className="text-xs">
                              {session.documentType.replace(/_/g, " ")}
                            </Badge>
                          </div>
                        )}

                        {session.jurisdiction && (
                          <div className="mt-1 text-xs text-muted-foreground truncate">
                            📍 {session.jurisdiction}
                          </div>
                        )}
                      </div>

                      <div className="flex-shrink-0">
                        {getStatusBadge(session.status)}
                      </div>
                    </div>
                  </button>
                  {index < sessions.length - 1 && (
                    <Separator className="my-2" />
                  )}
                </div>
              ))}

              {/* Load More Button */}
              {hasMore && (
                <Button
                  variant="outline"
                  className="w-full mt-4"
                  onClick={handleLoadMore}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Load More"
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Session Count */}
      {sessions.length > 0 && (
        <div className="text-xs text-muted-foreground text-center pt-2 border-t">
          Showing {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          {hasMore && " • More available"}
        </div>
      )}
    </div>
  );
}
