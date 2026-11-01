import { GNode, type GEdge, type ScopeLayout } from '../scopes/GNode.js';
import { ChannelRouter } from '../routing/ChannelRouter.js';
import { ScopeLabels } from '../scopes/ScopeLabels.js';
import { ArrangementCheckpoint } from './ArrangementCheckpoint.js';

export interface Routes {
  crossings: number;
  hits: number;
  labels: number;
  rises: Set<GEdge>;
  above: Set<GEdge>;
  straight: Set<GEdge>;
  bends: number;
  shared: number;
  sharing: Set<GEdge>;
}

type LinePiece = [low: number, high: number, edgeIndex: number];

export abstract class ArrangementTrial {
  constructor(protected readonly layout: ScopeLayout) {}

  private static risesStraight(edge: GEdge, node: GNode, slots: readonly number[]): boolean {
    const [beforeLast, last] = edge.points.slice(-2);
    if (!beforeLast || !last || last.y !== node.box.bottom || beforeLast.x !== last.x) {
      return false;
    }
    const from = ChannelRouter.riseFrom(edge);
    return edge.source.host ? slots.includes(last.x) && beforeLast.y >= from - 1 : last.x === slots[0] && Math.abs(beforeLast.y - from) <= 1;
  }

  private static piecesOf(lines: Map<string, LinePiece[]>, edge: GEdge, edgeIndex: number): void {
    edge.points.slice(1).forEach((end, index) => {
      const start = edge.points[index]!;
      const level = start.y === end.y;
      if (level || start.x === end.x) {
        const key = level ? `h${start.y}` : `v${start.x}`;
        const span: [number, number] = level ? [Math.min(start.x, end.x), Math.max(start.x, end.x)] : [Math.min(start.y, end.y), Math.max(start.y, end.y)];
        lines.set(key, [...(lines.get(key) ?? []), [span[0], span[1], edgeIndex]]);
      }
    });
  }

  abstract run(): void;

  protected routesOf(lines = false, look?: () => void): Routes {
    const { layout } = this;
    const checkpoint = new ArrangementCheckpoint(layout);
    const router = new ChannelRouter(layout);
    router.route();
    const straight = new Set(layout.edges.filter((edge) => edge.points.length === 2));
    const bends = layout.edges.reduce((sum, edge) => sum + Math.max(0, edge.points.length - 2), 0);
    const labels = new ScopeLabels(layout);
    const routes = { ...router.faults([...labels.shapes(), ...labels.data()]), rises: this.straightRises(), above: new Set(layout.edges.filter((edge) => edge.runsAbove)), straight, bends, ...(lines ? this.sharedLines() : { shared: 0, sharing: new Set<GEdge>() }) };
    look?.();
    checkpoint.restore();
    return routes;
  }

  private sharedLines(): { shared: number; sharing: Set<GEdge> } {
    const { edges } = this.layout;
    const lines = new Map<string, LinePiece[]>();
    edges.forEach((edge, edgeIndex) => ArrangementTrial.piecesOf(lines, edge, edgeIndex));
    const pairs = new Set<number>();
    const sharing = new Set<GEdge>();
    for (const pieces of lines.values()) {
      pieces.sort((first, second) => first[0] - second[0]);
      pieces.forEach(([, high, firstEdge], firstIndex) => {
        for (let index = firstIndex + 1; index < pieces.length && pieces[index]![0] < high; index++) {
          const secondEdge = pieces[index]![2];
          if (firstEdge !== secondEdge) {
            pairs.add(Math.min(firstEdge, secondEdge) * edges.length + Math.max(firstEdge, secondEdge));
            sharing.add(edges[firstEdge]!).add(edges[secondEdge]!);
          }
        }
      });
    }
    return { shared: pairs.size, sharing };
  }

  private straightRises(): Set<GEdge> {
    const rises = new Set<GEdge>();
    for (const node of this.layout.nodes) {
      const slots = node.riseSlots().map(Math.round);
      for (const edge of node.risesInto()) {
        if (ArrangementTrial.risesStraight(edge, node, slots)) {
          rises.add(edge);
        }
      }
    }
    return rises;
  }
}
