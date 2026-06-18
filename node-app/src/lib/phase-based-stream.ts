export async function executePhaseBasedAnalysis(
  _sessionId: unknown,
  _sessionOrigin: unknown,
  _req: unknown,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  ..._rest: unknown[]
): Promise<void> {
  controller.enqueue(
    encoder.encode(
      "Phase-based execution is currently unavailable in this build. Falling back to step-based mode is recommended.\n",
    ),
  );
  controller.close();
}