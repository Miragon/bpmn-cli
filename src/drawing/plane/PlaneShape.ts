import { Box, DiagramIndex, type BpmnElement } from '../../model/index.js';
import type { ShapeDrawing } from '../../scoring/index.js';

export type ShapeKind = 'task' | 'subProcess' | 'event' | 'gateway' | 'boundary' | 'data' | 'annotation' | 'participant' | 'lane' | 'group' | 'other';

export type LabelSide = 'above' | 'below' | 'left' | 'right';

type LabelBox = Pick<Box, 'width' | 'height'>;

export class PlaneShape {
  static readonly LABEL_SIDES: Readonly<Record<string, readonly LabelSide[]>> = {
    event: ['below', 'above', 'right', 'left'],
    boundary: ['below', 'right', 'left', 'above'],
    gateway: ['above', 'below', 'right', 'left'],
    data: ['below', 'right', 'left', 'above'],
  };

  private static readonly LABEL_GAP = 6;
  private static readonly STACK_GAP = 4;
  private static readonly BESIDE_STEP = 10;
  private static readonly BORDER_TOLERANCE = 2;

  planeElement?: BpmnElement | undefined;
  expanded?: boolean | undefined;
  label?: Box | undefined;
  hostId?: string | undefined;
  laneId?: string | undefined;
  poolId?: string | undefined;
  parentId?: string | undefined;

  constructor(
    readonly id: string,
    readonly el: BpmnElement,
    public bounds: Box,
    public kind: ShapeKind,
    public container: boolean,
  ) {}

  static defaultLabelSide(kind: ShapeKind): LabelSide {
    return PlaneShape.LABEL_SIDES[kind]?.[0] ?? 'below';
  }

  static hasExternalLabel(kind: ShapeKind): boolean {
    return kind === 'event' || kind === 'boundary' || kind === 'gateway' || kind === 'data';
  }

  static storedBox(bounds: BpmnElement | undefined, box: Box): Box {
    const current = DiagramIndex.boxOf(bounds);
    return current && Box.same(current, box) ? current : new Box(Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height));
  }

  static storedLabel(planeElement: BpmnElement | undefined, label: Box | undefined): Box | undefined {
    const bounds = planeElement?.peek<BpmnElement>('label')?.peek<BpmnElement>('bounds');
    return label ? PlaneShape.storedBox(bounds, label) : DiagramIndex.boxOf(bounds);
  }

  get isLeaf(): boolean {
    return !this.container && this.kind !== 'group';
  }

  get frameWord(): string {
    if (this.kind === 'participant') {
      return 'pool';
    }
    return this.kind === 'lane' ? 'lane' : 'sub-process';
  }

  drawing(): ShapeDrawing {
    const { id, el, planeElement, bounds, expanded, label } = this;
    return { id, el, expanded, bounds: PlaneShape.storedBox(planeElement?.peek<BpmnElement>('bounds'), bounds), label: PlaneShape.storedLabel(planeElement, label) };
  }

  translate(dx: number, dy: number): void {
    this.bounds.translate(dx, dy);
    this.label?.translate(dx, dy);
  }

  labelAt(size: LabelBox, side: LabelSide, host?: PlaneShape, step = 0): Box {
    const { bounds } = this;
    const { width, height } = size;
    const offset = PlaneShape.LABEL_GAP + step * (height + PlaneShape.STACK_GAP);
    if (side === 'below' && this.kind === 'boundary' && host) {
      return new Box(Math.round(bounds.right + PlaneShape.STACK_GAP), Math.round(host.bounds.bottom + 2 + step * (height + PlaneShape.STACK_GAP)), width, height);
    }
    const centred = Math.round(bounds.center.x - width / 2);
    const middled = Math.round(bounds.center.y - height / 2);
    const beside = PlaneShape.LABEL_GAP + step * PlaneShape.BESIDE_STEP;
    switch (side) {
      case 'below':
        return new Box(centred, Math.round(bounds.bottom + offset), width, height);
      case 'above':
        return new Box(centred, Math.round(bounds.y - height - offset), width, height);
      case 'right':
        return new Box(Math.round(bounds.right + beside), middled, width, height);
      case 'left':
        return new Box(Math.round(bounds.x - width - beside), middled, width, height);
    }
  }

  labelSide(host?: Box): LabelSide | 'inside' | undefined {
    const { label, bounds } = this;
    const tolerance = PlaneShape.BORDER_TOLERANCE;
    if (!label) {
      return undefined;
    }
    if ((host && this.kind === 'boundary' && label.y >= host.bottom - tolerance) || label.y >= bounds.bottom - tolerance) {
      return 'below';
    }
    if (label.bottom <= bounds.y + tolerance) {
      return 'above';
    }
    if (label.x >= bounds.right - tolerance) {
      return 'right';
    }
    return label.right <= bounds.x + tolerance ? 'left' : 'inside';
  }
}
