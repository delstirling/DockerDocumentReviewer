export interface ProgressUpdate {
  sessionId: string;
  currentStep: number;
  totalSteps: number;
  status: string;
  progressPercentage: number;
  timestamp: number;
  message?: string;
}
