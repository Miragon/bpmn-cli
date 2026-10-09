/**
 * design-iq stickies follow their flow node.
 *
 * A sticky is a `bpmiq:sticky` extension element of a process (namespace
 * https://bpmiq.io/schema/1.0/bpmiq, any prefix) with absolute canvas
 * coordinates in its own attributes (`x`, `y`, optional `width` / `height`,
 * default 120) and no DI. It belongs to the flow node nearest to it, as in
 * the design-iq editor (Miragon/design-iq PR #218, layout/apply.ts).
 *
 * CONTRACT
 *  stickyAnchors(defs) is taken BEFORE the ops: for every sticky with a
 *  numeric x and y, the flow node of the main diagram (the first
 *  BPMNDiagram) whose shape is nearest to the sticky's centre (distance to
 *  the shape, 0 inside; ties go to the smaller shape, so a sticky lying on a
 *  task inside an expanded sub-process belongs to the task) and the centre
 *  of that shape.
 *  followStickies(defs, anchors) runs on the final document (after the
 *  layout and the format operations): every sticky moves by the shift of its
 *  node's centre on the main diagram, rounded to whole pixels. A sticky whose
 *  node did not move, is gone or is no longer on the main diagram stays as
 *  it is, so a write that moves nothing never touches a sticky. Only the x / y
 *  attributes change. Returns the moved stickies (`id`, or
 *  `<processId>#<n>` for one without id) with their node.
 *  Anchors name processes and nodes by element (resolveAnchors maps them to
 *  their ids after the ops, so a renamed node is still followed).
 */
import { is, type El } from '../model.js';
import { idOf, raw, rawList } from './plane.js';

export const BPMIQ_URI = 'https://bpmiq.io/schema/1.0/bpmiq';

/** design-iq's default sticky size (apps/web sticky-model STICKY_SIZE). */
const DEFAULT_SIZE = 120;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

export interface StickyAnchor {
  /** the process the sticky belongs to, and its position among that process' stickies */
  process: El;
  index: number;
  stickyId?: string;
  /** the flow node it follows and that node's centre before the ops */
  node: El;
  centre: Point;
}

/** An anchor with the ids the process and node have after the ops. */
export interface ResolvedAnchor {
  processId: string;
  index: number;
  stickyId?: string;
  nodeId: string;
  centre: Point;
}

function isSticky(el: unknown): el is El {
  const type = raw<string>(el, '$type');
  if (!type || type.slice(type.indexOf(':') + 1).toLowerCase() !== 'sticky') return false;
  const ns = raw<{ uri?: string; prefix?: string }>(raw(el, '$descriptor'), 'ns');
  return ns?.uri === BPMIQ_URI || (!ns?.uri && type.startsWith('bpmiq:'));
}

/** The stickies of every process, in document order per process. */
function stickiesOf(defs: El): Array<{ process: El; stickies: El[] }> {
  const out: Array<{ process: El; stickies: El[] }> = [];
  for (const root of rawList(defs, 'rootElements')) {
    if (!is(root, 'bpmn:Process')) continue;
    const stickies = rawList(raw(root, 'extensionElements'), 'values').filter(isSticky);
    if (stickies.length) out.push({ process: root, stickies });
  }
  return out;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function boxOfSticky(sticky: El): Box | undefined {
  const x = num(raw(sticky, 'x'));
  const y = num(raw(sticky, 'y'));
  if (x === undefined || y === undefined) return undefined;
  return { x, y, width: num(raw(sticky, 'width')) ?? DEFAULT_SIZE, height: num(raw(sticky, 'height')) ?? DEFAULT_SIZE };
}

/** Flow node shapes of the main diagram (the first BPMNDiagram) by element. */
function mainShapes(defs: El): Map<El, Box> {
  const out = new Map<El, Box>();
  const plane = raw(rawList(defs, 'diagrams')[0], 'plane');
  for (const pe of rawList(plane, 'planeElement')) {
    if (!is(pe, 'bpmndi:BPMNShape')) continue;
    const el = raw<El>(pe, 'bpmnElement');
    const b = raw(pe, 'bounds');
    const box = { x: num(raw(b, 'x')), y: num(raw(b, 'y')), width: num(raw(b, 'width')), height: num(raw(b, 'height')) };
    if (!el || !is(el, 'bpmn:FlowNode') || box.x === undefined || box.y === undefined || box.width === undefined || box.height === undefined) continue;
    out.set(el, box as Box);
  }
  return out;
}

const centreOf = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

function distance(p: Point, r: Box): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/** The node every sticky follows (see the module contract); [] for a file without stickies or diagram. */
export function stickyAnchors(defs: El): StickyAnchor[] {
  const groups = stickiesOf(defs);
  if (!groups.length) return [];
  const shapes = [...mainShapes(defs)];
  if (!shapes.length) return [];
  const out: StickyAnchor[] = [];
  for (const { process, stickies } of groups) {
    stickies.forEach((sticky, index) => {
      const box = boxOfSticky(sticky);
      if (!box) return;
      const c = centreOf(box);
      let best: { el: El; box: Box; d: number } | undefined;
      for (const [el, b] of shapes) {
        const d = distance(c, b);
        if (!best || d < best.d || (d === best.d && b.width * b.height < best.box.width * best.box.height)) best = { el, box: b, d };
      }
      if (best) out.push({ process, index, ...(idOf(sticky) ? { stickyId: idOf(sticky) } : {}), node: best.el, centre: centreOf(best.box) });
    });
  }
  return out;
}

/** Moves the stickies of `defs` with their nodes (see the module contract); returns what moved. */
export function followStickies(defs: El, anchors: readonly ResolvedAnchor[]): Array<{ sticky: string; node: string }> {
  if (!anchors.length) return [];
  const byId = new Map<string, Box>();
  for (const [el, box] of mainShapes(defs)) {
    const id = idOf(el);
    if (id) byId.set(id, box);
  }
  const groups = new Map(stickiesOf(defs).map((g) => [idOf(g.process), g.stickies] as const));
  const moved: Array<{ sticky: string; node: string }> = [];
  for (const a of anchors) {
    const now = byId.get(a.nodeId);
    const stickies = groups.get(a.processId);
    if (!now || !stickies) continue;
    const sticky = a.stickyId !== undefined ? stickies.find((s) => idOf(s) === a.stickyId) : stickies[a.index];
    const box = sticky ? boxOfSticky(sticky) : undefined;
    if (!sticky || !box) continue;
    const c = centreOf(now);
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
