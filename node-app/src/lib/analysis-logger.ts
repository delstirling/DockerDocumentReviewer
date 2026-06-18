type LogPayload = Record<string, unknown>;

function log(event: string, payload: LogPayload): void {
  console.log(`[AnalysisLogger] ${event}`, payload);
}

export function redactToolArgs(input: unknown): unknown {
  return input;
}

export function redactToolResult(input: unknown): unknown {
  return input;
}

export class AnalysisLogger {
  constructor(
    private readonly sessionId: unknown,
    private readonly chunkId: string,
    private readonly continuationCount: number,
  ) {
    log("init", { sessionId, chunkId, continuationCount });
  }

  requestStart(payload: LogPayload): void {
    log("requestStart", payload);
  }

  preStepGateDecision(payload: LogPayload): void {
    log("preStepGateDecision", payload);
  }

  progressUpdate(payload: LogPayload): void {
    log("progressUpdate", payload);
  }

  setStepIndex(stepIndex: number): void {
    log("setStepIndex", { stepIndex });
  }

  stepStart(payload: LogPayload): void {
    log("stepStart", payload);
  }

  modelStart(payload: LogPayload): void {
    log("modelStart", payload);
  }

  modelFinish(payload: LogPayload): void {
    log("modelFinish", payload);
  }

  toolError(payload: LogPayload): void {
    log("toolError", payload);
  }

  toolFinish(payload: LogPayload): void {
    log("toolFinish", payload);
  }

  stepFinish(payload: LogPayload): void {
    log("stepFinish", payload);
  }

  analysisError(payload: LogPayload): void {
    log("analysisError", payload);
  }

  streamEnd(payload: LogPayload): void {
    log("streamEnd", payload);
  }

  hardStopTrigger(payload: LogPayload): void {
    log("hardStopTrigger", payload);
  }

  suspectSilentFailure(payload: LogPayload): void {
    log("suspectSilentFailure", payload);
  }
}
