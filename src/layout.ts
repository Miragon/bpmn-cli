/**
 * DI generation. The AI never sees this: every mutation ends here.
 *
 * bpmn-auto-layout discards all existing DI and re-derives it from the
 * semantic model. The single piece of information it harvests from old DI is
 * `isExpanded="true"` on sub-process shapes located on the plane of the layout
 * root. We therefore carry "expanded" as a convention:
 *
 *   - a sub-process is expanded by default (that is what modellers want),
 *   - it is collapsed only if the existing DI says so (a BPMNShape exists for it
 *     without isExpanded=true), or if the caller explicitly asks for it.
 *
 * Before calling the layouter we replace the DI with a minimal "hint" diagram
 * that lists the expanded sub-processes.
 *
 * Both engines write new DI; the ids the file's DI had are given back to it
 * afterwards (diagram/write.ts restoreDiIds: same DI, plane and diagram ids,
 * new DI in the file's DI id style), so a redraw only changes geometry.
 *
 * Two things the alpha layouter does not handle are patched around here:
 *
 *   - a process with lanes and a node in none of them (a lint state, W_NOT_IN_LANE)
 *     crashes the layouter as soon as a data object is shared between a lane
 *     member and the laneless node. Such nodes are put into a lane for the
 *     duration of the layout only (the written model is untouched).
 *   - associations whose non-annotation end is not a flow node (a sequence /
 *     message flow, a pool) and compensation associations (compensate boundary
 *     event -> handler) get no BPMNEdge. The edge is synthesised afterwards; a
 *     compensation handler is moved right below its boundary event (bpmn.io
 *     convention) when that spot is free.
 */
import { layoutProcess, LayoutError, LayoutWarning } from 'bpmn-auto-layout';
import { rememberDiIds, restoreDiIds } from './diagram/write.js';
import { layoutClean } from './layout/engine.js';
import { addTo, is, layoutRoot, many, parseXml, processes, removeFrom, serialize, walk, type El, type Model, ModelError } from './model.js';

export interface LayoutWarningInfo {
  code: string;
  elementId: string;
  message: string;
  relatedElementIds: string[];
}

export type LayoutEngine = 'clean' | 'auto';

export interface LayoutOptions {
  /** sub-process ids that must be expanded (in addition to what the DI says) */
  expand?: Iterable<string>;
  /** sub-process ids that must be collapsed */
  collapse?: Iterable<string>;
  /** 'clean' (built-in engine, default) or 'auto' (bpmn-auto-layout) */
  engine?: LayoutEngine;
}

export interface LayoutResult {
  xml: string;
  warnings: LayoutWarningInfo[];
  expanded: string[];
}

export const SUB_PROCESS_TYPES = ['bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction'];

function subProcesses(root: El): El[] {
  return [...walk(root)].filter((e) => SUB_PROCESS_TYPES.some((t) => is(e, t)) && !!e.get('id'));
}

function idOf(el: El): string {
  return el.get<string>('id');
}

/** Reads the expansion state recorded in the current DI. */
export function diExpansionState(defs: El): Map<string, boolean> {
  const state = new Map<string, boolean>();
  for (const diagram of many(defs, 'diagrams')) {
    const plane = diagram.get<El | undefined>('plane');
    if (!plane) continue;
    for (const shape of many(plane, 'planeElement')) {
      if (!is(shape, 'bpmndi:BPMNShape')) continue;
      const target = shape.get<El | undefined>('bpmnElement');
      const id = target?.get<string | undefined>('id');
      if (!id) continue;
      if (SUB_PROCESS_TYPES.some((t) => is(target, t))) {
        state.set(id, shape.get<boolean | undefined>('isExpanded') === true);
      }
    }
  }
  return state;
}

/**
 * Computes the set of sub-process ids that should be laid out expanded. Ids
 * in the options that are not sub-processes of the model are ignored (the
 * CLI validates them up front).
 */
