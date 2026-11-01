import { TextMetrics } from '@miragon/bpmn-render/text';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GEdge, GNode, ScopeLayout } from './GNode.js';

type LabelSide = 'above' | 'below' | undefined;

export class ScopeColumns {
  private static readonly natural = new WeakMap<ScopeLayout, ReadonlyMap<GNode, number>>();
  private static readonly LABEL_ROOM = 16;
  private static readonly NAMED_GATEWAY_ROOM = 12;
  private static readonly LABEL_APART = 4;

  constructor(private readonly layout: ScopeLayout) {}

  private static labelSide(node: GNode): LabelSide {
    if (node.child || node.kind === 'subProcess' || node.kind === 'eventSubProcess' || !node.el.name) {
      return undefined;
    }
    if (node.kind === 'gateway') {
      return 'above';
    }
    return node.isEvent ? 'below' : undefined;
  }

  private static labelWidth(node: GNode): number {
    return TextMetrics.labelSize(node.el.name!).width;
  }

  private static neededFor(edge: GEdge, name: string): number {
    const label = TextMetrics.labelSize(name);
    const source = edge.source.host ?? edge.source;
    const gatewayName = source.kind === 'gateway' ? source.el.name : undefined;
    const need = label.width + ScopeColumns.LABEL_ROOM;
    if (gatewayName && label.lines > 1) {
      return Math.max(need, TextMetrics.labelSize(gatewayName).width / 2 - source.width / 2 + label.width + ScopeColumns.NAMED_GATEWAY_ROOM);
    }
    return need;
  }

  assign(shifts: ReadonlyMap<GNode, number>): ReadonlyMap<GNode, number> {
    const { layout } = this;
    let natural = ScopeColumns.natural.get(layout);
    if (!natural) {
      natural = this.layersWith(new Map());
      ScopeColumns.natural.set(layout, natural);
    }
    const moved = shifts.size ? this.layersWith(shifts) : natural;
    for (const node of layout.nodes) {
      node.layer = moved.get(node)!;
    }
    for (const node of layout.nodes) {
      if (node.compensatedBy?.host) {
        node.layer = node.compensatedBy.host.layer;
      }
    }
    for (const node of layout.nodes) {
      for (const event of node.boundary) {
        event.layer = node.layer;
      }
    }
    return natural;
  }

  gaps(columnWidth: readonly number[]): number[] {
    const { nodes, edges } = this.layout;
    const outOf = columnWidth.map((): GEdge[] => []);
    for (const edge of edges) {
      outOf[(edge.source.host ?? edge.source).layer]?.push(edge);
    }
    const inColumn = columnWidth.map((): GNode[] => []);
    for (const node of nodes) {
      inColumn[node.layer]!.push(node);
    }
    const sides = new Map(nodes.map((node) => [node, ScopeColumns.labelSide(node)]));
    return columnWidth.map((_width, column) => Math.max(this.flowLabelGap(outOf[column]!, column), this.nodeLabelGap(inColumn[column]!, inColumn[column + 1] ?? [], columnWidth, column, sides)));
  }

  private layersWith(moves: ReadonlyMap<GNode, number>): Map<GNode, number> {
    const memo = new Map<GNode, number>();
    const layerOf = (node: GNode): number => {
      const known = memo.get(node);
      if (known !== undefined) {
        return known;
      }
      memo.set(node, 0);
      let layer = 0;
      for (const edge of node.in) {
        if (!edge.back) {
          layer = Math.max(layer, layerOf(edge.source.host ?? edge.source) + 1);
        }
      }
      layer += moves.get(node) ?? 0;
      memo.set(node, layer);
      return layer;
    };
    for (const node of this.layout.nodes) {
      layerOf(node);
    }
    return memo;
  }

  private flowLabelGap(edges: readonly GEdge[], layer: number): number {
    let gap = ShapeSizes.GAPS.hGap;
    for (const edge of edges) {
      const source = edge.source.host ?? edge.source;
      const name = edge.el.name;
      if (!edge.back && name && source.layer === layer && edge.target.layer === layer + 1) {
        gap = Math.max(gap, ScopeColumns.neededFor(edge, name));
      }
    }
    return gap;
  }

  private nodeLabelGap(here: readonly GNode[], next: readonly GNode[], columnWidth: readonly number[], layer: number, sides: ReadonlyMap<GNode, LabelSide>): number {
    let gap = 0;
    for (const node of here) {
      const side = sides.get(node);
      for (const neighbour of side ? next : []) {
        if (neighbour.row === node.row && sides.get(neighbour) === side) {
          gap = Math.max(gap, (ScopeColumns.labelWidth(node) - columnWidth[layer]!) / 2 + (ScopeColumns.labelWidth(neighbour) - columnWidth[layer + 1]!) / 2 + ScopeColumns.LABEL_APART);
        }
      }
    }
    return Math.ceil(gap);
  }
}
