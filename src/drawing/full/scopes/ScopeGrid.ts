import { Box } from '../../../model/index.js';
import { RowAssigner } from '../lanes/RowAssigner.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GNode, ScopeLayout } from './GNode.js';
import { ScopeColumns } from './ScopeColumns.js';

interface RowHeights {
  height: number[];
  extra: number[];
}

export class ScopeGrid {
  static readonly DATA_ROW_EXTRA = 40;

  private static readonly EVENT_APART = 8;
  private static readonly BOUNDARY_HANG = 20;

  constructor(
    private readonly layout: ScopeLayout,
    private readonly groups?: ReadonlyMap<string, readonly string[]>,
  ) {}

  static boundaryExtra(node: GNode): number {
    return node.boundary.length ? ShapeSizes.EVENT.height / 2 + ScopeGrid.BOUNDARY_HANG : 0;
  }

  static borderSpots(host: GNode): number {
    const reach = host.width - ShapeSizes.GAPS.boundaryOffset - ShapeSizes.EVENT.width / 2;
    return Math.max(1, 1 + Math.floor(reach / ScopeGrid.eventStep()));
  }

  static spreadOverBorders(host: GNode): void {
    const spots = ScopeGrid.borderSpots(host);
    host.boundary.forEach((event, index) => {
      event.onTop = index >= spots && index < 2 * spots ? true : undefined;
    });
  }

  static placeBoundaryEvents(host: GNode): void {
    const collapsed = host.kind === 'subProcess' && !host.child;
    const spots = ScopeGrid.borderSpots(host);
    const reach = (event: GNode): number => Math.min(...event.out.map((flow) => flow.target.box.center.x));
    const tops = host.boundary.filter((event) => event.onTop).sort((first, second) => reach(first) - reach(second));
    const { width, height } = ShapeSizes.EVENT;
    host.boundary.forEach((event, index) => {
      const step = (event.onTop ? tops.indexOf(event) : index % spots) * ScopeGrid.eventStep();
      const { boundaryOffset } = ShapeSizes.GAPS;
      const centerX = collapsed && !event.onTop ? host.box.x + boundaryOffset + step : host.box.right - boundaryOffset - step;
      const top = event.onTop ? host.box.y - height / 2 : host.box.bottom - height / 2;
      event.box = new Box(Math.round(centerX - width / 2), top, width, height);
    });
  }

  private static eventStep(): number {
    return ShapeSizes.EVENT.width + ScopeGrid.EVENT_APART;
  }

  private static runningSum(sizes: readonly number[], gapAfter: (index: number) => number): { starts: number[]; end: number } {
    const starts: number[] = [];
    let end = 0;
    sizes.forEach((size, index) => {
      starts.push(end);
      end += size + gapAfter(index);
    });
    return { starts, end };
  }

  arrange(shifts: ReadonlyMap<GNode, number> = new Map()): void {
    for (const edge of this.layout.edges) {
      edge.bandRow = undefined;
      edge.bandY = undefined;
    }
    new RowAssigner(this.layout, this.groups, new ScopeColumns(this.layout).assign(shifts)).assign();
    this.positionNodes();
  }

  private columnWidths(): number[] {
    const { nodes } = this.layout;
    const widths = new Array<number>(Math.max(...nodes.map((node) => node.layer)) + 1).fill(0);
    for (const node of nodes) {
      widths[node.layer] = Math.max(widths[node.layer]!, node.width);
    }
    return widths;
  }

  private rowHeights(): RowHeights {
    const { nodes, edges, artifacts } = this.layout;
    const rows = Math.max(...nodes.map((node) => node.row), ...edges.map((edge) => edge.bandRow ?? 0)) + 1;
    const height = new Array<number>(rows).fill(0);
    const extra = new Array<number>(rows).fill(0);
    for (const node of nodes) {
      height[node.row] = Math.max(height[node.row]!, node.height + ScopeGrid.boundaryExtra(node));
    }
    for (const artifact of artifacts) {
      if (artifact.kind !== 'annotation' && artifact.anchorNode) {
        extra[artifact.anchorNode.row] = ScopeGrid.DATA_ROW_EXTRA;
      }
    }
    return { height, extra };
  }

  private positionNodes(): void {
    const { layout } = this;
    if (!layout.nodes.length) {
      layout.width = 0;
      layout.height = 0;
      return;
    }
    const columnWidth = this.columnWidths();
    const rows = this.rowHeights();
    const gaps = new ScopeColumns(layout).gaps(columnWidth);
    const columns = ScopeGrid.runningSum(columnWidth, (column) => gaps[column]!);
    const rowTops = ScopeGrid.runningSum(rows.height, (row) => ShapeSizes.GAPS.vGap + rows.extra[row]!);
    this.placeNodes(columns.starts, columnWidth, rowTops.starts, rows.height);
    layout.width = columns.end - gaps.at(-1)!;
    layout.height = rowTops.end - ShapeSizes.GAPS.vGap - rows.extra.at(-1)!;
  }

  private placeNodes(columnX: readonly number[], columnWidth: readonly number[], rowY: readonly number[], rowHeight: readonly number[]): void {
    const { nodes, edges } = this.layout;
    for (const node of nodes) {
      const x = columnX[node.layer]! + (columnWidth[node.layer]! - node.width) / 2;
      const y = rowY[node.row]! + rowHeight[node.row]! / 2 - node.height / 2;
      node.box = new Box(Math.round(x), Math.round(y), node.width, node.height);
      ScopeGrid.placeBoundaryEvents(node);
    }
    for (const edge of edges) {
      if (edge.bandRow !== undefined) {
        edge.bandY = rowY[edge.bandRow]! + rowHeight[edge.bandRow]! / 2;
      }
    }
    for (const node of nodes) {
      if (node.compensatedBy) {
        node.box.x = Math.round(node.compensatedBy.box.center.x - node.box.width / 2);
        ScopeGrid.placeBoundaryEvents(node);
      }
    }
  }
}
