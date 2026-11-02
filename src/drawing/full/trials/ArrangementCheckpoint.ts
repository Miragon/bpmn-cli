import type { Box, Point } from '../../../model/index.js';
import type { GArtifact, GEdge, GNode, LaneBandInfo, ScopeLayout } from '../scopes/GNode.js';

type SavedShape = Pick<GNode, 'layer' | 'row' | 'band' | 'box' | 'topUsed' | 'onTop' | 'labelLeft'> & { node: GNode };
type SavedEdge = Pick<GEdge, 'bandRow' | 'bandY' | 'points' | 'label' | 'runsBelow' | 'runsAbove'> & { edge: GEdge };
type SavedLine = { compensation: ScopeLayout['compensations'][number]; points: Point[] };

export class ArrangementCheckpoint {
  private readonly shapes: SavedShape[];
  private readonly edges: SavedEdge[];
  private readonly artifacts: Array<{ artifact: GArtifact; box: Box }>;
  private readonly compensations: SavedLine[];
  private readonly width: number;
  private readonly height: number;
  private readonly laneBands: LaneBandInfo[] | undefined;

  constructor(private readonly layout: ScopeLayout) {
    this.shapes = layout.nodes.flatMap((node) => [node, ...node.boundary]).map((shape) => ({ node: shape, layer: shape.layer, row: shape.row, band: shape.band, box: shape.box.copy(), topUsed: shape.topUsed, onTop: shape.onTop, labelLeft: shape.labelLeft }));
    this.edges = layout.edges.map((edge) => ({ edge, bandRow: edge.bandRow, bandY: edge.bandY, points: edge.points.map((point) => point.copy()), label: edge.label?.copy(), runsBelow: edge.runsBelow, runsAbove: edge.runsAbove }));
    this.artifacts = layout.artifacts.map((artifact) => ({ artifact, box: artifact.box.copy() }));
    this.compensations = layout.compensations.map((compensation) => ({ compensation, points: compensation.points.map((point) => point.copy()) }));
    this.width = layout.width;
    this.height = layout.height;
    this.laneBands = layout.laneBands?.map((band) => ({ ...band }));
  }

  restore(): void {
    const { layout } = this;
    for (const { node, ...shape } of this.shapes) {
      Object.assign(node, shape);
    }
    for (const { edge, ...saved } of this.edges) {
      Object.assign(edge, saved);
    }
    for (const { artifact, box } of this.artifacts) {
      artifact.box = box;
    }
    for (const { compensation, points } of this.compensations) {
      compensation.points = points;
    }
    layout.width = this.width;
    layout.height = this.height;
    layout.laneBands = this.laneBands;
  }
}
