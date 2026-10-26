import { labelSize } from '../../drawing/utils/text.js';
import { METRICS, SIZES } from '../../drawing/utils/sizes.js';
import { center, cx } from '../../drawing/utils/geom.js';
import type { GEdge, GNode, ScopeLayout } from '../../drawing/types.js';
import { RowAssigner } from './RowAssigner.js';
import { nameOf } from './utils/names.js';
import { isEvent } from './utils/nodes.js';

/** Extra gap below a row for the data objects hanging from it. */
export const DATA_ROW_EXTRA = 40;

const naturalLayers = new WeakMap<ScopeLayout, ReadonlyMap<GNode, number>>();

/**
 * Columns, rows and positions of a scope's nodes and boundary events.
 * `shifts` move a node and what follows further right; the same shifts give the same grid.
 */
export class ScopeGrid {
  constructor(
    private readonly layout: ScopeLayout,
    private readonly groups?: ReadonlyMap<string, readonly string[]>,
  ) {}

  arrange(shifts: ReadonlyMap<GNode, number> = new Map()): void {
    for (const edge of this.layout.edges) {
      delete edge.bandRow;
      delete edge.bandY;
    }
    new RowAssigner(this.layout, this.groups, this.assignLayers(shifts)).assign();
    this.positionNodes();
  }

  /** Rows are made before TopBorderTrial moves an event up, so every event hangs below. */
  static boundaryExtra(node: GNode): number {
    return node.boundary.length ? SIZES.event.height / 2 + 20 : 0;
  }

  /**
   * Bottom-border events run right to left, on a collapsed sub-process left to right (away from
   * the drill-down marker). Top-border events start at the right end, off the type icon, ordered
   * by their nearest target so the ways over the top nest; they never move a bottom-border event.
   */
  static placeBoundaryEvents(host: GNode): void {
    const collapsed = host.kind === 'subProcess' && !host.child;
    const reach = (event: GNode): number => Math.min(...event.out.map((flow) => center(flow.target.box).x));
    const tops = host.boundary.filter((event) => event.onTop).sort((first, second) => reach(first) - reach(second));
    host.boundary.forEach((event, index) => {
      const slot = event.onTop ? tops.indexOf(event) : index;
      const step = slot * (SIZES.event.width + 8);
      const centerX = collapsed && !event.onTop ? host.box.x + METRICS.boundaryOffset + step : host.box.x + host.box.width - METRICS.boundaryOffset - step;
      const top = event.onTop ? host.box.y - SIZES.event.height / 2 : host.box.y + host.box.height - SIZES.event.height / 2;
      event.box = { x: Math.round(centerX - SIZES.event.width / 2), y: top, width: SIZES.event.width, height: SIZES.event.height };
    });
  }

  /** Returns the columns without the shifts: RowAssigner chooses the chains by them. */
  private assignLayers(shifts: ReadonlyMap<GNode, number>): ReadonlyMap<GNode, number> {
    const { nodes } = this.layout;
    // stable once the loops are marked, so computed once per scope
    const layers = (moves: ReadonlyMap<GNode, number>): Map<GNode, number> => {
      const memo = new Map<GNode, number>();
      const layerOf = (node: GNode): number => {
        const known = memo.get(node);
        if (known !== undefined) return known;
        memo.set(node, 0); // guard against unexpected cycles
        let layer = 0;
        for (const edge of node.in) {
          if (edge.back) continue;
          const src = edge.source.host ?? edge.source;
          layer = Math.max(layer, layerOf(src) + 1);
        }
        layer += moves.get(node) ?? 0;
        memo.set(node, layer);
        return layer;
      };
      for (const node of nodes) layerOf(node);
      return memo;
    };
    let natural = naturalLayers.get(this.layout);
    if (!natural) naturalLayers.set(this.layout, (natural = layers(new Map())));
    const moved = shifts.size ? layers(shifts) : natural;
    for (const node of nodes) node.layer = moved.get(node)!;
    // handler under its host
    for (const node of nodes) if (node.compensatedBy?.host) node.layer = node.compensatedBy.host.layer;
    for (const node of nodes) for (const event of node.boundary) event.layer = node.layer;
    return natural;
  }

  private hostWidthFor(node: GNode): number {
    const count = node.boundary.length;
    if (count < 3) return node.width;
    return Math.max(node.width, 2 * METRICS.boundaryOffset + (count - 1) * (SIZES.event.width + 8) + 10);
  }

