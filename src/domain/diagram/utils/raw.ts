/**
 * Raw property access on moddle objects: never through `get()`, which would
 * materialise an empty collection on the model.
 */
import type { El } from '../../document/utils/moddle.js';
import type { Box } from './geom.js';

export function raw<TValue>(el: unknown, prop: string): TValue | undefined {
  return el && typeof el === 'object' ? ((el as Record<string, unknown>)[prop] as TValue | undefined) : undefined;
}

export const rawList = (el: unknown, prop: string): El[] => raw<El[]>(el, prop) ?? [];

export const idOf = (el: unknown): string | undefined => raw<string>(el, 'id');

/** The Box of a dc:Bounds; undefined when a coordinate is missing or not finite. */
export function boxOf(bounds: unknown): Box | undefined {
  if (!bounds) return undefined;
  const box = { x: raw<number>(bounds, 'x'), y: raw<number>(bounds, 'y'), width: raw<number>(bounds, 'width'), height: raw<number>(bounds, 'height') };
  if ([box.x, box.y, box.width, box.height].some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))) return undefined;
  return box as Box;
}
