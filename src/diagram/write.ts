/**
 * Writes planes (src/diagram/plane.ts) back into the moddle DI.
 *
 * CONTRACT
 *  - writePlanes(model, planes): for every shape/edge that has DI, bounds,
 *    waypoints and label bounds are updated IN PLACE when they changed (every
 *    other attribute survives: bioc:/color: colours, foreign attributes,
 *    isMarkerVisible, ...). Shapes/edges without DI get a new BPMNShape /
 *    BPMNEdge in their plane, with an id in the file's prevailing style
 *    (`<id>_di`, `BPMNShape_<id>` / `BPMNEdge_<id>` or `Shape_<id>` /
 *    `Edge_<id>`), isHorizontal on pools and lanes, isExpanded on
 *    sub-processes and isMarkerVisible on exclusive gateways. A DI element
 *    whose shape moved to another plane is moved there. `plane.dropped` DI
 *    elements are deleted. A plane without DI gets a new BPMNDiagram.
 *    Coordinates are rounded to whole pixels when written; a connection
 *    keeps at least two waypoints (rounding never merges its ends into one;
 *    the engine reroutes zero-length connections before, reroute.ts).
 *  - rememberDiIds(defs) / restoreDiIds(defs, memo): a full redraw (the
 *    engine writes new DI) keeps the ids the file's DI had: every BPMNShape /
 *    BPMNEdge gets the id of the old DI element of its element, every
 *    BPMNPlane / BPMNDiagram the ids of the old diagram of the same root (a
 *    main diagram whose root changed, e.g. to a new collaboration, keeps the
 *    old ids unless they were derived from the old root's id like
 *    `BPMNPlane_<processId>`, also cut); DI of elements that had none
 *    follows the file's DI id style (diIds). A file without DI (or without
 *    shapes and edges showing a style) gets the engine's form, `BPMNShape_<id>` /
 *    `BPMNEdge_<id>` / `BPMNPlane_<root>` / `BPMNDiagram_<root>`, with a
 *    long element id cut like styledId (every DI id within 64 characters;
 *    a taken one gets `_2`, after the ids that need no cut). An old id is
 *    never cut: an old DI id over 64 characters stays.
 *  - followDiIds(defs, el, old, id, ids): an element renamed `old` -> `id`
 *    (`set id=`, a flow that follows its ends) takes its BPMNShape /
 *    BPMNEdge ids along where they were derived from `old` (diStyleOf:
 *    `<old>_di`, `BPMNShape_<old>`, `Edge_<old>`, also cut, also as 0.6
 *    cut them, also with a collision suffix `_2`), `_2` when the new one
 *    is taken; any other DI id stays.
 *  - pruneDi(defs, sem): deletes DI whose semantic element is gone (or is not
 *    the element registered under its id) and diagrams whose root is gone;
 *    returns the ids of the deleted DI's elements.
 *  - pruneEdges(defs, stale): deletes every BPMNEdge for which
 *    `stale(edge, plane, further)` is true (`further`: its diagram shows a
 *    root an earlier diagram already shows, a second view); returns the ids
 *    of their elements in document order. Used for the edges of flows whose
 *    ends changed (layout/incremental.ts pruneReEnded).
 *  - colorsOf(defs) / applyColors(defs, colors): the bpmn-js colour
 *    attributes by element id, used to carry colours over a full redraw.
 *  - setSwatch(di, swatch) writes one colour of the bpmn-js colour
 *    picker (SWATCHES) on a BPMNShape / BPMNEdge: shapes bioc:fill,
 *    bioc:stroke, color:background-color, color:border-color; edges
 *    bioc:stroke, color:border-color; an existing BPMNLabel color:color =
 *    stroke (bpmn-js falls back to the stroke for a label without one).
 *    `undefined` removes every colour attribute. swatchOf(di) reads it
 *    back (the swatch name, or 'custom').
 */
import type { BpmnModdle } from 'bpmn-moddle';
import { cutAt, MAX_ID } from '../ids/utils/slug.js';
import { addTo, is, removeFrom, type El } from '../model/utils/moddle.js';
import { roundPoints, sameBox, samePoints, type Box, type Point } from './geom.js';
import { displayRoot, idOf, raw, rawList, type DEdge, type DShape, type Plane, type Semantics } from './plane.js';

