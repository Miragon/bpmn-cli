/**
 * Placement: builds the graph of one scope, assigns layers (columns) and
 * rows (bands), positions nodes, boundary events, event sub-processes and
 * artifacts. Recurses into expanded sub-processes.
 *
 * Conventions (see HANDOVER.md and the README section "Layout conventions"):
 *  - left to right; the happy path (the branch that reaches farthest) is a
 *    straight line on row 0
 *  - every other branch is a band below its split, in declaration order; a
 *    band is reused when its column interval is free (compact but never
 *    overlapping), and the split's column stays free for the drop line
 *  - boundary event handlers are bands below their host
 *  - loops (edges closing a cycle) do not influence layering; they are drawn
 *    underneath (see route.ts)
 *  - event sub-processes sit below the main content
 *  - text annotations go above, data objects/stores below their node; a
 *    note on a boundary event hangs below the host, clear of the sibling
 *    events, their labels and the flows dropping from them
 *  - expanded / collapsed follows `opts.expanded` for every sub-process,
 *    event sub-processes included
 */
import { layoutDebug, layoutDebugOn } from '../debug.js';
import { is, many, type El } from '../model.js';
import { elementLabel, routeEdges, routeLinks, routedSegments } from './route.js';
import { METRICS, SIZES, boxesOverlap, labelSize, type Box, type GArtifact, type GEdge, type GNode, type LinkEnd, type Point, type ScopeLayout } from './types.js';

const idOf = (el: El): string => el.get<string>('id');

/* ------------------------------------------------------------------ */
/* graph extraction                                                     */
/* ------------------------------------------------------------------ */

function kindOfNode(el: El): GNode['kind'] {
  if (is(el, 'bpmn:StartEvent')) return 'start';
  if (is(el, 'bpmn:EndEvent')) return 'end';
  if (is(el, 'bpmn:Event')) return 'event';
  if (is(el, 'bpmn:Gateway')) return 'gateway';
  if (is(el, 'bpmn:SubProcess')) return el.get<boolean | undefined>('triggeredByEvent') ? 'eventSubProcess' : 'subProcess';
  return 'task';
}

function sizeOf(el: El): { width: number; height: number } {
  if (is(el, 'bpmn:Event')) return { ...SIZES.event };
  if (is(el, 'bpmn:Gateway')) return { ...SIZES.gateway };
  return { ...SIZES.task };
}

export interface PlaceOptions {
  /** ids of sub-processes to lay out expanded */
  expanded: Set<string>;
  /** collects child planes of collapsed sub-processes */
  collapsedScopes: Map<string, ScopeLayout>;
}

/** Builds and lays out one scope (process or sub-process). */
export function layoutScope(scope: El, opts: PlaceOptions): ScopeLayout {
  const flowElements = many(scope, 'flowElements');
  const byId = new Map<string, GNode>();
  const nodes: GNode[] = [];
  const eventSubs: GNode[] = [];

  for (const el of flowElements) {
    if (!is(el, 'bpmn:FlowNode') || is(el, 'bpmn:BoundaryEvent')) continue;
    const kind = kindOfNode(el);
    const node: GNode = { el, id: idOf(el), ...sizeOf(el), kind, boundary: [], layer: 0, row: 0, band: 0, box: { x: 0, y: 0, width: 0, height: 0 }, out: [], in: [] };
    if (kind === 'subProcess' || kind === 'eventSubProcess') {
      // event sub-processes too: expanded unless the DI or the caller collapses them
      if (opts.expanded.has(node.id)) {
        node.child = layoutScope(el, opts);
        const p = SIZES.subProcessPadding;
        node.width = Math.max(SIZES.subProcessMin.width, node.child.width + p.left + p.right);
        node.height = Math.max(SIZES.subProcessMin.height, node.child.height + p.top + p.bottom);
      } else {
        opts.collapsedScopes.set(node.id, layoutScope(el, opts));
      }
    }
    byId.set(node.id, node);
    if (kind === 'eventSubProcess') eventSubs.push(node);
    else nodes.push(node);
  }
  // boundary events
  for (const el of flowElements) {
    if (!is(el, 'bpmn:BoundaryEvent')) continue;
    const hostEl = el.get<El | undefined>('attachedToRef');
    const host = hostEl ? byId.get(idOf(hostEl)) : undefined;
    const node: GNode = { el, id: idOf(el), ...SIZES.event, kind: 'event', boundary: [], layer: 0, row: 0, band: 0, box: { x: 0, y: 0, width: 0, height: 0 }, out: [], in: [] };
    if (host) {
      node.host = host;
      host.boundary.push(node);
    } else {
      nodes.push(node); // dangling boundary event: treat as a normal node
    }
    byId.set(node.id, node);
  }
  // edges
  const edges: GEdge[] = [];
  for (const el of flowElements) {
    if (!is(el, 'bpmn:SequenceFlow')) continue;
    const s = el.get<El | undefined>('sourceRef');
    const t = el.get<El | undefined>('targetRef');
    const source = s ? byId.get(idOf(s)) : undefined;
    const target = t ? byId.get(idOf(t)) : undefined;
    if (!source || !target) continue;
    const edge: GEdge = { el, id: idOf(el), source, target, back: false, points: [] };
    source.out.push(edge);
    target.in.push(edge);
    edges.push(edge);
  }

  const layout: ScopeLayout = { el: scope, nodes, edges, artifacts: [], eventSubs, compensations: [], width: 0, height: 0, lanes: [], crossLinks: [] };
  // compensation: boundary event -> handler association
  for (const el of many(scope, 'artifacts')) {
    if (!is(el, 'bpmn:Association')) continue;
    const src = el.get<El | undefined>('sourceRef');
    const tgt = el.get<El | undefined>('targetRef');
    const event = src ? byId.get(idOf(src)) : undefined;
    const handler = tgt ? byId.get(idOf(tgt)) : undefined;
    if (!event || !handler || !event.host || !is(event.el, 'bpmn:BoundaryEvent')) continue;
    if (handler.in.length || !is(handler.el, 'bpmn:Activity')) continue;
    event.compensationHandler = handler;
    handler.compensatedBy = event;
    layout.compensations.push({ el, id: idOf(el), event, handler, points: [] });
  }
  markBackEdges(layout);
  assignLayers(layout);
  assignRows(layout);
  buildArtifacts(layout, scope, byId);
  positionNodes(layout);
  placeAttachedArtifacts(layout);
  routeEdges(layout);
  refreshFlowAnchors(layout);
  placeEventSubs(layout);
  placeAnnotations(layout);
  routeLinks(layout);
  growToFit(layout);
  return layout;
}

