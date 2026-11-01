export interface ProblemKindRecord {
  weight: number;
  symmetric?: boolean;
  measured?: boolean;
}

export type ProblemKind = keyof typeof ProblemKinds.RECORDS;

export class ProblemKinds {
  static readonly RECORDS = {
    crossings: { weight: 5, symmetric: true },
    overlaps: { weight: 10, symmetric: true },
    frameIntrusion: { weight: 10 },
    frameOverlap: { weight: 10, symmetric: true },
    through: { weight: 8 },
    diagonal: { weight: 3 },
    degenerateEdge: { weight: 10 },
    detachedEdge: { weight: 10 },
    missing: { weight: 10 },
    labelClash: { weight: 2 },
    labelOnLine: { weight: 1 },
    inOut: { weight: 3 },
    parallelRun: { weight: 1, symmetric: true, measured: true },
    outsideLane: { weight: 6 },
    outsidePool: { weight: 8 },
    outsideSub: { weight: 8 },
    edgeLeavesLane: { weight: 1 },
    edgeOutside: { weight: 4 },
    msgThroughPool: { weight: 5 },
    laneGap: { weight: 2 },
    backwardFlow: { weight: 3 },
    segmentOverlap: { weight: 2, symmetric: true, measured: true },
    labelOutsideFrame: { weight: 2 },
    labelOnTitle: { weight: 2 },
    messageLabelFar: { weight: 1, measured: true },
    failed: { weight: 50 },
  } as const satisfies Record<string, ProblemKindRecord>;

  static readonly ALL = Object.keys(ProblemKinds.RECORDS) as ProblemKind[];

  private static readonly HARD_WEIGHT = 6;

  static recordOf(kind: ProblemKind): ProblemKindRecord {
    return ProblemKinds.RECORDS[kind];
  }

  static isHard(kind: ProblemKind): boolean {
    return kind !== 'failed' && ProblemKinds.recordOf(kind).weight >= ProblemKinds.HARD_WEIGHT;
  }

  static perKind<TValue>(make: () => TValue): Record<ProblemKind, TValue> {
    return Object.fromEntries(ProblemKinds.ALL.map((kind) => [kind, make()])) as Record<ProblemKind, TValue>;
  }
}
