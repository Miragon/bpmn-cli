import type { Box, GArtifact, GEdge, GNode, LaneBandInfo, Point, ScopeLayout } from '../../di/types.js';

type SavedShape = { node: GNode; layer: number; row: number; band: number; width: number; box: Box; topUsed: boolean | undefined; onTop: boolean | undefined; labelLeft: boolean | undefined };
type SavedEdge = { edge: GEdge; bandRow: number | undefined; bandY: number | undefined; points: Point[]; label: Box | undefined; runsBelow: boolean | undefined; runsAbove: boolean | undefined };
type SavedLink = { compensation: ScopeLayout['compensations'][number]; points: Point[] };

/**
 * Saves what arranging and routing set on a scope so a rejected trial can be undone exactly.
 * restore() works once.
 */
export class ArrangementCheckpoint {
  private readonly shapes: SavedShape[];
  private readonly edges: SavedEdge[];
  private readonly artifacts: Array<{ artifact: GArtifact; box: Box }>;
  private readonly compensations: SavedLink[];
  private readonly width: number;
  private readonly height: number;
  private readonly laneBands: LaneBandInfo[] | undefined;

  constructor(private readonly layout: ScopeLayout) {
    this.shapes = layout.nodes.flatMap((node) => [node, ...node.boundary]).map((shape) => ({ node: shape, layer: shape.layer, row: shape.row, band: shape.band, width: shape.width, box: { ...shape.box }, topUsed: shape.topUsed, onTop: shape.onTop, labelLeft: shape.labelLeft }));
    this.edges = layout.edges.map((edge) => ({ edge, bandRow: edge.bandRow, bandY: edge.bandY, points: edge.points.map((point) => ({ ...point })), label: edge.label && { ...edge.label }, runsBelow: edge.runsBelow, runsAbove: edge.runsAbove }));
    this.artifacts = layout.artifacts.map((artifact) => ({ artifact, box: { ...artifact.box } }));
    this.compensations = layout.compensations.map((compensation) => ({ compensation, points: compensation.points.map((point) => ({ ...point })) }));
    this.width = layout.width;
    this.height = layout.height;
    this.laneBands = layout.laneBands?.map((band) => ({ ...band }));
  }

  restore(): void {
    const { layout } = this;
    // deleting a property slows every later access to the object: missing ones get undefined
    for (const saved of this.shapes) {
      Object.assign(saved.node, { layer: saved.layer, row: saved.row, band: saved.band, width: saved.width, box: saved.box, topUsed: saved.topUsed });
      if (saved.node.onTop !== saved.onTop) saved.node.onTop = saved.onTop;
      if (saved.node.labelLeft !== saved.labelLeft) saved.node.labelLeft = saved.labelLeft;
    }
    for (const saved of this.edges) {
      Object.assign(saved.edge, { points: saved.points, label: saved.label, runsBelow: saved.runsBelow, runsAbove: saved.runsAbove });
      if (saved.bandRow === undefined) delete saved.edge.bandRow;
      else saved.edge.bandRow = saved.bandRow;
      if (saved.bandY === undefined) delete saved.edge.bandY;
      else saved.edge.bandY = saved.bandY;
    }
    for (const saved of this.artifacts) saved.artifact.box = saved.box;
    for (const saved of this.compensations) saved.compensation.points = saved.points;
    layout.width = this.width;
    layout.height = this.height;
    layout.laneBands = this.laneBands;
  }
}
