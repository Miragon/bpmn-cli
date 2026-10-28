/** The engine's default shape sizes and gaps, shared by both layout engines. */
import { is, type El } from '../../document/utils/moddle.js';
import { raw } from './raw.js';

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

export function defaultSizeOf(el: El): { width: number; height: number } {
  if (is(el, 'bpmn:Event')) return { ...SIZES.event };
  if (is(el, 'bpmn:Gateway')) return { ...SIZES.gateway };
  if (is(el, 'bpmn:DataObjectReference')) return { ...SIZES.dataObject };
  if (is(el, 'bpmn:DataStoreReference')) return { ...SIZES.dataStore };
  if (is(el, 'bpmn:TextAnnotation')) return annotationSize(raw<string>(el, 'text'));
  return { ...SIZES.task };
}

export function annotationSize(text: string | undefined): { width: number; height: number } {
  const len = (text ?? '').length;
  const width = Math.min(300, Math.max(100, Math.ceil((len * 6.5 + 24) / 20) * 20));
  const lines = Math.max(1, Math.ceil((len * 6.5) / (width - 14)));
  return { width, height: Math.max(30, lines * 14 + 12) };
}
