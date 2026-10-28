import type { Box } from '../../../domain/diagram/utils/geom.js';
import type { LayoutProblem } from '../../../domain/diagram/utils/problems.js';
import type { Plane } from '../../../domain/diagram/di/types.js';
import type { El } from '../../../domain/document/utils/moddle.js';

/** A drawing that needs more tiles stays one image, with a note. */
export const MAX_TILES = 40;
/** Coordinates beyond this (or not a number) are broken DI and not drawn. */
export const COORD_LIMIT = 1_000_000;

export const MARGIN = 20;

export interface Item {
  box: Box;
  layer: number;
  svg: string;
  id?: string;
  /** drawn when in view, but the view is not made to fit them */
  extra?: boolean;
  /** fitted instead of `box`, e.g. a faded connection's first 40 px */
  fit?: Box;
  tile?: number;
  /** what makes a tile worth keeping; absent for connections, context and overlays */
  content?: Box;
}

export const LAYER = { participant: 0, lane: 1, subProcess: 2, leaf: 3, group: 4, boundary: 5, edge: 6, label: 7, badge: 8 } as const;

export interface RenderFrame {
  plane: string;
  planes: string[];
  notes: string[];
  located?: Plane;
  defs?: El;
  /** a file drawn in memory: its own layout problems, without badges */
  fileProblems?: LayoutProblem[];
  drawn?: Set<string>;
  nodes?: string[];
}
