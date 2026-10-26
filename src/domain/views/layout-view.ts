import type { LabelSide } from '../diagram/utils/labels.js';
import type { LayoutMetrics } from '../diagram/utils/problems.js';
import type { SwatchName } from '../diagram/utils/colors.js';

/**
 * A frame of the drawing (`show --layout`): its flow nodes as rows clustered by centre y, rows
 * top to bottom and each left to right; boundary events are left out.
 */
export interface LayoutGroup {
  id: string;
  kind: 'process' | 'collaboration' | 'participant' | 'lane' | 'subProcess';
  name?: string;
  parent?: string;
  rows: string[][];
  /** the diagram column of every node of `rows`, so x order compares across lanes and pools */
  columns: number[][];
  /**
   * per row: the nodes a wide empty gap lies before; such a row holds unrelated clusters
   * that merely share a y
   */
  gaps?: Array<{ row: number; before: number[] }>;
}

export interface LayoutGap {
  after: number;
  width: number;
}

export interface LayoutDiagram {
  id: string;
  root: string;
  columns: number;
  /** strips wider than one column of the drawing: room `compact` can close */
  gaps: LayoutGap[];
  groups: LayoutGroup[];
}

export interface LayoutColor {
  id: string;
  color: SwatchName | 'custom';
  fill?: string;
  stroke?: string;
}

export interface LayoutLabel {
  id: string;
  side: LabelSide | 'inside';
  default: LabelSide;
}

export interface LayoutView {
  diagrams: LayoutDiagram[];
  colors: LayoutColor[];
  labels: LayoutLabel[];
  metrics: LayoutMetrics;
}

/** A column of a plane (`show --layout`'s c<index>): its flow nodes and their x extent. */
export interface PlaneColumn {
  index: number;
  ids: string[];
  x0: number;
  x1: number;
}