  private layerGapFor(edges: GEdge[], layer: number): number {
    let gap = METRICS.hGap;
    for (const edge of edges) {
      if (edge.back) continue;
      const source = edge.source.host ?? edge.source;
      if (source.layer !== layer || edge.target.layer !== layer + 1) continue;
      const name = nameOf(edge);
      if (!name) continue;
      const lbl = labelSize(name);
      let need = lbl.width + 16;
      const gwName = source.kind === 'gateway' ? nameOf(source) : undefined;
      if (gwName && lbl.lines > 1) need = Math.max(need, labelSize(gwName).width / 2 - source.width / 2 + lbl.width + 12);
      gap = Math.max(gap, need);
    }
    return gap;
  }

  private labelSide(node: GNode): 'above' | 'below' | undefined {
    if (node.child || node.kind === 'subProcess' || node.kind === 'eventSubProcess' || !nameOf(node)) return undefined;
    return node.kind === 'gateway' ? 'above' : isEvent(node) ? 'below' : undefined;
  }

  /** Keeps the labels of two same-row neighbours on the same side 4 px apart. */
  private labelGapFor(here: GNode[], next: GNode[], colWidth: number[], layer: number, sides: ReadonlyMap<GNode, 'above' | 'below' | undefined>): number {
    let gap = 0;
    const width = (node: GNode): number => labelSize(nameOf(node)!).width;
    for (const node of here) {
      const side = sides.get(node);
      if (!side) continue;
      for (const neighbour of next) {
        if (neighbour.row !== node.row || sides.get(neighbour) !== side) continue;
        gap = Math.max(gap, (width(node) - colWidth[layer]!) / 2 + (width(neighbour) - colWidth[layer + 1]!) / 2 + 4);
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
    for (const node of nodes) node.width = this.hostWidthFor(node);
    const layers = Math.max(...nodes.map((node) => node.layer)) + 1;
    const rows = Math.max(...nodes.map((node) => node.row), ...layout.edges.map((edge) => edge.bandRow ?? 0)) + 1;
    const colWidth = new Array<number>(layers).fill(0);
    const rowHeight = new Array<number>(rows).fill(0);
    const rowExtra = new Array<number>(rows).fill(0);
    for (const node of nodes) {
      colWidth[node.layer] = Math.max(colWidth[node.layer]!, node.width);
      rowHeight[node.row] = Math.max(rowHeight[node.row]!, node.height + ScopeGrid.boundaryExtra(node));
    }
    for (const artifact of layout.artifacts) {
      if (artifact.kind !== 'annotation' && artifact.anchorNode) rowExtra[artifact.anchorNode.row] = DATA_ROW_EXTRA;
    }
    const outOf = colWidth.map((): GEdge[] => []);
    for (const edge of layout.edges) outOf[(edge.source.host ?? edge.source).layer]?.push(edge);
    const inColumn = colWidth.map((): GNode[] => []);
    for (const node of nodes) inColumn[node.layer]!.push(node);
    const sides = new Map(nodes.map((node) => [node, this.labelSide(node)]));
    const gaps = colWidth.map((_width, column) => Math.max(this.layerGapFor(outOf[column]!, column), this.labelGapFor(inColumn[column]!, inColumn[column + 1] ?? [], colWidth, column, sides)));
    const colX: number[] = [];
    let left = 0;
    for (let column = 0; column < layers; column++) {
      colX.push(left);
      left += colWidth[column]! + gaps[column]!;
    }
    const rowY: number[] = [];
    let top = 0;
    for (let row = 0; row < rows; row++) {
      rowY.push(top);
      top += rowHeight[row]! + METRICS.vGap + rowExtra[row]!;
    }
    for (const node of nodes) {
      const cw = colWidth[node.layer]!;
      const rh = rowHeight[node.row]!;
      const bx = colX[node.layer]! + (cw - node.width) / 2;
      // every node is centred on the row centre so same-row flows are straight
      const by = rowY[node.row]! + rh / 2 - node.height / 2;
      node.box = { x: Math.round(bx), y: Math.round(by), width: node.width, height: node.height };
      ScopeGrid.placeBoundaryEvents(node);
    }
    for (const edge of layout.edges) if (edge.bandRow !== undefined) edge.bandY = rowY[edge.bandRow]! + rowHeight[edge.bandRow]! / 2;
    // compensation handlers sit centred under their boundary event
    for (const node of nodes) {
      const ev = node.compensatedBy;
      if (ev) {
        node.box.x = Math.round(cx(ev.box) - node.box.width / 2);
        ScopeGrid.placeBoundaryEvents(node);
      }
    }
    layout.width = left - gaps[layers - 1]!;
    layout.height = top - METRICS.vGap - rowExtra[rows - 1]!;
  }
}
