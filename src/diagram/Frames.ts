import type { DShape, Plane } from './types.js';
import { bottom, type Box } from './utils/geom.js';
import { raw } from './utils/raw.js';
import { titleBox, titleDepth } from './utils/text.js';

type Framed = Pick<DShape, 'parentId' | 'laneId' | 'poolId' | 'kind'>;

/** The frames of a plane: which frame holds a shape, where content and labels may sit in one. */
export class Frames {
  /** The innermost frame of a shape: expanded parent sub-process, else lane, else pool. */
  static of(plane: Plane, s: Framed): DShape | undefined {
    if (s.parentId) {
      const p = plane.shapes.get(s.parentId);
      if (p) return p;
    }
    if (s.laneId) {
      const l = plane.shapes.get(s.laneId);
      if (l) return l;
    }
    if (s.poolId) return plane.shapes.get(s.poolId);
    return undefined;
  }

  /**
   * True when `frame` is `s`'s frame or an ancestor of it.
   * An undefined frame is the plane, which holds everything.
   */
  static within(plane: Plane, s: Framed, frame: DShape | undefined): boolean {
    if (!frame) return true;
    let f = Frames.of(plane, s);
    for (let i = 0; f && i < 12; i++) {
      if (f === frame) return true;
      f = Frames.of(plane, f);
    }
    return false;
  }

  /** The frame chain of a shape, innermost first. */
  static chain(plane: Plane, s: DShape): DShape[] {
    const out: DShape[] = [];
    let f = Frames.of(plane, s);
    for (let i = 0; f && i < 16 && !out.includes(f); i++) {
      out.push(f);
      f = Frames.of(plane, f);
    }
    return out;
  }

  /**
   * Inner area of a frame where content may sit (headers and padding left out;
   * a sub-process keeps 25 px at the top, or its title and 4 px below it).
   */
  static interior(frame: DShape, pad = 15): Box {
    const head = frame.kind === 'participant' || frame.kind === 'lane' ? 30 : 0;
    const b = frame.bounds;
    const top = frame.kind === 'subProcess' ? Math.max(pad, 25, Math.round(titleDepth(raw<string>(frame.el, 'name'), b.width) + 4)) : pad;
    return { x: b.x + head + pad, y: b.y + top, width: Math.max(0, b.width - head - 2 * pad), height: Math.max(0, b.height - top - pad) };
  }

  /** Where an expanded sub-process draws its title; undefined for other shapes or no name. */
  static title(s: DShape): Box | undefined {
    return s.kind === 'subProcess' && s.container ? titleBox(s.bounds, raw<string>(s.el, 'name')) : undefined;
  }

  /** Where a label inside `frame` goes first: 2 px inside its border, below its title. */
  static labelArea(frame: DShape): Box {
    const b = frame.bounds;
    const title = Frames.title(frame);
    const top = title ? bottom(title) + 2 : b.y + 2;
    return { x: b.x + 2, y: top, width: Math.max(0, b.width - 4), height: Math.max(0, bottom(b) - 2 - top) };
  }
}
