/**
 * The "clean" layout engine: processes, pools, lanes, collapsed planes and
 * the BPMN DI writer. Coordinates handed to the DI are absolute.
 *
 * Contract (beyond the placement conventions of place.ts / route.ts):
 *  - lanes: every flow node lies inside the band of its leaf lane; the bands
 *    follow the content when routing or annotations open a strip above it,
 *    and the lanes fill their pool without gaps
 *  - event sub-processes sit below the content of their own lane (the lanes
 *    below move down); those of the last lane or of no lane below everything
 *  - pools stack vertically in the order whose message flows cut the fewest
 *    shapes (declaration order on ties); message flows: see messages.ts
 *  - text annotations owned by the collaboration are drawn next to their
 *    element (notes.ts), their associations as straight lines; links between
 *    scope levels are drawn when both ends are on the same plane, otherwise
 *    reported as DI_NOT_CREATED
 */
import { addTo, is, many, type El, type Model } from '../model.js';
import { layoutRoot } from '../model.js';
import { DATA_ROW_EXTRA, annotationSize, boundaryExtra, framedSize, growToFit, layoutScope, nodeLabels, placeAnnotations, placeAttachedArtifacts, shiftNode, type PlaceOptions } from './place.js';
import { messageLabel, poolOrder, routeMessageFlows, type MessageFlowJob, type MessagePool, type Seg } from './messages.js';
import { placeCollaborationNotes, type NoteJob } from './notes.js';
import { borderPoint, elementLabel, routeEdges, routeLinks } from './route.js';
import { METRICS, SIZES, boxesOverlap, center, type Box, type GNode, type LaneBox, type Point, type ScopeLayout } from './types.js';

export interface EngineWarning {
  code: string;
  elementId: string;
  message: string;
}

interface PoolLayout {
  participant: El;
  process?: El;
  scope?: ScopeLayout;
  box: Box;
  /** absolute origin of the scope content */
  origin: Point;
  /** the DI elements drawn for this pool (its shape, lanes, content) */
  di?: El[];
}

const idOf = (el: El): string => el.get<string>('id');

/* ------------------------------------------------------------------ */
/* lanes                                                                */
/* ------------------------------------------------------------------ */

interface LaneBand {
  el: El;
  id: string;
  nodes: GNode[];
  /** event sub-processes of this (leaf) lane */
  subs: GNode[];
  children: LaneBand[];
  y: number;
  height: number;
}

/**
 * The content of a laned scope moved down by `shift` (a strip opened above
 * it): the first leaf lane grows upwards over the strip, every other lane
 * moves down with its nodes. `bandsMoved`: the router already shifted the
 * scope's lane bands (routeEdges does that for its own shift).
 */
function growFirstLane(scope: ScopeLayout, leaves: LaneBand[], shift: number, bandsMoved: boolean): void {
  if (!shift) return;
  for (const l of leaves) l.y += shift;
  leaves[0]!.y -= shift;
  leaves[0]!.height += shift;
  const bands = scope.laneBands ?? [];
  if (!bandsMoved) {
    for (const b of bands) {
      b.top += shift;
      b.bottom += shift;
    }
  }
  if (bands[0]) bands[0].top -= shift;
}

/**
 * Opens a horizontal strip of height `dy` at `cut` in a routed laned scope
 * (the space tool): everything at or below the cut moves down, lanes below
 * it too. Routes are orthogonal, so a segment across the cut stays vertical.
 */
function openStrip(scope: ScopeLayout, leaves: LaneBand[], cut: number, dy: number): void {
  const move = (p: Point): void => {
    if (p.y >= cut) p.y += dy;
  };
  for (const n of [...scope.nodes, ...scope.eventSubs]) if (n.box.y >= cut) shiftNode(n, 0, dy);
  for (const a of scope.artifacts) {
    if (a.box.y >= cut) a.box.y += dy;
    for (const link of a.links) link.points.forEach(move);
  }
  for (const e of scope.edges) {
    e.points.forEach(move);
    if (e.label && e.label.y >= cut) e.label.y += dy;
  }
  for (const c of scope.compensations) c.points.forEach(move);
  for (const l of leaves) if (l.y >= cut) l.y += dy;
  scope.height += dy;
}

/** x for a box of `width` in a strip at `cut`: left, but clear of the vertical segments that cross the cut. */
function stripX(scope: ScopeLayout, cut: number, width: number): number {
  const crossing: number[] = [];
  for (const e of scope.edges) {
    for (let i = 0; i + 1 < e.points.length; i++) {
      const p = e.points[i]!, q = e.points[i + 1]!;
      if (p.x === q.x && Math.min(p.y, q.y) < cut && Math.max(p.y, q.y) > cut) crossing.push(p.x);
    }
  }
  const candidates = [0, ...crossing.map((x) => x + 20)].sort((a, b) => a - b);
  return candidates.find((x) => !crossing.some((c) => c > x - 20 && c < x + width + 20)) ?? 0;
}

/**
 * The event sub-processes of a lane that is not the last one: stacked below
 * the lane's content (nodes, routes, artifacts), the lane grows by a strip
 * at its bottom and the lanes below move down.
 */