/* ------------------------------------------------------------------ */
/* id style                                                             */
/* ------------------------------------------------------------------ */

export type Style = 'suffix' | 'bpmn' | 'short';

export interface DiIds {
  shape(id: string): string;
  edge(id: string): string;
  plane(id: string): string;
  diagram(id: string): string;
}

function styleOf(diId: string, elId: string, kind: 'Shape' | 'Edge'): Style | undefined {
  if (diId === `${elId}_di`) return 'suffix';
  if (diId === `BPMN${kind}_${elId}`) return 'bpmn';
  if (diId === `${kind}_${elId}`) return 'short';
  return undefined;
}

function allIds(defs: El): Set<string> {
  const ids = new Set<string>();
  const stack: El[] = [defs];
  const seen = new Set<El>();
  while (stack.length) {
    const el = stack.pop()!;
    if (seen.has(el)) continue;
    seen.add(el);
    const id = idOf(el);
    if (id) ids.add(id);
    const descriptor = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean }> };
    if (descriptor.isGeneric) continue;
    for (const p of descriptor.properties ?? []) {
      if (p.isReference) continue;
      const v = raw<unknown>(el, p.name);
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c === 'object' && '$type' in c) stack.push(c as El);
      } else if (v && typeof v === 'object' && '$type' in v) stack.push(v as El);
    }
  }
  return ids;
}

/** The DI id styles of shapes and edges most DI of the file uses (edges without a style like shapes; undefined: no DI shows one). */
function diStyles(defs: El): { shape?: Style; edge?: Style } {
  const votes = { Shape: new Map<Style, number>(), Edge: new Map<Style, number>() };
  for (const diagram of rawList(defs, 'diagrams')) {
    for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
      const kind = is(pe, 'bpmndi:BPMNShape') ? 'Shape' : is(pe, 'bpmndi:BPMNEdge') ? 'Edge' : undefined;
      const diId = idOf(pe);
      const elId = idOf(raw(pe, 'bpmnElement'));
      if (!kind || !diId || !elId) continue;
      const style = styleOf(diId, elId, kind);
      if (style) votes[kind].set(style, (votes[kind].get(style) ?? 0) + 1);
    }
  }
  const pick = (m: Map<Style, number>, fallback?: Style): Style | undefined => {
    let best = fallback;
    let n = 0;
    for (const s of ['suffix', 'bpmn', 'short'] as Style[]) {
      const v = m.get(s) ?? 0;
      if (v > n) {
        best = s;
        n = v;
      }
    }
    return best;
  };
  const shape = pick(votes.Shape);
  return { shape, edge: pick(votes.Edge, shape) };
}

/** The longest DI id before a collision suffix (`_99`). */
const MAX_DI = MAX_ID - 3;

/**
 * The DI id of an element in a style (`<id>_di`, `BPMNShape_<id>`,
 * `Edge_<id>`), at most MAX_ID characters less room for a collision suffix:
 * a long element id is cut at a word boundary (src/ids/utils/slug.ts cutAt), like the
 * element ids themselves. `legacy`: cut as 0.6 cut (recognising the DI ids
 * it wrote).
 */
export function styledId(style: Style, kind: 'Shape' | 'Edge', id: string, legacy = false): string {
  const [head, tail] = style === 'suffix' ? ['', '_di'] : style === 'bpmn' ? [`BPMN${kind}_`, ''] : [`${kind}_`, ''];
  const room = MAX_DI - head.length - tail.length;
  return `${head}${id.length > room ? cutAt(id, room, legacy) : id}${tail}`;
}

/** Whether `diId` is `base` or `base` with the collision suffix claimUnique gives (`_2`, `_3`, ...). */
function isOrSuffixed(diId: string, base: string): boolean {
  return diId === base || (diId.startsWith(`${base}_`) && /^\d+$/.test(diId.slice(base.length + 1)));
}

/** The DI style of a shape's or an edge's id (`<id>_di`, `BPMNShape_<id>`, `Edge_<id>`, also cut by styledId, now or as 0.6 cut, also with a collision suffix `_2`); undefined for any other id. */
export function diStyleOf(diId: string, elId: string, kind: 'Shape' | 'Edge'): Style | undefined {
  return styleOf(diId, elId, kind) ?? (['suffix', 'bpmn', 'short'] as Style[]).find((s) => isOrSuffixed(diId, styledId(s, kind, elId)) || isOrSuffixed(diId, styledId(s, kind, elId, true)));
}

