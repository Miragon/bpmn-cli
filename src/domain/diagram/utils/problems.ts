/** Layout problem kinds, their weights and the comparison of two measurements. */
/** structural defects the regression harness does not measure, weighted like an overlap @internal */
export const EXTRA_KEYS = ['frameIntrusion', 'frameOverlap', 'degenerateEdge', 'detachedEdge'] as const;

/** soft kinds the harness does not measure; weights below 6, so they never count as hard @internal */
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

/** the regression harness's kinds, in its order @internal */
export const HARNESS_KEYS: readonly MetricKey[] = KEYS.filter((key) => !(EXTRA_KEYS as readonly string[]).includes(key) && !(QUALITY_KEYS as readonly string[]).includes(key));

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
export const isHardProblem = (problem: LayoutProblem): boolean => problem.kind !== 'failed' && WEIGHTS[problem.kind] >= 6;

export interface ProblemLocation {
  /** the element the plane shows */
  plane: string;
  x: number;
  y: number;
}

export interface LayoutProblem {
  kind: MetricKey;
  ids: string[];
  detail?: string;
  /** only from locateProblems */
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

export interface MetricsDelta {
  before?: MetricsSummary;
  after: MetricsSummary;
  added: LayoutProblem[];
  resolved: LayoutProblem[];
}

export function perKey<TValue>(make: () => TValue): Record<MetricKey, TValue> {
  return Object.fromEntries(KEYS.map((key) => [key, make()])) as Record<MetricKey, TValue>;
}

export function scoreOf(counts: Record<MetricKey, number>): number {
  return KEYS.reduce((sum, key) => sum + counts[key] * WEIGHTS[key], 0);
}

const SYMMETRIC = new Set<MetricKey>(['crossings', 'overlaps', 'frameOverlap', 'parallelRun', 'segmentOverlap']);

const MEASURED = new Set<MetricKey>(['parallelRun', 'segmentOverlap', 'messageLabelFar']);

/** Ids are order-free for symmetric kinds; a measured detail is no part of the identity. */
export function problemKey(problem: LayoutProblem): string {
  const unordered = SYMMETRIC.has(problem.kind) || (problem.kind === 'labelClash' && problem.detail === 'label on label');
  const ids = unordered ? [...problem.ids].sort() : problem.ids;
  const detail = problem.detail !== undefined && !MEASURED.has(problem.kind) ? `#${problem.detail}` : '';
  return `${problem.kind}:${ids.join(',')}${detail}`;
}

function unmatched(list: readonly LayoutProblem[], other: readonly LayoutProblem[]): LayoutProblem[] {
  const pool = new Map<string, number>();
  for (const problem of other) pool.set(problemKey(problem), (pool.get(problemKey(problem)) ?? 0) + 1);
  return list.filter((problem) => {
    const key = problemKey(problem);
    const count = pool.get(key) ?? 0;
    if (count === 0) return true;
    pool.set(key, count - 1);
    return false;
  });
}

/** Duplicates are matched one to one. */
export function diffProblems(before: readonly LayoutProblem[], after: readonly LayoutProblem[]): { added: LayoutProblem[]; resolved: LayoutProblem[] } {
  return { added: unmatched(after, before), resolved: unmatched(before, after) };
}

/** `before` is omitted when there was no diagram before. */
export function metricsDelta(before: LayoutMetrics | undefined, after: LayoutMetrics): MetricsDelta {
  const { added, resolved } = diffProblems(before?.problems ?? [], after.problems);
  return {
    ...(before ? { before: { counts: before.counts, score: before.score } } : {}),
    after: { counts: after.counts, score: after.score },
    added,
    resolved,
  };
}
