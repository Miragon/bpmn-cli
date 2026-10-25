import { is, type El } from '../model/utils/moddle.js';
import { idOf, raw, rawList } from './utils/raw.js';
import { center } from './utils/geom.js';
import type { Box, Point } from './types.js';

export const BPMIQ_URI = 'https://bpmiq.io/schema/1.0/bpmiq';

/** design-iq's default sticky size */
const DEFAULT_SIZE = 120;

export interface StickyAnchor {
  process: El;
  index: number;
  stickyId?: string;
  /** the node it follows, with its centre before the ops */
  node: El;
  centre: Point;
}

/** Resolved after the ops, so a renamed node is still followed. */
export interface ResolvedAnchor {
  processId: string;
  index: number;
  stickyId?: string;
  nodeId: string;
  centre: Point;
}

/**
 * design-iq stickies follow their flow node. A sticky is a `bpmiq:sticky` extension element of a
 * process with absolute coordinates in its attributes and no DI; it belongs to the nearest node.
 */
export class Stickies {
  constructor(private readonly defs: El) {}

  private isSticky(el: unknown): el is El {
    const type = raw<string>(el, '$type');
    if (!type || type.slice(type.indexOf(':') + 1).toLowerCase() !== 'sticky') return false;
    const ns = raw<{ uri?: string; prefix?: string }>(raw(el, '$descriptor'), 'ns');
    return ns?.uri === BPMIQ_URI || (!ns?.uri && type.startsWith('bpmiq:'));
  }

  private stickiesOf(): Array<{ process: El; stickies: El[] }> {
    const out: Array<{ process: El; stickies: El[] }> = [];
    for (const root of rawList(this.defs, 'rootElements')) {
      if (!is(root, 'bpmn:Process')) continue;
      const stickies = rawList(raw(root, 'extensionElements'), 'values').filter(this.isSticky);
      if (stickies.length) out.push({ process: root, stickies });
    }
    return out;
  }

  private num(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  }

  private boxOfSticky(sticky: El): Box | undefined {
    const x = this.num(raw(sticky, 'x'));
    const y = this.num(raw(sticky, 'y'));
    if (x === undefined || y === undefined) return undefined;
    return { x, y, width: this.num(raw(sticky, 'width')) ?? DEFAULT_SIZE, height: this.num(raw(sticky, 'height')) ?? DEFAULT_SIZE };
  }

  /** The main diagram is the first BPMNDiagram. */
  private mainShapes(): Map<El, Box> {
    const out = new Map<El, Box>();
    const plane = raw(rawList(this.defs, 'diagrams')[0], 'plane');
    for (const pe of rawList(plane, 'planeElement')) {
      if (!is(pe, 'bpmndi:BPMNShape')) continue;
      const el = raw<El>(pe, 'bpmnElement');
      const b = raw(pe, 'bounds');
      const box = { x: this.num(raw(b, 'x')), y: this.num(raw(b, 'y')), width: this.num(raw(b, 'width')), height: this.num(raw(b, 'height')) };
      if (!el || !is(el, 'bpmn:FlowNode') || box.x === undefined || box.y === undefined || box.width === undefined || box.height === undefined) continue;
      out.set(el, box as Box);
    }
    return out;
  }

  private distance(p: Point, r: Box): number {
    const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
    const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
    return Math.hypot(dx, dy);
  }

  /**
   * Take before the ops: the node whose shape is nearest to each sticky's centre. Ties go to the
   * smaller shape, so a sticky on a task inside a sub-process belongs to the task.
   */
  anchors(): StickyAnchor[] {
    const groups = this.stickiesOf();
    if (!groups.length) return [];
    const shapes = [...this.mainShapes()];
    if (!shapes.length) return [];
    const out: StickyAnchor[] = [];
    for (const { process, stickies } of groups) {
      stickies.forEach((sticky, index) => {
        const box = this.boxOfSticky(sticky);
        if (!box) return;
        const c = center(box);
        let best: { el: El; box: Box; d: number } | undefined;
        for (const [el, b] of shapes) {
          const d = this.distance(c, b);
          if (!best || d < best.d || (d === best.d && b.width * b.height < best.box.width * best.box.height)) best = { el, box: b, d };
        }
        if (best) out.push({ process, index, ...(idOf(sticky) ? { stickyId: idOf(sticky) } : {}), node: best.el, centre: center(best.box) });
      });
    }
    return out;
  }

  /**
   * Run on the final document: each sticky moves by its node's shift, rounded. A sticky whose
   * node did not move or is gone stays, so a write that moves nothing never touches one.
   */
  follow(anchors: readonly ResolvedAnchor[]): Array<{ sticky: string; node: string }> {
    if (!anchors.length) return [];
    const byId = new Map<string, Box>();
    for (const [el, box] of this.mainShapes()) {
      const id = idOf(el);
      if (id) byId.set(id, box);
    }
    const groups = new Map(this.stickiesOf().map((g) => [idOf(g.process), g.stickies] as const));
    const moved: Array<{ sticky: string; node: string }> = [];
    for (const a of anchors) {
      const now = byId.get(a.nodeId);
      const stickies = groups.get(a.processId);
      if (!now || !stickies) continue;
      const sticky = a.stickyId !== undefined ? stickies.find((s) => idOf(s) === a.stickyId) : stickies[a.index];
      const box = sticky ? this.boxOfSticky(sticky) : undefined;
      if (!sticky || !box) continue;
      const c = center(now);
      const dx = Math.round(c.x - a.centre.x);
      const dy = Math.round(c.y - a.centre.y);
      if (!dx && !dy) continue;
      // a generic (untyped) element: its attributes are plain string properties
      const attrs = sticky as unknown as Record<string, unknown>;
      if (dx) attrs['x'] = String(Math.round(box.x + dx));
      if (dy) attrs['y'] = String(Math.round(box.y + dy));
      moved.push({ sticky: a.stickyId ?? `${a.processId}#${a.index}`, node: a.nodeId });
    }
    return moved;
  }
}