/** The id of the BPMNPlane / BPMNDiagram that shows `root`: `BPMNPlane_<root>`, a long root id cut like styledId (`legacy`: as 0.6 cut it). */
function rootDiId(kind: 'Plane' | 'Diagram', root: string, legacy = false): string {
  const head = `BPMN${kind}_`;
  return `${head}${cutAt(root, MAX_DI - head.length, legacy)}`;
}

/** Whether `diId` was derived from `root` as the id of its plane / diagram: `BPMNPlane_<root>` uncut (0.6 and the layouter), cut (rootDiId) or as 0.6 cut it. */
function namesRoot(kind: 'Plane' | 'Diagram', diId: string | undefined, root: string): boolean {
  return diId === `BPMN${kind}_${root}` || diId === rootDiId(kind, root) || diId === rootDiId(kind, root, true);
}

/** Whether every DI id derived from an id of `defs` fits uncut (no id is longer than the room `BPMNDiagram_` leaves): restoreDiIds then keeps the engine's ids of a drawing without old DI. */
export function diIdsFit(defs: El): boolean {
  for (const id of allIds(defs)) if (id.length > MAX_DI - 'BPMNDiagram_'.length) return false;
  return true;
}

/** What followDiIds asks and changes: the document's id registry (src/ids/IdRegistry.ts). */
export interface IdClaims {
  has(id: string): boolean;
  claim(id: string): void;
  release(id: string): void;
}

/**
 * The DI of an element renamed `old` -> `id`: each BPMNShape / BPMNEdge of
 * `el` whose id was derived from `old` (diStyleOf, a collision suffix
 * included) takes the id derived from `id` in the same style (styledId),
 * `_2`, `_3`, ... when that one is taken in `ids`, which it updates (as new
 * DI gets its id: claimUnique). A DI id already derived from `id` stays, and
 * so does any other DI id. True when one changed.
 */
export function followDiIds(defs: El, el: El, old: string, id: string, ids: IdClaims): boolean {
  let changed = false;
  for (const diagram of rawList(defs, 'diagrams')) {
    for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
      if (raw(pe, 'bpmnElement') !== el) continue;
      const kind = is(pe, 'bpmndi:BPMNShape') ? 'Shape' : is(pe, 'bpmndi:BPMNEdge') ? 'Edge' : undefined;
      const diId = idOf(pe);
      const style = kind && diId ? diStyleOf(diId, old, kind) : undefined;
      if (!kind || !diId || !style) continue;
      const base = styledId(style, kind, id);
      if (isOrSuffixed(diId, base)) continue;
      let next = base;
      for (let i = 2; ids.has(next); i++) next = `${base}_${i}`;
      ids.release(diId);
      ids.claim(next);
      pe.set('id', next);
      changed = true;
    }
  }
  return changed;
}

/** `base`, else `base_2`, `base_3`, ... whichever is not taken; claims it. */
function claimUnique(taken: Set<string>, base: string): string {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  taken.add(id);
  return id;
}

/** Id factory for new DI in the style most DI of the file already uses (default `<id>_di`). */
export function diIds(defs: El): DiIds {
  const styles = diStyles(defs);
  const taken = allIds(defs);
  return {
    shape: (id) => claimUnique(taken, styledId(styles.shape ?? 'suffix', 'Shape', id)),
    edge: (id) => claimUnique(taken, styledId(styles.edge ?? 'suffix', 'Edge', id)),
    plane: (id) => claimUnique(taken, rootDiId('Plane', id)),
    diagram: (id) => claimUnique(taken, rootDiId('Diagram', id)),
  };
}

/* ------------------------------------------------------------------ */
/* DI ids over a full redraw                                            */
/* ------------------------------------------------------------------ */

/** The DI ids of a document before a full redraw (rememberDiIds). */
export interface DiIdMemo {
  /** element id -> id of its BPMNShape / BPMNEdge */
  shapes: Map<string, string>;
  edges: Map<string, string>;
  /** per BPMNDiagram in document order: the id of the element its plane shows, the plane's and the diagram's id */
  diagrams: Array<{ root?: string; plane?: string; diagram?: string }>;
  /** the file's DI id styles (none: new DI takes the engine's form, `BPMNShape_<id>`) */
  styles: { shape?: Style; edge?: Style };
}