export function resolveExpanded(model: Model, opts: LayoutOptions = {}): Set<string> {
  const diState = diExpansionState(model.definitions);
  const known = new Set(subProcesses(model.definitions).map(idOf));
  const expanded = new Set<string>();
  for (const id of known) {
    const recorded = diState.get(id);
    if (recorded === undefined || recorded) expanded.add(id);
  }
  for (const id of opts.expand ?? []) if (known.has(id)) expanded.add(id);
  for (const id of opts.collapse ?? []) expanded.delete(id);
  return expanded;
}

/** Replaces the DI of `model` with a hint diagram for the layouter. */
export function injectLayoutHints(model: Model, expanded: Set<string>): void {
  const { moddle, definitions } = model;
  const root = layoutRoot(definitions);
  definitions.set('diagrams', []);
  if (!root) return;
  const byId = new Map<string, El>();
  for (const sub of subProcesses(definitions)) byId.set(idOf(sub), sub);
  const plane = moddle.create('bpmndi:BPMNPlane', { id: `BPMNPlane_${idOf(root)}`, bpmnElement: root });
  const diagram = moddle.create('bpmndi:BPMNDiagram', { id: `BPMNDiagram_${idOf(root)}`, plane });
  plane.$parent = diagram;
  for (const id of expanded) {
    const sub = byId.get(id);
    if (!sub) continue;
    const shape = moddle.create('bpmndi:BPMNShape', { id: `BPMNShape_${id}`, bpmnElement: sub, isExpanded: true });
    addTo(plane, 'planeElement', shape);
  }
  addTo(definitions, 'diagrams', diagram);
}

/* ------------------------------------------------------------------ */
/* temporary lane membership                                            */
/* ------------------------------------------------------------------ */

interface TempMember {
  laneId: string;
  nodeId: string;
}

function allLanes(process: El): El[] {
  const out: El[] = [];
  const visit = (laneSet: El | undefined): void => {
    if (!laneSet) return;
    for (const lane of many(laneSet, 'lanes')) {
      out.push(lane);
      visit(lane.get<El | undefined>('childLaneSet'));
    }
  };
  for (const ls of many(process, 'laneSets')) visit(ls);
  return out;
}

function isLeafLane(lane: El): boolean {
  const child = lane.get<El | undefined>('childLaneSet');
  return !child || many(child, 'lanes').length === 0;
}

/** The lane a laneless node is drawn in: that of a connected neighbour, else the first leaf lane. */
function laneForLayout(node: El, laneOfNode: Map<El, El>, leafLanes: El[]): El | undefined {
  const neighbours: El[] = [];
  const host = node.get<El | undefined>('attachedToRef');
  if (host) neighbours.push(host);
  for (const f of node.get<El[] | undefined>('incoming') ?? []) {
    const src = f.get<El | undefined>('sourceRef');
    if (src) neighbours.push(src);
  }
  for (const f of node.get<El[] | undefined>('outgoing') ?? []) {
    const tgt = f.get<El | undefined>('targetRef');
    if (tgt) neighbours.push(tgt);
  }
  for (const n of neighbours) {
    const lane = laneOfNode.get(n);
    if (lane && isLeafLane(lane)) return lane;
  }
  return leafLanes[0];
}

/**
 * Puts every top-level flow node of a lane-partitioned process that is in no
 * lane into one, for the layout only. Returns what was added so it can be
 * stripped from the result again.
 */
function addTemporaryLaneMembers(defs: El): TempMember[] {
  const added: TempMember[] = [];
  for (const process of processes(defs)) {
    const lanes = allLanes(process);
    if (!lanes.length) continue;
    const leafLanes = lanes.filter(isLeafLane);
    if (!leafLanes.length) continue;
    const laneOfNode = new Map<El, El>();
    for (const lane of lanes) for (const n of lane.get<El[] | undefined>('flowNodeRef') ?? []) laneOfNode.set(n, lane);
    for (const node of many(process, 'flowElements')) {
      if (!is(node, 'bpmn:FlowNode') || laneOfNode.has(node) || !node.get('id')) continue;
      const lane = laneForLayout(node, laneOfNode, leafLanes);
      if (!lane) continue;
      addTo(lane, 'flowNodeRef', node);
      laneOfNode.set(node, lane);
      added.push({ laneId: idOf(lane), nodeId: idOf(node) });
    }
  }
  return added;
}

