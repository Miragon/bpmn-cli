import { METRICS, SIZES, center, labelSize, type GEdge, type GNode, type ScopeLayout } from '../../diagram/types.js';
import { RowAssigner } from './RowAssigner.js';
import { nameOf } from './utils/names.js';
import { isEvent } from './utils/nodes.js';

/** Room for data objects / stores hanging below a row: the gap between rows grows by this. */
export const DATA_ROW_EXTRA = 40;

/** assignLayers' columns without the moves, by scope. */
const naturalLayers = new WeakMap<ScopeLayout, ReadonlyMap<GNode, number>>();

/**
 * Columns, rows and positions of a scope's nodes and boundary events, and the
 * y of the empty bands. `shifts`: the columns a node sits further right than
 * its entries need (JoinColumnTrial), what follows it with it; the chains
 * and their rows are those without them. Run again from scratch, it gives
 * the same grid for the same `shifts`.
 */
export class ScopeGrid {
  constructor(
    private readonly layout: ScopeLayout,
    private readonly groups?: ReadonlyMap<string, readonly string[]>,
  ) {}

  arrange(shifts: ReadonlyMap<GNode, number> = new Map()): void {
    for (const e of this.layout.edges) {
      delete e.bandRow;
      delete e.bandY;
    }
    new RowAssigner(this.layout, this.groups, this.assignLayers(shifts)).assign();
    this.positionNodes();
  }

  /** Extra row height below a node for its boundary events (they hang out of the bottom border, labels beside; the rows are made before TopBorderTrial moves one up). */
  static boundaryExtra(n: GNode): number {
    return n.boundary.length ? SIZES.event.height / 2 + 20 : 0;
  }

  /**
   * Positions the boundary events of a host along its bottom border (right to left; collapsed sub-processes: left to
   * right, away from the drill-down marker), each in the place of its index, and those on its top border (GNode.onTop,
   * TopBorderTrial) along that one from its right end (off the type icon at the top left), right to left by the x of
   * their nearest target (the ways over the top nest: the rightmost event's runs lowest, EdgeRouter), else in their
   * order: an event that goes up moves no event of the bottom border.
   */
  static placeBoundaryEvents(n: GNode): void {
    const collapsed = n.kind === 'subProcess' && !n.child;
    const reach = (b: GNode): number => Math.min(...b.out.map((e) => center(e.target.box).x));
    const tops = n.boundary.filter((b) => b.onTop).sort((a, b) => reach(a) - reach(b));
    n.boundary.forEach((b, i) => {
      const k = b.onTop ? tops.indexOf(b) : i;
      const step = k * (SIZES.event.width + 8);
      const cx = collapsed && !b.onTop ? n.box.x + METRICS.boundaryOffset + step : n.box.x + n.box.width - METRICS.boundaryOffset - step;
      const y = b.onTop ? n.box.y - SIZES.event.height / 2 : n.box.y + n.box.height - SIZES.event.height / 2;
      b.box = { x: Math.round(cx - SIZES.event.width / 2), y, width: SIZES.event.width, height: SIZES.event.height };
    });
  }

  /**
   * Columns: one more than the deepest forward predecessor, more for a node moved right (`shifts`, JoinColumnTrial).
   * Returns the columns without the moves (RowAssigner chooses the chains by them).
   */
  private assignLayers(shifts: ReadonlyMap<GNode, number>): ReadonlyMap<GNode, number> {
    const { nodes } = this.layout;
    // the columns without the moves stay what they are once the loops are marked: computed once per scope
    const layers = (moves: ReadonlyMap<GNode, number>): Map<GNode, number> => {
      const memo = new Map<GNode, number>();
      const layerOf = (n: GNode): number => {
        const known = memo.get(n);
        if (known !== undefined) return known;
        memo.set(n, 0); // guard against unexpected cycles
        let layer = 0;
        for (const e of n.in) {
          if (e.back) continue;
          const src = e.source.host ?? e.source;
          layer = Math.max(layer, layerOf(src) + 1);
        }
        layer += moves.get(n) ?? 0;
        memo.set(n, layer);
        return layer;
      };
      for (const n of nodes) layerOf(n);
      return memo;
    };
    let natural = naturalLayers.get(this.layout);
    if (!natural) naturalLayers.set(this.layout, (natural = layers(new Map())));
    const moved = shifts.size ? layers(shifts) : natural;
    for (const n of nodes) n.layer = moved.get(n)!;
    for (const n of nodes) if (n.compensatedBy?.host) n.layer = n.compensatedBy.host.layer; // handler under its host
    for (const n of nodes) for (const b of n.boundary) b.layer = n.layer;
    return natural;
  }

  /** Width a host needs so its boundary events fit along the bottom border. */
  private hostWidthFor(n: GNode): number {
    const count = n.boundary.length;
    if (count < 3) return n.width;
    return Math.max(n.width, 2 * METRICS.boundaryOffset + (count - 1) * (SIZES.event.width + 8) + 10);
  }

