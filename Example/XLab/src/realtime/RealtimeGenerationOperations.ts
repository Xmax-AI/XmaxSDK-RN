/**
 * Owns screen-level reference preparation and cancellation. Generation requests are
 * submitted immediately; the SDK replaces pending generation and owns resource cleanup.
 */
export class RealtimeGenerationOperations {
  private controller: AbortController | null = null;
  private readonly pending = new Set<Promise<void>>();
  private cleanup: Promise<void> | null = null;

  constructor(private readonly disconnect: () => Promise<void>) {}

  /** Replaces pending reference preparation and submits the latest generation intent. */
  run(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const cleanup = this.cleanup;
    const operation = (async () => {
      // A user-requested stop must finish before accepting another start.
      if (cleanup) await cleanup;
      if (controller.signal.aborted) return;
      try {
        await action(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      }
    })().finally(() => {
      this.pending.delete(operation);
      if (this.controller === controller) this.controller = null;
    });
    this.pending.add(operation);
    return operation;
  }

  /** Cancels preparation and asks the SDK to disconnect or close immediately. */
  cancel(cleanup = this.disconnect): Promise<void> {
    this.controller?.abort();
    this.controller = null;
    const pending = [...this.pending];
    const cleaning = Promise.resolve().then(cleanup);
    const result = Promise.allSettled(pending).then(() => cleaning);
    // Observe cleanup rejection immediately while independent preparation settles.
    void cleaning.catch(() => {});
    const completion = result.finally(() => {
      if (this.cleanup === completion) this.cleanup = null;
    });
    this.cleanup = completion;
    return completion;
  }
}