function removeTemporaryLaneMembers(defs: El, members: TempMember[]): void {
  if (!members.length) return;
  const byId = new Map<string, El>();
  for (const el of walk(defs)) {
    const id = el.get<string | undefined>('id');
    if (id) byId.set(id, el);
  }
  for (const { laneId, nodeId } of members) {
    const lane = byId.get(laneId);
    const node = byId.get(nodeId);
    if (lane && node) removeFrom(lane, 'flowNodeRef', node);
  }
}

/* ------------------------------------------------------------------ */
/* association edges the layouter leaves out                           */
/* ------------------------------------------------------------------ */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface PlaneIndex {
  plane: El;
  shapes: Map<El, El>;
  edges: Map<El, El>;
}

const HANDLER_GAP = 40;
const OVERLAP_MARGIN = 10;

function boundsOf(shape: El): Rect | undefined {
  const b = shape.get<El | undefined>('bounds');
  if (!b) return undefined;
  const x = b.get<number>('x');
  const y = b.get<number>('y');
  const width = b.get<number>('width');
  const height = b.get<number>('height');
  if ([x, y, width, height].some((v) => typeof v !== 'number')) return undefined;
  return { x, y, width, height };
}

function setBounds(shape: El, rect: Rect): void {
  const b = shape.get<El>('bounds');
  b.set('x', rect.x);
  b.set('y', rect.y);
}

