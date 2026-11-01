import { TextMetrics } from '@miragon/bpmn-render/text';
import { Box, type BpmnElement } from '../../model/index.js';
import type { DShape } from './DShape.js';
import type { Plane } from './Plane.js';

export type Framed = Pick<DShape, 'parentId' | 'laneId' | 'poolId'>;

export class Frames {
  private static readonly MAX_DEPTH = 12;
  private static readonly MAX_CHAIN = 16;
  private static readonly HEADER = 30;
  private static readonly TOP_OF_SUB_PROCESS = 25;

  constructor(private readonly plane: Plane) {}

  static interior(frame: DShape, pad = 15): Box {
    const { bounds } = frame;
    const head = frame.kind === 'participant' || frame.kind === 'lane' ? Frames.HEADER : 0;
    const top = frame.kind === 'subProcess' ? Math.max(pad, Frames.TOP_OF_SUB_PROCESS, Math.round(TextMetrics.titleDepth(frame.el.peek<string>('name'), bounds.width) + 4)) : pad;
    return new Box(bounds.x + head + pad, bounds.y + top, Math.max(0, bounds.width - head - 2 * pad), Math.max(0, bounds.height - top - pad));
  }

  static titleBox(bounds: Box, name: string | undefined): Box | undefined {
    const title = TextMetrics.titleBox(bounds, name);
    return title && new Box(title.x, title.y, title.width, title.height);
  }

  static title(shape: DShape): Box | undefined {
    return shape.kind === 'subProcess' && shape.container ? Frames.titleBox(shape.bounds, shape.el.peek<string>('name')) : undefined;
  }

  static labelArea(frame: DShape): Box {
    const { bounds } = frame;
    const title = Frames.title(frame);
    const top = title ? title.bottom + 2 : bounds.y + 2;
    return new Box(bounds.x + 2, top, Math.max(0, bounds.width - 4), Math.max(0, bounds.bottom - 2 - top));
  }

  static isContainerDi(di: BpmnElement, element: BpmnElement): boolean {
    return element.is('bpmn:Participant') || element.is('bpmn:Lane') || di.peek<boolean>('isExpanded') === true;
  }

  of(framed: Framed): DShape | undefined {
    const { shapes } = this.plane;
    const parent = framed.parentId ? shapes.get(framed.parentId) : undefined;
    const lane = framed.laneId ? shapes.get(framed.laneId) : undefined;
    return parent ?? lane ?? (framed.poolId ? shapes.get(framed.poolId) : undefined);
  }

  within(framed: Framed, frame: DShape | undefined): boolean {
    if (!frame) {
      return true;
    }
    let ancestor = this.of(framed);
    for (let depth = 0; ancestor && depth < Frames.MAX_DEPTH; depth++) {
      if (ancestor === frame) {
        return true;
      }
      ancestor = this.of(ancestor);
    }
    return false;
  }

  chain(shape: DShape): DShape[] {
    const chain: DShape[] = [];
    let ancestor = this.of(shape);
    for (let depth = 0; ancestor && depth < Frames.MAX_CHAIN && !chain.includes(ancestor); depth++) {
      chain.push(ancestor);
      ancestor = this.of(ancestor);
    }
    return chain;
  }
}