  /** Horizontal gap needed after a layer so the labels of its outgoing flows fit before the next column. */
  private layerGapFor(edges: GEdge[], layer: number): number {
    let gap = METRICS.hGap;
    for (const e of edges) {
      if (e.back) continue;
      const s = e.source.host ?? e.source;
      if (s.layer !== layer || e.target.layer !== layer + 1) continue;
      const name = nameOf(e);
      if (!name) continue;
      const lbl = labelSize(name);
      let need = lbl.width + 16;
      const gwName = s.kind === 'gateway' ? nameOf(s) : undefined;
      if (gwName && lbl.lines > 1) need = Math.max(need, labelSize(gwName).width / 2 - s.width / 2 + lbl.width + 12);
      gap = Math.max(gap, need);
    }
    return gap;
  }

  /** The side the engine draws a node's external label on (ScopeLabels.of): a gateway's above, an event's below. */
  private labelSide(n: GNode): 'above' | 'below' | undefined {
    if (n.child || n.kind === 'subProcess' || n.kind === 'eventSubProcess' || !nameOf(n)) return undefined;
    return n.kind === 'gateway' ? 'above' : isEvent(n) ? 'below' : undefined;
  }

  /**
   * Horizontal gap needed after a layer so that the labels of two neighbours
   * in one row on the same side (events below, gateways above) keep 4 px
   * apart: what the one's label reaches beyond its column and the other's
   * beyond the next (0 when none do).
   */
  private labelGapFor(here: GNode[], next: GNode[], colWidth: number[], layer: number, sides: ReadonlyMap<GNode, 'above' | 'below' | undefined>): number {
    let gap = 0;
    const width = (n: GNode): number => labelSize(nameOf(n)!).width;
    for (const a of here) {
      const side = sides.get(a);
      if (!side) continue;
      for (const b of next) {
        if (b.row !== a.row || sides.get(b) !== side) continue;
        gap = Math.max(gap, (width(a) - colWidth[layer]!) / 2 + (width(b) - colWidth[layer + 1]!) / 2 + 4);
      }
    }
    return Math.ceil(gap);
  }

  private positionNodes(): void {
    const { layout } = this;
    const { nodes } = layout;
    if (!nodes.length) {
      layout.width = 0;
      layout.height = 0;
      return;
    }
    for (const n of nodes) n.width = this.hostWidthFor(n);
    const layers = Math.max(...nodes.map((n) => n.layer)) + 1;
    const rows = Math.max(...nodes.map((n) => n.row), ...layout.edges.map((e) => e.bandRow ?? 0)) + 1;
    const colWidth = new Array<number>(layers).fill(0);
    const rowHeight = new Array<number>(rows).fill(0);
    const rowExtra = new Array<number>(rows).fill(0);
    for (const n of nodes) {
      colWidth[n.layer] = Math.max(colWidth[n.layer]!, n.width);
      rowHeight[n.row] = Math.max(rowHeight[n.row]!, n.height + ScopeGrid.boundaryExtra(n));
    }
    for (const a of layout.artifacts) {
      if (a.kind !== 'annotation' && a.anchorNode) rowExtra[a.anchorNode.row] = DATA_ROW_EXTRA;
    }
    // the flows leaving each column and the nodes in it, for the gap after the column
    const outOf = colWidth.map((): GEdge[] => []);
    for (const e of layout.edges) outOf[(e.source.host ?? e.source).layer]?.push(e);
    const inColumn = colWidth.map((): GNode[] => []);
    for (const n of nodes) inColumn[n.layer]!.push(n);
    const sides = new Map(nodes.map((n) => [n, this.labelSide(n)]));
    const gaps = colWidth.map((_, l) => Math.max(this.layerGapFor(outOf[l]!, l), this.labelGapFor(inColumn[l]!, inColumn[l + 1] ?? [], colWidth, l, sides)));
    const colX: number[] = [];
    let x = 0;
    for (let l = 0; l < layers; l++) {
      colX.push(x);
      x += colWidth[l]! + gaps[l]!;
    }
    const rowY: number[] = [];
    let y = 0;
    for (let r = 0; r < rows; r++) {
      rowY.push(y);
      y += rowHeight[r]! + METRICS.vGap + rowExtra[r]!;
    }
    for (const n of nodes) {
      const cw = colWidth[n.layer]!;
      const rh = rowHeight[n.row]!;
      const bx = colX[n.layer]! + (cw - n.width) / 2;
      // every node is centred on the row centre so same-row flows are straight
      const by = rowY[n.row]! + rh / 2 - n.height / 2;
      n.box = { x: Math.round(bx), y: Math.round(by), width: n.width, height: n.height };
      ScopeGrid.placeBoundaryEvents(n);
    }
    for (const e of layout.edges) if (e.bandRow !== undefined) e.bandY = rowY[e.bandRow]! + rowHeight[e.bandRow]! / 2;
    // compensation handlers sit centred under their boundary event
    for (const n of nodes) {
      const ev = n.compensatedBy;
      if (ev) {
        n.box.x = Math.round(ev.box.x + ev.box.width / 2 - n.box.width / 2);
        ScopeGrid.placeBoundaryEvents(n);
      }
    }
    layout.width = x - gaps[layers - 1]!;
    layout.height = y - METRICS.vGap - rowExtra[rows - 1]!;
  }
}
