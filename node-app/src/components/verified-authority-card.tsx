"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";

interface VerifiedAuthorityCardProps {
  citation: string;
  url: string;
  verified: boolean;
  fallback_flag?: boolean;
  confidence_score?: number;
  note?: string;
}

export function VerifiedAuthorityCard({
  citation,
  url,
  verified,
  fallback_flag = false,
  confidence_score = 0,
  note,
}: VerifiedAuthorityCardProps) {
  const getStatusBadge = () => {
    if (verified) {
      return (
        <Badge variant="default" className="bg-green-600">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Verified
        </Badge>
      );
    } else if (fallback_flag) {
      return (
        <Badge variant="secondary">
          <AlertCircle className="mr-1 h-3 w-3" />
          Non-Searchable
        </Badge>
      );
    } else {
      return (
        <Badge variant="destructive">
          <AlertCircle className="mr-1 h-3 w-3" />
          Not Verified
        </Badge>
      );
    }
  };

  const getConfidenceColor = () => {
    if (confidence_score >= 0.9) return "text-green-600";
    if (confidence_score >= 0.7) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base font-medium">{citation}</CardTitle>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <ExternalLink className="h-4 w-4 text-muted-foreground" />
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline break-all"
          >
            {url}
          </a>
        </div>

        {verified && confidence_score > 0 && (
          <div className="text-sm">
            <span className="text-muted-foreground">Confidence: </span>
            <span className={`font-medium ${getConfidenceColor()}`}>
              {Math.round(confidence_score * 100)}%
            </span>
          </div>
        )}

        {note && (
          <div className="text-sm text-muted-foreground bg-muted p-2 rounded">
            {note}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
