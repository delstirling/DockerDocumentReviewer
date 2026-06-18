"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";

const ANALYSIS_STEPS = [
  {
    id: 1,
    name: "Document Identification",
    description: "Classifying document type and jurisdiction",
  },
  {
    id: 2,
    name: "Document Fundamentals",
    description: "Reviewing formatting and structure",
  },
  {
    id: 3,
    name: "Party Information",
    description: "Verifying party details and standing",
  },
  {
    id: 4,
    name: "Factual Foundation",
    description: "Analyzing facts and evidence",
  },
  {
    id: 5,
    name: "Legal Authority",
    description: "Searching and reviewing applicable law",
  },
  {
    id: 6,
    name: "Legal Elements",
    description: "Evaluating claims and defenses",
  },
  { id: 7, name: "Relief Sought", description: "Analyzing requested remedies" },
  {
    id: 8,
    name: "Persuasive Effectiveness",
    description: "Reviewing argumentation quality",
  },
  {
    id: 9,
    name: "Ethical Considerations",
    description: "Checking professional conduct compliance",
  },
  {
    id: 10,
    name: "Document-Specific",
    description: "Verifying type-specific requirements",
  },
  {
    id: 11,
    name: "Technical Quality",
    description: "Reviewing citations and formatting",
  },
  {
    id: 12,
    name: "Comprehensive Evaluation",
    description: "Synthesizing findings",
  },
  { id: 13, name: "Final Report", description: "Generating compliance report" },
  { id: 14, name: "Paralegal Checklist", description: "Creating action items" },
];

export default function AnalysisProgress() {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < ANALYSIS_STEPS.length - 1) {
          return prev + 1;
        }
        return prev;
      });
      setProgress((prev) => {
        if (prev < 100) {
          return prev + 100 / ANALYSIS_STEPS.length;
        }
        return prev;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Analysis in Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Overall Progress</span>
              <span className="font-medium text-foreground">
                {Math.round(progress)}%
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <div className="space-y-3">
            {ANALYSIS_STEPS.map((step, index) => (
              <div
                key={step.id}
                className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                  index === currentStep
                    ? "bg-primary/10 border border-primary/20"
                    : index < currentStep
                      ? "bg-muted/50"
                      : "bg-background"
                }`}
              >
                <div className="mt-0.5">
                  {index < currentStep ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : index === currentStep ? (
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      index <= currentStep
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    Step {step.id}: {step.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
