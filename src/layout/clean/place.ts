import { is, type El } from '../../model/utils/moddle.js';
import { SIZES, type Box } from '../../diagram/types.js';

export function sizeOf(el: El): { width: number; height: number } {
  if (is(el, 'bpmn:Event')) return { ...SIZES.event };
  if (is(el, 'bpmn:Gateway')) return { ...SIZES.gateway };
  return { ...SIZES.task };
}

export function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function annotationSize(text: string | undefined): { width: number; height: number } {
  const len = (text ?? '').length;
  const width = Math.min(300, Math.max(100, Math.ceil((len * 6.5 + 24) / 20) * 20));
  const lines = Math.max(1, Math.ceil((len * 6.5) / (width - 14)));
  return { width, height: Math.max(30, lines * 14 + 12) };
}
