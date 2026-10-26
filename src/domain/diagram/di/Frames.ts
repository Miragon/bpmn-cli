import type { DShape, Plane } from './types.js';
import { bottom, type Box } from '../utils/geom.js';
import { raw } from '../utils/raw.js';
import { titleBox, titleDepth } from '../utils/text.js';

type Framed = Pick<DShape, 'parentId' | 'laneId' | 'poolId' | 'kind'>;

/** The frames of a plane: which frame holds a shape, where content and labels may sit in one. */
export class Frames {
  /** The innermost frame of a shape: expanded parent sub-process, else lane, else pool. */
  static of(plane: Plane, framed: Framed): DShape | undefined {
    if (framed.parentId) {
      const parent = plane.shapes.get(framed.parentId);
      if (parent) return parent;
    }
    if (framed.laneId) {
      const lane = plane.shapes.get(framed.laneId);
      if (lane) return lane;
    }
    if (framed.poolId) return plane.shapes.get(framed.poolId);
    return undefined;
  }

  /**
   * True when `frame` is `s`'s frame or an ancestor of it.
   * An undefined frame is the plane, which holds everything.
   */
  static within(plane: Plane, framed: Framed, frame: DShape | undefined): boolean {
    if (!frame) return true;
    let ancestor = Frames.of(plane, framed);
    for (let depth = 0; ancestor && depth < 12; depth++) {
      if (ancestor === frame) return true;
      ancestor = Frames.of(plane, ancestor);
    }
    return false;
  }

  /** The frame chain of a shape, innermost first. */
  static chain(plane: Plane, shape: DShape): DShape[] {
    const out: DShape[] = [];
    let ancestor = Frames.of(plane, shape);
    for (let depth = 0; ancestor && depth < 16 && !out.includes(ancestor); depth++) {
      out.push(ancestor);
      ancestor = Frames.of(plane, ancestor);
    }
    return out;
  }

  /**
   * Inner area of a frame where content may sit (headers and padding left out;
   * a sub-process keeps 25 px at the top, or its title and 4 px below it).
   */
  static interior(frame: DShape, pad = 15): Box {
    const head = frame.kind === 'participant' || frame.kind === 'lane' ? 30 : 0;
    const bounds = frame.bounds;
    const top = frame.kind === 'subProcess' ? Math.max(pad, 25, Math.round(titleDepth(raw<string>(frame.el, 'name'), bounds.width) + 4)) : pad;
    return { x: bounds.x + head + pad, y: bounds.y + top, width: Math.max(0, bounds.width - head - 2 * pad), height: Math.max(0, bounds.height - top - pad) };
  }

  /** Where an expanded sub-process draws its title; undefined for other shapes or no name. */
  static title(shape: DShape): Box | undefined {
    return shape.kind === 'subProcess' && shape.container ? titleBox(shape.bounds, raw<string>(shape.el, 'name')) : undefined;
  }

  /** Where a label inside `frame` goes first: 2 px inside its border, below its title. */
  static labelArea(frame: DShape): Box {
    const bounds = frame.bounds;
    const title = Frames.title(frame);
    const top = title ? bottom(title) + 2 : bounds.y + 2;
    return { x: bounds.x + 2, y: top, width: Math.max(0, bounds.width - 4), height: Math.max(0, bottom(bounds) - 2 - top) };
  }
}