function placeLaneEventSubs(scope: ScopeLayout, leaves: LaneBand[], lane: LaneBand): void {
  const top = lane.y, bottom = lane.y + lane.height;
  const inBand = (y: number): boolean => y > top && y <= bottom;
  let content = bottom - SIZES.lanePadding;
  for (const n of lane.nodes) content = Math.max(content, n.box.y + n.box.height, ...n.boundary.map((b) => b.box.y + b.box.height));
  for (const a of scope.artifacts) if (inBand(a.box.y + a.box.height / 2)) content = Math.max(content, a.box.y + a.box.height);
  for (const e of scope.edges) {
    for (const p of e.points) if (inBand(p.y)) content = Math.max(content, p.y);
    if (e.label && inBand(e.label.y)) content = Math.max(content, e.label.y + e.label.height);
  }
  let y = content;
  const stack = lane.subs.map((es) => {
    const at = y + METRICS.vGap;
    y = at + es.height;
    return { es, at };
  });
  const dy = Math.max(0, Math.round(y + SIZES.lanePadding - bottom));
  const x = stripX(scope, bottom, Math.max(...lane.subs.map((es) => es.width)));
  if (dy) openStrip(scope, leaves, bottom, dy);
  lane.height += dy;
  for (const { es, at } of stack) {
    es.box = { x, y: Math.round(at), width: es.width, height: es.height };
    scope.width = Math.max(scope.width, x + es.width);
  }
}

/**
 * Re-arranges the rows of a scope into lane bands (leaf lanes in declaration
 * order) and lays the scope out again inside them: nodes keep their column,
 * every node moves into the band of its lane, data objects and annotations
 * stay with their node and the router keeps loop channels inside the band.
 */
function applyLanes(scope: ScopeLayout, process: El): void {
  const laneSets = many(process, 'laneSets');
  if (!laneSets.length) return;
  const byId = new Map(scope.nodes.map((n) => [n.id, n]));
  const subsById = new Map(scope.eventSubs.map((n) => [n.id, n]));
  const build = (laneSet: El): LaneBand[] =>
    many(laneSet, 'lanes').map((lane) => {
      const child = lane.get<El | undefined>('childLaneSet');
      const band: LaneBand = { el: lane, id: idOf(lane), nodes: [], subs: [], children: child ? build(child) : [], y: 0, height: 0 };
      if (!band.children.length) {
        for (const ref of lane.get<El[] | undefined>('flowNodeRef') ?? []) {
          const n = byId.get(idOf(ref));
          if (n) band.nodes.push(n);
          const sub = subsById.get(idOf(ref));
          if (sub) band.subs.push(sub);
        }
      }
      return band;
    });
  const top = build(laneSets[0]!);
  const leaves: LaneBand[] = [];
  const collect = (b: LaneBand): void => (b.children.length ? b.children.forEach(collect) : void leaves.push(b));
  top.forEach(collect);
  if (!leaves.length) return;
  // nodes not in any lane go to the first lane
  const assigned = new Set(leaves.flatMap((l) => l.nodes));
  for (const n of scope.nodes) if (!assigned.has(n)) leaves[0]!.nodes.push(n);

  // rows inside every lane, in the order the placer assigned them
  const dataRow = new Set(scope.artifacts.filter((a) => a.kind !== 'annotation' && a.anchorNode).map((a) => a.anchorNode!));
  let y = 0;
  for (const lane of leaves) {
    const rows = [...new Set(lane.nodes.map((n) => n.row))].sort((a, b) => a - b);
    let rowY = y + SIZES.lanePadding;
    rows.forEach((r) => {
      const inRow = lane.nodes.filter((n) => n.row === r);
      const rh = Math.max(0, ...inRow.map((n) => n.height + boundaryExtra(n)));
      for (const n of inRow) shiftNode(n, 0, Math.round(rowY + rh / 2 - n.height / 2 - n.box.y));
      rowY += rh + METRICS.vGap + (inRow.some((n) => dataRow.has(n)) ? DATA_ROW_EXTRA : 0);
    });
    const content = rows.length ? rowY - METRICS.vGap - (y + SIZES.lanePadding) : 0;
    lane.y = y;
    lane.height = Math.max(60 + 2 * SIZES.lanePadding, content + 2 * SIZES.lanePadding);
    y += lane.height;
  }
  scope.height = y;
  // data objects and boundary notes follow their node, then route inside the bands
  placeAttachedArtifacts(scope);
  scope.laneBands = leaves.map((l) => ({ nodes: new Set(l.nodes), top: l.y, bottom: l.y + l.height }));
  const ref = scope.nodes[0];
  const yOf = (): number => ref?.box.y ?? 0;
  // a loop drawn over the top (its label above y 0) moves the content down: the bands follow
  const beforeRouting = yOf();
  routeEdges(scope);
  growFirstLane(scope, leaves, yOf() - beforeRouting, true);
  // annotations may need a strip above the content: same again
  const beforeNotes = yOf();
  placeAnnotations(scope);
  growFirstLane(scope, leaves, yOf() - beforeNotes, false);
  routeLinks(scope);
  growToFit(scope);
  // event sub-processes go below the content of their lane; those of the last lane or of none below everything
  const last = leaves[leaves.length - 1]!;
  for (const lane of leaves) if (lane !== last && lane.subs.length) placeLaneEventSubs(scope, leaves, lane);
  const placed = new Set(leaves.filter((l) => l !== last).flatMap((l) => l.subs));
  let extraY = last.y + last.height - SIZES.lanePadding;
  for (const es of scope.eventSubs.filter((e) => !placed.has(e))) {
    es.box.y = extraY + METRICS.vGap;
    extraY = es.box.y + es.box.height;
  }
  const contentBottom = Math.max(extraY, ...scope.nodes.map((n) => n.box.y + n.box.height), ...scope.artifacts.map((a) => a.box.y + a.box.height), ...scope.edges.flatMap((e) => e.points.map((p) => p.y)), ...nodeLabels(scope).map((l) => l.y + l.height));
  if (contentBottom > last.y + last.height - SIZES.lanePadding) last.height = Math.round(contentBottom + SIZES.lanePadding - last.y);
  scope.height = last.y + last.height;
  // parent bands span their children
  const finalize = (b: LaneBand): void => {
    if (b.children.length) {
      b.children.forEach(finalize);
      b.y = b.children[0]!.y;
      const end = b.children[b.children.length - 1]!;
      b.height = end.y + end.height - b.y;
    }
  };
  top.forEach(finalize);
  const width = Math.max(scope.width, ...scope.artifacts.map((a) => a.box.x + a.box.width), ...scope.nodes.map((n) => n.box.x + n.box.width), ...scope.eventSubs.map((n) => n.box.x + n.box.width), ...nodeLabels(scope).map((l) => l.x + l.width)) + 2 * SIZES.lanePadding;
  const depth = (bands: LaneBand[]): number => (bands.length ? 1 + Math.max(...bands.map((b) => depth(b.children))) : 0);
  const totalDepth = depth(top);
  const toBox = (b: LaneBand, level: number): LaneBox => ({
    el: b.el,
    id: b.id,
    box: { x: level * SIZES.laneHeader, y: b.y, width: width + (totalDepth - level) * SIZES.laneHeader, height: b.height },
    children: b.children.map((c) => toBox(c, level + 1)),
  });
  scope.lanes = top.map((b) => toBox(b, 0));
}

