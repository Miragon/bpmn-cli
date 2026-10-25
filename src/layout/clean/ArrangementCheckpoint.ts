import type { Box, GArtifact, GEdge, GNode, LaneBandInfo, Point, ScopeLayout } from '../../diagram/types.js';

type SavedShape = { n: GNode; layer: number; row: number; band: number; width: number; box: Box; topUsed: boolean | undefined; onTop: boolean | undefined; labelLeft: boolean | undefined };
type SavedEdge = { e: GEdge; bandRow: number | undefined; bandY: number | undefined; points: Point[]; label: Box | undefined; runsBelow: boolean | undefined; runsAbove: boolean | undefined };
type SavedLink = { c: ScopeLayout['compensations'][number]; points: Point[] };

/**
 * Saves what arranging and routing set on a scope so a rejected trial can be undone exactly.
 * restore() works once.
 */
export class ArrangementCheckpoint {
  private readonly shapes: SavedShape[];
  private readonly edges: SavedEdge[];
  private readonly artifacts: Array<{ a: GArtifact; box: Box }>;
  private readonly compensations: SavedLink[];
  private readonly width: number;
  private readonly height: number;
  private readonly laneBands: LaneBandInfo[] | undefined;

  constructor(private readonly layout: ScopeLayout) {
    this.shapes = layout.nodes.flatMap((n) => [n, ...n.boundary]).map((n) => ({ n, layer: n.layer, row: n.row, band: n.band, width: n.width, box: { ...n.box }, topUsed: n.topUsed, onTop: n.onTop, labelLeft: n.labelLeft }));
    this.edges = layout.edges.map((e) => ({ e, bandRow: e.bandRow, bandY: e.bandY, points: e.points.map((p) => ({ ...p })), label: e.label && { ...e.label }, runsBelow: e.runsBelow, runsAbove: e.runsAbove }));
    this.artifacts = layout.artifacts.map((a) => ({ a, box: { ...a.box } }));
    this.compensations = layout.compensations.map((c) => ({ c, points: c.points.map((p) => ({ ...p })) }));
    this.width = layout.width;
    this.height = layout.height;
    this.laneBands = layout.laneBands?.map((b) => ({ ...b }));
  }

  restore(): void {
    const { layout } = this;
    // deleting a property slows every later access to the object: missing ones get undefined
    for (const s of this.shapes) {
      Object.assign(s.n, { layer: s.layer, row: s.row, band: s.band, width: s.width, box: s.box, topUsed: s.topUsed });
      if (s.n.onTop !== s.onTop) s.n.onTop = s.onTop;
      if (s.n.labelLeft !== s.labelLeft) s.n.labelLeft = s.labelLeft;
    }
    for (const s of this.edges) {
      Object.assign(s.e, { points: s.points, label: s.label, runsBelow: s.runsBelow, runsAbove: s.runsAbove });
      if (s.bandRow === undefined) delete s.e.bandRow;
      else s.e.bandRow = s.bandRow;
      if (s.bandY === undefined) delete s.e.bandY;
      else s.e.bandY = s.bandY;
    }
    for (const s of this.artifacts) s.a.box = s.box;
    for (const s of this.compensations) s.c.points = s.points;
    layout.width = this.width;
    layout.height = this.height;
    layout.laneBands = this.laneBands;
  }
}
