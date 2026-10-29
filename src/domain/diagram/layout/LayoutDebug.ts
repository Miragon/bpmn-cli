/** One line without trailing newline, e.g. `[route] flow_aToB: source moved`. */
export type DebugSink = (line: string) => void;

/**
 * Diagnostic lines of the layout engines. The core never reads the environment (it also runs in
 * the browser), so callers switch them on with a sink, process-wide or for one call.
 * Lines of concurrent calls can interleave.
 */
export class LayoutDebug {
  private static processSink: DebugSink | undefined;
  private static readonly callSinks = new Set<DebugSink>();

  static setProcessSink(sink?: DebugSink): void {
    LayoutDebug.processSink = sink;
  }

  /** Build the line only when this is true. */
  static on(): boolean {
    return LayoutDebug.processSink !== undefined || LayoutDebug.callSinks.size > 0;
  }

  static log(line: string): void {
    LayoutDebug.processSink?.(line);
    for (const sink of LayoutDebug.callSinks) {
      sink(line);
    }
  }

  /**
   * Routes the log to `sink` while `fn` runs; a wrapper per call keeps a sink shared by two
   * overlapping calls active until both are done.
   */
  static async during<TResult>(sink: DebugSink | undefined, fn: () => Promise<TResult>): Promise<TResult> {
    if (!sink) return fn();
    const own: DebugSink = (line) => sink(line);
    LayoutDebug.callSinks.add(own);
    try {
      return await fn();
    } finally {
      LayoutDebug.callSinks.delete(own);
    }
  }
}