/* ------------------------------------------------------------------ */
/* engine                                                               */
/* ------------------------------------------------------------------ */

export function layoutClean(model: Model, expanded: Set<string>): { warnings: EngineWarning[] } {
  const { moddle, definitions } = model;
  const warnings: EngineWarning[] = [];
  const root = layoutRoot(definitions);
  definitions.set('diagrams', []);
  if (!root) return { warnings };
  const collapsedScopes = new Map<string, ScopeLayout>();
  const placeOpts: PlaceOptions = { expanded, collapsedScopes };
  const di: El[] = [];
  const absBoxes = new Map<string, Box>();
  const lanesOf = new Map<string, number>(); // scope id -> lane header width (for content offset)

  const bounds = (b: Box): El => moddle.create('dc:Bounds', { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
  const shape = (el: El, box: Box, extra: Record<string, unknown> = {}, label?: Box): void => {
    const s = moddle.create('bpmndi:BPMNShape', { id: `BPMNShape_${idOf(el)}`, bpmnElement: el, bounds: bounds(box), ...extra });
    if (label) s.set('label', moddle.create('bpmndi:BPMNLabel', { bounds: bounds(label) }));
    di.push(s);
    absBoxes.set(idOf(el), { ...box });
  };
  const edge = (el: El, points: Point[], label?: Box): void => {
    const e = moddle.create('bpmndi:BPMNEdge', { id: `BPMNEdge_${idOf(el)}`, bpmnElement: el, waypoint: points.map((p) => moddle.create('dc:Point', { x: Math.round(p.x), y: Math.round(p.y) })) });
    if (label) e.set('label', moddle.create('bpmndi:BPMNLabel', { bounds: bounds(label) }));
    di.push(e);
  };
  const shift = (b: Box, o: Point): Box => ({ x: b.x + o.x, y: b.y + o.y, width: b.width, height: b.height });
  const shiftPts = (pts: Point[], o: Point): Point[] => pts.map((p) => ({ x: p.x + o.x, y: p.y + o.y }));

  /** data associations whose ends live in different scopes: drawn once both shapes exist */
  const crossLinks: Array<{ el: El; sourceId: string; targetId: string }> = [];

  function emitScope(scope: ScopeLayout, origin: Point): void {
    crossLinks.push(...scope.crossLinks);
    for (const lane of scope.lanes) emitLane(lane, origin);
    for (const n of [...scope.nodes, ...scope.eventSubs]) emitNode(n, origin);
    for (const e of scope.edges) edge(e.el, shiftPts(e.points, origin), e.label ? shift(e.label, origin) : undefined);
    for (const c of scope.compensations) edge(c.el, shiftPts(c.points, origin));
    for (const a of scope.artifacts) {
      const box = shift(a.box, origin);
      const label = a.kind === 'annotation' ? undefined : elementLabel(a, 'data');
      shape(a.el, box, {}, label ? shift(label, origin) : undefined);
      for (const link of a.links) edge(link.el, shiftPts(link.points, origin));
    }
  }
  function emitLane(lane: LaneBox, origin: Point): void {
    shape(lane.el, shift(lane.box, origin), { isHorizontal: true });
    for (const c of lane.children) emitLane(c, origin);
  }
  function emitNode(n: GNode, origin: Point): void {
    const box = shift(n.box, origin);
    if (n.child) {
      shape(n.el, box, { isExpanded: true });
      const p = SIZES.subProcessPadding;
      emitScope(n.child, { x: box.x + p.left + Math.max(0, (box.width - p.left - p.right - n.child.width) / 2), y: box.y + p.top });
    } else if (n.kind === 'subProcess' || n.kind === 'eventSubProcess') {
      shape(n.el, box); // collapsed: own plane
    } else {
      const kind = n.kind === 'gateway' ? 'gateway' : is(n.el, 'bpmn:Event') ? 'event' : undefined;
      const label = kind ? elementLabel(n, kind) : undefined;
      const extra = is(n.el, 'bpmn:ExclusiveGateway') ? { isMarkerVisible: true } : {};
      shape(n.el, box, extra, label ? shift(label, origin) : undefined);
    }
    for (const b of n.boundary) {
      const bb = shift(b.box, origin);
      const label = elementLabel(b, 'boundary');
      shape(b.el, bb, {}, label ? shift(label, origin) : undefined);
    }
  }

  const margin = SIZES.outerMargin;
  if (is(root, 'bpmn:Collaboration')) {
    const pools: PoolLayout[] = [];
    for (const participant of many(root, 'participants')) {
      const process = participant.get<El | undefined>('processRef');
      if (process) {
        const scope = layoutScope(process, placeOpts);
        applyLanes(scope, process);
        pools.push({ participant, process, scope, box: { x: 0, y: 0, width: 0, height: 0 }, origin: { x: 0, y: 0 } });
      } else {
        pools.push({ participant, box: { x: 0, y: 0, width: 0, height: SIZES.blackBoxHeight }, origin: { x: 0, y: 0 } });
      }
    }
    // size pools
    let maxWidth = 300;
    for (const p of pools) {
      if (!p.scope) continue;
      const laneDepth = p.scope.lanes.length ? laneDepthOf(p.scope.lanes) : 0;
      // the labels right of the content (an end event's): the pool holds them
      const framed = framedSize(p.scope);
      const contentW = framed.width - framed.left + 2 * SIZES.lanePadding + laneDepth * SIZES.laneHeader;
      maxWidth = Math.max(maxWidth, SIZES.participantHeader + contentW);
      p.box.height = p.scope.lanes.length ? p.scope.height : Math.max(150, p.scope.height + 2 * SIZES.lanePadding);
    }
    let y = margin;
    for (const p of pools) {
      p.box = { x: margin, y, width: maxWidth, height: p.box.height };
      const laneDepth = p.scope?.lanes.length ? laneDepthOf(p.scope.lanes) : 0;
      p.origin = { x: p.box.x + SIZES.participantHeader + laneDepth * SIZES.laneHeader + SIZES.lanePadding, y: p.box.y + (p.scope?.lanes.length ? 0 : SIZES.lanePadding) };
      y += p.box.height + SIZES.poolGap;
    }
    for (const p of pools) {
      const first = di.length;
      shape(p.participant, p.box, { isHorizontal: true });
      if (p.scope) {
        // lanes span the pool width (minus header); stretch lane boxes
        for (const lane of p.scope.lanes) stretchLane(lane, p.box.width - SIZES.participantHeader);
        emitScope(p.scope, p.scope.lanes.length ? { x: p.origin.x, y: p.box.y } : p.origin);
        // lane shapes were emitted relative to the scope origin; re-anchor them to the pool
        for (const lane of p.scope.lanes) fixLaneShapes(lane, p);
      }
      p.di = di.slice(first);
    }
    const flows = collectMessageFlows(root, pools, absBoxes, warnings);
    // pools in the order whose message flows cut the fewest shapes, then the routes
    let views = new Map(pools.map((p) => [p, messageView(p, absBoxes)]));
    const order = poolOrder(pools.map((p) => views.get(p)!), messageJobs(flows, views));
    const reordered = order.map((view) => pools.find((p) => views.get(p) === view)!);
    if (reordered.some((p, i) => p !== pools[i])) {
      restackPools(reordered, absBoxes);
      pools.splice(0, pools.length, ...reordered);
      views = new Map(pools.map((p) => [p, messageView(p, absBoxes)]));
    }
    for (const route of routeMessageFlows(messageJobs(flows, views), pools.map((p) => views.get(p)!))) {
      const name = route.el.get<string | undefined>('name');
      edge(route.el, route.points, name ? messageLabel(route.points, name, route.channelY) : undefined);
    }
    // text annotations owned by the collaboration: next to their element, after everything else
    for (const note of collaborationNotes(root, pools, di, absBoxes)) {
      if (note.box) shape(note.el, note.box);
      else warnings.push({ code: 'DI_NOT_CREATED', elementId: idOf(note.el), message: `Artifacts owned by the collaboration are not laid out (${idOf(note.el)})` });
    }
    for (const link of collaborationLinks(root, pools, di, absBoxes)) {
      if (link.points) edge(link.el, link.points);
      else warnings.push({ code: 'DI_NOT_CREATED', elementId: idOf(link.el), message: `No DI created for ${idOf(link.el)} (an end has no shape)` });
    }
  } else {
    const scope = layoutScope(root, placeOpts);
    applyLanes(scope, root);
    if (scope.lanes.length) {
      const laneDepth = laneDepthOf(scope.lanes);
      const framed = framedSize(scope);
      for (const lane of scope.lanes) stretchLane(lane, framed.width - framed.left + 2 * SIZES.lanePadding + laneDepth * SIZES.laneHeader);
      emitScope(scope, { x: margin + laneDepth * SIZES.laneHeader + SIZES.lanePadding, y: margin });
      for (const lane of scope.lanes) fixLaneShapes(lane, { box: { x: margin, y: margin, width: 0, height: 0 }, participant: root, origin: { x: 0, y: 0 } }, true);
    } else {
      emitScope(scope, { x: margin, y: margin });
    }
  }

  flushCrossLinks();
  declutterLabels(di, moddle);
  const plane = moddle.create('bpmndi:BPMNPlane', { id: `BPMNPlane_${idOf(root)}`, bpmnElement: root });
  addTo(plane, 'planeElement', ...di);
  const diagram = moddle.create('bpmndi:BPMNDiagram', { id: `BPMNDiagram_${idOf(root)}`, plane });
  plane.$parent = diagram;
  addTo(definitions, 'diagrams', diagram);

  // collapsed sub-processes: one diagram each (bpmn-js drill-down)
  for (const [subId, scope] of collapsedScopes) {
    di.length = 0;
    emitScope(scope, { x: margin, y: margin });
    const sub = scope.el;
    flushCrossLinks();
    declutterLabels(di, moddle);
    const subPlane = moddle.create('bpmndi:BPMNPlane', { id: `BPMNPlane_${subId}`, bpmnElement: sub });
    addTo(subPlane, 'planeElement', ...di);
    const subDiagram = moddle.create('bpmndi:BPMNDiagram', { id: `BPMNDiagram_${subId}`, plane: subPlane });
    subPlane.$parent = subDiagram;
    addTo(definitions, 'diagrams', subDiagram);
  }
  return { warnings };

  /** Links between scopes of the plane just emitted: a straight line when both ends are on it, else a warning. */
  function flushCrossLinks(): void {
    const here = new Set(di.filter((d) => is(d, 'bpmndi:BPMNShape')).map((d) => idOf(d.get<El>('bpmnElement'))));
    for (const link of crossLinks) {
      const sb = here.has(link.sourceId) ? absBoxes.get(link.sourceId) : undefined;
      const tb = here.has(link.targetId) ? absBoxes.get(link.targetId) : undefined;
      if (!sb || !tb) {
        warnings.push({ code: 'DI_NOT_CREATED', elementId: idOf(link.el), message: `No DI created for ${idOf(link.el)} (its ends are on different diagrams)` });
        continue;
      }
      edge(link.el, [borderPoint(sb, center(tb)), borderPoint(tb, center(sb))]);
    }
    crossLinks.length = 0;
  }
  function laneDepthOf(lanes: ScopeLayout['lanes']): number {
    return lanes.length ? 1 + Math.max(...lanes.map((l) => laneDepthOf(l.children))) : 0;
  }
  function stretchLane(lane: LaneBox, width: number): void {
    lane.box.width = width - lane.box.x;
    for (const c of lane.children) stretchLane(c, width);
  }
  /** lane shapes are placed at the pool's left edge (after the participant header) */
  function fixLaneShapes(lane: LaneBox, pool: PoolLayout, processOnly = false): void {
    const s = di.find((d) => d.get<El>('bpmnElement') === lane.el);
    if (s) {
      const b = s.get<El>('bounds');
      const baseX = processOnly ? pool.box.x : pool.box.x + SIZES.participantHeader;
      b.set('x', baseX + lane.box.x);
      b.set('y', pool.box.y + lane.box.y);
      absBoxes.set(lane.id, { x: baseX + lane.box.x, y: pool.box.y + lane.box.y, width: lane.box.width, height: lane.box.height });
    }
    for (const c of lane.children) fixLaneShapes(c, pool, processOnly);
  }
}


/* ------------------------------------------------------------------ */
/* pools and message flows                                              */
/* ------------------------------------------------------------------ */

/** A message flow with both ends drawn, its pools as engine layouts. */
interface MessageFlowEnds extends Omit<MessageFlowJob, 'sourcePool' | 'targetPool'> {
  sourcePool?: PoolLayout;
  targetPool?: PoolLayout;
}

/** The pool an element is drawn in: the participant itself, or the one whose process contains it. */
function poolOf(pools: PoolLayout[], el: El): PoolLayout | undefined {
  if (is(el, 'bpmn:Participant')) return pools.find((p) => p.participant === el);
  let parent: El | undefined = el.$parent as El | undefined;
  while (parent && !is(parent, 'bpmn:Process')) parent = parent.$parent as El | undefined;
  return parent ? pools.find((p) => p.process === parent) : undefined;
}

/** Boxes of the boundary events attached to an element (they belong to the end of a flow). */
function boundaryBoxes(el: El, absBoxes: Map<string, Box>): Box[] {
  const parent = el.$parent as El | undefined;
  if (!parent || is(el, 'bpmn:Participant')) return [];
  return many(parent, 'flowElements')
    .filter((b) => is(b, 'bpmn:BoundaryEvent') && b.get<El | undefined>('attachedToRef') === el)
    .map((b) => absBoxes.get(idOf(b)))
    .filter((b): b is Box => !!b);
}

/** Every message flow whose ends have shapes; the others get a DI_NOT_CREATED warning. */
function collectMessageFlows(root: El, pools: PoolLayout[], absBoxes: Map<string, Box>, warnings: EngineWarning[]): MessageFlowEnds[] {
  const out: MessageFlowEnds[] = [];
  for (const mf of many(root, 'messageFlows')) {
    const s = mf.get<El | undefined>('sourceRef');
    const t = mf.get<El | undefined>('targetRef');
    const sb = s ? absBoxes.get(idOf(s)) : undefined;
    const tb = t ? absBoxes.get(idOf(t)) : undefined;
    if (!s || !t || !sb || !tb) {
      warnings.push({ code: 'DI_NOT_CREATED', elementId: idOf(mf), message: `No DI created for message flow ${idOf(mf)} (endpoint without shape)` });
      continue;
    }
    out.push({ el: mf, source: s, target: t, sourceBox: sb, targetBox: tb, sourceOwn: boundaryBoxes(s, absBoxes), targetOwn: boundaryBoxes(t, absBoxes), sourcePool: poolOf(pools, s), targetPool: poolOf(pools, t) });
  }
  return out;
}

function messageJobs(flows: MessageFlowEnds[], views: Map<PoolLayout, MessagePool>): MessageFlowJob[] {
  return flows.map((f) => ({ ...f, sourcePool: f.sourcePool && views.get(f.sourcePool), targetPool: f.targetPool && views.get(f.targetPool) }));
}

const isContainerShape = (d: El, el: El): boolean => is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || d.get<boolean | undefined>('isExpanded') === true;

/** A pool as the message flow router sees it: its leaf shapes (the absolute boxes themselves) and its drawn edges. */
function messageView(p: PoolLayout, absBoxes: Map<string, Box>): MessagePool {
  const obstacles: Box[] = [];
  const lines: Seg[] = [];
  for (const d of p.di ?? []) {
    const el = d.get<El | undefined>('bpmnElement');
    if (!el) continue;
    if (is(d, 'bpmndi:BPMNShape')) {
      const box = absBoxes.get(idOf(el));
      if (box && !isContainerShape(d, el)) obstacles.push(box);
      continue;
    }
    const pts = many(d, 'waypoint').map((w) => ({ x: w.get<number>('x'), y: w.get<number>('y') }));
    for (let i = 0; i + 1 < pts.length; i++) lines.push([pts[i]!, pts[i + 1]!]);
  }
  const laneDepth = p.scope?.lanes.length ? laneDepthOfBoxes(p.scope.lanes) : 0;
  return { box: p.box, obstacles, lines, contentLeft: p.box.x + SIZES.participantHeader + laneDepth * SIZES.laneHeader };
}

function laneDepthOfBoxes(lanes: LaneBox[]): number {
  return lanes.length ? 1 + Math.max(...lanes.map((l) => laneDepthOfBoxes(l.children))) : 0;
}

/** Moves a drawn pool vertically: its DI (bounds, labels, waypoints) and the absolute boxes of its shapes. */
function shiftPool(p: PoolLayout, dy: number, absBoxes: Map<string, Box>): void {
  if (!dy) return;
  const moveBounds = (b: El | undefined): void => {
    if (b) b.set('y', b.get<number>('y') + dy);
  };
  for (const d of p.di ?? []) {
    moveBounds(d.get<El | undefined>('label')?.get<El | undefined>('bounds'));
    if (!is(d, 'bpmndi:BPMNShape')) {
      for (const w of many(d, 'waypoint')) w.set('y', w.get<number>('y') + dy);
      continue;
    }
    moveBounds(d.get<El | undefined>('bounds'));
    const el = d.get<El | undefined>('bpmnElement');
    const box = el ? absBoxes.get(idOf(el)) : undefined;
    if (box) box.y += dy;
  }
  p.box.y += dy;
  p.origin.y += dy;
}

/** Stacks the drawn pools again in a new order (same margin and gaps). */
function restackPools(order: PoolLayout[], absBoxes: Map<string, Box>): void {
  let y = SIZES.outerMargin;
  for (const p of order) {
    shiftPool(p, y - p.box.y, absBoxes);
    y += p.box.height + SIZES.poolGap;
  }
}

/* ------------------------------------------------------------------ */
/* collaboration-level artifacts                                        */
/* ------------------------------------------------------------------ */

/** Waypoints of the drawn edges by element id. */
function drawnEdges(di: El[]): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  for (const d of di) {
    const el = d.get<El | undefined>('bpmnElement');
    if (!el || is(d, 'bpmndi:BPMNShape')) continue;
    out.set(idOf(el), many(d, 'waypoint').map((w) => ({ x: w.get<number>('x'), y: w.get<number>('y') })));
  }
  return out;
}

/** Middle of the longest segment of a polyline, as a zero-size box. */
function edgeAnchor(points: Point[]): Box | undefined {
  let best: [Point, Point] | undefined;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    if (!best || Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > Math.abs(best[1].x - best[0].x) + Math.abs(best[1].y - best[0].y)) best = [a, b];
  }
  return best ? { x: Math.round((best[0].x + best[1].x) / 2), y: Math.round((best[0].y + best[1].y) / 2), width: 0, height: 0 } : undefined;
}

