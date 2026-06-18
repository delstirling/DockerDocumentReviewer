"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DollarSign,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

interface ModelUsage {
  name: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: string;
}

interface SessionExpense {
  id: number;
  sessionId: number;
  username: string | null;
  sessionStartTime: string | null;
  sessionCompletionTime: string | null;
  models: ModelUsage[];
  totalCostUsd: string;
  tavilyCreditsUsed: number;
  tavilyCostUsd: string;
  grandTotalCostUsd: string;
}

interface ExpensesResponse {
  expenses: SessionExpense[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export function SessionExpenses() {
  const [expenses, setExpenses] = useState<SessionExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false,
  });

  const fetchExpenses = useCallback(
    async (offset = 0) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/organization/expenses?limit=${pagination.limit}&offset=${offset}`,
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch expenses");
        }

        const data: ExpensesResponse = await response.json();
        setExpenses(data.expenses);
        setPagination(data.pagination);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch expenses",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [pagination.limit],
  );

  useEffect(() => {
    fetchExpenses(0);
  }, [fetchExpenses]);

  const handleRefresh = () => {
    fetchExpenses(pagination.offset);
  };

  const handlePrevPage = () => {
    const newOffset = Math.max(0, pagination.offset - pagination.limit);
    fetchExpenses(newOffset);
  };

  const handleNextPage = () => {
    if (pagination.hasMore) {
      fetchExpenses(pagination.offset + pagination.limit);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString();
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(2)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  const formatCost = (cost: string) => {
    const numCost = parseFloat(cost);
    if (isNaN(numCost)) return "$0.00";
    return `$${numCost.toFixed(4)}`;
  };

  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Session Expenses
            </CardTitle>
            <CardDescription>
              Token usage and costs per analysis session, organized by
              completion time
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading && expenses.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading expenses...
          </div>
        ) : expenses.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No session expenses recorded yet. Expenses will appear here after
            analysis sessions complete.
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Completion Time</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Input Tokens</TableHead>
                  <TableHead className="text-right">Output Tokens</TableHead>
                  <TableHead className="text-right">Cache Created</TableHead>
                  <TableHead className="text-right">Cache Read</TableHead>
                  <TableHead className="text-right">AI Cost</TableHead>
                  <TableHead className="text-right">Tavily Credits</TableHead>
                  <TableHead className="text-right">Tavily Cost</TableHead>
                  <TableHead className="text-right">Grand Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => {
                  const hasMultipleModels = expense.models.length > 1;

                  return expense.models.length > 0 ? (
                    expense.models.map((model, modelIndex) => (
                      <TableRow key={`${expense.id}-${modelIndex}`}>
                        {modelIndex === 0 && (
                          <>
                            <TableCell rowSpan={expense.models.length}>
                              <Link
                                href={`/analysis/${expense.sessionId}`}
                                className="text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 font-mono text-xs"
                                title={String(expense.sessionId)}
                              >
                                {String(expense.sessionId)}
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            </TableCell>
                            <TableCell rowSpan={expense.models.length}>
                              {formatDate(expense.sessionCompletionTime)}
                            </TableCell>
                            <TableCell rowSpan={expense.models.length}>
                              {formatDate(expense.sessionStartTime)}
                            </TableCell>
                            <TableCell rowSpan={expense.models.length}>
                              {expense.username || "Unknown"}
                            </TableCell>
                          </>
                        )}
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="font-mono text-xs"
                          >
                            {model.name || "Unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatTokens(model.inputTokens)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatTokens(model.outputTokens)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatTokens(model.cacheCreationTokens)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatTokens(model.cacheReadTokens)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCost(model.costUsd)}
                        </TableCell>
                        {modelIndex === 0 && (
                          <>
                            <TableCell
                              rowSpan={expense.models.length}
                              className="text-right font-mono"
                            >
                              {expense.tavilyCreditsUsed || 0}
                            </TableCell>
                            <TableCell
                              rowSpan={expense.models.length}
                              className="text-right font-mono"
                            >
                              {formatCost(expense.tavilyCostUsd)}
                            </TableCell>
                            <TableCell
                              rowSpan={expense.models.length}
                              className="text-right font-mono font-semibold"
                            >
                              {formatCost(
                                expense.grandTotalCostUsd ||
                                  expense.totalCostUsd,
                              )}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow key={expense.id}>
                      <TableCell>
                        <Link
                          href={`/analysis/${expense.sessionId}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 font-mono text-xs"
                          title={String(expense.sessionId)}
                        >
                          {String(expense.sessionId)}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </TableCell>
                      <TableCell>
                        {formatDate(expense.sessionCompletionTime)}
                      </TableCell>
                      <TableCell>
                        {formatDate(expense.sessionStartTime)}
                      </TableCell>
                      <TableCell>{expense.username || "Unknown"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">No model data</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">-</TableCell>
                      <TableCell className="text-right font-mono">-</TableCell>
                      <TableCell className="text-right font-mono">-</TableCell>
                      <TableCell className="text-right font-mono">-</TableCell>
                      <TableCell className="text-right font-mono">-</TableCell>
                      <TableCell className="text-right font-mono">
                        {expense.tavilyCreditsUsed || 0}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCost(expense.tavilyCostUsd)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCost(
                          expense.grandTotalCostUsd || expense.totalCostUsd,
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Showing {pagination.offset + 1} to{" "}
                {Math.min(
                  pagination.offset + expenses.length,
                  pagination.total,
                )}{" "}
                of {pagination.total} sessions
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrevPage}
                  disabled={pagination.offset === 0 || isLoading}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages || 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={!pagination.hasMore || isLoading}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