/** Records the DI ids of a document (before a full redraw replaces its DI). */
export function rememberDiIds(defs: El): DiIdMemo {
  const memo: DiIdMemo = { shapes: new Map(), edges: new Map(), diagrams: [], styles: diStyles(defs) };
  for (const diagram of rawList(defs, 'diagrams')) {
    const plane = raw<El>(diagram, 'plane');
    memo.diagrams.push({ root: idOf(raw(plane, 'bpmnElement')), plane: idOf(plane), diagram: idOf(diagram) });
    for (const pe of rawList(plane, 'planeElement')) {
      const diId = idOf(pe);
      const elId = idOf(raw(pe, 'bpmnElement'));
      if (!diId || !elId) continue;
      const into = is(pe, 'bpmndi:BPMNShape') ? memo.shapes : is(pe, 'bpmndi:BPMNEdge') ? memo.edges : undefined;
      if (into && !into.has(elId)) into.set(elId, diId);
    }
  }
  return memo;
}

/** Gives the DI the engine wrote the ids the document had before (see the module contract). */
export function restoreDiIds(defs: El, memo: DiIdMemo): void {
  const diagrams = rawList(defs, 'diagrams');
  const di = new Set<El>();
  for (const diagram of diagrams) {
    const plane = raw<El>(diagram, 'plane');
    di.add(diagram);
    if (plane) di.add(plane);
    for (const pe of rawList(plane, 'planeElement')) di.add(pe);
  }
  // every id but those of the new DI (they are given again)
  const taken = allIds(defs);
  for (const el of di) {
    const id = idOf(el);
    if (id) taken.delete(id);
  }
  // DI without an old id that is free: the id of its style (`base`), given once every old id is
  const fresh: Array<{ el: El; base: string }> = [];
  const claim = (el: El, wanted: string | undefined, base: string): void => {
    if (wanted && !taken.has(wanted)) {
      taken.add(wanted);
      el.set('id', wanted);
    } else fresh.push({ el, base });
  };
  const rootId = (kind: 'Plane' | 'Diagram', el: El, root: string | undefined): string => (root ? rootDiId(kind, root) : (idOf(el) ?? `BPMN${kind}_1`));
  const old = [...memo.diagrams];
  const main = old[0];
  const derived = (o: { root?: string; plane?: string; diagram?: string }): boolean => !!o.root && (namesRoot('Plane', o.plane, o.root) || namesRoot('Diagram', o.diagram, o.root));
  const unmatched: El[] = [];
  for (const diagram of diagrams) {
    const plane = raw<El>(diagram, 'plane');
    const root = idOf(raw(plane, 'bpmnElement'));
    const i = old.findIndex((o) => o.root === root);
    if (i === -1) {
      unmatched.push(diagram);
      continue;
    }
    const [o] = old.splice(i, 1);
    if (plane) claim(plane, o!.plane, rootId('Plane', plane, root));
    claim(diagram, o!.diagram, rootId('Diagram', diagram, root));
  }
  for (const diagram of unmatched) {
    const plane = raw<El>(diagram, 'plane');
    const root = idOf(raw(plane, 'bpmnElement'));
    // only the main diagram takes over the ids of the old main diagram (its root changed, e.g. to a new collaboration)
    const o = diagram === diagrams[0] && main && old.includes(main) && !derived(main) ? main : undefined;
    if (o) old.splice(old.indexOf(o), 1);
    if (plane) claim(plane, o?.plane, rootId('Plane', plane, root));
    claim(diagram, o?.diagram, rootId('Diagram', diagram, root));
  }
  for (const diagram of diagrams) {
    for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
      const elId = idOf(raw(pe, 'bpmnElement'));
      if (!elId) continue;
      const kind = is(pe, 'bpmndi:BPMNShape') ? 'Shape' : is(pe, 'bpmndi:BPMNEdge') ? 'Edge' : undefined;
      if (!kind) continue;
      const wanted = (kind === 'Shape' ? memo.shapes : memo.edges).get(elId);
      const style = kind === 'Shape' ? memo.styles.shape : memo.styles.edge;
      claim(pe, wanted, styledId(style ?? 'bpmn', kind, elId));
    }
  }
  // the engine's ids that already are what their style gives first: a cut id never pushes one that needs no cut to `_2`
  const uncut = (f: { el: El; base: string }): boolean => idOf(f.el) === f.base;
  for (const { el, base } of [...fresh.filter(uncut), ...fresh.filter((f) => !uncut(f))]) el.set('id', claimUnique(taken, base));
}