function centre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function overlaps(a: Rect, b: Rect, margin = 0): boolean {
  return a.x - margin < b.x + b.width && a.x + a.width + margin > b.x && a.y - margin < b.y + b.height && a.y + a.height + margin > b.y;
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** The point on the border of `r` where a line from its centre towards `to` leaves it. */
function borderPoint(r: Rect, to: Point): Point {
  const c = centre(r);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (!dx && !dy) return c;
  const hw = r.width / 2;
  const hh = r.height / 2;
  if (Math.abs(dx) * hh >= Math.abs(dy) * hw) {
    const sx = Math.sign(dx) * hw;
    return { x: Math.round(c.x + sx), y: Math.round(c.y + (dy * sx) / dx) };
  }
  const sy = Math.sign(dy) * hh;
  return { x: Math.round(c.x + (dx * sy) / dy), y: Math.round(c.y + sy) };
}

function waypoints(edge: El): Point[] {
  return many(edge, 'waypoint').map((p) => ({ x: p.get<number>('x'), y: p.get<number>('y') }));
}

/** Midpoint of the middle segment of a polyline. */
function midpoint(points: Point[]): Point | undefined {
  if (!points.length) return undefined;
  if (points.length === 1) return points[0];
  const i = Math.floor((points.length - 1) / 2);
  const a = points[i]!;
  const b = points[i + 1]!;
  return { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
}

function indexPlanes(defs: El): PlaneIndex[] {
  const out: PlaneIndex[] = [];
  for (const diagram of many(defs, 'diagrams')) {
    const plane = diagram.get<El | undefined>('plane');
    if (!plane) continue;
    const shapes = new Map<El, El>();
    const edges = new Map<El, El>();
    for (const di of many(plane, 'planeElement')) {
      const target = di.get<El | undefined>('bpmnElement');
      if (!target) continue;
      if (is(di, 'bpmndi:BPMNShape')) shapes.set(target, di);
      else if (is(di, 'bpmndi:BPMNEdge')) edges.set(target, di);
    }
    out.push({ plane, shapes, edges });
  }
  return out;
}

/** Where an association may dock on an element: its shape, or the middle of its edge. */
function anchorOf(index: PlaneIndex, el: El): { rect?: Rect; point?: Point } | undefined {
  const shape = index.shapes.get(el);
  if (shape) {
    const rect = boundsOf(shape);
    return rect ? { rect } : undefined;
  }
  const edge = index.edges.get(el);
  if (edge) {
    const point = midpoint(waypoints(edge));
    return point ? { point } : undefined;
  }
  return undefined;
}

function dock(anchor: { rect?: Rect; point?: Point }, towards: Point): Point {
  return anchor.rect ? borderPoint(anchor.rect, towards) : anchor.point!;
}

function referenceOf(anchor: { rect?: Rect; point?: Point }): Point {
  return anchor.rect ? centre(anchor.rect) : anchor.point!;
}

function isCompensationHandlerPair(source: El, target: El): boolean {
  if (!is(source, 'bpmn:BoundaryEvent') || !is(target, 'bpmn:Activity')) return false;
  return many(source, 'eventDefinitions').some((d) => is(d, 'bpmn:CompensateEventDefinition'));
}

/** Container shapes (pools, lanes, expanded sub-processes) enclosing a point. */
function containersAround(index: PlaneIndex, p: Point): Rect[] {
  const out: Rect[] = [];
  for (const [el, shape] of index.shapes) {
    const isContainer = is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || (SUB_PROCESS_TYPES.some((t) => is(el, t)) && shape.get<boolean | undefined>('isExpanded') === true);
    if (!isContainer) continue;
    const r = boundsOf(shape);
    if (r && containsPoint(r, p)) out.push(r);
  }
  return out;
}

/**
 * Moves a compensation handler right below its boundary event when that spot
 * (or one a little further down) is free and inside the same containers.
 */
function placeHandlerBelow(index: PlaneIndex, handler: El, handlerRect: Rect, eventRect: Rect): Rect | undefined {
  const containers = containersAround(index, centre(handlerRect));
  const others: Rect[] = [];
  for (const [el, shape] of index.shapes) {
    if (el === handler) continue;
    if (is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane')) continue;
    if (SUB_PROCESS_TYPES.some((t) => is(el, t)) && shape.get<boolean | undefined>('isExpanded') === true) continue;
    const r = boundsOf(shape);
    if (r) others.push(r);
  }
  const x = Math.round(eventRect.x + eventRect.width / 2 - handlerRect.width / 2);
  for (let gap = HANDLER_GAP; gap <= HANDLER_GAP * 4; gap += 20) {
    const candidate: Rect = { x, y: eventRect.y + eventRect.height + gap, width: handlerRect.width, height: handlerRect.height };
    if (others.some((o) => overlaps(candidate, o, OVERLAP_MARGIN))) continue;
    if (!containers.every((c) => contains(c, candidate))) return undefined;
    return candidate;
  }
  return undefined;
}

/**
 * Creates a BPMNEdge for every association that has none although both ends
 * are drawn on the same plane. Returns the ids of the associations fixed.
 */
function synthesiseAssociationEdges(model: Model): string[] {
  const { moddle, definitions } = model;
  const planes = indexPlanes(definitions);
  if (!planes.length) return [];
  const fixed: string[] = [];
  for (const assoc of [...walk(definitions)].filter((e) => is(e, 'bpmn:Association'))) {
    const source = assoc.get<El | undefined>('sourceRef');
    const target = assoc.get<El | undefined>('targetRef');
    const id = assoc.get<string | undefined>('id');
    if (!source || !target || !id) continue;
    if (planes.some((p) => p.edges.has(assoc))) continue;
    const index = planes.find((p) => (p.shapes.has(source) || p.edges.has(source)) && (p.shapes.has(target) || p.edges.has(target)));
    if (!index) continue;
    let from = anchorOf(index, source);
    let to = anchorOf(index, target);
    if (!from || !to) continue;
    if (isCompensationHandlerPair(source, target) && from.rect && to.rect) {
      const moved = placeHandlerBelow(index, target, to.rect, from.rect);
      if (moved) {
        setBounds(index.shapes.get(target)!, moved);
        to = { rect: moved };
      }
    }
    const a = dock(from, referenceOf(to));
    const b = dock(to, a);
    const edge = moddle.create('bpmndi:BPMNEdge', {
      id: `BPMNEdge_${id}`,
      bpmnElement: assoc,
      waypoint: [moddle.create('dc:Point', a), moddle.create('dc:Point', b)],
    });
    addTo(index.plane, 'planeElement', edge);
    index.edges.set(assoc, edge);
    fixed.push(id);
  }
  return fixed;
}

/* ------------------------------------------------------------------ */
/* entry points                                                         */
/* ------------------------------------------------------------------ */

function toWarningInfo(w: LayoutWarning): LayoutWarningInfo {
  return { code: w.code, elementId: w.elementId, message: w.message, relatedElementIds: w.relatedElementIds ?? [] };
}

/**
 * Lays out the model. The model's in-memory DI is replaced by the hint diagram
 * as a side effect; callers should treat the returned XML as the truth and
 * re-parse it if they need DI.
 */
export async function layoutModel(model: Model, opts: LayoutOptions = {}): Promise<LayoutResult> {
  const expanded = resolveExpanded(model, opts);
  const diIds = rememberDiIds(model.definitions);
  if ((opts.engine ?? 'clean') === 'clean') {
    const { warnings } = layoutClean(model, expanded);
    restoreDiIds(model.definitions, diIds);
    const { xml } = await model.moddle.toXML(model.definitions, { format: true });
    return { xml, warnings: warnings.map((w) => ({ code: w.code, elementId: w.elementId, message: w.message, relatedElementIds: [] })), expanded: [...expanded] };
  }
  injectLayoutHints(model, expanded);
  const temporary = addTemporaryLaneMembers(model.definitions);
  let result: LayoutResult;
  try {
    const { xml: input } = await model.moddle.toXML(model.definitions, { format: true });
    result = await layoutXml(input, expanded);
  } finally {
    removeTemporaryLaneMembers(model.definitions, temporary);
  }
  const missingDi = result.warnings.some((w) => w.code === 'DI_NOT_CREATED');
  if (!temporary.length && !missingDi && !diIds.diagrams.length) return result;

  // second pass over the layouter's output: strip the temporary lane members, draw missing association edges, give the DI its ids back
  const laidOut = await parseXml(result.xml);
  removeTemporaryLaneMembers(laidOut.definitions, temporary);
  const fixed = new Set(missingDi ? synthesiseAssociationEdges(laidOut) : []);
  restoreDiIds(laidOut.definitions, diIds);
  return {
    xml: await serialize(laidOut),
    warnings: result.warnings.filter((w) => !(w.code === 'DI_NOT_CREATED' && fixed.has(w.elementId))),
    expanded: result.expanded,
  };
}

/** Lays out raw XML that already carries the right expansion hints. */
export async function layoutXml(xml: string, expanded: Set<string> = new Set()): Promise<LayoutResult> {
  try {
    const { xml: out, warnings } = await layoutProcess(xml);
    return { xml: out, warnings: warnings.map(toWarningInfo), expanded: [...expanded] };
  } catch (err) {
    if (err instanceof LayoutError) {
      throw new ModelError(`Layout failed: ${err.message}`, `LAYOUT_${err.code}`, {
        elementId: err.elementId,
        element: err.elementId,
        relatedElementIds: err.relatedElementIds ?? [],
        related: err.relatedElementIds ?? [],
      });
    }
    throw new ModelError(`Layout failed: ${(err as Error).message}`, 'LAYOUT_ERROR', {
      hint: 'bpmn-auto-layout (alpha) crashed on this model. Write without DI using --no-layout and run `bpmn layout` later, check `bpmn validate` for unusual structure (nodes outside lanes, unreachable nodes), and report the command and file.',
    });
  }
}