/* ------------------------------------------------------------------ */
/* layering                                                             */
/* ------------------------------------------------------------------ */

/**
 * Marks the edges that close cycles. A loop is closed at the edge that jumps
 * back to the shallowest node of the cycle (smallest breadth-first distance
 * from the starts), so a branch that re-joins after its own join keeps its
 * place and the loop is drawn from the late node back to the early one.
 * Repeats until the forward graph is acyclic; deterministic (ties: the edge
 * with the deepest source, then the later declared one).
 */
function markBackEdges(layout: ScopeLayout): void {
  const { nodes, edges } = layout;
  const srcOf = (e: GEdge): GNode => e.source.host ?? e.source;
  const forwardOut = (n: GNode): GEdge[] => outgoingOf(n).filter((e) => !e.back);
  const starts = nodes.filter((n) => n.kind === 'start');
  const sources = nodes.filter((n) => n.kind !== 'start' && n.in.length === 0);
  const roots = [...starts, ...sources];
  const depths = (): Map<GNode, number> => {
    const depth = new Map<GNode, number>();
    const bfs = (root: GNode): void => {
      if (depth.has(root)) return;
      depth.set(root, 0);
      const queue = [root];
      while (queue.length) {
        const n = queue.shift()!;
        for (const e of forwardOut(n)) {
          if (depth.has(e.target)) continue;
          depth.set(e.target, depth.get(n)! + 1);
          queue.push(e.target);
        }
      }
    };
    for (const r of roots) bfs(r);
    for (const n of nodes) bfs(n); // nodes only reachable through cycles
    return depth;
  };
  const reaches = (from: GNode, to: GNode): boolean => {
    const seen = new Set<GNode>([from]);
    const stack = [from];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === to) return true;
      for (const e of forwardOut(n)) if (!seen.has(e.target)) {
        seen.add(e.target);
        stack.push(e.target);
      }
    }
    return false;
  };
  const hasCycle = (): boolean => {
    const state = new Map<GNode, 1 | 2>();
    const visit = (n: GNode): boolean => {
      state.set(n, 1);
      for (const e of forwardOut(n)) {
        const s = state.get(e.target);
        if (s === 1 || (s === undefined && visit(e.target))) return true;
      }
      state.set(n, 2);
      return false;
    };
    return nodes.some((n) => !state.has(n) && visit(n));
  };
  for (let guard = 0; guard <= edges.length && hasCycle(); guard++) {
    const depth = depths();
    let best: { e: GEdge; index: number; tDepth: number; sDepth: number } | undefined;
    edges.forEach((e, index) => {
      if (e.back) return;
      const u = srcOf(e), v = e.target;
      const tDepth = depth.get(v) ?? 0, sDepth = depth.get(u) ?? 0;
      if (tDepth > sDepth || !reaches(v, u)) return;
      if (!best || tDepth < best.tDepth || (tDepth === best.tDepth && (sDepth > best.sDepth || (sDepth === best.sDepth && index > best.index)))) {
        best = { e, index, tDepth, sDepth };
      }
    });
    if (!best) break;
    best.e.back = true;
  }
}

/** True when every forward continuation of a node is a loop back (or the node has none but a loop). */
function loopsBackOnly(n: GNode): boolean {
  const out = outgoingOf(n);
  return out.length > 0 && out.every((e) => e.back);
}

/** Outgoing flows of a node including those of its boundary events (they leave from the host's column). */
function outgoingOf(n: GNode): GEdge[] {
  return [...n.out, ...n.boundary.flatMap((b) => b.out)];
}

function assignLayers(layout: ScopeLayout): void {
  const { nodes } = layout;
  const memo = new Map<GNode, number>();
  const layerOf = (n: GNode): number => {
    const known = memo.get(n);
    if (known !== undefined) return known;
    memo.set(n, 0); // guard against unexpected cycles
    let layer = 0;
    for (const e of n.in) {
      if (e.back) continue;
      const src = e.source.host ?? e.source;
      layer = Math.max(layer, layerOf(src) + 1);
    }
    memo.set(n, layer);
    return layer;
  };
  for (const n of nodes) n.layer = layerOf(n);
  for (const n of nodes) if (n.compensatedBy?.host) n.layer = n.compensatedBy.host.layer; // handler under its host
  for (const n of nodes) for (const b of n.boundary) b.layer = n.layer;
}