/* ------------------------------------------------------------------ */
/* write                                                                */
/* ------------------------------------------------------------------ */

function rounded(b: Box): Box {
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
}

function readBox(bounds: unknown): Box | undefined {
  if (!bounds) return undefined;
  return { x: raw<number>(bounds, 'x') ?? NaN, y: raw<number>(bounds, 'y') ?? NaN, width: raw<number>(bounds, 'width') ?? NaN, height: raw<number>(bounds, 'height') ?? NaN };
}

function setBounds(moddle: BpmnModdle, owner: El, b: Box): void {
  const current = raw<El>(owner, 'bounds');
  if (current && sameBox(readBox(current), b)) return;
  const r = rounded(b);
  if (current) {
    current.set('x', r.x);
    current.set('y', r.y);
    current.set('width', r.width);
    current.set('height', r.height);
  } else {
    const created = moddle.create('dc:Bounds', r);
    owner.set('bounds', created);
    created.$parent = owner;
  }
}

function setLabel(moddle: BpmnModdle, di: El, label: Box | undefined): void {
  if (!label) return;
  let lbl = raw<El>(di, 'label');
  if (!lbl) {
    lbl = moddle.create('bpmndi:BPMNLabel', {});
    di.set('label', lbl);
    lbl.$parent = di;
  }
  setBounds(moddle, lbl, label);
}

/** Whole-pixel waypoints, never fewer than two (DI needs two; rounding must not merge the ends into one). */
function writablePoints(points: readonly Point[]): Point[] {
  const pts = roundPoints(points);
  if (pts.length >= 2 || points.length < 2) return pts;
  const last = points[points.length - 1]!;
  return [pts[0]!, { x: Math.round(last.x), y: Math.round(last.y) }];
}

function setWaypoints(moddle: BpmnModdle, di: El, points: Point[]): void {
  const current = rawList(di, 'waypoint').map((w) => ({ x: raw<number>(w, 'x') ?? NaN, y: raw<number>(w, 'y') ?? NaN }));
  if (samePoints(current, points)) return;
  const pts = writablePoints(points).map((p) => {
    const w = moddle.create('dc:Point', p);
    w.$parent = di;
    return w;
  });
  di.set('waypoint', pts);
}

/** Moves a DI element into `plane` when it currently lives in another plane. */
function adopt(planeDi: El, di: El): void {
  const parent = di.$parent as El | undefined;
  if (parent === planeDi) return;
  if (parent) removeFrom(parent, 'planeElement', di);
  addTo(planeDi, 'planeElement', di);
}

function writeShape(moddle: BpmnModdle, ids: DiIds, planeDi: El, s: DShape): void {
  if (!s.di) {
    const attrs: Record<string, unknown> = { id: ids.shape(s.id), bpmnElement: s.el };
    if (s.kind === 'participant' || s.kind === 'lane') attrs['isHorizontal'] = true;
    if (s.kind === 'subProcess') attrs['isExpanded'] = s.expanded === true;
    if (is(s.el, 'bpmn:ExclusiveGateway')) attrs['isMarkerVisible'] = true;
    s.di = moddle.create('bpmndi:BPMNShape', attrs);
    addTo(planeDi, 'planeElement', s.di);
  } else {
    adopt(planeDi, s.di);
    if (s.kind === 'subProcess' && s.expanded !== undefined && (raw<boolean>(s.di, 'isExpanded') === true) !== s.expanded) s.di.set('isExpanded', s.expanded);
  }
  setBounds(moddle, s.di, s.bounds);
  setLabel(moddle, s.di, s.label);
}

function writeEdge(moddle: BpmnModdle, ids: DiIds, planeDi: El, e: DEdge): void {
  if (!e.di) {
    e.di = moddle.create('bpmndi:BPMNEdge', { id: ids.edge(e.id), bpmnElement: e.el });
    addTo(planeDi, 'planeElement', e.di);
  } else {
    adopt(planeDi, e.di);
  }
  setWaypoints(moddle, e.di, e.points);
  setLabel(moddle, e.di, e.label);
}

