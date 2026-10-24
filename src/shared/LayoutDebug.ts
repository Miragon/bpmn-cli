/**
 * Diagnostic lines of the layout engines (placement candidates, reroute
 * reasons, strip closing, row assignment, separation moves), for whoever
 * debugs a drawing.
 *
 * The core never reads the environment (it also runs in the browser): a
 * caller switches the lines on with a sink. `LayoutDebug.setProcessSink(sink)`
 * sets one for the whole process (the CLI does that when BPMN_LAYOUT_DEBUG is
 * set and writes the lines to stderr); `LayoutDebug.during(sink, fn)` adds one
 * for the duration of one call (the `debug` option of the in-memory API and of
 * MutationOptions). Every active sink receives every line, so the lines of
 * calls that run at the same time can interleave.
 *
 * Call sites build their line only when someone listens:
 *
 *   if (LayoutDebug.on()) LayoutDebug.log(`[place] ...`);
 */

/** Receives one diagnostic line (no trailing newline), e.g. `[route] Flow_3: source moved`. */
export type DebugSink = (line: string) => void;

export class LayoutDebug {
  private static processSink: DebugSink | undefined;
  private static readonly callSinks = new Set<DebugSink>();

  /** Sets (or, without an argument, clears) the process-wide sink. */
  static setProcessSink(sink?: DebugSink): void {
    LayoutDebug.processSink = sink;
  }

  /** True when a sink listens: build the line only then. */
  static on(): boolean {
    return LayoutDebug.processSink !== undefined || LayoutDebug.callSinks.size > 0;
  }

  /** Sends a line to every active sink. */
  static log(line: string): void {
    LayoutDebug.processSink?.(line);
    for (const sink of LayoutDebug.callSinks) sink(line);
  }

  /** Runs `fn` with `sink` active (no-op without a sink); the sink is removed afterwards, also on failure. */
  static async during<T>(sink: DebugSink | undefined, fn: () => Promise<T>): Promise<T> {
    if (!sink) return fn();
    // a wrapper per call: the same function passed by two overlapping calls stays active until both are done
    const own: DebugSink = (line) => sink(line);
    LayoutDebug.callSinks.add(own);
    try {
      return await fn();
    } finally {
      LayoutDebug.callSinks.delete(own);
    }
  }
}
