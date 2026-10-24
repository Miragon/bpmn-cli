/**
 * The layout problem kinds, their weights and the comparison of two
 * measurements (src/diagram/LayoutAnalysis.ts measures).
 */
/** structural defects the regression harness does not measure (see contract) */
export const EXTRA_KEYS = ['frameIntrusion', 'frameOverlap', 'degenerateEdge', 'detachedEdge'] as const;

/** soft drawing-quality kinds the regression harness does not measure (see contract) */
export const QUALITY_KEYS = ['backwardFlow', 'segmentOverlap', 'labelOutsideFrame', 'labelOnTitle', 'messageLabelFar'] as const;

export const KEYS = [
  'crossings',
  'overlaps',
  'frameIntrusion',
  'frameOverlap',
  'through',
  'diagonal',
  'degenerateEdge',
  'detachedEdge',
  'missing',
  'labelClash',
  'labelOnLine',
  'inOut',
  'parallelRun',
  'outsideLane',
  'outsidePool',
  'outsideSub',
  'edgeLeavesLane',
  'edgeOutside',
  'msgThroughPool',
  'laneGap',
  'backwardFlow',
  'segmentOverlap',
  'labelOutsideFrame',
  'labelOnTitle',
  'messageLabelFar',
  'failed',
] as const;

export type MetricKey = (typeof KEYS)[number];

/** the kinds of the regression harness (tools/layout-regress.mjs), in its order */
export const HARNESS_KEYS: readonly MetricKey[] = KEYS.filter((k) => !(EXTRA_KEYS as readonly string[]).includes(k) && !(QUALITY_KEYS as readonly string[]).includes(k));

export const WEIGHTS: Readonly<Record<MetricKey, number>> = {
  crossings: 5,
  overlaps: 10,
  frameIntrusion: 10,
  frameOverlap: 10,
  through: 8,
  diagonal: 3,
  degenerateEdge: 10,
  detachedEdge: 10,
  missing: 10,
  labelClash: 2,
  labelOnLine: 1,
  inOut: 3,
  parallelRun: 1,
  outsideLane: 6,
  outsidePool: 8,
  outsideSub: 8,
  edgeLeavesLane: 1,
  edgeOutside: 4,
  msgThroughPool: 5,
  laneGap: 2,
  backwardFlow: 3,
  segmentOverlap: 2,
  labelOutsideFrame: 2,
  labelOnTitle: 2,
  messageLabelFar: 1,
  failed: 50,
};

/** A hard layout defect: weighted like an outside-lane node or more (import warnings aside). */
export const isHardProblem = (p: LayoutProblem): boolean => p.kind !== 'failed' && WEIGHTS[p.kind] >= 6;

/** Where a problem shows in the drawing (locateProblems). */
export interface ProblemLocation {
  /** the element whose plane it is on: process, collaboration or collapsed sub-process */
  plane: string;
  x: number;
  y: number;
}

export interface LayoutProblem {
  kind: MetricKey;
  ids: string[];
  detail?: string;
  /** only from locateProblems: where it shows (see contract) */
  at?: ProblemLocation;
}

export interface LayoutMetrics {
  counts: Record<MetricKey, number>;
  problems: LayoutProblem[];
  score: number;
}

export interface MetricsSummary {
  counts: Record<MetricKey, number>;
  score: number;
}

/** The `layout.metrics` block of a mutation result. */
export interface MetricsDelta {
  before?: MetricsSummary;
  after: MetricsSummary;
  added: LayoutProblem[];
  resolved: LayoutProblem[];
}

export function perKey<T>(make: () => T): Record<MetricKey, T> {
  return Object.fromEntries(KEYS.map((k) => [k, make()])) as Record<MetricKey, T>;
}

export function scoreOf(counts: Record<MetricKey, number>): number {
  return KEYS.reduce((sum, k) => sum + counts[k] * WEIGHTS[k], 0);
}

/** kinds whose ids form an unordered pair */
const SYMMETRIC = new Set<MetricKey>(['crossings', 'overlaps', 'frameOverlap', 'parallelRun', 'segmentOverlap']);

/** kinds whose detail is a measurement, not part of the identity */
const MEASURED = new Set<MetricKey>(['parallelRun', 'segmentOverlap', 'messageLabelFar']);

/** Identity of a problem across two measurements of the same model. */
export function problemKey(p: LayoutProblem): string {
  const unordered = SYMMETRIC.has(p.kind) || (p.kind === 'labelClash' && p.detail === 'label on label');
  const ids = unordered ? [...p.ids].sort() : p.ids;
  const detail = p.detail !== undefined && !MEASURED.has(p.kind) ? `#${p.detail}` : '';
  return `${p.kind}:${ids.join(',')}${detail}`;
}

function unmatched(list: readonly LayoutProblem[], other: readonly LayoutProblem[]): LayoutProblem[] {
  const pool = new Map<string, number>();
  for (const p of other) pool.set(problemKey(p), (pool.get(problemKey(p)) ?? 0) + 1);
  return list.filter((p) => {
    const k = problemKey(p);
    const n = pool.get(k) ?? 0;
    if (n === 0) return true;
    pool.set(k, n - 1);
    return false;
  });
}

/** Problems that appeared (`added`) and disappeared (`resolved`) between two measurements. */
export function diffProblems(before: readonly LayoutProblem[], after: readonly LayoutProblem[]): { added: LayoutProblem[]; resolved: LayoutProblem[] } {
  return { added: unmatched(after, before), resolved: unmatched(before, after) };
}

/** `layout.metrics` of a mutation result; `before` is omitted when there was no diagram before. */
export function metricsDelta(before: LayoutMetrics | undefined, after: LayoutMetrics): MetricsDelta {
  const { added, resolved } = diffProblems(before?.problems ?? [], after.problems);
  return {
    ...(before ? { before: { counts: before.counts, score: before.score } } : {}),
    after: { counts: after.counts, score: after.score },
    added,
    resolved,
  };
}