function ensurePlaneDi(moddle: BpmnModdle, defs: El, ids: DiIds, plane: Plane): El {
  if (plane.di) {
    if (raw<El>(plane.di, 'bpmnElement') !== plane.root) plane.di.set('bpmnElement', plane.root);
    return plane.di;
  }
  const di = moddle.create('bpmndi:BPMNPlane', { id: ids.plane(plane.rootId), bpmnElement: plane.root });
  const diagram = moddle.create('bpmndi:BPMNDiagram', { id: ids.diagram(plane.rootId), plane: di });
  di.$parent = diagram;
  addTo(defs, 'diagrams', diagram);
  plane.di = di;
  plane.id = idOf(di) ?? plane.id;
  return di;
}

/** Writes every plane back into the DI of `defs` (see module contract). */
export function writePlanes(moddle: BpmnModdle, defs: El, planes: readonly Plane[]): void {
  const ids = diIds(defs);
  for (const plane of planes) {
    if (plane.deleted) {
      const diagram = plane.di?.$parent as El | undefined;
      if (diagram) removeFrom(defs, 'diagrams', diagram);
      continue;
    }
    const planeDi = ensurePlaneDi(moddle, defs, ids, plane);
    for (const d of plane.dropped) {
      const parent = d.$parent as El | undefined;
      if (parent) removeFrom(parent, 'planeElement', d);
    }
    plane.dropped = [];
    for (const s of plane.shapes.values()) writeShape(moddle, ids, planeDi, s);
    for (const e of plane.edges.values()) writeEdge(moddle, ids, planeDi, e);
  }
}

/* ------------------------------------------------------------------ */
/* prune                                                                */
/* ------------------------------------------------------------------ */

/** Deletes DI of elements that no longer exist (see module contract); returns their ids. */
export function pruneDi(defs: El, sem: Semantics): string[] {
  const pruned: string[] = [];
  const diagrams = rawList(defs, 'diagrams');
  for (let d = diagrams.length - 1; d >= 0; d--) {
    const plane = raw<El>(diagrams[d], 'plane');
    // a plane without bpmnElement shows the first process / collaboration (bpmn-js): kept, not deleted
    const root = raw<El>(plane, 'bpmnElement') ?? (plane ? displayRoot(defs) : undefined);
    const rootId = idOf(root);
    if (!plane || !root || !rootId || sem.byId.get(rootId) !== root) {
      diagrams.splice(d, 1);
      continue;
    }
    const elements = rawList(plane, 'planeElement');
    for (let i = elements.length - 1; i >= 0; i--) {
      const pe = elements[i];
      const target = raw<El>(pe, 'bpmnElement');
      const id = idOf(target);
      if (target && id && sem.byId.get(id) === target) continue;
      elements.splice(i, 1);
      pruned.push(id ?? idOf(pe) ?? '?');
    }
  }
  return pruned.reverse();
}

/** Deletes the BPMNEdges `stale` names (see module contract); returns their elements' ids. */
export function pruneEdges(defs: El, stale: (edge: El, plane: El, further: boolean) => boolean): string[] {
  const pruned: string[] = [];
  const shown = new Set<string>();
  for (const diagram of rawList(defs, 'diagrams')) {
    const plane = raw<El>(diagram, 'plane');
    const rootId = idOf(raw<El>(plane, 'bpmnElement') ?? (plane ? displayRoot(defs) : undefined));
    if (!plane || !rootId) continue;
    const further = shown.has(rootId);
    shown.add(rootId);
    const elements = rawList(plane, 'planeElement');
    for (let i = 0; i < elements.length; i++) {
      const pe = elements[i]!;
      if (!is(pe, 'bpmndi:BPMNEdge') || !stale(pe, plane, further)) continue;
      elements.splice(i--, 1);
      pruned.push(idOf(raw(pe, 'bpmnElement')) ?? idOf(pe) ?? '?');
    }
  }
  return pruned;
}

/* ------------------------------------------------------------------ */
/* colours                                                              */
/* ------------------------------------------------------------------ */

const SHAPE_COLORS = ['bioc:stroke', 'bioc:fill', 'color:background-color', 'color:border-color'];
const EDGE_COLORS = ['bioc:stroke', 'bioc:fill', 'color:border-color'];
const LABEL_COLORS = ['color:color'];

