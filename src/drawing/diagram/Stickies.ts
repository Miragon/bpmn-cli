import { Box, DiagramIndex, type BpmnElement, type Point } from '../../model/index.js';

export interface StickyAnchor {
  process: BpmnElement;
  index: number;
  stickyId?: string;
  node: BpmnElement;
  centre: Point;
}

export interface ResolvedAnchor {
  processId: string;
  index: number;
  stickyId?: string;
  nodeId: string;
  centre: Point;
}

export interface MovedSticky {
  sticky: string;
  node: string;
}

export class Stickies {
  private static readonly BPMIQ_URI = 'https://bpmiq.io/schema/1.0/bpmiq';
  private static readonly DEFAULT_SIZE = 120;

  constructor(private readonly definitions: BpmnElement) {}

  private static isSticky(element: BpmnElement): boolean {
    const { type } = element;
    if (type.slice(type.indexOf(':') + 1).toLowerCase() !== 'sticky') {
      return false;
    }
    const uri = element.descriptor.ns?.uri;
    return uri === Stickies.BPMIQ_URI || (!uri && type.startsWith('bpmiq:'));
  }

  private static numberOf(input: unknown): number | undefined {
    const parsed = typeof input === 'string' && input.trim() !== '' ? Number(input) : input;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
  }

  private static boxOf(sticky: BpmnElement): Box | undefined {
    const x = Stickies.numberOf(sticky.peek('x'));
    const y = Stickies.numberOf(sticky.peek('y'));
    if (x === undefined || y === undefined) {
      return undefined;
    }
    const size = (property: string): number => Stickies.numberOf(sticky.peek(property)) ?? Stickies.DEFAULT_SIZE;
    return new Box(x, y, size('width'), size('height'));
  }

  anchors(): StickyAnchor[] {
    const groups = this.stickiesByProcess();
    const shapes = groups.length ? [...this.mainShapes()] : [];
    return shapes.length ? groups.flatMap(({ process, stickies }) => stickies.flatMap((sticky, index) => this.anchorOf(process, sticky, index, shapes) ?? [])) : [];
  }

  follow(anchors: readonly ResolvedAnchor[]): MovedSticky[] {
    if (!anchors.length) {
      return [];
    }
    const shapesById = new Map([...this.mainShapes()].map(([element, box]) => [element.peek<string>('id'), box]));
    const groups = new Map(this.stickiesByProcess().map((group) => [group.process.peek<string>('id'), group.stickies]));
    return anchors.flatMap((anchor) => this.moveSticky(anchor, shapesById.get(anchor.nodeId), groups.get(anchor.processId)) ?? []);
  }

  private stickiesByProcess(): Array<{ process: BpmnElement; stickies: BpmnElement[] }> {
    return this.definitions
      .list('rootElements')
      .filter((root) => root.is('bpmn:Process'))
      .map((process) => ({ process, stickies: (process.peek<BpmnElement>('extensionElements')?.list('values') ?? []).filter(Stickies.isSticky) }))
      .filter(({ stickies }) => stickies.length);
  }

  private mainShapes(): Map<BpmnElement, Box> {
    const shapes = new Map<BpmnElement, Box>();
    const plane = this.definitions.list('diagrams')[0]?.peek<BpmnElement>('plane');
    for (const planeElement of plane?.list('planeElement') ?? []) {
      const element = planeElement.is('bpmndi:BPMNShape') ? planeElement.peek<BpmnElement>('bpmnElement') : undefined;
      const box = DiagramIndex.boxOf(planeElement.peek<BpmnElement>('bounds'));
      if (element?.is('bpmn:FlowNode') && box) {
        shapes.set(element, box);
      }
    }
    return shapes;
  }

  private anchorOf(process: BpmnElement, sticky: BpmnElement, index: number, shapes: ReadonlyArray<[BpmnElement, Box]>): StickyAnchor | undefined {
    const box = Stickies.boxOf(sticky);
    if (!box) {
      return undefined;
    }
    const { center } = box;
    const distanceTo = (shape: Box): number => {
      const dx = Math.max(shape.x - center.x, 0, center.x - shape.right);
      const dy = Math.max(shape.y - center.y, 0, center.y - shape.bottom);
      return Math.hypot(dx, dy);
    };
    const [node, nearest] = shapes.reduce((best, shape) => {
      const [gap, bestGap] = [distanceTo(shape[1]), distanceTo(best[1])];
      return gap < bestGap || (gap === bestGap && shape[1].width * shape[1].height < best[1].width * best[1].height) ? shape : best;
    });
    const stickyId = sticky.peek<string>('id');
    return { process, index, ...(stickyId ? { stickyId } : {}), node, centre: nearest.center };
  }

  private moveSticky(anchor: ResolvedAnchor, now: Box | undefined, stickies: readonly BpmnElement[] | undefined): MovedSticky | undefined {
    const sticky = anchor.stickyId !== undefined ? stickies?.find((candidate) => candidate.peek('id') === anchor.stickyId) : stickies?.[anchor.index];
    const box = sticky && Stickies.boxOf(sticky);
    if (!now || !sticky || !box) {
      return undefined;
    }
    const center = now.center;
    const dx = Math.round(center.x - anchor.centre.x);
    const dy = Math.round(center.y - anchor.centre.y);
    if (!dx && !dy) {
      return undefined;
    }
    if (dx) {
      sticky.set('x', String(Math.round(box.x + dx)));
    }
    if (dy) {
      sticky.set('y', String(Math.round(box.y + dy)));
    }
    return { sticky: anchor.stickyId ?? `${anchor.processId}#${anchor.index}`, node: anchor.nodeId };
  }
}
