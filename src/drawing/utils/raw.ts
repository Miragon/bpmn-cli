/**
 * Raw property access on moddle objects: never through `get()`, which would
 * materialise an empty collection on the model.
 */
import type { El } from '../../model/utils/moddle.js';
import type { Box } from './geom.js';

export function raw<T>(el: unknown, prop: string): T | undefined {
  return el && typeof el === 'object' ? ((el as Record<string, unknown>)[prop] as T | undefined) : undefined;
}

export const rawList = (el: unknown, prop: string): El[] => raw<El[]>(el, prop) ?? [];

export const idOf = (el: unknown): string | undefined => raw<string>(el, 'id');

/** The Box of a dc:Bounds; undefined when a coordinate is missing or not finite. */
export function boxOf(bounds: unknown): Box | undefined {
  if (!bounds) return undefined;
  const b = { x: raw<number>(bounds, 'x'), y: raw<number>(bounds, 'y'), width: raw<number>(bounds, 'width'), height: raw<number>(bounds, 'height') };
  if ([b.x, b.y, b.width, b.height].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return undefined;
  return b as Box;
}