export interface ColorAttrs {
  own: Record<string, string>;
  label: Record<string, string>;
}

function pick(el: El | undefined, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!el) return out;
  for (const k of keys) {
    const v = el.get<string | undefined>(k);
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

/** The bpmn-js colour attributes of every coloured shape / edge, by element id. */
export function colorsOf(defs: El): Map<string, ColorAttrs> {
  const out = new Map<string, ColorAttrs>();
  for (const diagram of rawList(defs, 'diagrams')) {
    for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
      const id = idOf(raw(pe, 'bpmnElement'));
      if (!id) continue;
      const own = pick(pe, is(pe, 'bpmndi:BPMNEdge') ? EDGE_COLORS : SHAPE_COLORS);
      const label = pick(raw<El>(pe, 'label'), LABEL_COLORS);
      if (Object.keys(own).length || Object.keys(label).length) out.set(id, { own, label });
    }
  }
  return out;
}

/** The colours of the bpmn-js colour picker (fill / stroke). */
export const SWATCHES = {
  blue: { fill: '#bbdefb', stroke: '#0d4372' },
  orange: { fill: '#ffe0b2', stroke: '#6b3c00' },
  green: { fill: '#c8e6c9', stroke: '#205022' },
  red: { fill: '#ffcdd2', stroke: '#831311' },
  purple: { fill: '#e1bee7', stroke: '#5b176d' },
} as const;

export type SwatchName = keyof typeof SWATCHES;

/** Writes one swatch on a DI element, or removes all colours (see module contract); true when something changed. */
export function setSwatch(di: El, swatch: SwatchName | undefined): boolean {
  const edge = is(di, 'bpmndi:BPMNEdge');
  const before = JSON.stringify([pick(di, SHAPE_COLORS.concat(EDGE_COLORS)), pick(raw<El>(di, 'label'), LABEL_COLORS)]);
  for (const k of new Set([...SHAPE_COLORS, ...EDGE_COLORS])) di.set(k, undefined);
  const label = raw<El>(di, 'label');
  if (label) label.set('color:color', undefined);
  if (swatch) {
    const { fill, stroke } = SWATCHES[swatch];
    di.set('bioc:stroke', stroke);
    di.set('color:border-color', stroke);
    if (!edge) {
      di.set('bioc:fill', fill);
      di.set('color:background-color', fill);
    }
    if (label) label.set('color:color', stroke);
  }
  return JSON.stringify([pick(di, SHAPE_COLORS.concat(EDGE_COLORS)), pick(raw<El>(di, 'label'), LABEL_COLORS)]) !== before;
}

/** The colour of a DI element: a swatch name, 'custom' (other values) or undefined (none). */
export function swatchOf(di: El): { color: SwatchName | 'custom'; fill?: string; stroke?: string } | undefined {
  const own = pick(di, is(di, 'bpmndi:BPMNEdge') ? EDGE_COLORS : SHAPE_COLORS);
  const stroke = own['bioc:stroke'] ?? own['color:border-color'];
  const fill = own['bioc:fill'] ?? own['color:background-color'];
  if (!stroke && !fill) return undefined;
  const edge = is(di, 'bpmndi:BPMNEdge');
  const name = (Object.keys(SWATCHES) as SwatchName[]).find((n) => SWATCHES[n].stroke === stroke?.toLowerCase() && (edge || SWATCHES[n].fill === fill?.toLowerCase()));
  return { color: name ?? 'custom', ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) };
}

/** Re-applies colours by element id; returns the number of DI elements coloured. */
export function applyColors(moddle: BpmnModdle, defs: El, colors: Map<string, ColorAttrs>): number {
  if (!colors.size) return 0;
  let n = 0;
  for (const diagram of rawList(defs, 'diagrams')) {
    for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
      const c = colors.get(idOf(raw(pe, 'bpmnElement')) ?? '');
      if (!c) continue;
      for (const [k, v] of Object.entries(c.own)) pe.set(k, v);
      if (Object.keys(c.label).length) {
        let lbl = raw<El>(pe, 'label');
        if (!lbl) {
          lbl = moddle.create('bpmndi:BPMNLabel', {});
          pe.set('label', lbl);
          lbl.$parent = pe;
        }
        for (const [k, v] of Object.entries(c.label)) lbl.set(k, v);
      }
      n++;
    }
  }
  return n;
}
