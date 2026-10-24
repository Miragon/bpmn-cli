/**
 * The drawing as an agent reads it, without coordinates: `bpmn show <file>
 * --layout`.
 *
 * CONTRACT
 *  LayoutViewBuilder(defs).build() returns, per diagram (BPMNPlane, document order):
 *   - groups: the frames of the drawing as a tree, in reading order (top to
 *     bottom, then left to right): the plane root (process, collaboration or
 *     collapsed sub-process), pools, lanes (nested lanes under their parent)
 *     and expanded sub-processes. Each group lists the flow nodes directly in
 *     it (boundary events follow their host and are left out) as rows: node
 *     ids clustered by centre y (same row when within max(5, row spacing / 4)
 *     of the row's first node, spacingOf), rows top to bottom, each row left
 *     to right. A node belongs to its expanded parent sub-process, else its
 *     lane, else its pool, else the root.
 *   - columns: the flow nodes of the whole diagram clustered by centre x
 *     (same column when within clamp(gap / 2, 10, 40) of the column's first
 *     node), numbered c0.. left to right; `columns` of a group gives the
 *     column of every node of its rows (same shape as `rows`), so x order
 *     can be compared across lanes and pools. `gaps` of the diagram are the
 *     wide empty strips between two neighbouring columns (free width more
 *     than one column of the drawing, median task width + 2 gaps: room
 *     `compact` can close), `gaps` of a group the places in its rows where
 *     two neighbours are that far apart (index of the node after the gap):
 *     such a row holds unrelated clusters that merely share a y.
 *   - colors: every coloured shape / edge with its swatch name (diagram/utils/colors.ts
 *     SWATCHES) or 'custom' plus the raw fill / stroke.
 *   - labels: external labels (events, gateways, data, flows) that are not on
 *     the default side (diagram/utils/labels.ts defaultLabelSide; flows: above), with the
 *     side they are on.
 *   - metrics: LayoutAnalysis.of(defs) (counts, score, problems with ids).
 *  Read-only.
 */
import type { LabelSide } from '../diagram/utils/labels.js';
import type { LayoutMetrics } from '../diagram/utils/problems.js';
import type { SwatchName } from '../diagram/utils/colors.js';

export interface LayoutGroup {
  /** the frame: plane root, participant, lane or expanded sub-process */
  id: string;
  kind: 'process' | 'collaboration' | 'participant' | 'lane' | 'subProcess';
  name?: string;
  /** the enclosing group */
  parent?: string;
  /** node ids per row: rows top to bottom, each left to right */
  rows: string[][];
  /** the diagram column (c0..) of every node of `rows`, same shape */
  columns: number[][];
  /** per row: indexes of the nodes a wide empty gap lies before (only rows that have one; omitted when none has) */
  gaps?: Array<{ row: number; before: number[] }>;
}

export interface LayoutGap {
  /** the gap lies between column `after` and column `after + 1` */
  after: number;
  /** free width in px */
  width: number;
}

export interface LayoutDiagram {
  /** BPMNPlane id */
  id: string;
  /** the element the diagram shows */
  root: string;
  /** number of columns (c0 .. c<columns - 1>) */
  columns: number;
  /** wide empty strips between neighbouring columns */
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
