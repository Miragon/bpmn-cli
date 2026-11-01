import { Box, Interval, Samples, type BpmnElement } from '../../model/index.js';
import type { PlaneDrawing } from '../../scoring/index.js';
import type { DEdge } from './DEdge.js';
import type { DShape } from './DShape.js';

export interface Spacing {
  gap: number;
  row: number;
  rowTol: number;
}

type Ends = Pick<DEdge, 'sourceId' | 'targetId'>;

export class Plane {
  static readonly DETACHED_GAP = 10;

  private static readonly MAX_PARENT_DEPTH = 20;

  readonly shapes = new Map<string, DShape>();
  readonly edges = new Map<string, DEdge>();
  dropped: BpmnElement[] = [];
  unbounded?: Map<string, BpmnElement> | undefined;
  deleted?: boolean | undefined;

  constructor(
    public id: string,
    public rootId: string,
    public root: BpmnElement,
    public di?: BpmnElement,
  ) {}

  static drawingsOf(planes: readonly Plane[]): PlaneDrawing[] {
    return planes.filter((plane) => !plane.deleted).map((plane) => plane.drawing());
  }

  leaves(): DShape[] {
    return [...this.shapes.values()].filter((shape) => shape.isLeaf);
  }

  contentBox(filter: (shape: DShape) => boolean = (shape) => shape.isLeaf): Box | undefined {
    return Box.unionAll([...this.shapes.values()].filter(filter).map((shape) => shape.bounds));
  }

  contentOf(subProcessId: string): { shapes: DShape[]; edges: DEdge[] } {
    const inside = new Set<string>();
    const belongs = (shape: DShape): boolean => shape.parentId === subProcessId || (!!shape.parentId && inside.has(shape.parentId)) || (!!shape.hostId && inside.has(shape.hostId));
    for (let grew = true; grew; ) {
      grew = false;
      for (const shape of this.shapes.values()) {
        if (!inside.has(shape.id) && belongs(shape)) {
          inside.add(shape.id);
          grew = true;
        }
      }
    }
    const edgeReaches = (edge: DEdge): boolean => (!!edge.sourceId && inside.has(edge.sourceId)) || (!!edge.targetId && inside.has(edge.targetId));
    return { shapes: [...this.shapes.values()].filter((shape) => inside.has(shape.id)), edges: [...this.edges.values()].filter(edgeReaches) };
  }

  boundariesOf(hostId: string): DShape[] {
    return [...this.shapes.values()].filter((shape) => shape.hostId === hostId);
  }

  outermost(shapes: readonly DShape[]): DShape[] {
    const ids = new Set(shapes.map((shape) => shape.id));
    return shapes.filter((shape) => {
      let parentId = shape.parentId;
      for (let depth = 0; parentId && depth < Plane.MAX_PARENT_DEPTH; depth++) {
        if (ids.has(parentId)) {
          return false;
        }
        parentId = this.shapes.get(parentId)?.parentId;
      }
      return true;
    });
  }

  spacing(endsOf: (edge: DEdge) => Ends | undefined = (edge) => edge): Spacing {
    const gaps: number[] = [];
    const rows: number[] = [];
    for (const edge of this.edges.values()) {
      const pair = this.spacedPair(edge, endsOf);
      if (pair) {
        this.measurePair(pair, gaps, rows);
      }
    }
    const gap = Math.round(new Interval(40, 100).clamp(new Samples(gaps).median() ?? 60));
    const row = Math.round(new Interval(80, 150).clamp(new Samples(rows).median() ?? 140));
    return { gap, row, rowTol: Math.max(5, row / 4) };
  }

  verticalBand(): DShape | undefined {
    return [...this.shapes.values()].find((shape) => (shape.kind === 'participant' || shape.kind === 'lane') && shape.di?.peek<boolean>('isHorizontal') === false);
  }

  drawing(): PlaneDrawing {
    return { shapes: [...this.shapes.values()].map((shape) => shape.drawing()), edges: [...this.edges.values()].map((edge) => edge.drawing()), root: this.rootId, unmeasuredIds: [...(this.unbounded?.keys() ?? [])] };
  }

  private spacedPair(edge: DEdge, endsOf: (edge: DEdge) => Ends | undefined): [DShape, DShape] | undefined {
    const ends = edge.kind === 'sequenceFlow' ? endsOf(edge) : undefined;
    const source = ends?.sourceId ? this.shapes.get(ends.sourceId) : undefined;
    const target = ends?.targetId ? this.shapes.get(ends.targetId) : undefined;
    return source && target && source.kind !== 'boundary' && !source.container && !target.container ? [source, target] : undefined;
  }

  private measurePair([source, target]: [DShape, DShape], gaps: number[], rows: number[]): void {
    const dy = Math.abs(source.bounds.center.y - target.bounds.center.y);
    if (dy <= 5) {
      const gap = target.bounds.x - source.bounds.right;
      if (gap > 0) {
        gaps.push(gap);
      }
    } else if (dy >= 30) {
      rows.push(dy);
    }
  }
}
