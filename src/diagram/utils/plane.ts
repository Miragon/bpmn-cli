/**
 * Queries on a plane (src/diagram/plane.ts reads it): kinds, frames,
 * content, the measured spacing, and the raw property access that never
 * materialises an empty collection on the model.
 */
import { is, type El } from '../../model/utils/moddle.js';
import type { DEdge, DShape, EdgeKind, Plane, ShapeKind } from '../types.js';
import { clamp, cy, median, right, unionAll, type Box } from './geom.js';
import { titleBox, titleDepth } from './text.js';

export function raw<T>(el: unknown, prop: string): T | undefined {
  return el && typeof el === 'object' ? ((el as Record<string, unknown>)[prop] as T | undefined) : undefined;
}

export const rawList = (el: unknown, prop: string): El[] => raw<El[]>(el, prop) ?? [];

export const idOf = (el: unknown): string | undefined => raw<string>(el, 'id');

/** The Box of a dc:Bounds; undefined when a coordinate is missing or not finite. */
export function boxOf(bounds: unknown): Box | undefined {
  if (!bounds) return undefined;
  const b = { x: raw<number>(bounds, 'x'), y: raw<number>(bounds, 'y'), width: raw<number>(bounds, 'width'), height: raw<number>(bounds, 'height') };
  if ([b.x, b.y, b.width, b.height].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return undefined;
  return b as Box;
}

export const SUB_PROCESS = ['bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction'];

export function isSubProcess(el: El): boolean {
  return SUB_PROCESS.some((t) => is(el, t));
}

export function shapeKind(el: El): ShapeKind {
  if (is(el, 'bpmn:BoundaryEvent')) return 'boundary';
  if (is(el, 'bpmn:Event')) return 'event';
  if (is(el, 'bpmn:Gateway')) return 'gateway';
  if (isSubProcess(el)) return 'subProcess';
  if (is(el, 'bpmn:Activity')) return 'task';
  if (is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference') || is(el, 'bpmn:DataInput') || is(el, 'bpmn:DataOutput')) return 'data';
  if (is(el, 'bpmn:TextAnnotation')) return 'annotation';
  if (is(el, 'bpmn:Participant')) return 'participant';
  if (is(el, 'bpmn:Lane')) return 'lane';
  if (is(el, 'bpmn:Group')) return 'group';
  return 'other';
}

export function edgeKind(el: El): EdgeKind {
  if (is(el, 'bpmn:SequenceFlow')) return 'sequenceFlow';
  if (is(el, 'bpmn:MessageFlow')) return 'messageFlow';
  if (is(el, 'bpmn:Association')) return 'association';
  if (is(el, 'bpmn:DataAssociation')) return 'dataAssociation';
  return 'other';
}

/** Shapes that are drawn as obstacles / take part in overlap removal (not containers, not groups). */
export function isLeaf(s: DShape): boolean {
  return !s.container && s.kind !== 'group';
}

/** The semantic ends of a connection (data associations: the activity is the parent element). */
export function edgeEnds(el: El): { sourceId?: string; targetId?: string } {
  if (is(el, 'bpmn:DataInputAssociation')) {
    const src = rawList(el, 'sourceRef')[0];
    return { sourceId: idOf(src), targetId: idOf(el.$parent) };
  }
  if (is(el, 'bpmn:DataOutputAssociation')) return { sourceId: idOf(el.$parent), targetId: idOf(raw(el, 'targetRef')) };
  return { sourceId: idOf(raw(el, 'sourceRef')), targetId: idOf(raw(el, 'targetRef')) };
}

/**
 * The element a BPMNPlane without bpmnElement shows: like bpmn-js (which
 * corrects such DI on import), the first process or collaboration.
 */
export function displayRoot(defs: El | undefined): El | undefined {
  return rawList(defs, 'rootElements').find((r) => is(r, 'bpmn:Process') || is(r, 'bpmn:Collaboration'));
}

/** The plane a shape or edge with this id is drawn on. */
export function planeWith(planes: readonly Plane[], id: string): Plane | undefined {
  return planes.find((p) => p.shapes.has(id) || p.edges.has(id));
}

/**
 * The innermost frame of a shape: its expanded parent sub-process, else its
 * lane, else its pool (undefined at plane level).
 */
export function frameOf(plane: Plane, s: Pick<DShape, 'parentId' | 'laneId' | 'poolId' | 'kind'>): DShape | undefined {
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

/** True when `frame` is `s`'s frame or an ancestor of it (undefined: the plane, which holds everything). */
export function inFrame(plane: Plane, s: Pick<DShape, 'parentId' | 'laneId' | 'poolId' | 'kind'>, frame: DShape | undefined): boolean {
  if (!frame) return true;
  let f = frameOf(plane, s);
  for (let i = 0; f && i < 12; i++) {
    if (f === frame) return true;
    f = frameOf(plane, f);
  }
  return false;
}

/**
 * Inner area of a frame where content may sit (headers and padding left out;
 * a sub-process keeps 25 px at the top, or its title and 4 px below it).
 */
export function frameInterior(frame: DShape, pad = 15): Box {
  const head = frame.kind === 'participant' || frame.kind === 'lane' ? 30 : 0;
  const b = frame.bounds;
  const top = frame.kind === 'subProcess' ? Math.max(pad, 25, Math.round(titleDepth(raw<string>(frame.el, 'name'), b.width) + 4)) : pad;
  return { x: b.x + head + pad, y: b.y + top, width: Math.max(0, b.width - head - 2 * pad), height: Math.max(0, b.height - top - pad) };
}

/** Where the title of an expanded sub-process is drawn (diagram/utils/text.ts titleBox); undefined for any other shape and without a name. */
export function titleOf(s: DShape): Box | undefined {
  return s.kind === 'subProcess' && s.container ? titleBox(s.bounds, raw<string>(s.el, 'name')) : undefined;
}

/** The leaf shapes of a plane (no containers, no groups). */
export function leaves(plane: Plane): DShape[] {
  return [...plane.shapes.values()].filter(isLeaf);
}

/** Shapes and edges drawn inside an expanded sub-process (all depths). */
export function contentOf(plane: Plane, subId: string): { shapes: DShape[]; edges: DEdge[] } {
  const inside = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of plane.shapes.values()) {
      if (inside.has(s.id)) continue;
      if (s.parentId === subId || (s.parentId && inside.has(s.parentId)) || (s.hostId && inside.has(s.hostId))) {
        inside.add(s.id);
        grew = true;
      }
    }
  }
  const shapes = [...plane.shapes.values()].filter((s) => inside.has(s.id));
  const edges = [...plane.edges.values()].filter((e) => (e.sourceId && inside.has(e.sourceId)) || (e.targetId && inside.has(e.targetId)));
  return { shapes, edges };
}

/** Boundary events attached to a host, in plane order. */
export function boundariesOf(plane: Plane, hostId: string): DShape[] {
  return [...plane.shapes.values()].filter((s) => s.hostId === hostId);
}

/** Bounding box of the leaf content of a plane (or of the shapes passing `filter`). */
export function contentBox(plane: Plane, filter: (s: DShape) => boolean = isLeaf): Box | undefined {
  return unionAll([...plane.shapes.values()].filter(filter).map((s) => s.bounds));
}

export interface Spacing {
  /** horizontal gap between connected neighbours */
  gap: number;
  /** vertical distance between row centres */
  row: number;
  /** centres closer than this are on the same row */
  rowTol: number;
}

/** Gap and row spacing of a plane, measured on its sequence flows. */
export function spacingOf(plane: Plane): Spacing {
  const gaps: number[] = [];
  const rows: number[] = [];
  for (const e of plane.edges.values()) {
    if (e.kind !== 'sequenceFlow' || !e.sourceId || !e.targetId) continue;
    const s = plane.shapes.get(e.sourceId);
    const t = plane.shapes.get(e.targetId);
    if (!s || !t || s.kind === 'boundary' || s.container || t.container) continue;
    const dy = Math.abs(cy(s.bounds) - cy(t.bounds));
    if (dy <= 5) {
      const g = t.bounds.x - right(s.bounds);
      if (g > 0) gaps.push(g);
    } else if (dy >= 30) rows.push(dy);
  }
  const gap = Math.round(clamp(median(gaps) ?? 60, 40, 100));
  const row = Math.round(clamp(median(rows) ?? 140, 80, 150));
  return { gap, row, rowTol: Math.max(5, row / 4) };
}