/** Pieces of an orthogonal segment outside every box (the boxes cut it into intervals). */
function outsidePieces(a: Point, b: Point, boxes: Box[]): Array<[Point, Point]> {
  const vertical = a.x === b.x;
  if (!vertical && a.y !== b.y) return [[a, b]];
  const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
  const fixed = vertical ? a.x : a.y;
  const cuts = boxes
    .filter((r) => (vertical ? fixed > r.x && fixed < r.x + r.width : fixed > r.y && fixed < r.y + r.height))
    .map((r) => (vertical ? [r.y, r.y + r.height] : [r.x, r.x + r.width]) as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const out: Array<[Point, Point]> = [];
  const at = (v: number): Point => (vertical ? { x: fixed, y: v } : { x: v, y: fixed });
  let cursor = lo;
  for (const [c1, c2] of cuts) {
    if (c1 > cursor) out.push([at(cursor), at(Math.min(c1, hi))]);
    cursor = Math.max(cursor, c2);
    if (cursor >= hi) break;
  }
  if (cursor < hi) out.push([at(cursor), at(hi)]);
  return out;
}

/** The drawn box of an association end: a shape, or a point on a drawn edge (between the pools for a message flow). */
function endBox(el: El | undefined, absBoxes: Map<string, Box>, edges: Map<string, Point[]>, pools: Box[] = []): Box | undefined {
  if (!el) return undefined;
  const id = idOf(el);
  const box = absBoxes.get(id);
  if (box) return box;
  const points = edges.get(id);
  if (!points) return undefined;
  if (is(el, 'bpmn:MessageFlow')) {
    const pieces = points.slice(1).flatMap((p, i) => outsidePieces(points[i]!, p, pools));
    if (pieces.length) return edgeAnchor(pieces.reduce((best, piece) => (len(piece) > len(best) ? piece : best)));
  }
  return edgeAnchor(points);
}

function len([a, b]: [Point, Point]): number {
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}

/** The leaf lane box an element is drawn in (by lane membership), if any. */
function laneBoxOf(el: El, absBoxes: Map<string, Box>): Box | undefined {
  let process: El | undefined = el.$parent as El | undefined;
  while (process && !is(process, 'bpmn:Process')) process = process.$parent as El | undefined;
  if (!process) return undefined;
  const visit = (laneSet: El | undefined): Box | undefined => {
    for (const lane of laneSet ? many(laneSet, 'lanes') : []) {
      const child = lane.get<El | undefined>('childLaneSet');
      const found = child && many(child, 'lanes').length ? visit(child) : (lane.get<El[] | undefined>('flowNodeRef') ?? []).includes(el) ? absBoxes.get(idOf(lane)) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  for (const laneSet of many(process, 'laneSets')) {
    const found = visit(laneSet);
    if (found) return found;
  }
  return undefined;
}

/** Intersection of two boxes (the first when they do not intersect). */
function clip(a: Box, b: Box | undefined): Box {
  if (!b) return a;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width), d = Math.min(a.y + a.height, b.y + b.height);
  return r > x && d > y ? { x, y, width: r - x, height: d - y } : a;
}

/** Content area of a pool (right of its header and lane headers). */
function poolContent(p: PoolLayout): Box {
  const left = SIZES.participantHeader + (p.scope?.lanes.length ? laneDepthOfBoxes(p.scope.lanes) : 0) * SIZES.laneHeader;
  return { x: p.box.x + left, y: p.box.y, width: p.box.width - left, height: p.box.height };
}

/** Leaf shapes and labels of the drawing (what a note must not cover) and its edges. */
function drawnWorld(di: El[], absBoxes: Map<string, Box>): { obstacles: Box[]; lines: Seg[] } {
  const obstacles: Box[] = [];
  const lines: Seg[] = [];
  const boxOf = (b: El): Box => ({ x: b.get<number>('x'), y: b.get<number>('y'), width: b.get<number>('width'), height: b.get<number>('height') });
  for (const d of di) {
    const el = d.get<El | undefined>('bpmnElement');
    if (!el) continue;
    const label = d.get<El | undefined>('label')?.get<El | undefined>('bounds');
    if (label) obstacles.push(boxOf(label));
    if (is(d, 'bpmndi:BPMNShape')) {
      const box = absBoxes.get(idOf(el));
      if (box && !isContainerShape(d, el)) obstacles.push(box);
      continue;
    }
    const pts = many(d, 'waypoint').map((w) => ({ x: w.get<number>('x'), y: w.get<number>('y') }));
    for (let i = 0; i + 1 < pts.length; i++) lines.push([pts[i]!, pts[i + 1]!]);
  }
  return { obstacles, lines };
}

/**
 * Boxes for the text annotations owned by the collaboration, next to the
 * first element an association ties them to (see notes.ts). Other
 * collaboration artifacts (groups) get no box.
 */
function collaborationNotes(root: El, pools: PoolLayout[], di: El[], absBoxes: Map<string, Box>): Array<{ el: El; box?: Box }> {
  const artifacts = many(root, 'artifacts');
  const links = artifacts.filter((a) => is(a, 'bpmn:Association'));
  const notes = artifacts.filter((a) => is(a, 'bpmn:TextAnnotation'));
  const edges = drawnEdges(di);
  const poolBoxes = pools.map((p) => p.box);
  const jobs: NoteJob[] = notes.map((note) => {
    const size = annotationSize(note.get<string | undefined>('text'));
    for (const link of links) {
      const s = link.get<El | undefined>('sourceRef'), t = link.get<El | undefined>('targetRef');
      const other = s === note ? t : t === note ? s : undefined;
      const anchor = endBox(other, absBoxes, edges, poolBoxes);
      if (!other || !anchor) continue;
      // inside the anchor's pool, and in its lane when it has one
      const pool = is(other, 'bpmn:Participant') || !absBoxes.has(idOf(other)) ? undefined : poolOf(pools, other);
      return { ...size, anchor, ...(pool ? { pool: clip(poolContent(pool), laneBoxOf(other, absBoxes)) } : {}) };
    }
    return { ...size };
  });
  const world = { ...drawnWorld(di, absBoxes), pools: pools.map((p) => p.box) };
  const boxes = placeCollaborationNotes(jobs, world);
  return [...notes.map((el, i) => ({ el, box: boxes[i] })), ...artifacts.filter((a) => !is(a, 'bpmn:Association') && !is(a, 'bpmn:TextAnnotation')).map((el) => ({ el }))];
}

/** Straight association lines of the collaboration (both ends drawn), border to border. */
function collaborationLinks(root: El, pools: PoolLayout[], di: El[], absBoxes: Map<string, Box>): Array<{ el: El; points?: Point[] }> {
  const edges = drawnEdges(di);
  const poolBoxes = pools.map((p) => p.box);
  return many(root, 'artifacts')
    .filter((a) => is(a, 'bpmn:Association'))
    .map((el) => {
      const a = endBox(el.get<El | undefined>('sourceRef'), absBoxes, edges, poolBoxes);
      const b = endBox(el.get<El | undefined>('targetRef'), absBoxes, edges, poolBoxes);
      if (!a || !b) return { el };
      const p = borderPoint(a, center(b));
      return { el, points: [p, borderPoint(b, p)] };
    });
}

/* ------------------------------------------------------------------ */
/* label declutter                                                      */
/* ------------------------------------------------------------------ */

function segs(points: Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i]!, points[i + 1]!]);
  return out;
}