/* ------------------------------------------------------------------ */
/* rows                                                                 */
/* ------------------------------------------------------------------ */

interface Branch {
  /** id of the origin node (its column is the drop column); '#spine' / '#comp-*' for chains without origin */
  owner: string;
  from: number;
  to: number;
  row: number;
  originRow: number;
  dropColumn: number;
  nodes: GNode[];
  /** empty band: the skip edge it is reserved for */
  edge?: GEdge;
}

function overlapsRange(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/**
 * Assigns rows. Row 0 is the spine (the path that reaches farthest). Every
 * other branch (a chain of not yet placed nodes starting with a non-spine
 * outgoing flow) becomes a band below its origin:
 *  1. the first existing row below the origin where the column interval is
 *     free and the drop line from the origin passes no other band,
 *  2. else a new band inserted between existing ones, shifting down only the
 *     bands it collides with (transitively),
 *  3. else the first row where merely the interval is free (the router then
 *     bends the drop line around the obstacle).
 * A split flow that goes straight to an already placed node on the same row
 * (an empty branch, a skip) reserves an empty band the same way.
 */
function assignRows(layout: ScopeLayout): void {
  const { nodes } = layout;
  const placed = new Set<GNode>();
  const branches: Branch[] = [];
  const debug = (msg: string): void => {
    if (layoutDebugOn()) layoutDebug(`[rows] ${msg}`);
  };
  const inRow = (row: number): Branch[] => branches.filter((b) => b.row === row);
  const maxRow = (): number => Math.max(-1, ...branches.map((b) => b.row));
  /** the drop line of `b` (excluding its ends) passes row `row` at its drop column */
  const dropPasses = (b: Branch, row: number): boolean => b.originRow < row && row < b.row;
  const intervalFree = (row: number, iv: Branch): boolean => !inRow(row).some((o) => overlapsRange(o, iv));
  const dropFree = (row: number, iv: Branch): boolean => {
    for (let r = iv.originRow + 1; r < row; r++) {
      if (inRow(r).some((o) => o.owner !== iv.owner && o.from <= iv.dropColumn && iv.dropColumn <= o.to)) return false;
    }
    return true;
  };
  const setRow = (iv: Branch, row: number): void => {
    iv.row = row;
    for (const n of iv.nodes) n.row = row;
    if (iv.edge) iv.edge.bandRow = row;
  };
  const commit = (iv: Branch, row: number): void => {
    setRow(iv, row);
    for (const n of iv.nodes) n.band = branches.length;
    branches.push(iv);
  };

  /** inserts a new band at `at` for `iv`, shifting only colliding bands down; false when a drop line would be cut */
  const tryInsert = (at: number, iv: Branch): boolean => {
    // bands that must move: those in row `at` overlapping the new band, then transitively the ones below them
    const moving = new Map<Branch, number>(); // branch -> new row
    const queue: Branch[] = inRow(at).filter((o) => overlapsRange(o, iv));
    for (const o of queue) moving.set(o, at + 1);
    while (queue.length) {
      const m = queue.shift()!;
      const newRow = moving.get(m)!;
      for (const o of inRow(newRow)) {
        if (moving.has(o) || !overlapsRange(o, m)) continue;
        moving.set(o, newRow + 1);
        queue.push(o);
      }
    }
    // a drop line of a band that stays must not be cut by the new band
    for (const b of branches) {
      if (moving.has(b)) continue;
      if (dropPasses(b, at) && iv.from <= b.dropColumn && b.dropColumn <= iv.to) return false;
    }
    // a moved band's drop line now also passes row `at`
    for (const [b] of moving) {
      if (b.originRow < at && iv.from <= b.dropColumn && b.dropColumn <= iv.to) return false;
    }
    // the own drop line must not be cut by bands staying between the origin and `at`
    for (let r = iv.originRow + 1; r < at; r++) {
      if (inRow(r).some((o) => !moving.has(o) && o.owner !== iv.owner && o.from <= iv.dropColumn && iv.dropColumn <= o.to)) return false;
    }
    for (const [b, newRow] of moving) setRow(b, newRow);
    commit(iv, at);
    return true;
  };

  const place = (iv: Branch): void => {
    const limit = maxRow() + 1;
    for (let row = iv.originRow + 1; row <= limit; row++) {
      if (intervalFree(row, iv) && dropFree(row, iv)) {
        commit(iv, row);
        debug(`${iv.owner} [${iv.from}..${iv.to}] from row ${iv.originRow} -> row ${row}`);
        return;
      }
    }
    for (let at = iv.originRow + 1; at <= limit; at++) {
      if (tryInsert(at, iv)) {
        debug(`${iv.owner} [${iv.from}..${iv.to}] from row ${iv.originRow} -> inserted row ${at}`);
        return;
      }
    }
    for (let row = iv.originRow + 1; ; row++) {
      if (intervalFree(row, iv)) {
        commit(iv, row);
        debug(`${iv.owner} [${iv.from}..${iv.to}] from row ${iv.originRow} -> fallback row ${row}`);
        return;
      }
    }
  };

  /** farthest layer reachable from a node over forward edges */
  const reachMemo = new Map<GNode, number>();
  const reach = (n: GNode): number => {
    const known = reachMemo.get(n);
    if (known !== undefined) return known;
    reachMemo.set(n, n.layer);
    let best = n.layer;
    for (const e of outgoingOf(n)) if (!e.back) best = Math.max(best, reach(e.target));
    reachMemo.set(n, best);
    return best;
  };

  /** the flow a node continues its chain with (the other flows are branches) */
  const chainNext = new Map<GNode, GNode>();

  /** Follows unplaced forward flows from `start` (farthest reach first); returns the chain and the join it ran into. */
  const chain = (start: GNode): { nodes: GNode[]; join?: GNode } => {
    const out: GNode[] = [];
    let cur: GNode | undefined = start;
    while (cur && !placed.has(cur)) {
      out.push(cur);
      placed.add(cur);
      // only the node's own flows continue the chain: boundary handlers are always bands below the host
      const candidates: GEdge[] = cur.out.filter((e) => !e.back && !placed.has(e.target));
      let next: GNode | undefined;
      let bestReach = -1;
      for (const e of candidates) {
        const r = loopsBackOnly(e.target) ? -0.5 : reach(e.target);
        if (r > bestReach) {
          bestReach = r;
          next = e.target;
        }
      }
      if (!next) {
        const join = cur.out.find((e) => !e.back && placed.has(e.target))?.target;
        if (join) chainNext.set(cur, join);
        return { nodes: out, join };
      }
      chainNext.set(cur, next);
      cur = next;
    }
    return { nodes: out, join: cur };
  };

  const queue: Array<{ origin: GNode; first: GNode }> = [];
  const enqueueBranches = (chainNodes: GNode[]): void => {
    // regular branches first (they get the rows right below the chain), boundary handlers afterwards
    for (const n of chainNodes) {
      for (const e of n.out) {
        if (e.back) continue;
        if (!placed.has(e.target)) queue.push({ origin: n, first: e.target });
        else if (e.target !== chainNext.get(n) && e.target.row === n.row && e.target.layer > n.layer + 1 && n.out.length > 1) {
          // empty branch / skip: reserve a band so the flow gets its own strip and enters the join from below
          const iv: Branch = { owner: n.id, from: n.layer, to: e.target.layer, row: 0, originRow: n.row, dropColumn: n.layer, nodes: [], edge: e };
          place(iv);
        }
      }
    }
    for (const n of chainNodes) {
      for (const e of n.boundary.flatMap((b) => b.out)) {
        if (e.back || placed.has(e.target)) continue;
        queue.push({ origin: n, first: e.target });
      }
      for (const b of n.boundary) {
        if (b.compensationHandler && !placed.has(b.compensationHandler)) queue.push({ origin: n, first: b.compensationHandler });
      }
    }
  };

  const starts = nodes.filter((n) => n.kind === 'start');
  const sources = nodes.filter((n) => n.in.length === 0 && n.kind !== 'start');
  const roots = [...starts, ...sources, ...nodes];
  const maxLayer = Math.max(0, ...nodes.map((n) => n.layer));
  let first = true;
  for (const root of roots) {
    if (placed.has(root)) continue;
    const c = chain(root);
    if (first) {
      commit({ owner: '#spine', from: 0, to: maxLayer, row: 0, originRow: -1, dropColumn: -1, nodes: c.nodes }, 0);
      first = false;
    } else {
      const from = Math.min(...c.nodes.map((n) => n.layer));
      const to = Math.max(...c.nodes.map((n) => n.layer), c.join?.layer ?? 0);
      place({ owner: `#comp-${root.id}`, from, to, row: 0, originRow: -1, dropColumn: -1, nodes: c.nodes });
    }
    enqueueBranches(c.nodes);
    while (queue.length) {
      const { origin, first: firstNode } = queue.shift()!;
      if (placed.has(firstNode)) continue;
      const c2 = chain(firstNode);
      const from = origin.layer;
      const to = Math.max(...c2.nodes.map((n) => n.layer), c2.join?.layer ?? 0);
      place({ owner: origin.id, from, to, row: 0, originRow: origin.row, dropColumn: origin.layer, nodes: c2.nodes });
      enqueueBranches(c2.nodes);
    }
  }
  for (const n of nodes) for (const b of n.boundary) b.row = n.row;
}

/* ------------------------------------------------------------------ */
/* geometry                                                             */
/* ------------------------------------------------------------------ */

/** Extra row height below a node for its boundary events (they hang out of the bottom border, labels beside). */
export function boundaryExtra(n: GNode): number {
  return n.boundary.length ? SIZES.event.height / 2 + 20 : 0;
}

/** Room for data objects / stores hanging below a row: the gap between rows grows by this. */
export const DATA_ROW_EXTRA = 40;

/** Width a host needs so its boundary events fit along the bottom border. */
export function hostWidthFor(n: GNode): number {
  const count = n.boundary.length;
  if (count < 3) return n.width;
  return Math.max(n.width, 2 * METRICS.boundaryOffset + (count - 1) * (SIZES.event.width + 8) + 10);
}

/** Positions the boundary events of a host along its bottom border (right to left; collapsed sub-processes: left to right, away from the drill-down marker). */
export function placeBoundaryEvents(n: GNode): void {
  const collapsed = n.kind === 'subProcess' && !n.child;
  n.boundary.forEach((b, i) => {
    const step = i * (SIZES.event.width + 8);
    const cx = collapsed ? n.box.x + METRICS.boundaryOffset + step : n.box.x + n.box.width - METRICS.boundaryOffset - step;
    b.box = { x: Math.round(cx - SIZES.event.width / 2), y: n.box.y + n.box.height - SIZES.event.height / 2, width: SIZES.event.width, height: SIZES.event.height };
  });
}

/** Horizontal gap needed after a layer so the labels of its outgoing flows fit before the next column. */
export function layerGapFor(edges: GEdge[], layer: number): number {
  let gap = METRICS.hGap;
  for (const e of edges) {
    if (e.back) continue;
    const s = e.source.host ?? e.source;
    if (s.layer !== layer || e.target.layer !== layer + 1) continue;
    const name = e.el.get<string | undefined>('name');
    if (!name) continue;
    const lbl = labelSize(name);
    let need = lbl.width + 16;
    const gwName = s.kind === 'gateway' ? s.el.get<string | undefined>('name') : undefined;
    if (gwName && lbl.lines > 1) need = Math.max(need, labelSize(gwName).width / 2 - s.width / 2 + lbl.width + 12);
    gap = Math.max(gap, need);
  }
  return gap;
}

function positionNodes(layout: ScopeLayout): void {
  const { nodes } = layout;
  if (!nodes.length) {
    layout.width = 0;
    layout.height = 0;
    return;
  }
  for (const n of nodes) n.width = hostWidthFor(n);
  const layers = Math.max(...nodes.map((n) => n.layer)) + 1;
  const rows = Math.max(...nodes.map((n) => n.row), ...layout.edges.map((e) => e.bandRow ?? 0)) + 1;
  const colWidth = new Array<number>(layers).fill(0);
  const rowHeight = new Array<number>(rows).fill(0);
  const rowExtra = new Array<number>(rows).fill(0);
  for (const n of nodes) {
    colWidth[n.layer] = Math.max(colWidth[n.layer]!, n.width);
    rowHeight[n.row] = Math.max(rowHeight[n.row]!, n.height + boundaryExtra(n));
  }
  for (const a of layout.artifacts) {
    if (a.kind !== 'annotation' && a.anchorNode) rowExtra[a.anchorNode.row] = DATA_ROW_EXTRA;
  }
  const colX: number[] = [];
  let x = 0;
  for (let l = 0; l < layers; l++) {
    colX.push(x);
    x += colWidth[l]! + layerGapFor(layout.edges, l);
  }
  const rowY: number[] = [];
  let y = 0;
  for (let r = 0; r < rows; r++) {
    rowY.push(y);
    y += rowHeight[r]! + METRICS.vGap + rowExtra[r]!;
  }
  for (const n of nodes) {
    const cw = colWidth[n.layer]!;
    const rh = rowHeight[n.row]!;
    const bx = colX[n.layer]! + (cw - n.width) / 2;
    // every node is centred on the row centre so same-row flows are straight
    const by = rowY[n.row]! + rh / 2 - n.height / 2;
    n.box = { x: Math.round(bx), y: Math.round(by), width: n.width, height: n.height };
    placeBoundaryEvents(n);
  }
  for (const e of layout.edges) if (e.bandRow !== undefined) e.bandY = rowY[e.bandRow]! + rowHeight[e.bandRow]! / 2;
  // compensation handlers sit centred under their boundary event
  for (const n of nodes) {
    const ev = n.compensatedBy;
    if (ev) {
      n.box.x = Math.round(ev.box.x + ev.box.width / 2 - n.box.width / 2);
      placeBoundaryEvents(n);
    }
  }
  layout.width = x - layerGapFor(layout.edges, layers - 1);
  layout.height = y - METRICS.vGap - rowExtra[rows - 1]!;
}

function placeEventSubs(layout: ScopeLayout): void {
  if (!layout.eventSubs.length) return;
  let y = layout.height ? layout.height + METRICS.vGap : 0;
  for (const es of layout.eventSubs) {
    es.box = { x: 0, y, width: es.width, height: es.height };
    y += es.height + METRICS.vGap;
    layout.width = Math.max(layout.width, es.width);
  }
  layout.height = y - METRICS.vGap;
}

/* ------------------------------------------------------------------ */
/* artifacts                                                            */
/* ------------------------------------------------------------------ */

export function annotationSize(text: string | undefined): { width: number; height: number } {
  const len = (text ?? '').length;
  const width = Math.min(300, Math.max(100, Math.ceil((len * 6.5 + 24) / 20) * 20));
  const lines = Math.max(1, Math.ceil((len * 6.5) / (width - 14)));
  return { width, height: Math.max(30, lines * 14 + 12) };
}

/** Middle of the longest segment of a routed flow (zero-size anchor box). */
function flowPoint(flow: GEdge): Box {
  let best: [Point, Point] | undefined;
  for (let i = 0; i + 1 < flow.points.length; i++) {
    const a = flow.points[i]!, b = flow.points[i + 1]!;
    if (!best || Math.hypot(b.x - a.x, b.y - a.y) > Math.hypot(best[1].x - best[0].x, best[1].y - best[0].y)) best = [a, b];
  }
  const p = best ? { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 } : { x: 0, y: 0 };
  return { x: p.x, y: p.y, width: 0, height: 0 };
}

/** Re-computes the anchor points of associations that dock on a flow (after routing). */
export function refreshFlowAnchors(layout: ScopeLayout): void {
  for (const a of layout.artifacts) {
    for (const link of a.links) {
      for (const end of [link.from, link.to]) if (end.flow) end.box = flowPoint(end.flow);
    }
    if (a.anchor?.flow) a.anchor.box = flowPoint(a.anchor.flow);
  }
}

/** Builds the artifacts of a scope and their links (no positions yet). */
function buildArtifacts(layout: ScopeLayout, scope: El, byId: Map<string, GNode>): void {
  const artifacts: GArtifact[] = [];
  const byArtifactId = new Map<string, GArtifact>();
  const add = (el: El, kind: GArtifact['kind'], size: { width: number; height: number }): GArtifact => {
    const a: GArtifact = { el, id: idOf(el), kind, ...size, box: { x: 0, y: 0, ...size }, links: [] };
    artifacts.push(a);
    byArtifactId.set(a.id, a);
    return a;
  };
  for (const el of many(scope, 'flowElements')) {
    if (is(el, 'bpmn:DataObjectReference')) add(el, 'dataObject', { ...SIZES.dataObject });
    else if (is(el, 'bpmn:DataStoreReference')) add(el, 'dataStore', { ...SIZES.dataStore });
  }
  for (const el of many(scope, 'artifacts')) {
    if (is(el, 'bpmn:TextAnnotation')) add(el, 'annotation', annotationSize(el.get<string | undefined>('text')));
  }
  const flowsById = new Map(layout.edges.map((e) => [e.id, e]));
  const flowEnds = new Map<GEdge, LinkEnd>();
  const resolve = (el: El | undefined): GNode | GArtifact | LinkEnd | undefined => {
    if (!el) return undefined;
    const id = idOf(el);
    const node = byId.get(id) ?? byArtifactId.get(id);
    if (node) return node;
    const flow = flowsById.get(id);
    if (!flow) return undefined;
    let end = flowEnds.get(flow);
    if (!end) {
      end = { box: { x: 0, y: 0, width: 0, height: 0 }, flow };
      flowEnds.set(flow, end);
    }
    return end;
  };
  const anchorTo = (art: GArtifact, end: GNode | GArtifact | LinkEnd): void => {
    if (art.anchor) return;
    art.anchor = end;
    if ('kind' in end && 'boundary' in end) art.anchorNode = end;
  };
  for (const el of many(scope, 'artifacts')) {
    if (!is(el, 'bpmn:Association')) continue;
    const source = el.get<El | undefined>('sourceRef');
    const target = el.get<El | undefined>('targetRef');
    const from = resolve(source);
    const to = resolve(target);
    const art = from && 'links' in from ? (from as GArtifact) : to && 'links' in to ? (to as GArtifact) : undefined;
    if (!from || !to || !art) {
      // an end in another scope (a nested sub-process): drawn by the engine once both shapes exist
      if (source && target && !layout.compensations.some((c) => c.el === el)) layout.crossLinks.push({ el, id: idOf(el), sourceId: idOf(source), targetId: idOf(target) });
      continue;
    }
    art.links.push({ el, id: idOf(el), from, to, points: [] });
    anchorTo(art, art === from ? to : from);
  }
  for (const node of [...byId.values()]) {
    for (const da of node.el.get<El[] | undefined>('dataInputAssociations') ?? []) {
      const src = (da.get<El[] | undefined>('sourceRef') ?? [])[0];
      const art = src ? byArtifactId.get(idOf(src)) : undefined;
      if (!art) {
        if (src) layout.crossLinks.push({ el: da, id: idOf(da), sourceId: idOf(src), targetId: node.id });
        continue;
      }
      art.links.push({ el: da, id: idOf(da), from: art, to: node, points: [] });
      anchorTo(art, node);
    }
    for (const da of node.el.get<El[] | undefined>('dataOutputAssociations') ?? []) {
      const tgt = da.get<El | undefined>('targetRef');
      const art = tgt ? byArtifactId.get(idOf(tgt)) : undefined;
      if (!art) {
        if (tgt) layout.crossLinks.push({ el: da, id: idOf(da), sourceId: node.id, targetId: idOf(tgt) });
        continue;
      }
      art.links.push({ el: da, id: idOf(da), from: node, to: art, points: [] });
      anchorTo(art, node);
    }
  }
  layout.artifacts = artifacts;
}

/** x centre for an artifact hanging below a node: beside the drop line, away from boundary events. */
function belowX(n: GNode): number {
  const cx = n.box.x + n.box.width / 2;
  if (!n.boundary.length) return cx + Math.min(30, n.box.width / 2 - 10);
  const collapsed = n.kind === 'subProcess' && !n.child;
  return collapsed ? cx + 30 : cx - 30;
}

/** A tall thin box: the line dropping from `x` downwards (an obstacle for notes). */
function dropLine(x: number, y: number): Box {
  return { x: x - 2, y, width: 4, height: 100000 };
}

/** What a note on a boundary event must not cover: the host's other boundary events, their labels and the lines dropping from them and from the host. */
function boundaryNoteBlockers(event: GNode, host: GNode): Box[] {
  const out: Box[] = [];
  for (const b of host.boundary) {
    if (b === event) continue;
    out.push(b.box);
    const label = elementLabel(b, 'boundary');
    if (label) out.push(label);
    if (b.out.length) out.push(dropLine(b.box.x + b.box.width / 2, b.box.y));
  }
  const hostY = host.box.y + host.box.height / 2;
  if (host.out.some((e) => !e.back && e.target.box.y + e.target.box.height / 2 > hostY + 1)) {
    for (const x of [host.box.x + 8, host.box.x + 20]) out.push(dropLine(x, host.box.y + host.box.height));
  }
  return out;
}

/**
 * Box of a note on a boundary event: at the lower left of the event, below
 * the host, further down while another note is there. When that spot covers
 * a sibling boundary event, its label, a line dropping from them or another
 * node, the note goes to the lower right of the event (below its label) or
 * left of everything it would cover, whichever is free first.
 */
function boundaryNoteBox(a: GArtifact, event: GNode, host: GNode, free: (b: Box) => boolean, nodes: Box[]): Box {
  const blockers = boundaryNoteBlockers(event, host);
  const near = event.box.x - 8 - a.width;
  const y0 = host.box.y + host.box.height + 8;
  const fallback = (): Box => {
    let box: Box = { x: near, y: y0, width: a.width, height: a.height };
    while (!free(box)) box = { ...box, y: box.y + a.height + 8 };
    return box;
  };
  if (!blockers.length) return fallback();
  const others = nodes.filter((b) => b !== host.box && b !== event.box);
  const clear = (b: Box): boolean => free(b) && !blockers.some((o) => boxesOverlap(o, b, 4)) && !others.some((o) => boxesOverlap(o, b, 8));
  const label = elementLabel(event, 'boundary');
  const right = { x: event.box.x + event.box.width + 8, y: Math.max(y0, label ? label.y + label.height + 6 : y0) };
  const far = Math.min(near, Math.min(...blockers.map((o) => o.x)) - 8 - a.width);
  for (let k = 0; k < 6; k++) {
    const dy = k * (a.height + 8);
    // left of the content (x < 0) the note would leave its lane / pool: not a candidate
    for (const { x, y } of [{ x: near, y: y0 }, right, ...(far >= 0 ? [{ x: far, y: y0 }] : [])]) {
      const box = { x, y: y + dy, width: a.width, height: a.height };
      if (clear(box)) return box;
    }
  }
  return fallback();
}

/**
 * Data objects / stores right below the node they belong to, annotations of
 * boundary events at the lower left of the event. Runs before routing so the
 * router treats them as obstacles.
 */
export function placeAttachedArtifacts(layout: ScopeLayout): void {
  const taken: Box[] = [];
  const free = (b: Box): boolean => !taken.some((t) => boxesOverlap(t, b, 10));
  for (const a of layout.artifacts) {
    const n = a.anchorNode;
    if (!n) continue;
    if (a.kind === 'annotation') {
      if (!n.host) continue;
      a.box = boundaryNoteBox(a, n, n.host, free, layout.nodes.flatMap((x) => [x.box, ...x.boundary.map((b) => b.box)]));
      taken.push(a.box);
      continue;
    }
    const cx = belowX(n);
    let box: Box = { x: Math.round(cx - a.width / 2), y: n.box.y + n.box.height + (n.boundary.length ? 24 : 20), width: a.width, height: a.height };
    while (!free(box)) box = { ...box, x: box.x + a.width + 10 };
    a.box = box;
    taken.push(box);
  }
  // unanchored data: right of the content
  let x = layout.width + METRICS.hGap;
  for (const a of layout.artifacts) {
    if (a.kind === 'annotation' || a.anchorNode) continue;
    a.box = { x, y: 0, width: a.width, height: a.height };
    x += a.width + 20;
  }
  layout.width = Math.max(layout.width, ...layout.artifacts.filter((a) => a.kind !== 'annotation' || a.anchorNode?.host).map((a) => a.box.x + a.box.width));
  layout.height = Math.max(layout.height, ...layout.artifacts.filter((a) => a.kind !== 'annotation' || a.anchorNode?.host).map((a) => a.box.y + a.box.height));
}

/**
 * Text annotations above their anchor (node or flow point) when that spot is
 * free, else in a band above the whole content. Runs after routing.
 */
export function placeAnnotations(layout: ScopeLayout): void {
  const notes = layout.artifacts.filter((a) => a.kind === 'annotation' && !(a.anchorNode?.host));
  if (!notes.length) return;
  const boxes: Box[] = [];
  for (const n of layout.nodes) {
    boxes.push(n.box);
    for (const b of n.boundary) boxes.push(b.box);
  }
  for (const es of layout.eventSubs) boxes.push(es.box);
  for (const a of layout.artifacts) if (a.kind !== 'annotation' || a.anchorNode?.host) boxes.push(a.box);
  for (const e of layout.edges) if (e.label) boxes.push(e.label);
  const segments = routedSegments(layout);
  const collides = (b: Box): boolean =>
    boxes.some((o) => boxesOverlap(o, b, 6)) ||
    segments.some(([p, q]) => Math.min(p.x, q.x) < b.x + b.width + 4 && Math.max(p.x, q.x) > b.x - 4 && Math.min(p.y, q.y) < b.y + b.height + 4 && Math.max(p.y, q.y) > b.y - 4);
  /** first free x near `cx`, alternating right and left */
  const settle = (a: GArtifact, cx: number, y: number, check: (b: Box) => boolean): Box | undefined => {
    for (let step = 0; step <= 8; step++) {
      for (const dir of step ? [1, -1] : [0]) {
        const x = Math.max(0, Math.round(cx - a.width / 2 + dir * step * (a.width / 2 + 20)));
        const box = { x, y, width: a.width, height: a.height };
        if (!check(box)) return box;
      }
    }
    return undefined;
  };
  const anchorX = (a: GArtifact): number => {
    const anchor = a.anchor?.box;
    return anchor ? anchor.x + anchor.width / 2 : layout.width + METRICS.hGap + a.width / 2;
  };
  const band: GArtifact[] = [];
  for (const a of notes) {
    const anchor = a.anchor?.box;
    if (!anchor) {
      band.push(a);
      continue;
    }
    const y = anchor.y - 16 - a.height;
    const box = y >= 0 ? settle(a, anchorX(a), y, collides) : undefined;
    if (box) {
      a.box = box;
      boxes.push(box);
    } else band.push(a);
  }
  if (band.length) {
    // a strip above the content: left to right in the order of their anchors, so
    // no two association lines cross
    const topBand = Math.max(...band.map((a) => a.height)) + METRICS.vGap;
    shiftScope(layout, 0, topBand);
    band.sort((p, q) => anchorX(p) - anchorX(q));
    let cursor = 0;
    for (const a of band) {
      const x = Math.max(cursor, Math.round(anchorX(a) - a.width / 2));
      a.box = { x, y: 0, width: a.width, height: a.height };
      cursor = x + a.width + 20;
    }
  }
  layout.width = Math.max(layout.width, ...layout.artifacts.map((a) => a.box.x + a.box.width));
  layout.height = Math.max(layout.height, ...layout.artifacts.map((a) => a.box.y + a.box.height));
}

/**
 * The external labels the engine draws for a scope's nodes (events,
 * gateways, boundary events: engine.ts emitNode) and flows, relative to the
 * scope origin.
 */
export function nodeLabels(layout: ScopeLayout): Box[] {
  const out: Box[] = [];
  for (const n of layout.nodes) {
    const kind = n.child || n.kind === 'subProcess' || n.kind === 'eventSubProcess' ? undefined : n.kind === 'gateway' ? 'gateway' : is(n.el, 'bpmn:Event') ? 'event' : undefined;
    const label = kind ? elementLabel(n, kind) : undefined;
    if (label) out.push(label);
    for (const b of n.boundary) {
      const bl = elementLabel(b, 'boundary');
      if (bl) out.push(bl);
    }
  }
  for (const e of layout.edges) if (e.label) out.push(e.label);
  return out;
}

/**
 * The width a frame around a scope (pool, lane, expanded sub-process) needs
 * for its content and the labels that reach past it (an end event at the
 * right edge has a label wider than the event: labelOutsideFrame otherwise),
 * and `left`, how far labels reach left of the content (a sub-process moves
 * its content right by that much; a pool's lane padding holds it). Only the
 * frames use it; the content is placed with the scope's own size.
 */
export function framedSize(layout: ScopeLayout): { width: number; left: number } {
  const labels = nodeLabels(layout);
  const left = Math.max(0, ...labels.map((l) => -l.x));
  return { width: Math.max(layout.width, ...labels.map((l) => l.x + l.width)) + left, left };
}

/** Extends the content size of a scope so association routes drawn around the content still fit. */
export function growToFit(layout: ScopeLayout): void {
  for (const a of layout.artifacts) {
    for (const link of a.links) {
      for (const p of link.points) {
        layout.width = Math.max(layout.width, p.x);
        layout.height = Math.max(layout.height, p.y);
      }
    }
  }
  for (const c of layout.compensations) {
    for (const p of c.points) {
      layout.width = Math.max(layout.width, p.x);
      layout.height = Math.max(layout.height, p.y);
    }
  }
}

/** Moves the whole content of a scope: nodes, boundary events, event sub-processes, artifacts, edges and labels. */
export function shiftScope(layout: ScopeLayout, dx: number, dy: number): void {
  for (const n of layout.nodes) shiftNode(n, dx, dy);
  for (const es of layout.eventSubs) {
    es.box.x += dx;
    es.box.y += dy;
  }
  // an anchor on a flow is the same object as the link end that uses it: move it once
  const movedEnds = new Set<LinkEnd>();
  const moveEnd = (end: LinkEnd | undefined): void => {
    if (!end?.flow || movedEnds.has(end)) return;
    movedEnds.add(end);
    end.box.x += dx;
    end.box.y += dy;
  };
  for (const a of layout.artifacts) {
    a.box.x += dx;
    a.box.y += dy;
    for (const link of a.links) {
      moveEnd(link.from);
      moveEnd(link.to);
      for (const p of link.points) {
        p.x += dx;
        p.y += dy;
      }
    }
    moveEnd(a.anchor);
  }
  shiftEdges(layout, dx, dy);
  layout.width += dx;
  layout.height += dy;
}

/** Moves every routed sequence flow, its label and the compensation links. */
export function shiftEdges(layout: ScopeLayout, dx: number, dy: number): void {
  for (const e of layout.edges) {
    for (const p of e.points) {
      p.x += dx;
      p.y += dy;
    }
    if (e.label) {
      e.label.x += dx;
      e.label.y += dy;
    }
    if (e.bandY !== undefined) e.bandY += dy;
  }
  for (const c of layout.compensations) {
    for (const p of c.points) {
      p.x += dx;
      p.y += dy;
    }
  }
}

export function shiftNode(n: GNode, dx: number, dy: number): void {
  n.box.x += dx;
  n.box.y += dy;
  for (const b of n.boundary) {
    b.box.x += dx;
    b.box.y += dy;
  }
}
