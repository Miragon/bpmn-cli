/**
 * The engine's default sizes and gaps of shapes, shared by both layout engines.
 */
export interface LayoutGaps {
  hGap: number;
  vGap: number;
  loopGap: number;
  boundaryOffset: number;
}

export const METRICS: LayoutGaps = {
  hGap: 60,
  vGap: 60,
  loopGap: 30,
  boundaryOffset: 25,
};

export const SIZES = {
  task: { width: 100, height: 80 },
  event: { width: 36, height: 36 },
  gateway: { width: 50, height: 50 },
  dataObject: { width: 36, height: 50 },
  dataStore: { width: 50, height: 50 },
  subProcessPadding: { top: 45, right: 30, bottom: 30, left: 30 },
  subProcessMin: { width: 200, height: 120 },
  participantHeader: 30,
  laneHeader: 30,
  lanePadding: 30,
  blackBoxHeight: 60,
  poolGap: 80,
  outerMargin: 80,
} as const;


export function annotationSize(text: string | undefined): { width: number; height: number } {
  const len = (text ?? '').length;
  const width = Math.min(300, Math.max(100, Math.ceil((len * 6.5 + 24) / 20) * 20));
  const lines = Math.max(1, Math.ceil((len * 6.5) / (width - 14)));
  return { width, height: Math.max(30, lines * 14 + 12) };
}