function hitsBox([p, q]: Seg, b: Box, shrink = 0): boolean {
  return Math.min(p.x, q.x) < b.x + b.width - shrink && Math.max(p.x, q.x) > b.x + shrink && Math.min(p.y, q.y) < b.y + b.height - shrink && Math.max(p.y, q.y) > b.y + shrink;
}

/**
 * Moves labels that sit on a shape, on another label or on a line to the next
 * free spot around their element. Runs on the finished DI of one plane, so it
 * sees every shape, edge and label at once. Deterministic: labels are handled
 * in emit order and every placed label becomes an obstacle for the next.
 */
function declutterLabels(di: El[], moddle: Model['moddle']): void {
  const boxOf = (bounds: El): Box => ({ x: bounds.get<number>('x'), y: bounds.get<number>('y'), width: bounds.get<number>('width'), height: bounds.get<number>('height') });
  interface Item {
    el: El;
    bounds: El;
    box: Box;
    shape?: Box;
    points?: Point[];
  }
  const shapes: Box[] = [];
  const frames: Box[] = [];
  const lines: Seg[] = [];
  const items: Item[] = [];
  for (const d of di) {
    const el = d.get<El | undefined>('bpmnElement');
    if (!el) continue;
    const isShape = is(d, 'bpmndi:BPMNShape');
    const container = isShape && (is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || (is(el, 'bpmn:SubProcess') && d.get<boolean | undefined>('isExpanded') === true));
    const shapeBox = isShape ? boxOf(d.get<El>('bounds')) : undefined;
    if (shapeBox && !container) shapes.push(shapeBox);
    if (shapeBox && container) frames.push(shapeBox);
    const points = isShape ? undefined : many(d, 'waypoint').map((w) => ({ x: w.get<number>('x'), y: w.get<number>('y') }));
    if (points) lines.push(...segs(points));
    const label = d.get<El | undefined>('label');
    const bounds = label?.get<El | undefined>('bounds');
    if (!bounds) continue;
    items.push({ el, bounds, box: boxOf(bounds), ...(shapeBox ? { shape: shapeBox } : {}), ...(points ? { points } : {}) });
  }
  const placed: Box[] = [];
  const holds = (f: Box, p: Point): boolean => p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + f.height;
  const within = (f: Box, b: Box): boolean => b.x >= f.x && b.y >= f.y && b.x + b.width <= f.x + f.width && b.y + b.height <= f.y + f.height;
  // the innermost frame (lane, pool, expanded sub-process) around a shape / both ends of a flow: a label moves out of it only when no free spot is inside
  const frameOf = (pts: Point[]): Box | undefined =>
    frames.filter((f) => pts.every((p) => holds(f, p))).sort((a, b) => a.width * a.height - b.width * b.height)[0];
  const clashes = (b: Box, own?: Box): boolean =>
    shapes.some((s) => s !== own && boxesOverlap(s, b, 2)) ||
    placed.some((o) => boxesOverlap(o, b, 2)) ||
    lines.some((seg) => hitsBox(seg, b, 1));
  for (const item of items) {
    const b = item.box;
    if (!clashes(b, item.shape)) {
      placed.push(b);
      continue;
    }
    const cands: Box[] = [];
    if (item.shape) {
      const s = item.shape;
      const cx = s.x + s.width / 2;
      const below = s.y + s.height + 6, above = s.y - b.height - 6;
      for (const dx of [0, -0.6, 0.6, -1.2, 1.2]) {
        cands.push({ ...b, x: Math.round(cx - b.width / 2 + dx * b.width), y: below });
        cands.push({ ...b, x: Math.round(cx - b.width / 2 + dx * b.width), y: above });
      }
      for (const dy of [0, -1, 1]) {
        cands.push({ ...b, x: s.x + s.width + 6, y: Math.round(s.y + s.height / 2 - b.height / 2 + dy * b.height) });
        cands.push({ ...b, x: s.x - b.width - 6, y: Math.round(s.y + s.height / 2 - b.height / 2 + dy * b.height) });
      }
      for (const step of [1, 2, 3]) {
        cands.push({ ...b, x: Math.round(cx - b.width / 2), y: below + step * (b.height + 4) });
        cands.push({ ...b, x: Math.round(cx - b.width / 2), y: above - step * (b.height + 4) });
      }
    } else if (item.points) {
      // along the edge: above / below every segment, at its start, middle and end
      for (const [p, q] of segs(item.points)) {
        const horizontal = p.y === q.y;
        const lo = Math.min(p.x, q.x), hi = Math.max(p.x, q.x);
        const loY = Math.min(p.y, q.y), hiY = Math.max(p.y, q.y);
        if (horizontal && hi - lo >= b.width / 2) {
          for (const t of [0.05, 0.5, 0.95]) {
            const x = Math.round(lo + (hi - lo) * t - b.width / 2);
            cands.push({ ...b, x, y: p.y - b.height - 4 });
            cands.push({ ...b, x, y: p.y + 4 });
          }
        } else if (!horizontal && hiY - loY >= b.height) {
          for (const t of [0.2, 0.5, 0.8]) {
            const y = Math.round(loY + (hiY - loY) * t - b.height / 2);
            cands.push({ ...b, x: p.x + 6, y });
            cands.push({ ...b, x: p.x - b.width - 6, y });
          }
        }
      }
    }
    const frame = item.shape ? frameOf([{ x: item.shape.x + item.shape.width / 2, y: item.shape.y + item.shape.height / 2 }]) : item.points?.length ? frameOf([item.points[0]!, item.points[item.points.length - 1]!]) : undefined;
    // a free spot inside the frame first, else any free spot
    const free = cands.filter((c) => !clashes(c, item.shape));
    const win = free.find((c) => !frame || !within(frame, b) || within(frame, c)) ?? free[0];
    const box = win ?? b;
    item.bounds.set('x', Math.round(box.x));
    item.bounds.set('y', Math.round(box.y));
    placed.push(box);
  }
  void moddle;
}

export { borderPoint };
