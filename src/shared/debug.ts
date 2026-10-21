/**
 * Diagnostic lines of the layout engines (placement candidates, reroute
 * reasons, strip closing, row assignment, separation moves), for whoever
 * debugs a drawing.
 *
 * The core never reads the environment (it also runs in the browser): a
 * caller switches the lines on with a sink. `setLayoutDebug(sink)` sets one
 * for the whole process (the CLI does that when BPMN_LAYOUT_DEBUG is set and
 * writes the lines to stderr); `withLayoutDebug(sink, fn)` adds one for the
 * duration of one call (the `debug` option of the in-memory API and of
 * MutationOptions). Every active sink receives every line, so the lines of
 * calls that run at the same time can interleave.
 *
 * Call sites build their line only when someone listens:
 *
 *   if (layoutDebugOn()) layoutDebug(`[place] ...`);
 */

/** Receives one diagnostic line (no trailing newline), e.g. `[route] Flow_3: source moved`. */
export type DebugSink = (line: string) => void;

let processSink: DebugSink | undefined;
const callSinks = new Set<DebugSink>();

/** Sets (or, without an argument, clears) the process-wide sink. */
export function setLayoutDebug(sink?: DebugSink): void {
  processSink = sink;
}

/** True when a sink listens: build the line only then. */
export function layoutDebugOn(): boolean {
  return processSink !== undefined || callSinks.size > 0;
}

/** Sends a line to every active sink. */
export function layoutDebug(line: string): void {
  processSink?.(line);
  for (const sink of callSinks) sink(line);
}

/** Runs `fn` with `sink` active (no-op without a sink); the sink is removed afterwards, also on failure. */
export async function withLayoutDebug<T>(sink: DebugSink | undefined, fn: () => Promise<T>): Promise<T> {
  if (!sink) return fn();
  // a wrapper per call: the same function passed by two overlapping calls stays active until both are done
  const own: DebugSink = (line) => sink(line);
  callSinks.add(own);
  try {
    return await fn();
  } finally {
    callSinks.delete(own);
  }
}
