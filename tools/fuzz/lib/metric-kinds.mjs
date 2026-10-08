/**
 * Which layout problem kinds count as hard defects, derived from the metrics
 * library (src/diagram/metrics.ts, built to dist/diagram/metrics.js) so that a
 * kind added there later is picked up by the fuzzer, the benchmark and the
 * property test without touching them.
 *
 * Contract: `hardKinds(lib)` with `lib` = the metrics module (KEYS, WEIGHTS and
 * optionally an explicit hard list) returns the hard kinds in KEYS order:
 *  1. env BPMN_HARD_KINDS (comma-separated) wins, when set;
 *  2. else a list the library exports as HARD_KEYS or HARD_KINDS;
 *  3. else every kind whose weight is at least HARD_WEIGHT (6, the weight of
 *     outsideLane), except `failed` (import warnings, which the tools check on
 *     their own). On the 17 original kinds this is exactly overlaps, through,
 *     missing, outsideLane, outsidePool and outsideSub, the hard list of the
 *     2026-10 audit; a new kind is hard when the library weights it like one.
 * `newKinds(lib)` lists the kinds that are not among the 17 original ones (for
 * reports). Pure apart from reading the environment.
 */

export const HARD_WEIGHT = 6;

/** The kinds of tools/layout-regress.mjs when the tools were written. */
export const ORIGINAL_KINDS = Object.freeze([
  'crossings', 'overlaps', 'through', 'diagonal', 'missing', 'labelClash', 'labelOnLine', 'inOut', 'parallelRun',
  'outsideLane', 'outsidePool', 'outsideSub', 'edgeLeavesLane', 'edgeOutside', 'msgThroughPool', 'laneGap', 'failed',
]);

const listFrom = (value) => (Array.isArray(value) || value instanceof Set ? [...value].map(String) : undefined);

export function hardKinds(lib, env = process.env) {
  const keys = [...lib.KEYS];
  const fromEnv = env.BPMN_HARD_KINDS?.split(',').map((s) => s.trim()).filter(Boolean);
  if (fromEnv?.length) return fromEnv;
  const exported = listFrom(lib.HARD_KEYS) ?? listFrom(lib.HARD_KINDS);
  if (exported) return keys.filter((k) => exported.includes(k));
  return keys.filter((k) => k !== 'failed' && (lib.WEIGHTS[k] ?? 0) >= HARD_WEIGHT);
}

export function newKinds(lib) {
  return [...lib.KEYS].filter((k) => !ORIGINAL_KINDS.includes(k));
}

/** Counts of the given kinds in a `counts` record (missing kinds count 0). */
export function countKinds(counts, kinds) {
  return Object.fromEntries(kinds.map((k) => [k, counts?.[k] ?? 0]));
}
