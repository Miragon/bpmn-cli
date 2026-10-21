/**
 * Invariant tests of the "clean" layout engine (src/layout/*.ts).
 *
 * Every scenario builds a model in memory with the same ops `bpmn apply`
 * runs, lays it out, re-imports the XML and checks the diagram interchange
 * against the quality metrics of the layout checker (the same metrics as
 * tools/layout-regress.mjs):
 *
 *   crossings  proper crossings between any two edges
 *   overlaps   overlapping leaf shapes (a boundary event may overlap its host)
 *   through    edge segments cutting through a shape they do not connect
 *   diagonal   non-orthogonal sequence / message flow segments
 *   missing    semantic elements without DI
 *
 * plus three checks the visual review asked for:
 *
 *   labelClashes   a label box overlapping a leaf shape or another label
 *   labelOnLine    label text (as bpmn-js draws it) crossed by a line
 *   inOutOverlaps  an incoming and an outgoing flow of one node sharing a line
 *
 * and: every coordinate is a finite integer, the XML re-imports without
 * warnings, and the engine reports no warnings. Where the engine's
 * conventions matter (happy path straight, branches below, loops around the
 * nodes, ...) the scenarios add structural assertions.
 *
 * Scenarios that fail because of a known engine defect are `it.todo` with a
 * comment naming the defect; flip them to `it` once the engine is fixed.
 *
 * Set BPMN_LAYOUT_TEST_OUT=<dir> to get every scenario written as <dir>/<name>.bpmn
 * (render with bpmn-to-image to look at them).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withLayoutDebug } from '../src/shared/debug.js';
import { layoutProblems } from '../src/diagram/metrics.js';
import { readPlanes as diagramPlanes, type DShape } from '../src/diagram/plane.js';
import { titleBox } from '../src/diagram/text.js';
import { Doc } from '../src/model/document.js';
import { layoutModel, type LayoutOptions, type LayoutWarningInfo } from '../src/layout/index.js';
import { freeJoinColumns, gridScope, layoutScope, liftChains, placeAttachedArtifacts, shiftNode } from '../src/layout/clean/place.js';
import type { GNode, ScopeLayout } from '../src/diagram/types.js';
import { is, many, type El } from '../src/model/moddle.js';
import { collapsedIds } from '../src/ops/add.js';
import { runOps } from '../src/ops/index.js';
import type { AddOp, Op } from '../src/ops/types.js';
import { layoutDoc, mutateDoc } from '../src/pipeline/index.js';

/* ------------------------------------------------------------------ */
/* DI reading                                                           */
/* ------------------------------------------------------------------ */

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

interface Shape {
  id: string;
  el: El;
  box: Box;
  expanded: boolean;
  /** pool, lane or expanded sub-process: may contain other shapes */
  container: boolean;
  label?: Box;
}

interface Edge {
  id: string;
  el: El;
  points: Point[];
  /** ids of the elements the edge connects (never counted as "through") */
  ends: Set<string>;
  label?: Box;
}

interface Plane {
  /** the element the plane belongs to (process, collaboration or collapsed sub-process) */
  el: El;
  shapes: Shape[];
  edges: Edge[];
}

interface Report {
  planes: number;
  shapes: number;
  edges: number;
  crossings: string[];
  overlaps: string[];
  through: string[];
  diagonal: string[];
  missing: string[];
  nonInteger: string[];
  /** label boxes overlapping a leaf shape or another label */
  labelClashes: string[];
  /** label text crossed by an edge segment (label text approximated as bpmn-js draws it) */
  labelOnLine: string[];
  /** an incoming and an outgoing sequence flow of one node sharing a collinear segment (ambiguous drawing) */
  inOutOverlaps: string[];
}

const idOf = (el: El): string => el.get<string>('id');

function boxOf(bounds: El): Box {
  return { x: bounds.get<number>('x'), y: bounds.get<number>('y'), width: bounds.get<number>('width'), height: bounds.get<number>('height') };
}

function labelOf(di: El): Box | undefined {
  const label = di.get<El | undefined>('label');
  const bounds = label?.get<El | undefined>('bounds');
  return bounds ? boxOf(bounds) : undefined;
}

function isContainer(el: El, expanded: boolean): boolean {
  return (is(el, 'bpmn:SubProcess') && expanded) || is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane');
}

function endsOf(el: El): Set<string> {
  const ends = new Set<string>();
  const add = (ref: unknown): void => {
    if (Array.isArray(ref)) ref.forEach(add);
    else if (ref && typeof ref === 'object' && 'get' in ref) {
      const id = (ref as El).get<string | undefined>('id');
      if (id) ends.add(id);
    }
  };
  add(el.get('sourceRef'));
  add(el.get('targetRef'));
  // data associations live on the node they belong to
  const parent = el.$parent as El | undefined;
  if (parent && is(parent, 'bpmn:FlowNode')) ends.add(idOf(parent));
  return ends;
}

function readPlanes(doc: Doc): Plane[] {
  const planes: Plane[] = [];
  for (const diagram of many(doc.definitions, 'diagrams')) {
    const plane = diagram.get<El | undefined>('plane');
    if (!plane) continue;
    const p: Plane = { el: plane.get<El>('bpmnElement'), shapes: [], edges: [] };
    for (const di of many(plane, 'planeElement')) {
      const el = di.get<El | undefined>('bpmnElement');
      if (!el) continue;
      if (is(di, 'bpmndi:BPMNShape')) {
        const expanded = di.get<boolean | undefined>('isExpanded') === true;
        p.shapes.push({ id: idOf(el), el, box: boxOf(di.get<El>('bounds')), expanded, container: isContainer(el, expanded), label: labelOf(di) });
      } else if (is(di, 'bpmndi:BPMNEdge')) {
        p.edges.push({ id: idOf(el), el, points: many(di, 'waypoint').map((w) => ({ x: w.get<number>('x'), y: w.get<number>('y') })), ends: endsOf(el), label: labelOf(di) });
      }
    }
    planes.push(p);
  }
  return planes;
}

/** Ids of every semantic element that needs a shape or an edge. */
function elementsNeedingDi(doc: Doc): Set<string> {
  const need = new Set<string>();
  const walk = (scope: El): void => {
    for (const fe of many(scope, 'flowElements')) {
      if (is(fe, 'bpmn:FlowNode') || is(fe, 'bpmn:SequenceFlow') || is(fe, 'bpmn:DataObjectReference') || is(fe, 'bpmn:DataStoreReference')) need.add(idOf(fe));
      if (is(fe, 'bpmn:SubProcess')) walk(fe);
    }
    for (const a of many(scope, 'artifacts')) if (is(a, 'bpmn:TextAnnotation') || is(a, 'bpmn:Association')) need.add(idOf(a));
  };
  for (const root of many(doc.definitions, 'rootElements')) {
    if (is(root, 'bpmn:Process')) walk(root);
    if (is(root, 'bpmn:Collaboration')) {
      for (const p of many(root, 'participants')) need.add(idOf(p));
      for (const m of many(root, 'messageFlows')) need.add(idOf(m));
    }
  }
  return need;
}

/* ------------------------------------------------------------------ */
/* geometry                                                             */
/* ------------------------------------------------------------------ */

type Segment = [Point, Point];

function segments(points: Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i]!, points[i + 1]!]);
  return out;
}

function orient(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

/** Proper crossing: shared endpoints and collinear overlaps do not count. */
function properCross([a, b]: Segment, [c, d]: Segment): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

function segmentHitsBox([p, q]: Segment, b: Box, shrink = 2): boolean {
  const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x), y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y);
  return x1 < b.x + b.width - shrink && x2 > b.x + shrink && y1 < b.y + b.height - shrink && y2 > b.y + shrink;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function contains(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

const cx = (b: Box): number => b.x + b.width / 2;
const cy = (b: Box): number => b.y + b.height / 2;
const bottom = (b: Box): number => b.y + b.height;
const right = (b: Box): number => b.x + b.width;

function isFlow(el: El): boolean {
  return is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow');
}

function attachedTo(el: El): string | undefined {
  const host = el.get<El | undefined>('attachedToRef');
  return host ? idOf(host) : undefined;
}

/**
 * Where bpmn-js draws the text of a label: centred on the label box, top
 * aligned, 11px Arial (about 6px per character), wrapped at 90px.
 */
function glyphBox(label: Box, name: string): Box {
  const est = Math.max(6, name.length * 6);
  const width = Math.min(est, 90);
  const lines = Math.max(1, Math.ceil(est / 90));
  return { x: cx(label) - width / 2, y: label.y, width, height: lines * 14 };
}

/** A segment strictly inside a box (touching the border does not count). */
function segmentCutsBox([p, q]: Segment, b: Box): boolean {
  return segmentHitsBox([p, q], b, 0);
}

/** Length of the collinear overlap of two axis-parallel segments (0 when they are not collinear). */
function collinearOverlap([a, b]: Segment, [c, d]: Segment): number {
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  }
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* the checker (the metrics of tools/layout-regress.mjs)              */
/* ------------------------------------------------------------------ */

function checkDi(doc: Doc, planes: Plane[]): Report {
  const report: Report = { planes: planes.length, shapes: 0, edges: 0, crossings: [], overlaps: [], through: [], diagonal: [], missing: [], nonInteger: [], labelClashes: [], labelOnLine: [], inOutOverlaps: [] };
  const seen = new Set<string>();
  const integer = (what: string, ...values: number[]): void => {
    if (!values.every((v) => Number.isInteger(v))) report.nonInteger.push(what);
  };
  for (const plane of planes) {
    report.shapes += plane.shapes.length;
    report.edges += plane.edges.length;
    for (const s of plane.shapes) {
      seen.add(s.id);
      integer(s.id, s.box.x, s.box.y, s.box.width, s.box.height);
      if (s.label) integer(`${s.id}#label`, s.label.x, s.label.y, s.label.width, s.label.height);
    }
    for (const e of plane.edges) {
      seen.add(e.id);
      for (const p of e.points) integer(e.id, p.x, p.y);
      if (e.label) integer(`${e.id}#label`, e.label.x, e.label.y, e.label.width, e.label.height);
    }
    const leaf = plane.shapes.filter((s) => !s.container);
    for (let i = 0; i < leaf.length; i++) {
      for (let j = i + 1; j < leaf.length; j++) {
        const a = leaf[i]!, b = leaf[j]!;
        const boundaryPair = (is(a.el, 'bpmn:BoundaryEvent') && attachedTo(a.el) === b.id) || (is(b.el, 'bpmn:BoundaryEvent') && attachedTo(b.el) === a.id);
        if (!boundaryPair && boxesOverlap(a.box, b.box)) report.overlaps.push(`${a.id}~${b.id}`);
      }
    }
    for (const e of plane.edges) {
      for (const seg of segments(e.points)) {
        if (isFlow(e.el) && seg[0].x !== seg[1].x && seg[0].y !== seg[1].y) report.diagonal.push(e.id);
        for (const s of leaf) {
          if (e.ends.has(s.id)) continue;
          if (is(s.el, 'bpmn:BoundaryEvent') && e.ends.has(attachedTo(s.el) ?? '')) continue;
          if (segmentHitsBox(seg, s.box)) report.through.push(`${e.id}->${s.id}`);
        }
      }
    }
    for (let i = 0; i < plane.edges.length; i++) {
      for (let j = i + 1; j < plane.edges.length; j++) {
        const a = plane.edges[i]!, b = plane.edges[j]!;
        if (segments(a.points).some((s1) => segments(b.points).some((s2) => properCross(s1, s2)))) report.crossings.push(`${a.id}x${b.id}`);
      }
    }
    // labels: against leaf shapes, other labels and edge segments
    const labels: Array<{ owner: string; box: Box; text: Box }> = [];
    for (const s of plane.shapes) if (s.label) labels.push({ owner: s.id, box: s.label, text: glyphBox(s.label, s.el.get<string | undefined>('name') ?? '') });
    for (const e of plane.edges) if (e.label) labels.push({ owner: e.id, box: e.label, text: glyphBox(e.label, e.el.get<string | undefined>('name') ?? '') });
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i]!;
      for (const s of leaf) if (s.id !== l.owner && boxesOverlap(l.box, s.box)) report.labelClashes.push(`${l.owner}#label~${s.id}`);
      for (let j = i + 1; j < labels.length; j++) if (boxesOverlap(l.box, labels[j]!.box)) report.labelClashes.push(`${l.owner}#label~${labels[j]!.owner}#label`);
      for (const e of plane.edges) if (segments(e.points).some((seg) => segmentCutsBox(seg, l.text))) report.labelOnLine.push(`${l.owner}#label~${e.id}`);
    }
    // an incoming and an outgoing flow of one node must not share a line
    const flows = plane.edges.filter((e) => is(e.el, 'bpmn:SequenceFlow'));
    for (const s of plane.shapes) {
      const into = flows.filter((e) => idOf(e.el.get<El>('targetRef')) === s.id);
      const outOf = flows.filter((e) => idOf(e.el.get<El>('sourceRef')) === s.id);
      for (const i of into) {
        for (const o of outOf) {
          if (i === o) continue;
          if (segments(i.points).some((s1) => segments(o.points).some((s2) => collinearOverlap(s1, s2) > 0))) report.inOutOverlaps.push(`${i.id}|${o.id}@${s.id}`);
        }
      }
    }
  }
  for (const id of elementsNeedingDi(doc)) if (!seen.has(id)) report.missing.push(id);
  const uniq = (list: string[]): string[] => [...new Set(list)];
  for (const key of ['crossings', 'overlaps', 'through', 'diagonal', 'nonInteger', 'labelClashes', 'labelOnLine', 'inOutOverlaps'] as const) report[key] = uniq(report[key]);
  return report;
}

/* ------------------------------------------------------------------ */
/* harness                                                              */
/* ------------------------------------------------------------------ */

interface Laid {
  xml: string;
  warnings: LayoutWarningInfo[];
  /** the laid-out XML re-imported */
  out: Doc;
  planes: Plane[];
  report: Report;
  /** shape bounds by element id (first plane that has it) */
  box: (id: string) => Box;
  /** waypoints by element id */
  points: (id: string) => Point[];
  shape: (id: string) => Shape;
  edge: (id: string) => Edge;
}

const OUT_DIR = process.env['BPMN_LAYOUT_TEST_OUT'];

async function layout(name: string, doc: Doc, opts: LayoutOptions = {}): Promise<Laid> {
  const { xml, warnings } = await layoutModel(doc.model, opts);
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${name}.bpmn`), xml);
  }
  const out = await Doc.fromXml(xml);
  const planes = readPlanes(out);
  const report = checkDi(out, planes);
  const shape = (id: string): Shape => {
    for (const p of planes) {
      const s = p.shapes.find((x) => x.id === id);
      if (s) return s;
    }
    throw new Error(`no shape for ${id}`);
  };
  const edge = (id: string): Edge => {
    for (const p of planes) {
      const e = p.edges.find((x) => x.id === id);
      if (e) return e;
    }
    throw new Error(`no edge for ${id}`);
  };
  return { xml, warnings, out, planes, report, shape, edge, box: (id) => shape(id).box, points: (id) => edge(id).points };
}

/** The invariants every scenario must satisfy. */
function expectClean(L: Laid): void {
  expect(L.out.importWarnings).toEqual([]);
  expect(L.warnings).toEqual([]);
  expect(L.report.missing).toEqual([]);
  expect(L.report.nonInteger).toEqual([]);
  expect(L.report.overlaps).toEqual([]);
  expect(L.report.through).toEqual([]);
  expect(L.report.diagonal).toEqual([]);
  expect(L.report.crossings).toEqual([]);
  expect(L.report.labelClashes).toEqual([]);
  expect(L.report.inOutOverlaps).toEqual([]);
  for (const p of L.planes) for (const e of p.edges) expect(e.points.length, `${e.id} has waypoints`).toBeGreaterThanOrEqual(2);
}

/** No label text is crossed by a line. */
function expectLabelsClear(L: Laid): void {
  expect(L.report.labelOnLine).toEqual([]);
}

/**
 * The listed nodes form a straight line: same centre y (an odd-height container
 * may sit half a pixel off), each right of the previous one, and every flow
 * between neighbours is one horizontal segment.
 */
function expectStraightLine(L: Laid, ids: string[]): void {
  const ys = ids.map((id) => cy(L.box(id)));
  expect(Math.max(...ys) - Math.min(...ys), `centre y of ${ids.join(' -> ')}: ${ys.join(', ')}`).toBeLessThanOrEqual(0.5);
  for (let i = 0; i + 1 < ids.length; i++) {
    const a = ids[i]!, b = ids[i + 1]!;
    expect(L.box(b).x, `${b} right of ${a}`).toBeGreaterThan(right(L.box(a)));
    const flow = L.out.outgoing(L.out.require(a)).find((f) => idOf(f.get<El>('targetRef')) === b);
    if (!flow) continue;
    const pts = L.edge(idOf(flow)).points;
    expect(pts, `${idOf(flow)} (${a} -> ${b}) is one horizontal segment`).toHaveLength(2);
    expect(pts[0]!.y).toBe(pts[1]!.y);
    expect(pts[0]!.x).toBe(right(L.box(a)));
    expect(pts[1]!.x).toBe(L.box(b).x);
  }
}

/** The single longest horizontal segment of a polyline (its y), undefined when there is none. */
function longestHorizontalY(points: Point[]): number | undefined {
  let best: Segment | undefined;
  for (const s of segments(points)) {
    if (s[0].y !== s[1].y) continue;
    if (!best || Math.abs(s[1].x - s[0].x) > Math.abs(best[1].x - best[0].x)) best = s;
  }
  return best?.[0].y;
}

/** The sequence flow between two nodes (by ids) in the laid-out document. */
function flowBetween(L: Laid, source: string, target: string): Edge {
  const flow = L.out.outgoing(L.out.require(source)).find((f) => idOf(f.get<El>('targetRef')) === target);
  if (!flow) throw new Error(`no flow ${source} -> ${target}`);
  return L.edge(idOf(flow));
}

/** A loop (or any edge) goes around the nodes it spans: its horizontal run is below or above every one of them and it ends on the target's border. */
function expectRoutedAround(L: Laid, edge: Edge, spanned: string[], targetId: string): void {
  const y = longestHorizontalY(edge.points);
  expect(y, `${edge.id} has a horizontal run`).toBeDefined();
  const boxes = spanned.map((id) => L.box(id));
  const below = boxes.every((b) => y! >= bottom(b));
  const above = boxes.every((b) => y! <= b.y);
  expect(below || above, `${edge.id} runs at y=${y} around ${spanned.join(', ')}`).toBe(true);
  const last = edge.points[edge.points.length - 1]!;
  const t = L.box(targetId);
  expect([t.y, bottom(t)], `${edge.id} enters ${targetId} from above or below`).toContain(last.y);
  expect(last.x).toBeGreaterThan(t.x);
  expect(last.x).toBeLessThan(right(t));
}

function proc(ops: Op[], processId = 'P'): Doc {
  const doc = Doc.create({ processId });
  runOps(doc, ops);
  return doc;
}

const start = (id: string, name?: string, extra: Partial<AddOp> = {}): AddOp => ({ op: 'add', kind: 'startEvent', id, ...(name ? { name } : {}), ...extra });
const end = (id: string, after: string, name?: string, extra: Partial<AddOp> = {}): AddOp => ({ op: 'add', kind: 'endEvent', id, after, ...(name ? { name } : {}), ...extra });
const task = (id: string, name: string, after: string, extra: Partial<AddOp> = {}): AddOp => ({ op: 'add', kind: 'task', id, name, after, ...extra });

/* ------------------------------------------------------------------ */
/* scenarios                                                            */
/* ------------------------------------------------------------------ */

describe('clean layout engine', () => {
  it('linear: start -> 3 tasks -> end on one straight line', async () => {
    const doc = proc([
      start('S', 'Order received'),
      task('A', 'Check order', 'S'),
      { op: 'add', kind: 'userTask', id: 'B', name: 'Approve order', after: 'A' },
      { op: 'add', kind: 'serviceTask', id: 'C', name: 'Book order', after: 'B' },
      end('E', 'C', 'Done'),
    ]);
    const L = await layout('linear', doc);
    expectClean(L);
    expectLabelsClear(L);
    expect(L.report).toMatchObject({ planes: 1, shapes: 5, edges: 4 });
    expectStraightLine(L, ['S', 'A', 'B', 'C', 'E']);
    for (const p of L.planes) for (const e of p.edges) expect(e.points, `${e.id} is one straight segment`).toHaveLength(2);
    // event labels below, and every element sits inside the plane at positive coordinates
    expect(L.shape('S').label!.y).toBeGreaterThan(bottom(L.box('S')));
    for (const s of L.planes[0]!.shapes) expect(Math.min(s.box.x, s.box.y)).toBeGreaterThan(0);
  });

  it('xor split / join with 3 branches: first branch is the spine, the others are bands below in order', async () => {
    const doc = proc([
      start('S'),
      task('A', 'Check invoice', 'S'),
      end('E', 'A'),
      {
        op: 'split',
        after: 'A',
        id: 'G',
        name: 'Result?',
        joinId: 'GJ',
        branches: [
          { flowName: 'ok', nodes: [{ kind: 'task', id: 'T1', name: 'Pay' }] },
          { flowName: 'unclear', nodes: [{ kind: 'userTask', id: 'T2a', name: 'Clarify' }, { kind: 'task', id: 'T2b', name: 'Correct' }] },
          { flowName: 'reject', default: true, nodes: [{ kind: 'task', id: 'T3', name: 'Reject' }] },
        ],
      },
    ]);
    const L = await layout('xor-3', doc);
    expectClean(L);
    expectLabelsClear(L);
    expectStraightLine(L, ['S', 'A', 'G', 'T1', 'GJ', 'E']);
    expectStraightLine(L, ['T2a', 'T2b']);
    expect(cy(L.box('T2a'))).toBeGreaterThan(bottom(L.box('T1')));
    expect(cy(L.box('T3'))).toBeGreaterThan(bottom(L.box('T2a')));
    // bands start right of the split and drop straight down from it
    for (const id of ['T2a', 'T3']) {
      const drop = flowBetween(L, 'G', id);
      expect(drop.points[0]).toEqual({ x: cx(L.box('G')), y: bottom(L.box('G')) });
      expect(L.box(id).x).toBeGreaterThan(right(L.box('G')));
    }
    // joins are entered from below
    for (const id of ['T2b', 'T3']) {
      const into = flowBetween(L, id, 'GJ');
      expect(into.points[into.points.length - 1]).toEqual({ x: cx(L.box('GJ')), y: bottom(L.box('GJ')) });
    }
    // gateway label above, flow labels above their first horizontal segment
    expect(bottom(L.shape('G').label!)).toBeLessThanOrEqual(L.box('G').y);
    const ok = flowBetween(L, 'G', 'T1');
    expect(ok.label).toBeDefined();
    expect(bottom(ok.label!)).toBeLessThanOrEqual(ok.points[0]!.y);
  });

  it('parallel split / join with 3 branches', async () => {
    const doc = proc([
      start('S'),
      task('A', 'Receive order', 'S'),
      end('E', 'A'),
      {
        op: 'split',
        after: 'A',
        kind: 'parallelGateway',
        id: 'G',
        joinId: 'GJ',
        branches: [
          { nodes: [{ kind: 'task', id: 'T1', name: 'Pack' }, { kind: 'task', id: 'T1b', name: 'Label' }] },
          { nodes: [{ kind: 'task', id: 'T2', name: 'Invoice' }] },
          { nodes: [{ kind: 'task', id: 'T3', name: 'Notify' }] },
        ],
      },
    ]);
    const L = await layout('parallel-3', doc);
    expectClean(L);
    expectLabelsClear(L);
    expectStraightLine(L, ['S', 'A', 'G', 'T1', 'T1b', 'GJ', 'E']);
    expect(cy(L.box('T2'))).toBeGreaterThan(bottom(L.box('T1')));
    expect(cy(L.box('T3'))).toBeGreaterThan(bottom(L.box('T2')));
    expect(L.box('T2').x).toBe(L.box('T1').x);
    expect(L.box('T3').x).toBe(L.box('T1').x);
  });

  it('loop back to an earlier task runs around the spine and enters the target from below', async () => {
    const doc = proc([
      start('S'),
      task('A', 'Prepare', 'S'),
      task('B', 'Execute', 'A'),
      { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'Worked?', after: 'B' },
      task('C', 'Finish', 'G', { flowName: 'yes' }),
      end('E', 'C'),
      { op: 'connect', source: 'G', target: 'A', name: 'retry' },
    ]);
    const L = await layout('loop-back', doc);
    expectClean(L);
    expectLabelsClear(L);
    expectStraightLine(L, ['S', 'A', 'B', 'G', 'C', 'E']);
    const loop = flowBetween(L, 'G', 'A');
    expect(loop.points.length).toBeGreaterThanOrEqual(4);
    expectRoutedAround(L, loop, ['A', 'B', 'G'], 'A');
    expect(loop.label).toBeDefined();
  });

  it('loops into a join share its bottom vertex with its other entries: a second loop into a merge, a loop into a split\'s join', async () => {
    // Fix and Ask both loop back into the merge M; the second one does not take M's left vertex
    const merge = await layout(
      'two-loops-merge',
      proc([
        start('S'),
        { op: 'add', kind: 'exclusiveGateway', id: 'M', after: 'S' },
        task('A', 'Check', 'M'),
        { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'Ok?', after: 'A' },
        task('B', 'Book', 'G', { flowName: 'yes' }),
        end('E', 'B'),
        task('F', 'Fix', 'G', { flowName: 'no', to: 'M' }),
        task('Q', 'Ask', 'G', { flowName: 'unclear', to: 'M' }),
      ]),
    );
    expectClean(merge);
    const m = merge.box('M');
    for (const id of ['F', 'Q']) expect(flowBetween(merge, id, 'M').points.at(-1), id).toEqual({ x: cx(m), y: bottom(m) });
    // Fix loops back into the join GJ, which T2 enters from below: it rises there too, not over the top
    const join = await layout(
      'loop-into-join',
      proc([
        start('S'),
        task('A', 'Check', 'S'),
        end('E', 'A'),
        { op: 'split', after: 'A', id: 'G', name: 'Route?', joinId: 'GJ', branches: [{ flowName: 'a', nodes: [{ kind: 'task', id: 'T1', name: 'One' }] }, { flowName: 'b', nodes: [{ kind: 'task', id: 'T2', name: 'Two' }] }] },
        { op: 'add', kind: 'task', id: 'V', name: 'Verify', before: 'E' },
        { op: 'add', kind: 'exclusiveGateway', id: 'K', name: 'Ok?', before: 'E' },
        task('F', 'Fix', 'K', { flowName: 'no', to: 'GJ' }),
      ]),
    );
    expectClean(join);
    const gj = join.box('GJ');
    for (const id of ['T2', 'F']) expect(flowBetween(join, id, 'GJ').points.at(-1), id).toEqual({ x: cx(gj), y: bottom(gj) });
  });

  it('a loop from a gateway into a join leaves through a vertex of the diamond, not beside it, to share the join\'s bottom vertex', async () => {
    // rework goes back into the merge J, whose bottom vertex the standard branch rises into; Approved?'s bottom vertex carries "no"
    const L = await layout(
      'rework-into-merge',
      proc([
        start('S', 'Order received'),
        { op: 'split', after: 'S', id: 'Sp', name: 'Express?', joinId: 'J', branches: [{ flowName: 'yes', nodes: [{ kind: 'task', id: 'A', name: 'Prepare express' }] }, { flowName: 'no', nodes: [{ kind: 'task', id: 'B', name: 'Prepare standard' }] }] },
        task('R', 'Review order', 'J'),
        { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'Approved?', after: 'R' },
        task('Ship', 'Ship order', 'G', { flowName: 'yes' }),
        end('E1', 'Ship', 'Shipped'),
        task('Rej', 'Notify rejection', 'G', { flowName: 'no' }),
        end('E2', 'Rej', 'Rejected'),
        { op: 'connect', source: 'G', target: 'J', name: 'rework' },
      ]),
    );
    expectClean(L);
    const g = L.box('G');
    const vertices = [`${cx(g)},${g.y}`, `${cx(g)},${bottom(g)}`, `${g.x},${g.y + g.height / 2}`, `${right(g)},${g.y + g.height / 2}`];
    const first = flowBetween(L, 'G', 'J').points[0]!;
    expect(vertices).toContain(`${first.x},${first.y}`);
  });

  it('the label of a gateway a loop leaves through the top stays clear of the loop as bpmn-js draws it (on one line, wider than its box)', async () => {
    // s20: "yes, another claim" rises from the top vertex of "Another claim?", whose name bpmn-js draws on one line
    const doc = await Doc.fromXml(readFileSync(join(import.meta.dirname, '..', 'tools', 'scenarios', 'controlflow__s20.bpmn'), 'utf8'));
    const L = await layout('top-loop-label', doc);
    const g = L.box('Gateway_Another');
    expect(flowBetween(L, 'Gateway_Another', 'Activity_Claim').points[0]).toEqual({ x: cx(g), y: g.y });
    expect(layoutProblems(L.out.definitions).problems.filter((p) => p.kind === 'labelOnLine' && p.ids[0] === 'Gateway_Another')).toEqual([]);
  });

  it('lanes: a join whose entries rise into its bottom vertex leaves for a target below through its right vertex; a split with one entry keeps its drops', async () => {
    // the branches and the join's successor lie in the lane below split and join: Ship would leave J down the line Pack and Label rise on
    for (const kind of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway'] as const) {
      const named = kind !== 'parallelGateway';
      const L = await layout(
        `lanes-join-exit-${kind}`,
        proc([
          start('S', 'Order received'),
          task('A', 'Check order', 'S'),
          { op: 'split', after: 'A', kind, id: 'G', joinId: 'J', ...(named ? { name: 'Extras?' } : {}), branches: [{ ...(named ? { flowName: 'pack' } : {}), nodes: [{ kind: 'task', id: 'B1', name: 'Pack' }] }, { ...(named ? { flowName: 'label' } : {}), nodes: [{ kind: 'task', id: 'B2', name: 'Label' }] }] },
          task('T', 'Ship', 'J'),
          end('E', 'T', 'Shipped'),
          { op: 'add', kind: 'participant', id: 'Org', name: 'Shop' },
          { op: 'add', kind: 'lane', id: 'L1', name: 'Service', in: 'P', members: ['S', 'A', 'G', 'J', 'E'] },
          { op: 'add', kind: 'lane', id: 'L2', name: 'Warehouse', in: 'P', members: ['B1', 'B2', 'T'] },
        ]),
      );
      expectClean(L);
      const g = L.box('G'), j = L.box('J'), t = L.box('T');
      for (const id of ['B1', 'B2']) {
        expect(flowBetween(L, 'G', id).points[0], `${kind}: G -> ${id}`).toEqual({ x: cx(g), y: bottom(g) });
        expect(flowBetween(L, id, 'J').points.at(-1), `${kind}: ${id} -> J`).toEqual({ x: cx(j), y: bottom(j) });
      }
      const out = flowBetween(L, 'J', 'T').points;
      expect(out, kind).toEqual([{ x: right(j), y: cy(j) }, { x: right(j) + 15, y: cy(j) }, { x: right(j) + 15, y: cy(t) }, { x: t.x, y: cy(t) }]);
    }
    // o2c: the join's entries from Finance and Warehouse, and the fork's entry from Finance (it merges "ok" too): both leave for the lanes below through the right vertex
    const doc = await Doc.fromXml(readFileSync(join(import.meta.dirname, '..', 'tools', 'scenarios', 'agent__o2c.bpmn'), 'utf8'));
    const o2c = await layout('o2c-join-exits', doc);
    expect(layoutProblems(o2c.out.definitions).problems.filter((p) => p.kind === 'inOut')).toEqual([]);
    const fork = o2c.box('Gateway_Fork'), join2 = o2c.box('Gateway_Join');
    for (const target of ['Activity_CreateInvoice', 'Activity_PickAndPack']) expect(flowBetween(o2c, 'Gateway_Fork', target).points[0], target).toEqual({ x: right(fork), y: cy(fork) });
    expect(flowBetween(o2c, 'Gateway_Join', 'Activity_ShipGoods').points[0]).toEqual({ x: right(join2), y: cy(join2) });
  });

  it('a loop into a gateway keeps off the top vertex a branch leaves through, as off a bottom vertex with a drop', async () => {
    // "other" leaves Which? up through its top (Step A blocks the way right), "rare" drops from its bottom: the loop "no" must not run down onto "other"
    const L = await layout(
      'loop-off-top-exit',
      proc([
        start('S', 'Start'),
        task('Pr', 'Prepare', 'S'),
        { op: 'split', after: 'Pr', id: 'G', name: 'Which?', joinId: 'J', branches: [{ flowName: 'usual', nodes: [{ kind: 'task', id: 'A', name: 'Step A' }] }, { flowName: 'rare', nodes: [{ kind: 'task', id: 'D', name: 'Step D' }] }, { flowName: 'other', nodes: [{ kind: 'task', id: 'B', name: 'Step B' }] }] },
        { op: 'add', kind: 'exclusiveGateway', id: 'C', name: 'Done?', after: 'J' },
        end('E', 'C', 'End', { flowName: 'yes' }),
        { op: 'connect', source: 'C', target: 'G', name: 'no' },
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: ['S', 'Pr', 'B', 'C', 'E'] },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: ['G', 'A', 'J'] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Lane 2', in: 'P', members: ['D'] },
      ]),
    );
    const g = L.box('G');
    expect(flowBetween(L, 'G', 'B').points[0]).toEqual({ x: cx(g), y: g.y });
    expect(flowBetween(L, 'C', 'G').points.at(-1)).not.toEqual({ x: cx(g), y: g.y });
    expect(L.report.inOutOverlaps).toEqual([]);
  });

  /** Order received -> Extras booked? (gift, express, an empty default branch "none") -> join -> Hand over parcel -> Done. */
  function emptyBranchDoc(lanes: Record<string, readonly string[]> | undefined, empty = true): Doc {
    const branches = [{ flowName: 'gift', nodes: [{ kind: 'task' as const, id: 'X', name: 'Wrap gift' }] }, { flowName: 'express', nodes: [{ kind: 'task' as const, id: 'Y', name: 'Book express' }] }, ...(empty ? [{ flowName: 'none', default: true, nodes: [] }] : [])];
    return proc([
      start('S', 'Order received'),
      { op: 'split', after: 'S', kind: 'inclusiveGateway', id: 'G', name: 'Extras booked?', joinId: 'J', branches },
      task('T', 'Hand over parcel', 'J'),
      end('E', 'T', 'Done'),
      ...(lanes ? [{ op: 'add', kind: 'participant', id: 'Org', name: 'Shop' } as Op, ...Object.entries(lanes).map(([id, members]) => ({ op: 'add', kind: 'lane', id, name: id, in: 'P', members: [...members] }) as Op)] : []),
    ]);
  }

  it('lanes: an empty branch whose row between split and join is free runs straight from the split into the join, and its band leaves no strip', async () => {
    // gift and express run in the lane below, so the split's row up to the join is empty
    const lanes = { Service: ['S', 'G', 'J', 'E'], Warehouse: ['X', 'Y', 'T'] } as const;
    const L = await layout('lanes-empty-branch-straight', emptyBranchDoc(lanes));
    expectClean(L);
    expectLabelsClear(L);
    const g = L.box('G'), j = L.box('J');
    expect(flowBetween(L, 'G', 'J').points).toEqual([{ x: right(g), y: cy(g) }, { x: j.x, y: cy(j) }]);
    const without = await layout('lanes-no-empty-branch', emptyBranchDoc(lanes, false));
    for (const id of ['Service', 'Warehouse']) expect(L.box(id), id).toEqual(without.box(id));
    // without lanes the branches lie on that row: the empty branch keeps its band below them
    const plain = await layout('empty-branch-band', emptyBranchDoc(undefined));
    expectClean(plain);
    expect(longestHorizontalY(flowBetween(plain, 'G', 'J').points)).toBeGreaterThan(bottom(plain.box('X')));
    // the join's left vertex takes express from the lane above: no straight line onto it
    const taken = await layout('lanes-empty-branch-left-taken', emptyBranchDoc({ Office: ['Y'], Service: ['S', 'G', 'J', 'E'], Warehouse: ['X', 'T'] }));
    expect(flowBetween(taken, 'Y', 'J').points.at(-1)).toEqual({ x: taken.box('J').x, y: cy(taken.box('J')) });
    expect(flowBetween(taken, 'G', 'J').points.length).toBeGreaterThan(2);
  });

  /** The flows from `sources` into `joinId` run along their row and rise straight into its bottom vertex, the join right above them. */
  function expectStraightRises(L: Laid, joinId: string, sources: string[], what: string): void {
    const j = L.box(joinId);
    for (const id of sources) {
      const s = L.box(id);
      expect(flowBetween(L, id, joinId).points, `${what}: ${id} -> ${joinId}`).toEqual([{ x: right(s), y: cy(s) }, { x: cx(j), y: cy(s) }, { x: cx(j), y: bottom(j) }]);
    }
  }

  /**
   * controlflow__s26 in small: Channel? (online: Auto process; manual: Handle manually, Confirm) -> join -> Finish, two
   * boundary paths on Handle manually: Reminder -> Send reminder -> Reminded ends in the join's column, in the row
   * between the join and Fallback, which Failed leads into the join. `lanes`: Fallback in a lane of its own below.
   */
  function boundaryEndDoc(kind: 'exclusiveGateway' | 'parallelGateway' | 'inclusiveGateway', lanes: boolean): Doc {
    const named = kind !== 'parallelGateway';
    return proc([
      start('S', 'Start'),
      task('R', 'Receive', 'S'),
      { op: 'split', after: 'R', kind, id: 'G', joinId: 'J', ...(named ? { name: 'Channel?' } : {}), branches: [{ ...(named ? { flowName: 'online' } : {}), nodes: [{ kind: 'task', id: 'Au', name: 'Auto process' }] }, { ...(named ? { flowName: 'manual' } : {}), nodes: [{ kind: 'userTask', id: 'H', name: 'Handle manually' }, { kind: 'task', id: 'C', name: 'Confirm' }] }] },
      task('F', 'Finish', 'J'),
      end('E', 'F', 'End'),
      { op: 'add', kind: 'boundaryEvent:timer', id: 'BR', name: 'Reminder', on: 'H', timer: 'PT1H', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', id: 'SR', name: 'Send reminder', after: 'BR' },
      end('ER', 'SR', 'Reminded'),
      { op: 'add', kind: 'boundaryEvent:error', id: 'BF', name: 'Failed', on: 'H' },
      task('FB', 'Fallback', 'BF'),
      { op: 'connect', source: 'FB', target: 'J' },
      ...(lanes
        ? ([
            { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
            { op: 'add', kind: 'lane', id: 'L1', name: 'Office', in: 'P', members: ['S', 'R', 'G', 'Au', 'H', 'C', 'SR', 'ER', 'J', 'F', 'E'] },
            { op: 'add', kind: 'lane', id: 'L2', name: 'Support', in: 'P', members: ['FB'] },
          ] as Op[])
        : []),
    ]);
  }

  it('the entries of a join from below rise straight into its bottom vertex: a boundary path ending in the join\'s column moves the join one column right (without and with lanes)', async () => {
    for (const kind of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway'] as const) {
      for (const lanes of [false, true]) {
        const what = `${kind}${lanes ? ', lanes' : ''}`;
        const L = await layout(`join-column-free-${kind}${lanes ? '-lanes' : ''}`, boundaryEndDoc(kind, lanes));
        expectClean(L);
        expectLabelsClear(L);
        expectStraightRises(L, 'J', ['C', 'FB'], what);
        // Reminded keeps its place right after Send reminder, in its row; the join moved past it, the happy path stays straight
        const er = L.box('ER'), sr = L.box('SR');
        expect(cy(er), what).toBe(cy(sr));
        expect(flowBetween(L, 'SR', 'ER').points, what).toEqual([{ x: right(sr), y: cy(sr) }, { x: er.x, y: cy(sr) }]);
        expect(right(er), what).toBeLessThan(L.box('J').x);
        expectStraightLine(L, ['S', 'R', 'G', 'Au', 'J', 'F', 'E']);
      }
    }
  });

  it('lanes: the order model in small: the entries from the lanes below rise straight into the join, which moves past the end of the boundary path in its lane', async () => {
    // Pick has a timer path Late -> Inform -> Informed in the join's lane; Informed would sit in the join's column, under it
    for (const kind of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway'] as const) {
      const L = await layout(
        `lanes-join-column-free-${kind}`,
        proc([
          start('S', 'Order received'),
          task('A', 'Check order', 'S'),
          { op: 'split', after: 'A', kind, id: 'G', joinId: 'GJ', branches: [{ nodes: [{ kind: 'task', id: 'T1', name: 'Pick' }, { kind: 'task', id: 'T1b', name: 'Pack' }] }, { nodes: [{ kind: 'task', id: 'T2', name: 'Invoice' }] }, { nodes: [{ kind: 'task', id: 'T3', name: 'Label' }] }] },
          end('E', 'GJ', 'Shipped'),
          { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name: 'Late', on: 'T1', timer: 'P2D', nonInterrupting: true },
          { op: 'add', kind: 'sendTask', id: 'TL', name: 'Inform', after: 'BT' },
          end('EL', 'TL', 'Informed'),
          { op: 'add', kind: 'participant', id: 'Org', name: 'Shop' },
          { op: 'add', kind: 'lane', id: 'L1', name: 'Service', in: 'P', members: ['S', 'A', 'E', 'G', 'GJ', 'TL', 'EL'] },
          { op: 'add', kind: 'lane', id: 'L2', name: 'Store', in: 'P', members: ['T1', 'T1b', 'T3'] },
          { op: 'add', kind: 'lane', id: 'L3', name: 'Accounting', in: 'P', members: ['T2'] },
        ]),
      );
      expect(L.report.through, kind).toEqual([]);
      expect(L.report.overlaps, kind).toEqual([]);
      expectStraightRises(L, 'GJ', ['T1b', 'T2', 'T3'], kind);
      expect(right(L.box('EL')), kind).toBeLessThan(L.box('GJ').x);
      expectStraightLine(L, ['S', 'A', 'G', 'GJ', 'E']);
      // only the timer path's way up to Inform crosses a line (Pack's into the join), as before
      expect(L.report.crossings.length, kind).toBeLessThanOrEqual(1);
    }
  });

  it('a join moves as far right as the boundary path in its column goes on (two columns: Print goods, then Stopped)', async () => {
    const L = await layout(
      'join-column-free-two',
      proc([
        start('S', 'Start'),
        task('A', 'Print data', 'S'),
        { op: 'split', after: 'A', kind: 'inclusiveGateway', id: 'G', name: 'Which way?', joinId: 'J', branches: [{ flowName: 'goods', nodes: [{ kind: 'task', id: 'T0', name: 'Check goods' }, { kind: 'task', id: 'T1', name: 'Call data' }, { kind: 'task', id: 'T2', name: 'Approve order' }] }, { flowName: 'claim', nodes: [{ kind: 'task', id: 'U0', name: 'Pack goods' }, { kind: 'task', id: 'U1', name: 'Review claim' }] }] },
        task('B', 'Book claim', 'J'),
        end('E', 'B', 'Done'),
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name: 'Late', on: 'T1', timer: 'P2D', nonInterrupting: true },
        task('P1', 'Print case', 'BT'),
        task('P2', 'Print goods', 'P1'),
        end('X', 'P2', 'Stopped'),
      ]),
    );
    expectClean(L);
    expectLabelsClear(L);
    expectStraightRises(L, 'J', ['U1'], 'two columns');
    expect(right(L.box('X'))).toBeLessThan(L.box('J').x);
    expectStraightLine(L, ['S', 'A', 'G', 'T0', 'T1', 'T2', 'J', 'B', 'E']);
  });

  it('a label in the join\'s column moves the join too: the entries keep off it, the label stays under its event', async () => {
    // the end of the reminder path sits left of the join's column, its one-word name reaches across it
    const L = await layout(
      'join-column-label',
      proc([
        start('S', 'Start'),
        task('R', 'Receive', 'S'),
        { op: 'split', after: 'R', id: 'G', name: 'Channel?', joinId: 'J', branches: [{ flowName: 'online', nodes: [{ kind: 'task', id: 'Au', name: 'Auto process' }] }, { flowName: 'manual', nodes: [{ kind: 'userTask', id: 'H', name: 'Handle manually' }, { kind: 'task', id: 'C', name: 'Confirm' }] }] },
        task('F', 'Finish', 'J'),
        end('E', 'F', 'End'),
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BR', name: 'Reminder', on: 'H', timer: 'PT1H', nonInterrupting: true },
        end('ER', 'BR', 'Kundenbenachrichtigungsversandbestaetigung'),
        { op: 'add', kind: 'boundaryEvent:error', id: 'BF', name: 'Failed', on: 'H' },
        task('FB', 'Fallback', 'BF'),
        { op: 'connect', source: 'FB', target: 'J' },
      ]),
    );
    expectClean(L);
    expectLabelsClear(L);
    expectStraightRises(L, 'J', ['C', 'FB'], 'label');
    const label = L.shape('ER').label!;
    expect(cx(label)).toBe(cx(L.box('ER')));
    expect(label.y).toBeGreaterThan(bottom(L.box('ER')));
    expect(right(label)).toBeLessThan(cx(L.box('J')));
  });

  it('a join stays where moving it right would add a crossing (Review case\'s run would cross the way up into Fine?, its route over the top does not)', async () => {
    const L = await layout(
      'join-stays-crossing',
      proc([
        start('S', 'Start'),
        task('A', 'Ship data', 'S'),
        { op: 'split', after: 'A', id: 'G', name: 'Which way?', joinId: 'J', branches: [{ flowName: 'b0', nodes: [{ kind: 'task', id: 'T0', name: 'Book claim' }, { kind: 'task', id: 'T1', name: 'Ship case' }] }, { flowName: 'b1', nodes: [{ kind: 'task', id: 'R', name: 'Review case' }] }] },
        task('T', 'Notify order', 'J'),
        { op: 'split', after: 'T', kind: 'parallelGateway', id: 'G2', joinId: 'J2', branches: [{ nodes: [{ kind: 'task', id: 'U0', name: 'Ship goods' }] }, { nodes: [{ kind: 'task', id: 'U1', name: 'Approve order' }, { kind: 'task', id: 'U2', name: 'Inform goods' }] }] },
        end('E', 'J2', 'Done'),
        { op: 'add', kind: 'exclusiveGateway', id: 'D', name: 'Fine?', after: 'T1' },
        end('DX', 'D', 'Dropped', { flowName: 'no' }),
        { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: ['A', 'J', 'J2', 'U0', 'U2'] },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: ['S', 'R', 'T', 'U1', 'E', 'D', 'DX'] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Lane 2', in: 'P', members: ['G', 'T0', 'T1', 'G2'] },
      ]),
    );
    expect(cx(L.box('J'))).toBe(cx(L.box('DX')));
    expect(flowBetween(L, 'R', 'J').points[0]).toEqual({ x: cx(L.box('R')), y: L.box('R').y });
    expect(L.report.crossings).toHaveLength(1);
  });

  it('a join stays where moving it right straightens none of its entries (controlflow__s22: the end event under it is in the way of its entry\'s own row)', async () => {
    const doc = await Doc.fromXml(readFileSync(join(import.meta.dirname, '..', 'tools', 'scenarios', 'controlflow__s22.bpmn'), 'utf8'));
    const L = await layout('join-stays-s22', doc);
    // Gave up? -> Abandoned runs in the row the entry would run along: the entry leaves Gave up? upwards as before
    expect(cx(L.box('Gateway_Complete_join'))).toBe(cx(L.box('Event_Abandoned')));
    expect(flowBetween(L, 'Gateway_GaveUp', 'Gateway_Complete_join').points[0]).toEqual({ x: cx(L.box('Gateway_GaveUp')), y: L.box('Gateway_GaveUp').y });
  });

  it('a join\'s move that is not kept is undone exactly, also on a scope the passes after placement already ran on (as in a process with lanes)', async () => {
    // controlflow__s22 laid out and routed; its join's column is still taken, so freeJoinColumns tries the move once more
    const doc = await Doc.fromXml(readFileSync(join(import.meta.dirname, '..', 'tools', 'scenarios', 'controlflow__s22.bpmn'), 'utf8'));
    const scope = layoutScope(doc.require('Process_S22'), { expanded: new Set(), collapsedScopes: new Map() });
    const state = (): string =>
      JSON.stringify({
        nodes: scope.nodes.flatMap((n) => [n, ...n.boundary]).map((n) => [n.id, n.layer, n.row, n.band, n.width, n.box, n.topUsed]),
        edges: scope.edges.map((e) => [e.id, e.bandRow, e.bandY, e.points, e.label]),
        artifacts: scope.artifacts.map((a) => a.box),
        size: [scope.width, scope.height],
      });
    const drawn = state();
    const lines: string[] = [];
    await withLayoutDebug(
      (line) => lines.push(line),
      async () =>
        freeJoinColumns(scope, (shifts) => {
          gridScope(scope, undefined, shifts);
          placeAttachedArtifacts(scope);
        }),
    );
    expect(lines.filter((l) => l.startsWith('[joins]')).map((l) => l.split(':')[0])).toEqual(['[joins] Gateway_Complete_join stays']);
    expect(state()).toBe(drawn);
  });

  it('lanes: a join\'s trial measures the empty band where it is drawn (a loop over the top moved the content down, the band with it)', async () => {
    // generated (L118): b1 is an empty branch; the band of Print invoice? runs under Pack order only with the offset the loop over the top gave it
    const L = await layout(
      'lanes-join-band-offset',
      proc([
        start('S', 'Start'),
        task('A', 'Review invoice', 'S'),
        {
          op: 'split',
          after: 'A',
          id: 'G0',
          joinId: 'J0',
          name: 'Print invoice?',
          branches: [
            { flowName: 'b0', nodes: [{ kind: 'task', id: 'T0', name: 'Pack goods' }, { kind: 'sendTask', id: 'T1', name: 'Print case' }, { kind: 'userTask', id: 'T2', name: 'Ship customer' }] },
            { flowName: 'b1', default: true, nodes: [] },
            { flowName: 'b2', nodes: [{ kind: 'serviceTask', id: 'U', name: 'Pack order' }] },
          ],
        },
        task('F', 'Label order', 'J0'),
        end('E', 'F', 'End'),
        { op: 'add', kind: 'boundaryEvent:error', id: 'BE1', name: 'Failed', on: 'T1' },
        end('EE2', 'BE1', 'Reminder sent to customer and manager'),
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BE3', name: 'Late', on: 'T2', timer: 'P2D', nonInterrupting: true },
        { op: 'add', kind: 'sendTask', id: 'H4', name: 'Ship invoice', after: 'BE3' },
        { op: 'add', kind: 'serviceTask', id: 'H5', name: 'Approve claim', after: 'H4' },
        { op: 'add', kind: 'userTask', id: 'H6', name: 'Print goods', after: 'H5' },
        end('EE7', 'H6', 'Ended'),
        { op: 'connect', source: 'T0', target: 'A', name: 'retry' },
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: ['S', 'T0', 'T1', 'T2', 'U', 'G0', 'J0', 'F', 'E', 'H4', 'H5', 'EE7'] },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: ['A', 'EE2', 'H6'] },
      ]),
    );
    // the band keeps its offset in the trial: it runs under Pack order, not through it, and the move straightens both entries
    expect(L.report.through).toEqual([]);
    expect(longestHorizontalY(flowBetween(L, 'G0', 'J0').points)).toBeGreaterThan(bottom(L.box('U')));
    const j = L.box('J0');
    for (const id of ['G0', 'U']) {
      const [p, q] = flowBetween(L, id, 'J0').points.slice(-2);
      expect([p, q], `${id} -> J0`).toEqual([{ x: cx(j), y: p!.y }, { x: cx(j), y: bottom(j) }]);
    }
    expect(L.box('H5').x).toBeLessThan(cx(j));
  });

  it('a join\'s own data object hangs right of the line its entries from below rise on', async () => {
    // only another tool ties a data object to a gateway (an association; bpmn-cli connects data to activities and events)
    const doc = proc([
      start('S', 'Start'),
      { op: 'split', after: 'S', id: 'G', name: 'Which?', joinId: 'J', branches: [{ flowName: 'one', nodes: [{ kind: 'task', id: 'B1', name: 'One' }] }, { flowName: 'two', nodes: [{ kind: 'task', id: 'B2', name: 'Two' }] }] },
      end('E', 'J', 'End'),
      { op: 'add', kind: 'dataObjectReference', id: 'D', name: 'Record' },
    ]);
    const process = doc.require('P');
    const association = doc.moddle.create('bpmn:Association', { id: 'Association_D', sourceRef: doc.require('D'), targetRef: doc.require('J') }) as El;
    association.$parent = process;
    process.set('artifacts', [...many(process, 'artifacts'), association]);
    const L = await layout('join-own-data', doc);
    expectClean(L);
    expectStraightRises(L, 'J', ['B2'], 'data');
    expect(L.box('D').x).toBeGreaterThan(cx(L.box('J')));
  });

  /**
   * The flow of boundary event `eventId` leaves the event downwards to a run that keeps 15 px from the shapes `passed`
   * and from the labels of them and of the event, and (`straight`) rises straight into the bottom of `targetId`, the
   * target right above its line. Returns the run's y.
   */
  function expectRunBelow(L: Laid, eventId: string, targetId: string, passed: string[], what: string, straight = true): number {
    const ev = L.box(eventId), t = L.box(targetId);
    const pts = flowBetween(L, eventId, targetId).points;
    expect(pts[0], `${what}: out of the event's bottom`).toEqual({ x: cx(ev), y: bottom(ev) });
    expect(pts[1]!.x, what).toBe(cx(ev));
    const run = pts[1]!.y;
    expect(pts[2]!.y, `${what}: a horizontal run`).toBe(run);
    for (const id of [eventId, ...passed]) {
      const s = L.shape(id);
      for (const b of [s.box, ...(s.label ? [s.label] : [])]) expect(run - bottom(b), `${what}: the run keeps off ${id}`).toBeGreaterThanOrEqual(15);
    }
    if (straight) expect(pts.slice(2), `${what}: straight up into ${targetId}`).toEqual([{ x: cx(t), y: run }, { x: cx(t), y: bottom(t) }]);
    return run;
  }

  it('lanes: a boundary path into the lane above leaves its event downwards, runs below the host\'s row and its label, and rises straight into the handler, which moves right past the host\'s next task (the order model in small)', async () => {
    // Pick goods has a timer path After 2 days -> Inform customer -> Customer informed in the lane above; Inform customer
    // would sit in the column of Pack goods, the task after the host: the flow ran along Pack goods' bottom border and hooked in
    for (const kind of ['parallelGateway', 'exclusiveGateway', 'inclusiveGateway'] as const) {
      const L = await layout(
        `lanes-handler-column-free-${kind}`,
        proc([
          start('S', 'Order received'),
          task('A', 'Check order', 'S'),
          { op: 'split', after: 'A', kind, id: 'G', joinId: 'GJ', branches: [{ nodes: [{ kind: 'userTask', id: 'T1', name: 'Pick goods' }, { kind: 'task', id: 'T1b', name: 'Pack goods' }] }, { nodes: [{ kind: 'serviceTask', id: 'T2', name: 'Write invoice' }] }, { nodes: [{ kind: 'serviceTask', id: 'T3', name: 'Print label' }] }] },
          end('E', 'GJ', 'Shipped'),
          { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name: 'After 2 days', on: 'T1', timer: 'P2D', nonInterrupting: true },
          { op: 'add', kind: 'sendTask', id: 'TL', name: 'Inform customer about the delay', after: 'BT' },
          end('EL', 'TL', 'Customer informed'),
          { op: 'add', kind: 'participant', id: 'Org', name: 'Shop' },
          { op: 'add', kind: 'lane', id: 'L1', name: 'Service', in: 'P', members: ['S', 'A', 'E', 'G', 'GJ', 'TL', 'EL'] },
          { op: 'add', kind: 'lane', id: 'L2', name: 'Store', in: 'P', members: ['T1', 'T1b', 'T3'] },
          { op: 'add', kind: 'lane', id: 'L3', name: 'Accounting', in: 'P', members: ['T2'] },
        ]),
      );
      expect(L.report.through, kind).toEqual([]);
      expect(L.report.overlaps, kind).toEqual([]);
      expectLabelsClear(L);
      expectRunBelow(L, 'BT', 'TL', ['T1', 'T1b'], kind);
      // the handler right of Pack goods, its end right after it; the join right of both, its entries still rising straight
      const tl = L.box('TL'), el = L.box('EL');
      expect(tl.x, kind).toBeGreaterThan(right(L.box('T1b')));
      expect(flowBetween(L, 'TL', 'EL').points, kind).toEqual([{ x: right(tl), y: cy(tl) }, { x: el.x, y: cy(tl) }]);
      expectStraightRises(L, 'GJ', ['T1b', 'T2', 'T3'], kind);
      expect(right(el), kind).toBeLessThan(L.box('GJ').x);
      expectStraightLine(L, ['S', 'A', 'G', 'GJ', 'E']);
      // only the timer's way up crosses a line (Pack goods' into the join), as before
      expect(L.report.crossings.length, kind).toBeLessThanOrEqual(1);
    }
  });

  it('lanes: the lane of a boundary event holds the run of its way to the lane above 15 px from its bottom border (a label of two lines pushes the run down)', async () => {
    const L = await layout(
      'lanes-boundary-run-in-lane',
      proc([
        start('S', 'Start'),
        task('A', 'Ship goods', 'S'),
        task('B', 'Archive order', 'A'),
        end('E', 'B', 'Done'),
        { op: 'add', kind: 'boundaryEvent:error', id: 'BF', name: 'Shipping failed badly', on: 'A' },
        task('H', 'Escalate to the team lead', 'BF'),
        end('EH', 'H', 'Escalated'),
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Service', in: 'P', members: ['S', 'H', 'EH'] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Logistics', in: 'P', members: ['A', 'B', 'E'] },
        { op: 'add', kind: 'lane', id: 'L3', name: 'Accounting', in: 'P', members: [] },
      ]),
    );
    expectClean(L);
    expect(L.shape('BF').label!.height).toBeGreaterThan(20);
    const run = expectRunBelow(L, 'BF', 'H', ['A', 'B'], 'two-line label');
    expect(bottom(L.box('L2')) - run).toBeGreaterThanOrEqual(15);
    for (const id of ['A', 'B', 'E']) expect(bottom(L.box(id)), id).toBeLessThan(bottom(L.box('L2')));
  });

  it('a boundary flow into a node on the row above leaves its event downwards and runs below the host\'s row and the event\'s label, not along the host\'s bottom border (without lanes)', async () => {
    // Review claim (the second branch) has a timer whose path goes on with Notify, the task after the join
    const L = await layout(
      'boundary-run-row-above',
      proc([
        start('S', 'Start'),
        { op: 'split', after: 'S', id: 'G', name: 'Which way?', joinId: 'J', branches: [{ flowName: 'fast', nodes: [{ kind: 'task', id: 'A', name: 'Check order' }] }, { flowName: 'slow', nodes: [{ kind: 'userTask', id: 'B', name: 'Review claim' }] }] },
        task('C', 'Notify customer', 'J'),
        end('E', 'C', 'Done'),
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name: 'Two days late', on: 'B', timer: 'P2D', nonInterrupting: true },
        { op: 'connect', source: 'BT', target: 'C' },
      ]),
    );
    expectClean(L);
    expectLabelsClear(L);
    expect(cy(L.box('B'))).toBeGreaterThan(cy(L.box('C')));
    expectRunBelow(L, 'BT', 'C', ['B'], 'row above');
    expectStraightLine(L, ['S', 'G', 'A', 'J', 'C', 'E']);
  });

  it('the run below the host\'s row on the bottom row is part of the scope: a pool or an expanded sub-process without lanes holds it 15 px from its border, an event sub-process below keeps off it (boundary labels of two and three lines)', async () => {
    // the scope without lanes was sized without the run: it lay on the frame's bottom border or below it, and through the
    // event sub-process placed under the content
    const claim = (name: string): Op[] => [
      { op: 'split', after: 'S', id: 'G', name: 'Which way?', joinId: 'J', branches: [{ flowName: 'fast', nodes: [{ kind: 'task', id: 'A', name: 'Check order' }] }, { flowName: 'slow', nodes: [{ kind: 'userTask', id: 'B', name: 'Review claim' }] }] },
      task('C', 'Notify customer', 'J'),
      end('E', 'C', 'Done'),
      { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name, on: 'B', timer: 'P2D', nonInterrupting: true },
      { op: 'connect', source: 'BT', target: 'C' },
    ];
    const cancel: Op[] = [
      { op: 'add', kind: 'eventSubProcess', id: 'ESP', name: 'Cancel', in: 'P' },
      { op: 'add', kind: 'startEvent:message', id: 'ES', name: 'Cancelled', in: 'ESP', message: 'Cancel' },
      task('ET1', 'Undo booking', 'ES'),
      task('ET2', 'Refund', 'ET1'),
      end('EE', 'ET2', 'Stopped'),
    ];
    for (const name of ['Two days late', 'No reply within 5 days', 'Two days late without any answer from the customer at all']) {
      const what = (where: string): string => `${where}, "${name}"`;
      const pool = await layout(`boundary-run-in-pool-${name.length}`, proc([start('S', 'Start'), ...claim(name), { op: 'add', kind: 'participant', id: 'Org', name: 'Shop' }]));
      const sub = await layout(`boundary-run-in-sub-${name.length}`, proc([start('S0', 'Go'), { op: 'add', kind: 'subProcess', id: 'SP', name: 'Handle', after: 'S0' }, { op: 'add', kind: 'startEvent', id: 'S', name: 'Start', in: 'SP' }, ...claim(name), end('E0', 'SP', 'End')]));
      const esp = await layout(`boundary-run-above-event-sub-${name.length}`, proc([start('S', 'Start'), ...claim(name), ...cancel]));
      expect(pool.shape('BT').label!.height, what('label lines')).toBeGreaterThan(20);
      for (const [L, frame, where] of [[pool, 'Org', 'pool'], [sub, 'SP', 'expanded sub-process']] as const) {
        expect(L.report.through, what(where)).toEqual([]);
        expect(L.report.overlaps, what(where)).toEqual([]);
        const run = expectRunBelow(L, 'BT', 'C', ['B'], what(where), false);
        const f = L.box(frame);
        expect(bottom(f) - run, what(`${where}: the run keeps off the frame's bottom border`)).toBeGreaterThanOrEqual(15);
        for (const p of flowBetween(L, 'BT', 'C').points) expect(contains(f, { ...p, width: 0, height: 0 }), what(`${where}: (${p.x}, ${p.y}) inside`)).toBe(true);
      }
      const run = expectRunBelow(esp, 'BT', 'C', ['B'], what('event sub-process'), false);
      const box = esp.box('ESP');
      expect(box.y - run, what('event sub-process: below the run')).toBeGreaterThanOrEqual(15);
      expect(segments(flowBetween(esp, 'BT', 'C').points).some((s) => segmentCutsBox(s, box)), what('event sub-process: the flow keeps out')).toBe(false);
    }
  });

  it('a boundary flow into a node on the row above rises straight into it: the node moves right past the host\'s next task, which stood under it (without lanes)', async () => {
    // Late on Pick goods (the second branch) goes on with Inform customer on the first; Inform customer would sit in the
    // column of Pack goods, the task after the host
    const L = await layout(
      'boundary-handler-column-free',
      proc([
        start('S', 'Start'),
        { op: 'split', after: 'S', kind: 'parallelGateway', id: 'G', joinId: 'J', branches: [{ nodes: [{ kind: 'task', id: 'PO', name: 'Prepare order' }, { kind: 'sendTask', id: 'Q', name: 'Inform customer' }] }, { nodes: [{ kind: 'userTask', id: 'K', name: 'Pick goods' }, { kind: 'task', id: 'N', name: 'Pack goods' }] }] },
        end('E', 'J', 'Done'),
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name: 'Late', on: 'K', timer: 'P2D', nonInterrupting: true },
        { op: 'connect', source: 'BT', target: 'Q' },
      ]),
    );
    expect(L.report.through).toEqual([]);
    expect(L.report.overlaps).toEqual([]);
    expectLabelsClear(L);
    expectRunBelow(L, 'BT', 'Q', ['K', 'N'], 'no lanes');
    expect(L.box('Q').x).toBeGreaterThan(right(L.box('N')));
    expectStraightRises(L, 'J', ['N'], 'no lanes');
    expectStraightLine(L, ['S', 'G', 'PO', 'Q', 'J', 'E']);
    // the way up crosses Pack goods' flow into the join, as the hook did
    expect(L.report.crossings).toHaveLength(1);
  });

  it('a boundary flow to a target below whose way down would cut a data store hanging under the event keeps its side exit, not a line through the store', async () => {
    // the second data element of the host shifts right, under the boundary event
    const L = await layout(
      'boundary-down-blocked-by-data',
      proc([
        start('S', 'Start'),
        task('A', 'Score applicant', 'S'),
        task('B', 'Review score', 'A'),
        end('E', 'B', 'Done'),
        { op: 'add', kind: 'dataObjectReference', id: 'D0', name: 'Score sheet' },
        { op: 'connect', source: 'A', target: 'D0' },
        { op: 'add', kind: 'dataStoreReference', id: 'D1', name: 'Applicant DB' },
        { op: 'connect', source: 'A', target: 'D1' },
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name: 'Timeout', on: 'A', timer: 'PT1H' },
        end('ET', 'BT', 'Timed out'),
      ]),
    );
    const ev = L.box('BT'), store = L.box('D1');
    expect(store.x).toBeLessThan(cx(ev));
    expect(right(store)).toBeGreaterThan(cx(ev));
    expect(L.report.through).toEqual([]);
    expect(L.report.overlaps).toEqual([]);
  });

  it('lanes: a handler stays where moving it right would add a crossing (Inform\'s way up would cross Failed\'s into Fix), and Fix moves instead', async () => {
    // generated: two boundary paths into the lane above, Inform (Late on Pick) and Fix (Failed on Invoice), both in the column of Pack
    const lines: string[] = [];
    const L = await withLayoutDebug(
      (line) => lines.push(line),
      async () =>
        layout(
          'lanes-handler-stays-crossing',
          proc([
            start('S', 'Start'),
            task('A', 'Check order', 'S'),
            { op: 'split', after: 'A', id: 'G', joinId: 'J', branches: [{ nodes: [{ kind: 'task', id: 'K', name: 'Pick' }, { kind: 'task', id: 'V', name: 'Pack' }] }, { nodes: [{ kind: 'task', id: 'R', name: 'Invoice' }] }] },
            task('F', 'Ship', 'J'),
            end('E', 'F', 'Done'),
            { op: 'add', kind: 'boundaryEvent:timer', id: 'B', name: 'Late', on: 'K', timer: 'P2D', nonInterrupting: true },
            task('H', 'Inform', 'B'),
            { op: 'connect', source: 'H', target: 'J' },
            { op: 'add', kind: 'boundaryEvent:error', id: 'B2', name: 'Failed', on: 'R' },
            task('X', 'Fix', 'B2'),
            { op: 'connect', source: 'X', target: 'J' },
            { op: 'add', kind: 'participant', id: 'Org', name: 'Shop' },
            { op: 'add', kind: 'lane', id: 'L0', name: 'Service', in: 'P', members: ['S', 'A', 'G', 'J', 'F', 'E', 'H', 'X'] },
            { op: 'add', kind: 'lane', id: 'L1', name: 'Store', in: 'P', members: ['K', 'V', 'R'] },
          ]),
        ),
    );
    const trials = lines.filter((l) => /^\[joins\] [HX] /.test(l));
    expect(trials.map((l) => l.split(':')[0])).toEqual(['[joins] H stays', '[joins] X moves 1 right']);
    // Inform's move would have given one more crossing (and no fewer cut shapes or labels run through)
    const [, was, would] = /: (\{.*?\}) -> (\{.*?\})/.exec(trials[0]!)!;
    const before = JSON.parse(was!) as { crossings: number; hits: number; rises: number }, after = JSON.parse(would!) as { crossings: number; hits: number; rises: number };
    expect(after.crossings).toBeGreaterThan(before.crossings);
    expect(after.hits).toBeGreaterThanOrEqual(before.hits);
    expect(cx(L.box('H'))).toBe(cx(L.box('V')));
    expect(L.box('X').x).toBeGreaterThan(right(L.box('V')));
    expectRunBelow(L, 'B2', 'X', ['R'], 'Fix');
    // Late's way still leaves its event downwards and keeps off Pick's row, and hooks into Inform from the column gap
    expectRunBelow(L, 'B', 'H', ['K', 'V'], 'Inform', false);
    expect(L.report.through).toEqual([]);
    expect(L.report.crossings).toHaveLength(3);
  });

  /** The id of the sequence flow from `source` to `target` in `doc`. */
  function flowId(doc: Doc, source: string, target: string): string {
    return idOf(doc.outgoing(doc.require(source)).find((f) => idOf(f.get<El>('targetRef')) === target)!);
  }

  /** `doc` with the sequence flow `id` moved to the start (`first`) or the end of its process's flow elements. */
  function moveFlow(doc: Doc, id: string, first = true): Doc {
    const process = many(doc.definitions, 'rootElements').find((r) => is(r, 'bpmn:Process'))!;
    const list = process.get<El[]>('flowElements');
    const [flow] = list.splice(list.findIndex((el) => idOf(el) === id), 1);
    if (first) list.unshift(flow!);
    else list.push(flow!);
    return doc;
  }

  it('a boundary flow to a target above is routed after the other flows: its run below the host\'s row keeps off their drops and rises, wherever the flow stands in the file', async () => {
    // generated (k-signal-down): 2 days on Invoice invoice goes on with Label customer after the join. Routed before the
    // others, its run just below the host's row looked free and was crossed by the split's drop, the join's rise and the
    // drop of Payment failed
    const ops: Op[] = [
      start('S', 'Start'),
      task('A1', 'Invoice invoice', 'S'),
      { op: 'split', after: 'A1', kind: 'parallelGateway', id: 'G2', joinId: 'J3', branches: [{ nodes: [{ kind: 'userTask', id: 'T4', name: 'Print case' }, { kind: 'sendTask', id: 'T5', name: 'Print data' }] }, { nodes: [{ kind: 'task', id: 'T6', name: 'Inform customer' }] }] },
      task('F', 'Label customer', 'J3'),
      end('E', 'F', 'End'),
      { op: 'add', kind: 'boundaryEvent:signal', id: 'BE7', on: 'A1', name: 'Payment failed', signal: 'Go' },
      task('H8', 'Escalate invoice', 'BE7'),
      { op: 'add', kind: 'dataStoreReference', id: 'DS9', name: 'Archive', in: 'P' },
      { op: 'connect', source: 'H8', target: 'DS9' },
      end('EE10', 'H8', 'Escalation finished'),
      { op: 'add', kind: 'boundaryEvent:signal', id: 'BE11', on: 'A1', name: '2 days', signal: 'Stop' },
      { op: 'connect', source: 'BE11', target: 'F' },
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
      { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: [] },
      { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: ['S', 'A1', 'T4', 'T5', 'T6', 'G2', 'J3', 'F', 'E', 'H8', 'EE10'] },
    ];
    const routes: Point[][] = [];
    for (const order of ['as built', 'boundary flow first', 'boundary flow last']) {
      const doc = proc(ops);
      const id = flowId(doc, 'BE11', 'F');
      if (order !== 'as built') moveFlow(doc, id, order === 'boundary flow first');
      const L = await layout(`boundary-run-routed-late-${routes.length}`, doc);
      expect(L.report.crossings, order).toEqual([]);
      expect(L.report.through, order).toEqual([]);
      expectRunBelow(L, 'BE11', 'F', ['A1'], order, false);
      routes.push(flowBetween(L, 'BE11', 'F').points);
    }
    expect(routes[1]).toEqual(routes[0]);
    expect(routes[2]).toEqual(routes[0]);
  });

  it('boundary events on one host take their runs below its row right to left: the rightmost event\'s run is the highest, so no sibling\'s drop crosses it (both file orders)', async () => {
    // generated (d-9): Late (right) goes on with the join, Escalated (left) with Ship goods after it; stacked in file
    // order, Late's drop crossed Escalated's run when Escalated's flow came first
    const ops: Op[] = [
      start('S', 'Start'),
      { op: 'split', after: 'S', kind: 'parallelGateway', id: 'G', joinId: 'J', branches: [{ nodes: [{ kind: 'userTask', id: 'T7', name: 'Label goods' }] }, { nodes: [{ kind: 'task', id: 'T8', name: 'Escalate case' }, { kind: 'sendTask', id: 'T9', name: 'Inform invoice' }] }] },
      task('F', 'Ship goods', 'J'),
      end('E', 'F', 'End'),
      { op: 'add', kind: 'boundaryEvent:signal', id: 'BL', on: 'T8', name: 'Late', signal: 'Go' },
      { op: 'connect', source: 'BL', target: 'J' },
      { op: 'add', kind: 'boundaryEvent:message', id: 'BS', on: 'T8', name: 'Escalated', message: 'Reminder', nonInterrupting: true },
      { op: 'connect', source: 'BS', target: 'F', name: 'timeout' },
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
    ];
    for (const first of ['BL', 'BS']) {
      const doc = proc(ops);
      moveFlow(doc, flowId(doc, first, first === 'BL' ? 'J' : 'F'));
      const L = await layout(`boundary-siblings-right-to-left-${first}`, doc);
      const what = `${first}'s flow first`;
      expect(L.box('BL').x, what).toBeGreaterThan(L.box('BS').x);
      expect(L.report.crossings, what).toEqual([]);
      expect(L.report.through, what).toEqual([]);
      const late = expectRunBelow(L, 'BL', 'J', ['T8'], what, false), escalated = expectRunBelow(L, 'BS', 'F', ['T8'], what, false);
      expect(late, what).toBeLessThan(escalated);
    }
  });

  it('a join moves right when that removes a crossing, though no entry rises straight more than before (as many straight rises, nothing worse)', async () => {
    // generated (r048): moving J4 right of the boundary path's end was rejected as it gained no straight rise; Check
    // customer's way into J4 then crossed Book case's flow and hooked into the join
    const lines: string[] = [];
    const L = await withLayoutDebug(
      (line) => lines.push(line),
      async () =>
        layout(
          'join-moves-for-fewer-crossings',
          proc([
            start('S', 'Start'),
            { op: 'add', kind: 'sendTask', id: 'A1', name: 'Inform customer', after: 'S' },
            { op: 'add', kind: 'sendTask', id: 'A2', name: 'Notify case', after: 'A1' },
            { op: 'split', after: 'A2', kind: 'exclusiveGateway', id: 'G3', joinId: 'J4', name: 'Archive goods?', branches: [{ flowName: 'b0', nodes: [{ kind: 'userTask', id: 'T5', name: 'Check customer' }] }, { flowName: 'b1', nodes: [{ kind: 'userTask', id: 'T6', name: 'Ship invoice' }, { kind: 'userTask', id: 'T7', name: 'Call case' }] }] },
            task('F', 'Check order', 'J4'),
            end('E', 'F', 'End'),
            { op: 'add', kind: 'boundaryEvent:timer', id: 'BE8', on: 'T7', name: 'Reminder after 3 days', timer: 'PT1H' },
            { op: 'add', kind: 'userTask', id: 'H9', name: 'Book case', after: 'BE8' },
            { op: 'add', kind: 'userTask', id: 'H10', name: 'Invoice customer', after: 'H9' },
            { op: 'add', kind: 'sendTask', id: 'H11', name: 'Approve invoice', after: 'H10' },
            end('EE12', 'H11', 'Customer informed about the delay'),
          ]),
        ),
    );
    const trial = lines.find((l) => l.startsWith('[joins] J4 '));
    expect(trial).toMatch(/^\[joins\] J4 moves \d right/);
    const [, was, now] = /: (\{.*?\}) -> (\{.*?\})/.exec(trial!)!;
    const before = JSON.parse(was!) as { crossings: number; rises: number }, after = JSON.parse(now!) as { crossings: number; rises: number };
    expect(after.crossings).toBeLessThan(before.crossings);
    expect(after.rises).toBe(before.rises);
    expect(L.report.crossings).toEqual([]);
    expect(L.report.through).toEqual([]);
    expectLabelsClear(L);
    // the join right of Book case, Check customer's flow into its bottom vertex
    const j = L.box('J4'), pts = flowBetween(L, 'T5', 'J4').points;
    expect(j.x).toBeGreaterThan(right(L.box('H9')));
    expect(pts[pts.length - 1]).toEqual({ x: cx(j), y: bottom(j) });
  });

  it('a node moves right when that uncuts a shape, at the cost of no more crossings than the shapes it uncuts', async () => {
    // generated (s-5): Ended (x) stood above Call invoice, the task after its host; every way up into it cut Call
    // invoice. Moving it right takes a crossing with Cancelled by customer's way, which a cut shape is worse than
    const L = await layout(
      'move-uncuts-shape',
      proc([
        start('S', 'Start'),
        { op: 'add', kind: 'serviceTask', id: 'A1', name: 'Pack claim', after: 'S' },
        { op: 'add', kind: 'sendTask', id: 'A2', name: 'Notify data', after: 'A1' },
        { op: 'add', kind: 'subProcess', id: 'SP3', name: 'Inform claim', after: 'A2' },
        { op: 'add', kind: 'startEvent', id: 'SS4', in: 'SP3' },
        task('ST5', 'Approve customer', 'SS4'),
        end('SE6', 'ST5'),
        task('F', 'Call invoice', 'SP3'),
        end('E', 'F', 'End'),
        { op: 'add', kind: 'boundaryEvent:signal', id: 'BE7', on: 'SP3', name: 'x', signal: 'Stop' },
        end('EE8', 'BE7', 'Ended'),
        { op: 'add', kind: 'boundaryEvent:conditional', id: 'BE9', on: 'SP3', name: 'Cancelled by customer', when: '${late}' },
        end('EE10', 'BE9', 'Ended'),
        { op: 'add', kind: 'exclusiveGateway', id: 'D', name: 'Ok?', after: 'A2' },
        { op: 'connect', source: 'D', target: 'A1', name: 'again' },
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: [] },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: ['EE8', 'EE10'] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Lane 2', in: 'P', members: [] },
        { op: 'add', kind: 'lane', id: 'L3', name: 'Lane 3', in: 'P', members: ['S', 'A1', 'A2', 'SP3', 'F', 'E', 'D'] },
      ]),
    );
    expect(L.report.through).toEqual([]);
    expect(L.report.crossings.length).toBeLessThanOrEqual(1);
    expect(L.box('EE8').x).toBeGreaterThan(right(L.box('F')));
  });

  it('two boundary flows into one task rise at different slots of its bottom, not on one line', async () => {
    // generated (m-5): Conditional and Signal received on Call order both go on with Call claim; both rose at its centre
    const L = await layout(
      'boundary-rises-own-slot',
      proc([
        start('S', 'Start'),
        task('A1', 'Call order', 'S'),
        { op: 'add', kind: 'serviceTask', id: 'A2', name: 'Label case', after: 'A1' },
        task('F', 'Call claim', 'A2'),
        end('E', 'F', 'End'),
        { op: 'add', kind: 'boundaryEvent:conditional', id: 'BE3', on: 'A1', when: '${late}' },
        { op: 'connect', source: 'BE3', target: 'F' },
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BE6', on: 'A1', name: 'Signal received', timer: 'PT1H', nonInterrupting: true },
        { op: 'connect', source: 'BE6', target: 'F' },
      ]),
    );
    expect(L.report.through).toEqual([]);
    expect(L.report.crossings).toEqual([]);
    const f = L.box('F');
    const ends = ['BE3', 'BE6'].map((id) => {
      const pts = flowBetween(L, id, 'F').points;
      const [p, q] = pts.slice(-2) as [Point, Point];
      expect(q.y, `${id} ends on the bottom of Call claim`).toBe(bottom(f));
      expect(p.x, `${id} rises straight`).toBe(q.x);
      return q.x;
    });
    expect(ends[0]).not.toBe(ends[1]);
    expect(L.report.inOutOverlaps).toEqual([]);
  });

  it('lanes: the labels of two boundary events on a collapsed sub-process sit beside their own events, off the runs of their ways to the lane above', async () => {
    // the labels' spots assumed the events right to left (a collapsed sub-process has them left to right): both lay on
    // the other event, and the one moved away landed on the run of its sibling's way
    const doc = proc([
      start('S', 'Start'),
      task('A', 'Ship goods', 'S'),
      { op: 'add', kind: 'subProcess', id: 'SP', name: 'Pick and pack', after: 'A', collapsed: true },
      { op: 'add', kind: 'startEvent', id: 'SS', in: 'SP' },
      task('ST', 'Pick', 'SS'),
      end('SE', 'ST'),
      task('B', 'Archive order', 'SP'),
      end('E', 'B', 'Done'),
      { op: 'add', kind: 'boundaryEvent:error', id: 'BF', name: 'Packing failed', on: 'SP' },
      task('H', 'Escalate', 'BF'),
      end('EH', 'H', 'Escalated'),
      { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name: 'Too slow', on: 'SP', timer: 'PT1H', nonInterrupting: true },
      task('H2', 'Notify', 'BT'),
      end('EH2', 'H2', 'Notified'),
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
      { op: 'add', kind: 'lane', id: 'L1', name: 'Service', in: 'P', members: ['S', 'H', 'EH', 'H2', 'EH2'] },
      { op: 'add', kind: 'lane', id: 'L2', name: 'Logistics', in: 'P', members: ['A', 'SP', 'B', 'E'] },
    ]);
    expect(collapsedIds(doc)).toEqual(['SP']);
    const L = await layout('lanes-collapsed-boundary-labels', doc, { collapse: collapsedIds(doc) });
    expect(L.report.through).toEqual([]);
    expect(L.report.labelClashes).toEqual([]);
    expectLabelsClear(L);
    const bf = L.shape('BF'), bt = L.shape('BT');
    expect(bf.box.x).toBeLessThan(bt.box.x);
    // the left event's label left of it, the right one's right of it
    expect(right(bf.label!)).toBeLessThanOrEqual(bf.box.x);
    expect(bt.label!.x).toBeGreaterThanOrEqual(right(bt.box));
    expectLabelsOffRuns(L);
  });

  /** No label of a shape sits on a horizontal run: the run keeps more than 2 px from its top and bottom edge (or crosses it: labelOnLine). */
  function expectLabelsOffRuns(L: Laid): void {
    for (const plane of L.planes) {
      for (const s of plane.shapes.filter((x) => x.label)) {
        for (const e of plane.edges) {
          for (const [p, q] of segments(e.points)) {
            if (p.y !== q.y || Math.max(p.x, q.x) <= s.label!.x || Math.min(p.x, q.x) >= right(s.label!)) continue;
            expect(Math.abs(p.y - s.label!.y) > 2 && Math.abs(p.y - bottom(s.label!)) > 2, `${s.id}'s label off ${e.id} at y ${p.y}`).toBe(true);
          }
        }
      }
    }
  }

  it('lanes: a boundary event\'s label is not left on a horizontal run that only touches its box (it moves to a free spot)', async () => {
    // generated (r077): the hook of the split's flow into Ship case ran along the bottom edge of Failed's label
    const L = await layout(
      'lanes-boundary-label-off-run',
      proc([
        start('S', 'Start'),
        { op: 'add', kind: 'sendTask', id: 'A1', name: 'Print claim', after: 'S' },
        { op: 'split', after: 'A1', kind: 'inclusiveGateway', id: 'G2', joinId: 'J3', name: 'Ship customer?', branches: [{ flowName: 'b0', nodes: [{ kind: 'task', id: 'T4', name: 'Inform customer' }] }, { flowName: 'b1', nodes: [{ kind: 'serviceTask', id: 'T5', name: 'Pick invoice' }] }, { flowName: 'b2', nodes: [{ kind: 'userTask', id: 'T6', name: 'Ship case' }] }] },
        task('F', 'Notify data', 'J3'),
        end('E', 'F', 'End'),
        { op: 'add', kind: 'boundaryEvent:signal', id: 'BE7', on: 'T4', name: 'Failed', signal: 'Stop', nonInterrupting: true },
        { op: 'add', kind: 'userTask', id: 'H8', name: 'Pick claim', after: 'BE7' },
        { op: 'add', kind: 'sendTask', id: 'H9', name: 'Call invoice', after: 'H8' },
        { op: 'add', kind: 'userTask', id: 'H10', name: 'Pick customer', after: 'H9' },
        { op: 'connect', source: 'H10', target: 'J3' },
        { op: 'add', kind: 'boundaryEvent:error', id: 'BE11', on: 'T6', name: 'Late', error: 'Rejected' },
        { op: 'connect', source: 'BE11', target: 'J3', name: 'timeout' },
        { op: 'add', kind: 'boundaryEvent:compensate', id: 'BE12', on: 'T4', name: 'Signal received' },
        { op: 'add', kind: 'task', id: 'C13', name: 'Undo goods', in: 'P' },
        { op: 'connect', source: 'BE12', target: 'C13' },
        { op: 'add', kind: 'boundaryEvent:message', id: 'BE14', on: 'T6', name: 'Failed', message: 'Update' },
        { op: 'add', kind: 'sendTask', id: 'H15', name: 'Archive customer', after: 'BE14' },
        { op: 'connect', source: 'H15', target: 'A1' },
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: ['H10', 'H15'] },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: ['T6'] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Lane 2', in: 'P', members: ['S', 'A1', 'T4', 'T5', 'G2', 'J3', 'F', 'E', 'C13'] },
        { op: 'add', kind: 'lane', id: 'L3', name: 'Lane 3', in: 'P', members: ['H8', 'H9'] },
      ]),
    );
    expect(L.report.through).toEqual([]);
    expectLabelsOffRuns(L);
  });

  /**
   * The way of a boundary event over the top into its target (route.ts): down out of the event's bottom, a short run
   * into a column gap beside the host, up past the host's row, along a run at least 15 px from every shape and label
   * in its x range (but its own label), down into the target's top. Returns the run's y.
   */
  function expectOverTop(L: Laid, eventId: string, targetId: string, hostId: string, what: string): number {
    const ev = L.box(eventId), t = L.box(targetId), host = L.box(hostId);
    const flow = flowBetween(L, eventId, targetId);
    const pts = flow.points;
    expect(pts, `${what}: ${pts.map((p) => `(${p.x}, ${p.y})`).join(' ')}`).toHaveLength(6);
    expect(pts[0], `${what}: out of the event's bottom`).toEqual({ x: cx(ev), y: bottom(ev) });
    expect(pts[1]!.x, `${what}: down`).toBe(cx(ev));
    expect(pts[2]!.y, `${what}: a short run below the host's row`).toBe(pts[1]!.y);
    const gx = pts[2]!.x;
    expect(gx < host.x || gx > right(host), `${what}: up beside the host (x ${gx})`).toBe(true);
    expect(pts[3]!.x, `${what}: up`).toBe(gx);
    const run = pts[3]!.y;
    expect(run, `${what}: over the host's row`).toBeLessThan(host.y);
    const tx = pts[5]!.x;
    expect(pts.slice(4), `${what}: along and down into ${targetId}'s top`).toEqual([{ x: tx, y: run }, { x: tx, y: t.y }]);
    expect(tx > t.x && tx < right(t), `${what}: into ${targetId}'s top`).toBe(true);
    const lo = Math.min(gx, tx), hi = Math.max(gx, tx);
    for (const plane of L.planes) {
      const boxes = [...plane.shapes.filter((s) => !s.container).flatMap((s) => [s.box, ...(s.label ? [s.label] : [])]), ...plane.edges.filter((e) => e !== flow && e.label).map((e) => e.label!)];
      for (const b of boxes) {
        if (right(b) <= lo || b.x >= hi) continue;
        expect(b.y >= run + 15 || bottom(b) <= run - 15, `${what}: the run at ${run} keeps 15 px from (${b.x}, ${b.y}, ${b.width}, ${b.height})`).toBe(true);
      }
    }
    return run;
  }

  /**
   * A boundary event on its host's top border whose way goes over the top (place.ts boundariesOnTop, route.ts):
   * straight up out of the event's top, along a run at least 15 px from every shape and label in its x range (its own
   * label above the host included), down into the target's top (`side`: into its left side from the column gap
   * before it). The event's label lies above the host, below the run. Returns the run's y.
   */
  function expectUpOverTop(L: Laid, eventId: string, targetId: string, hostId: string, what: string, side = false): number {
    const ev = L.box(eventId), t = L.box(targetId), host = L.box(hostId);
    expect(cy(ev), `${what}: ${eventId} on ${hostId}'s top border`).toBe(host.y);
    const flow = flowBetween(L, eventId, targetId);
    const pts = flow.points;
    expect(pts, `${what}: ${pts.map((p) => `(${p.x}, ${p.y})`).join(' ')}`).toHaveLength(side ? 5 : 4);
    expect(pts[0], `${what}: out of the event's top`).toEqual({ x: cx(ev), y: ev.y });
    expect(pts[1]!.x, `${what}: straight up`).toBe(cx(ev));
    const run = pts[1]!.y;
    expect(run, `${what}: over the host's row`).toBeLessThan(host.y);
    const tx = pts[2]!.x;
    expect(pts[2]!.y, `${what}: along`).toBe(run);
    if (side) {
      expect(tx, `${what}: down the gap before ${targetId}`).toBeLessThan(t.x);
      expect(pts.slice(3), `${what}: into ${targetId}'s left side`).toEqual([{ x: tx, y: cy(t) }, { x: t.x, y: cy(t) }]);
    } else {
      expect(pts[3], `${what}: down into ${targetId}'s top`).toEqual({ x: tx, y: t.y });
      expect(tx > t.x && tx < right(t), `${what}: into ${targetId}'s top`).toBe(true);
    }
    const label = L.shape(eventId).label;
    if (label) {
      expect(bottom(label), `${what}: ${eventId}'s label above the host`).toBeLessThanOrEqual(host.y);
      expect(label.x >= right(ev) || right(label) <= ev.x, `${what}: ${eventId}'s label beside the event`).toBe(true);
    }
    const lo = Math.min(cx(ev), tx), hi = Math.max(cx(ev), tx);
    for (const plane of L.planes) {
      const boxes = [...plane.shapes.filter((s) => !s.container).flatMap((s) => [s.box, ...(s.label ? [s.label] : [])]), ...plane.edges.filter((e) => e !== flow && e.label).map((e) => e.label!)];
      for (const b of boxes) {
        if (right(b) <= lo || b.x >= hi) continue;
        expect(b.y >= run + 15 || bottom(b) <= run - 15, `${what}: the run at ${run} keeps 15 px from (${b.x}, ${b.y}, ${b.width}, ${b.height})`).toBe(true);
      }
    }
    return run;
  }

  /** The crossings of the drawing that one flow takes part in. */
  const crossingsOf = (L: Laid, flowId: string): string[] => L.report.crossings.filter((c) => c.startsWith(`${flowId}x`) || c.endsWith(`x${flowId}`));

  /**
   * r013, the maintainer's model: the non-interrupting timer Payment failed on Pick invoice (lane 0, top row) goes on
   * with Pack data, the last task of that row; the branches of the split run in the lanes below. `check`: a task with
   * four data objects between the join and Pack data (the last of them hangs in Pack data's column).
   */
  function paymentFailedDoc(check = false): Doc {
    return proc([
      start('S', 'Start'),
      { op: 'add', kind: 'userTask', id: 'A1', name: 'Pick invoice', after: 'S' },
      { op: 'split', after: 'A1', kind: 'parallelGateway', id: 'G2', joinId: 'J3', branches: [{ nodes: [{ kind: 'task', id: 'T4', name: 'Pack order' }, { kind: 'sendTask', id: 'T5', name: 'Inform order' }] }, { nodes: [{ kind: 'serviceTask', id: 'T6', name: 'Notify data' }, { kind: 'task', id: 'T7', name: 'Book data' }] }] },
      ...(check ? [task('X', 'Check data', 'J3'), task('F', 'Pack data', 'X')] : [task('F', 'Pack data', 'J3')]),
      end('E', 'F', 'End'),
      { op: 'add', kind: 'boundaryEvent:error', id: 'BE8', on: 'T5', name: '2 days', error: 'Failure' },
      { op: 'add', kind: 'serviceTask', id: 'H9', name: 'Approve goods', after: 'BE8' },
      { op: 'add', kind: 'serviceTask', id: 'H10', name: 'Archive case', after: 'H9' },
      { op: 'add', kind: 'dataObjectReference', id: 'DS11', name: 'Record', in: 'P' },
      { op: 'connect', source: 'H9', target: 'DS11' },
      { op: 'connect', source: 'H10', target: 'J3' },
      { op: 'add', kind: 'boundaryEvent:timer', id: 'BE12', on: 'A1', name: 'Payment failed', timer: 'P2D', nonInterrupting: true },
      { op: 'connect', source: 'BE12', target: 'F' },
      { op: 'add', kind: 'eventSubProcess', id: 'ES', name: 'On cancel', in: 'P' },
      { op: 'add', kind: 'startEvent:signal', id: 'ESS', name: 'Cancel', in: 'ES', signal: 'Stop' },
      task('EST', 'Cancel order', 'ESS'),
      end('ESE', 'EST', 'Cancelled'),
      ...(check ? [1, 2, 3, 4].flatMap((i): Op[] => [{ op: 'add', kind: 'dataObjectReference', id: `D${i}`, name: `Doc ${i}`, in: 'P' }, { op: 'connect', source: 'X', target: `D${i}` }]) : []),
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
      { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: ['S', 'A1', 'T5', 'T6', 'G2', 'J3', 'F', 'E', 'H9', 'H10', ...(check ? ['X'] : [])] },
      { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: ['T7'] },
      { op: 'add', kind: 'lane', id: 'L2', name: 'Lane 2', in: 'P', members: ['T4', 'ES'] },
      { op: 'add', kind: 'lane', id: 'L3', name: 'Lane 3', in: 'P', members: [] },
    ]);
  }

  it('lanes: a boundary flow into the last task of its host\'s row goes over the top from the host\'s top border where its run below would cross the lines of the branches in the lanes below (the maintainer\'s r013): straight up, along and down into Pack data, no crossing, the run 15 px inside the lane, nothing on a lane border', async () => {
    // the run below lane 0's content crossed the split's drop, Notify data's into Book data, Pack order's way up and Book
    // data's into the join (score 25); from the bottom border the way over the top crossed Start -> Pick invoice (score 10)
    const lines: string[] = [];
    const L = await withLayoutDebug(
      (line) => lines.push(line),
      async () => layout('lanes-boundary-over-top', paymentFailedDoc()),
    );
    expect(L.report.through).toEqual([]);
    expect(L.report.overlaps).toEqual([]);
    expect(L.report.labelClashes).toEqual([]);
    expect(lines.filter((l) => l.startsWith('[boundary] BE12 '))).toEqual([expect.stringMatching(/^\[boundary\] BE12 moves to the top border/)]);
    const run = expectUpOverTop(L, 'BE12', 'F', 'A1', 'r013');
    expect(run - L.box('L0').y, 'the run keeps 15 px from the lane\'s top border').toBeGreaterThanOrEqual(15);
    const flow = flowBetween(L, 'BE12', 'F');
    // it crosses no line; the drawing keeps the crossing the lanes force (score 5)
    expect(crossingsOf(L, flow.id)).toEqual([]);
    expect(L.report.crossings).toEqual(['Flow_PackOrderToInformOrderxFlow_BookDataToGateway']);
    expect(layoutProblems(L.out.model.definitions).score).toBeLessThanOrEqual(5);
    // the label to the upper right of the event, clear of the flows into and out of Pick invoice
    const label = L.shape('BE12').label!, host = L.box('A1');
    expect(label.x).toBeGreaterThan(right(L.box('BE12')));
    expect(bottom(label)).toBeLessThanOrEqual(host.y);
    expect(L.box('BE8').y, '2 days stays on the bottom border of Inform order').toBe(bottom(L.box('T5')) - 18);
    const borders = ['L0', 'L1', 'L2', 'L3'].flatMap((id) => [L.box(id).y, bottom(L.box(id))]);
    for (const p of flow.points) expect(borders, `(${p.x}, ${p.y}) off the lane borders`).not.toContain(p.y);
  });

  it('lanes: a host in the first column sends its boundary flow over the top from its top border (r013 without the start event)', async () => {
    const doc = paymentFailedDoc();
    runOps(doc, [{ op: 'remove', ids: ['S'] }]);
    const L = await layout('lanes-boundary-over-top-first-column', doc);
    expect(L.report.through).toEqual([]);
    const host = L.box('A1');
    expect(host.x, 'Pick invoice comes first').toBe(Math.min(...L.planes[0]!.shapes.filter((s) => !s.container).map((s) => s.box.x)));
    expectUpOverTop(L, 'BE12', 'F', 'A1', 'first column');
    expect(crossingsOf(L, flowBetween(L, 'BE12', 'F').id)).toEqual([]);
  });

  it('lanes: the lane of host and target grows to hold a way over the top and its label (a lane that is not the first: the lane above keeps its place and height)', async () => {
    // the split's three-line name above its diamond puts the run near the lane's top border, the flow's label above it
    const L = await layout(
      'lanes-boundary-over-top-middle',
      proc([
        start('S', 'Start'),
        { op: 'add', kind: 'userTask', id: 'A', name: 'Pick invoice', after: 'S' },
        { op: 'split', after: 'A', kind: 'exclusiveGateway', id: 'G', joinId: 'J', name: 'Is the payment complete and is the order valid?', branches: [{ nodes: [{ kind: 'task', id: 'T1', name: 'Pack order' }, { kind: 'sendTask', id: 'T2', name: 'Inform order' }] }, { nodes: [{ kind: 'serviceTask', id: 'T3', name: 'Notify data' }, { kind: 'task', id: 'T4', name: 'Book data' }] }, { nodes: [{ kind: 'serviceTask', id: 'T5', name: 'Print label' }] }] },
        task('F', 'Pack data', 'J'),
        end('E', 'F', 'End'),
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', on: 'A', name: 'Payment failed', timer: 'P2D', nonInterrupting: true },
        { op: 'connect', source: 'BT', target: 'F', name: 'timeout' },
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L0', name: 'Office', in: 'P', members: [] },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Sales', in: 'P', members: ['S', 'A', 'G', 'T1', 'T2', 'J', 'F', 'E'] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Store', in: 'P', members: ['T3', 'T4', 'T5'] },
      ]),
    );
    expect(L.report.through).toEqual([]);
    expect(L.report.overlaps).toEqual([]);
    expect(L.report.labelClashes).toEqual([]);
    // from the host's top border; the upper right of the event is the split's three-line label's, so the event's label
    // goes to its upper left
    const run = expectUpOverTop(L, 'BT', 'F', 'A', 'middle lane');
    const lane = L.box('L1'), flow = flowBetween(L, 'BT', 'F'), label = flow.label!, own = L.shape('BT').label!;
    expect(right(own), 'Payment failed left of the event').toBeLessThanOrEqual(L.box('BT').x);
    expect(run - lane.y, 'the run keeps 15 px from the lane\'s top border').toBeGreaterThanOrEqual(15);
    expect(label.y, 'its label inside the lane').toBeGreaterThanOrEqual(lane.y);
    expect(bottom(label)).toBeLessThanOrEqual(run);
    expect(contains(lane, own), 'the event\'s label inside the lane').toBe(true);
    const office = L.box('L0');
    expect(office.height, 'the empty lane above keeps its height').toBe(120);
    expect(bottom(office)).toBe(lane.y);
    // the way below crossed the split's drops and the branches' ways into the join (four lines), the way over the top
    // from the bottom border Start's flow; this one none
    expect(L.report.crossings).toEqual([]);
  });

  /** generated (on-34): Failed on Inform data goes on with the second join; the compensation handler under its sibling blocks the way below everything */
  const failedToJoinOps = (where = 'P'): Op[] => [
    start('S', 'Start', { in: where }),
    task('A1', 'Inform data', 'S'),
    { op: 'split', after: 'A1', kind: 'exclusiveGateway', id: 'G2', joinId: 'J3', name: 'Invoice claim?', branches: [{ flowName: 'b0', nodes: [{ kind: 'sendTask', id: 'T4', name: 'Inform customer' }] }, { flowName: 'b1', nodes: [{ kind: 'sendTask', id: 'T5', name: 'Archive claim' }, { kind: 'task', id: 'T6', name: 'Notify claim' }] }] },
    { op: 'split', after: 'J3', kind: 'inclusiveGateway', id: 'G7', joinId: 'J8', name: 'Notify claim?', branches: [{ flowName: 'b0', nodes: [{ kind: 'task', id: 'T9', name: 'Inform order' }, { kind: 'userTask', id: 'T10', name: 'Pack data' }] }, { flowName: 'b1', nodes: [{ kind: 'serviceTask', id: 'T11', name: 'Label goods' }] }] },
    task('F', 'Pick case', 'J8'),
    end('E', 'F', 'End'),
    { op: 'add', kind: 'boundaryEvent:signal', id: 'BE12', on: 'A1', name: 'Failed', signal: 'Go' },
    { op: 'connect', source: 'BE12', target: 'J8', name: 'timeout' },
    { op: 'add', kind: 'boundaryEvent:compensate', id: 'BE13', on: 'A1', name: 'Signal received' },
    { op: 'add', kind: 'task', id: 'C14', name: 'Undo customer', in: where },
    { op: 'connect', source: 'BE13', target: 'C14' },
  ];

  it('a boundary flow into a join on its row goes over the top from its host\'s top border into the join\'s top vertex where the ways below cross more lines (without lanes: a process, a pool and an expanded sub-process hold the event, the run and their labels)', async () => {
    // the run just below the host's row crossed the first split's drop, Notify claim's way up and the second split's
    // drop; the way below everything would cut Undo customer; from the bottom border the way over the top crossed
    // Start's flow
    const docs: Array<[string, Doc, string | undefined]> = [
      ['process', proc(failedToJoinOps()), undefined],
      ['pool', proc([...failedToJoinOps(), { op: 'add', kind: 'participant', id: 'Org', name: 'Company' }]), 'Org'],
      ['sub-process', proc([start('S0', 'Go'), { op: 'add', kind: 'subProcess', id: 'SP', name: 'Handle claim', after: 'S0' }, ...failedToJoinOps('SP'), end('E0', 'SP', 'Done')]), 'SP'],
    ];
    for (const [where, doc, frame] of docs) {
      const L = await layout(`boundary-over-top-${where}`, doc);
      expect(L.report.through, where).toEqual([]);
      expect(L.report.overlaps, where).toEqual([]);
      expect(L.report.labelClashes, where).toEqual([]);
      const run = expectUpOverTop(L, 'BE12', 'J8', 'A1', where);
      const j = L.box('J8'), flow = flowBetween(L, 'BE12', 'J8');
      expect(flow.points[flow.points.length - 1], `${where}: into the top vertex`).toEqual({ x: cx(j), y: j.y });
      expect(L.report.crossings, where).toEqual([]);
      // the compensation event stays on the bottom border, its handler right under it
      const comp = L.box('BE13'), handler = L.box('C14');
      expect(cy(comp), `${where}: Signal received on the bottom border`).toBe(bottom(L.box('A1')));
      expect(cx(handler), `${where}: Undo customer under Signal received`).toBe(cx(comp));
      if (!frame) continue;
      const f = L.box(frame);
      expect(run - f.y, `${where}: the run keeps 15 px from the frame's top border`).toBeGreaterThanOrEqual(15);
      for (const label of [flow.label!, L.shape('BE12').label!]) expect(contains(f, label), `${where}: the labels inside the frame`).toBe(true);
      expect(contains(f, L.box('BE12')), `${where}: the event inside the frame`).toBe(true);
    }
  });

  it('a loop over the top keeps off a boundary event\'s way over the top: it does not hook into its target along that run', async () => {
    // generated (om-19): 2 days on Inform order goes on with Notify order over the top; the loop again from Ok? back to
    // Inform order hooked into Inform order's top along the run (two flows on one line for 80 px)
    const L = await layout(
      'boundary-over-top-loop',
      proc([
        start('S', 'Start'),
        { op: 'add', kind: 'sendTask', id: 'A1', name: 'Inform order', after: 'S' },
        { op: 'add', kind: 'sendTask', id: 'A2', name: 'Pick claim', after: 'A1' },
        task('F', 'Notify order', 'A2'),
        end('E', 'F', 'End'),
        { op: 'add', kind: 'boundaryEvent:message', id: 'BE3', on: 'A1', name: 'x', message: 'Cancel', nonInterrupting: true },
        { op: 'connect', source: 'BE3', target: 'A2', name: 'timeout' },
        { op: 'add', kind: 'boundaryEvent:signal', id: 'BE4', on: 'A2', name: 'Payment failed', signal: 'Stop' },
        { op: 'connect', source: 'BE4', target: 'F' },
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BE5', on: 'A2', name: 'x', timer: 'PT1H', nonInterrupting: true },
        { op: 'connect', source: 'BE5', target: 'F', name: 'timeout' },
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BE6', on: 'A1', name: '2 days', timer: 'PT1H' },
        { op: 'connect', source: 'BE6', target: 'F' },
        { op: 'add', kind: 'exclusiveGateway', id: 'D', name: 'Ok?', after: 'F' },
        { op: 'connect', source: 'D', target: 'A1', name: 'again' },
      ]),
    );
    expect(L.report.through).toEqual([]);
    // from its host's top border: the run starts above the host, the loop runs below
    expectUpOverTop(L, 'BE6', 'F', 'A1', 'om-19');
    const way = segments(flowBetween(L, 'BE6', 'F').points), loop = segments(flowBetween(L, 'D', 'A1').points);
    for (const s of way) for (const q of loop) expect(collinearOverlap(s, q), `${JSON.stringify(s)} / ${JSON.stringify(q)}`).toBeLessThanOrEqual(0);
  });

  it('lanes: a node that a boundary event\'s way enters over the top is not moved for a rise into its bottom it does not have (r013 with data objects in Pack data\'s column)', async () => {
    // freeJoinColumns moved Pack data right past the data object under it, for the straight rise of a way it then
    // drew over the top
    const lines: string[] = [];
    const L = await withLayoutDebug(
      (line) => lines.push(line),
      async () => layout('lanes-boundary-over-top-no-move', paymentFailedDoc(true)),
    );
    expect(lines.filter((l) => l.startsWith('[joins] F '))).toEqual(['[joins] F stays: entered over the top']);
    expect(L.report.through).toEqual([]);
    // then the event goes to the top border (boundariesOnTop runs after the joins' moves)
    expectUpOverTop(L, 'BE12', 'F', 'A1', 'r013 with data');
  });

  it('lanes: a way over the top passes under no other boundary event of its host (their drops are routed after it): the three ways of Book invoice cross none of each other', async () => {
    // generated (ot-50): 2 days, the rightmost event, went over the top through the gap before Book invoice; its short run
    // passed under Failed and Late, whose drops then crossed it
    const L = await layout(
      'lanes-boundary-over-top-siblings',
      proc([
        start('S', 'Start'),
        { op: 'add', kind: 'sendTask', id: 'A1', name: 'Book invoice', after: 'S' },
        { op: 'split', after: 'A1', kind: 'inclusiveGateway', id: 'G2', joinId: 'J3', name: 'Print data?', branches: [{ flowName: 'b0', nodes: [{ kind: 'serviceTask', id: 'T4', name: 'Archive goods' }] }, { flowName: 'b1', nodes: [{ kind: 'sendTask', id: 'T5', name: 'Pick customer' }] }, { flowName: 'b2', nodes: [{ kind: 'serviceTask', id: 'T6', name: 'Label data' }, { kind: 'serviceTask', id: 'T7', name: 'Check claim' }] }] },
        { op: 'split', after: 'J3', kind: 'parallelGateway', id: 'G8', joinId: 'J9', branches: [{ nodes: [{ kind: 'task', id: 'T10', name: 'Call invoice' }, { kind: 'sendTask', id: 'T11', name: 'Ship case' }] }, { nodes: [{ kind: 'task', id: 'T12', name: 'Ship order' }, { kind: 'serviceTask', id: 'T13', name: 'Pack invoice' }] }] },
        task('F', 'Notify customer', 'J9'),
        end('E', 'F', 'End'),
        { op: 'add', kind: 'boundaryEvent:signal', id: 'BE14', on: 'A1', name: 'Failed', signal: 'Stop', nonInterrupting: true },
        { op: 'connect', source: 'BE14', target: 'J3', name: 'timeout' },
        { op: 'add', kind: 'boundaryEvent:message', id: 'BE15', on: 'A1', name: '2 days', message: 'Cancel', nonInterrupting: true },
        { op: 'connect', source: 'BE15', target: 'J9', name: 'timeout' },
        { op: 'add', kind: 'boundaryEvent:message', id: 'BE16', on: 'A1', name: 'Late', message: 'Cancel', nonInterrupting: true },
        { op: 'connect', source: 'BE16', target: 'F' },
        { op: 'add', kind: 'exclusiveGateway', id: 'D', name: 'Ok?', after: 'F' },
        { op: 'connect', source: 'D', target: 'A1', name: 'again' },
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: ['S', 'A1', 'T4', 'T5', 'T7', 'G2', 'J3', 'T10', 'T11', 'T12', 'T13', 'G8', 'J9', 'F', 'E', 'D'] },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: [] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Lane 2', in: 'P', members: ['T6'] },
        { op: 'add', kind: 'lane', id: 'L3', name: 'Lane 3', in: 'P', members: [] },
      ]),
    );
    expect(L.report.through).toEqual([]);
    const ways = [flowBetween(L, 'BE14', 'J3'), flowBetween(L, 'BE15', 'J9'), flowBetween(L, 'BE16', 'F')];
    for (const a of ways) for (const b of ways) if (a !== b) expect(L.report.crossings, `${a.id} / ${b.id}`).not.toContain(`${a.id}x${b.id}`);
    for (const [ev, way] of [['BE14', ways[0]!], ['BE15', ways[1]!], ['BE16', ways[2]!]] as const) {
      // the ways over the top
      if (Math.min(...way.points.map((p) => p.y)) >= L.box('A1').y) continue;
      const [p, q] = [way.points[1]!, way.points[2]!];
      for (const other of ['BE14', 'BE15', 'BE16']) {
        if (other === ev) continue;
        const x = cx(L.box(other));
        expect(x > Math.min(p.x, q.x) && x < Math.max(p.x, q.x), `${ev}'s run below the row passes under ${other}`).toBe(false);
      }
    }
  });

  it('a boundary flow keeps its way below where that crosses no line but runs through labels (they move off it) and a way over the top from the bottom border would cross one; from the top border of its host (an expanded sub-process) it crosses none and runs through no label', async () => {
    // generated (ol-23): Cancelled by customer on Inform invoice rose straight into Book claim through the default spots
    // of Book claim's boundary labels; the way over the top crossed Start's flow. Book claim's events rise straight into
    // Pack invoice, clean: they stay on the bottom border
    const L = await layout(
      'boundary-over-top-not-for-labels',
      proc([
        start('S', 'Start'),
        { op: 'add', kind: 'subProcess', id: 'SP1', name: 'Inform invoice', after: 'S' },
        { op: 'add', kind: 'startEvent', id: 'SS2', in: 'SP1' },
        task('ST3', 'Notify customer', 'SS2'),
        end('SE4', 'ST3'),
        { op: 'add', kind: 'serviceTask', id: 'A5', name: 'Book claim', after: 'SP1' },
        task('F', 'Pack invoice', 'A5'),
        end('E', 'F', 'End'),
        { op: 'add', kind: 'boundaryEvent:escalation', id: 'BE6', on: 'SP1', name: 'Cancelled by customer', escalation: 'Esc' },
        { op: 'connect', source: 'BE6', target: 'A5' },
        { op: 'add', kind: 'boundaryEvent:escalation', id: 'BE7', on: 'A5', name: 'Signal received', escalation: 'Boss', nonInterrupting: true },
        { op: 'connect', source: 'BE7', target: 'F', name: 'timeout' },
        { op: 'add', kind: 'boundaryEvent:escalation', id: 'BE8', on: 'A5', name: 'Escalated', escalation: 'Boss' },
        { op: 'connect', source: 'BE8', target: 'F', name: 'timeout' },
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: [] },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: [] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Lane 2', in: 'P', members: ['S', 'SP1', 'A5', 'F', 'E'] },
      ]),
    );
    expect(L.report.through).toEqual([]);
    expect(L.report.crossings).toEqual([]);
    for (const [ev, t] of [['BE7', 'F'], ['BE8', 'F']] as const) {
      const pts = flowBetween(L, ev, t).points;
      expect(Math.min(...pts.map((p) => p.y)), `${ev} -> ${t} enters from below`).toBe(bottom(L.box(t)));
      expect(cy(L.box(ev)), `${ev} on the bottom border`).toBe(bottom(L.box('A5')));
    }
    const run = expectUpOverTop(L, 'BE6', 'A5', 'SP1', 'ol-23');
    // the event at the right end of the sub-process's top border, off its title; its label inside the lane
    const sp = L.box('SP1'), ev = L.box('BE6'), title = titleBox(sp, 'Inform invoice')!;
    expect(cx(ev)).toBe(right(sp) - 25);
    expect(ev.x).toBeGreaterThan(right(title));
    expect(run - L.box('L2').y).toBeGreaterThanOrEqual(15);
    expect(contains(L.box('L2'), L.shape('BE6').label!)).toBe(true);
  });

  /**
   * Pick invoice (no lanes) with the timer Payment failed going on with Pack data after the join and the error event
   * Rejected with its own handler below (`host`: the host, an expanded sub-process with content when `sub`).
   */
  function twoEventsDoc(sub = false): Doc {
    return proc([
      start('S', 'Start'),
      ...(sub
        ? [{ op: 'add', kind: 'subProcess', id: 'A1', name: 'Handle claim', after: 'S' } as AddOp, start('SS', undefined, { in: 'A1' }), task('ST', 'Check claim', 'SS'), end('SE', 'ST')]
        : [{ op: 'add', kind: 'userTask', id: 'A1', name: 'Pick invoice', after: 'S' } as AddOp]),
      { op: 'split', after: 'A1', kind: 'parallelGateway', id: 'G2', joinId: 'J3', branches: [{ nodes: [{ kind: 'task', id: 'T4', name: 'Pack order' }, { kind: 'sendTask', id: 'T5', name: 'Inform order' }] }, { nodes: [{ kind: 'serviceTask', id: 'T6', name: 'Notify data' }, { kind: 'task', id: 'T7', name: 'Book data' }] }] },
      task('F', 'Pack data', 'J3'),
      end('E', 'F', 'End'),
      { op: 'add', kind: 'boundaryEvent:timer', id: 'BE12', on: 'A1', name: 'Payment failed', timer: 'P2D', nonInterrupting: true },
      { op: 'connect', source: 'BE12', target: 'F' },
      { op: 'add', kind: 'boundaryEvent:error', id: 'BE13', on: 'A1', name: 'Rejected', error: 'Fail' },
      task('H', 'Call customer', 'BE13'),
      end('HE', 'H', 'Called'),
    ]);
  }

  it('without lanes: a boundary event whose way goes over the top sits on its host\'s top border; the other event of the host, whose handler lies below, stays on the bottom border in its place', async () => {
    for (const sub of [false, true]) {
      const what = sub ? 'an expanded sub-process as host' : 'a task as host';
      const lines: string[] = [];
      const L = await withLayoutDebug(
        (line) => lines.push(line),
        async () => layout(`boundary-top-border-one-of-two${sub ? '-sub' : ''}`, twoEventsDoc(sub)),
      );
      expect(L.report.through, what).toEqual([]);
      expect(L.report.overlaps, what).toEqual([]);
      expect(L.report.labelClashes, what).toEqual([]);
      // from the bottom border the way below everything crossed Rejected's drop (score 5)
      expect(L.report.crossings, what).toEqual([]);
      expect(lines.filter((l) => l.startsWith('[boundary] ')), what).toEqual([expect.stringMatching(/^\[boundary\] BE12 moves to the top border/)]);
      expectUpOverTop(L, 'BE12', 'F', 'A1', what);
      const host = L.box('A1'), rejected = L.box('BE13');
      expect(cx(L.box('BE12')), `${what}: Payment failed at the right end of the top border`).toBe(right(host) - 25);
      expect(cy(rejected), `${what}: Rejected on the bottom border`).toBe(bottom(host));
      expect(cx(rejected), `${what}: Rejected keeps its place, the second from the right`).toBe(right(host) - 69);
      expect(flowBetween(L, 'BE13', 'H').points[0], `${what}: Rejected's flow leaves downwards`).toEqual({ x: cx(rejected), y: bottom(rejected) });
      expect(L.shape('BE13').label!.x, `${what}: its label right of it, below the host`).toBeGreaterThan(right(rejected));
      if (sub) expect(L.box('BE12').x, 'off the title').toBeGreaterThan(right(titleBox(host, 'Handle claim')!));
      expect(layoutProblems(L.out.model.definitions).score, what).toBe(0);
    }
  });

  it('lanes: two boundary events of one host on its top border nest their ways (the one with the nearer target on the right): no crossing, their labels apart (r013 with a second event into the join)', async () => {
    const doc = paymentFailedDoc();
    runOps(doc, [
      { op: 'add', kind: 'boundaryEvent:message', id: 'BE14', on: 'A1', name: 'Paid', message: 'Paid', nonInterrupting: true },
      { op: 'connect', source: 'BE14', target: 'J3' },
    ]);
    const L = await layout('lanes-boundary-top-border-two', doc);
    expect(L.report.through).toEqual([]);
    expect(L.report.overlaps).toEqual([]);
    expect(L.report.labelClashes).toEqual([]);
    // from the bottom border: score 30 (the ways below cross the branches in the lanes below, the one over the top Start's flow)
    expect(L.report.crossings).toEqual(['Flow_PackOrderToInformOrderxFlow_BookDataToGateway']);
    const host = L.box('A1');
    expect(cx(L.box('BE14')), 'Paid (into the join) on the right').toBe(right(host) - 25);
    expect(cx(L.box('BE12')), 'Payment failed (into Pack data) left of it').toBe(right(host) - 69);
    const inner = expectUpOverTop(L, 'BE14', 'J3', 'A1', 'Paid');
    const outer = expectUpOverTop(L, 'BE12', 'F', 'A1', 'Payment failed');
    expect(outer, 'the outer way runs above the inner one').toBeLessThan(inner);
    const paid = L.shape('BE14').label!, failed = L.shape('BE12').label!;
    expect(paid.x, 'Paid\'s label to its upper right').toBeGreaterThan(right(L.box('BE14')));
    expect(right(failed), 'Payment failed\'s label to its upper left').toBeLessThan(L.box('BE12').x);
    expect(boxesOverlap(paid, failed)).toBe(false);
  });

  it('a boundary event stays on the bottom border where its way from the top border would be worse: the node of the row above stands right above its host', async () => {
    // generated: Too late on Order goods (the "no" branch) goes on with Ship order; Check stock (the "yes" branch) is in
    // its column on the row above, so a way up out of the top border cuts it; the way below crosses Wait for goods' way
    // into the join and stays
    const lines: string[] = [];
    const L = await withLayoutDebug(
      (line) => lines.push(line),
      async () =>
        layout(
          'boundary-top-border-worse',
          proc([
            start('S', 'Start'),
            task('A', 'Receive order', 'S'),
            { op: 'split', after: 'A', kind: 'exclusiveGateway', id: 'G', joinId: 'J', name: 'In stock?', branches: [{ flowName: 'yes', nodes: [{ kind: 'task', id: 'X', name: 'Check stock' }, { kind: 'task', id: 'Y', name: 'Reserve stock' }] }, { flowName: 'no', nodes: [{ kind: 'userTask', id: 'H', name: 'Order goods' }] }, { flowName: 'later', nodes: [{ kind: 'task', id: 'Z', name: 'Notify customer' }, { kind: 'task', id: 'Z2', name: 'Wait for goods' }] }] },
            task('F', 'Ship order', 'J'),
            end('E', 'F', 'Shipped'),
            { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', on: 'H', name: 'Too late', timer: 'P2D', nonInterrupting: true },
            { op: 'connect', source: 'BT', target: 'F' },
          ]),
        ),
    );
    expect(lines.filter((l) => l.startsWith('[boundary] '))).toEqual([expect.stringMatching(/^\[boundary\] BT stays on the bottom border: .* \(not up\)$/)]);
    const host = L.box('H'), ev = L.box('BT');
    expect(cy(ev)).toBe(bottom(host));
    expect(flowBetween(L, 'BT', 'F').points[0]).toEqual({ x: cx(ev), y: bottom(ev) });
    expect(L.report.through).toEqual([]);
    expect(L.report.crossings).toHaveLength(1);
  });

  it('lanes: a boundary event\'s flow to an end below whose drop is blocked runs in a channel its lane holds 15 px from its border, also when no way below holds the lane open (m-9: the other event goes over the top from its top border)', async () => {
    // generated (m-9): 2 days on Book order drops through the data store into a channel below Undo data; Cancelled by
    // customer's way below everything held the lane open, from the top border it no longer does (the channel lay on the
    // lane border)
    const L = await layout(
      'lanes-boundary-channel-held',
      proc([
        start('S', 'Start'),
        { op: 'add', kind: 'serviceTask', id: 'A1', name: 'Call invoice', after: 'S' },
        { op: 'add', kind: 'serviceTask', id: 'A2', name: 'Book order', after: 'A1' },
        task('F', 'Check invoice', 'A2'),
        end('E', 'F', 'End'),
        { op: 'add', kind: 'boundaryEvent:compensate', id: 'BE3', on: 'A2' },
        { op: 'add', kind: 'task', id: 'C4', name: 'Undo data', in: 'P' },
        { op: 'connect', source: 'BE3', target: 'C4' },
        { op: 'add', kind: 'boundaryEvent:message', id: 'BE5', on: 'A1', name: 'Cancelled by customer', message: 'Update', nonInterrupting: true },
        { op: 'connect', source: 'BE5', target: 'F', name: 'timeout' },
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BE6', on: 'A2', name: '2 days', timer: 'PT1H' },
        end('EE7', 'BE6', 'Escalation finished'),
        { op: 'add', kind: 'dataStoreReference', id: 'DU8', name: 'Event log', in: 'P' },
        { op: 'connect', source: 'BE6', target: 'DU8' },
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: ['S', 'A1', 'A2', 'F', 'E', 'C4', 'EE7'] },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: [] },
      ]),
    );
    expectUpOverTop(L, 'BE5', 'F', 'A1', 'm-9');
    const channel = flowBetween(L, 'BE6', 'EE7').points[1]!.y;
    expect(bottom(L.box('L0')) - channel, 'the channel 15 px inside its lane').toBeGreaterThanOrEqual(15);
  });

  it('pools: a message flow into the top of a host keeps off the boundary event on its top border and its label', async () => {
    const doc = twoEventsDoc();
    runOps(doc, [
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
      { op: 'add', kind: 'participant', id: 'Cust', name: 'Customer' },
      start('CS', 'Order', { in: 'Cust' }),
      { op: 'add', kind: 'sendTask', id: 'CT', name: 'Send invoice', after: 'CS' },
      end('CE', 'CT', 'Sent'),
      { op: 'connect', source: 'CT', target: 'A1' },
    ]);
    // the customer's pool above: the message flow enters Pick invoice's top
    const collaboration = [...doc.byId()].find(([, el]) => is(el, 'bpmn:Collaboration'))![0];
    runOps(doc, [{ op: 'order', id: collaboration, pools: ['Cust', 'Org'] }]);
    const L = await layout('pools-boundary-top-border-message', doc);
    expectUpOverTop(L, 'BE12', 'F', 'A1', 'with a message flow into Pick invoice');
    const message = L.planes.flatMap((p) => p.edges).find((e) => is(e.el, 'bpmn:MessageFlow'))!;
    const ev = L.box('BE12'), label = L.shape('BE12').label!;
    expect(message.points[message.points.length - 1]!.y, 'into the top of Pick invoice').toBe(L.box('A1').y);
    for (const s of segments(message.points)) {
      expect(segmentHitsBox(s, ev, 0), `${JSON.stringify(s)} keeps off Payment failed`).toBe(false);
      expect(segmentHitsBox(s, label, 0), `${JSON.stringify(s)} keeps off its label`).toBe(false);
    }
    expect(L.report.crossings).toEqual([]);
  });

  it('a boundary event with a note keeps the bottom border (the note hangs below the host): its way goes over the top from there (r013 with a note on the timer)', async () => {
    const doc = paymentFailedDoc();
    runOps(doc, [{ op: 'add', kind: 'textAnnotation', id: 'N', text: 'Reminder after two days', to: 'BE12' }]);
    const lines: string[] = [];
    const L = await withLayoutDebug(
      (line) => lines.push(line),
      async () => layout('lanes-boundary-note-bottom', doc),
    );
    expect(lines.filter((l) => l.startsWith('[boundary] '))).toEqual([]);
    expect(cy(L.box('BE12'))).toBe(bottom(L.box('A1')));
    expectOverTop(L, 'BE12', 'F', 'A1', 'with a note');
    expect(L.box('N').y, 'the note below the host').toBeGreaterThan(bottom(L.box('A1')));
  });

  /** start -> "Poll status" -> end with a named self loop on the task. */
  function selfLoopDoc(): Doc {
    return proc([start('S'), task('A', 'Poll status', 'S'), end('E', 'A'), { op: 'connect', source: 'A', target: 'A', name: 'again' }]);
  }

  it('self loop is drawn as a small orthogonal loop under the task', async () => {
    const L = await layout('self-loop', selfLoopDoc());
    expectClean(L);
    expectStraightLine(L, ['S', 'A', 'E']);
    const loop = flowBetween(L, 'A', 'A');
    const a = L.box('A');
    expect(loop.points).toHaveLength(4);
    for (const p of loop.points) {
      expect(p.y).toBeGreaterThanOrEqual(bottom(a));
      expect(p.x).toBeGreaterThan(a.x);
      expect(p.x).toBeLessThan(right(a));
    }
    expect(loop.points[0]!.y).toBe(bottom(a));
    expect(loop.points[3]!.y).toBe(bottom(a));
  });

  // ENGINE DEFECT (route.ts flowLabel for back edges): the self-loop label is put left of the loop's right end,
  // inside the loop, where the loop's left vertical line runs through the text.
  it('self loop label sits outside the loop, clear of its lines', async () => {
    const L = await layout('self-loop-label', selfLoopDoc());
    expectClean(L);
    expectLabelsClear(L);
    const loop = flowBetween(L, 'A', 'A');
    const label = loop.label!;
    const loopY = Math.max(...loop.points.map((p) => p.y));
    expect(label.y).toBeGreaterThanOrEqual(loopY);
  });

  /** start -> "Approve request" -> "Archive" -> end; a non-interrupting timer (T) and an error (X) on the first task, each with a handler path. */
  function boundaryDoc(errorName?: string): Doc {
    return proc([
      start('S'),
      task('A', 'Approve request', 'S'),
      task('B', 'Archive', 'A'),
      end('E', 'B'),
      { op: 'add', kind: 'boundaryEvent:timer', id: 'T', name: 'after 1 day', on: 'A', timer: 'PT1D', nonInterrupting: true },
      task('R', 'Send reminder', 'T'),
      end('RE', 'R'),
      { op: 'add', kind: 'boundaryEvent:error', id: 'X', ...(errorName ? { name: errorName } : {}), on: 'A', error: 'ApprovalFailed' },
      task('H', 'Handle failure', 'X'),
      end('HE', 'H'),
    ]);
  }

  it('boundary events (non-interrupting timer + error) with handler paths below the host', async () => {
    const L = await layout('boundary', boundaryDoc());
    expectClean(L);
    expectLabelsClear(L);
    expectStraightLine(L, ['S', 'A', 'B', 'E']);
    const a = L.box('A');
    for (const b of ['T', 'X']) {
      const eb = L.box(b);
      // on the bottom border of the host, inside its width
      expect(cy(eb)).toBe(bottom(a));
      expect(eb.x).toBeGreaterThanOrEqual(a.x);
      expect(right(eb)).toBeLessThanOrEqual(right(a));
    }
    // label to the right of the event, below the host
    const tl = L.shape('T').label!;
    expect(tl.x).toBeGreaterThanOrEqual(right(L.box('T')));
    expect(tl.y).toBeGreaterThanOrEqual(bottom(a));
    expect(L.box('T').x).not.toBe(L.box('X').x);
    // handler paths are bands below the host, in declaration order, and start with a drop from the event
    expect(L.box('R').y).toBeGreaterThan(bottom(a));
    expect(L.box('H').y).toBeGreaterThan(bottom(L.box('R')));
    expectStraightLine(L, ['R', 'RE']);
    expectStraightLine(L, ['H', 'HE']);
    for (const [ev, handler] of [
      ['T', 'R'],
      ['X', 'H'],
    ] as const) {
      const drop = flowBetween(L, ev, handler);
      expect(drop.points[0]).toEqual({ x: cx(L.box(ev)), y: bottom(L.box(ev)) });
      expect(drop.points[drop.points.length - 1]!.y).toBe(cy(L.box(handler)));
    }
  });

  // ENGINE DEFECT (route.ts elementLabel 'boundary'): every boundary label goes right of its event, so with two
  // named boundary events on one host the label of the left one runs into the right event and its label.
  it('two named boundary events on one host: their labels collide with nothing', async () => {
    const L = await layout('boundary-two-names', boundaryDoc('failed'));
    expectClean(L);
    expectLabelsClear(L);
    const xl = L.shape('X').label!;
    expect(boxesOverlap(xl, L.box('T'))).toBe(false);
    expect(boxesOverlap(xl, L.shape('T').label!)).toBe(false);
  });

  // ENGINE DEFECT (route.ts elementLabel 'boundary' + label size estimate): a boundary name estimated at two
  // lines is anchored at the event's bottom, so the label box rises into the host activity.
  it('a long boundary event name stays below its host', async () => {
    const doc = proc([
      start('S'),
      { op: 'add', kind: 'serviceTask', id: 'Ship', name: 'Ship order', after: 'S' },
      end('E', 'Ship'),
      { op: 'add', kind: 'boundaryEvent:error', id: 'ShipFailed', name: 'carrier error', on: 'Ship', error: 'CarrierError' },
      { op: 'add', kind: 'userTask', id: 'Fix', name: 'Fix shipment', after: 'ShipFailed' },
      end('FE', 'Fix'),
    ]);
    const L = await layout('boundary-long-name', doc);
    expectClean(L);
    expectLabelsClear(L);
    expect(L.shape('ShipFailed').label!.y).toBeGreaterThanOrEqual(bottom(L.box('Ship')));
  });

  it('expanded nested sub-process with an internal loop', async () => {
    const doc = proc([
      start('S'),
      { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Handle item', after: 'S' },
      end('E', 'Sub'),
      start('S2', undefined, { in: 'Sub' }),
      task('T1', 'Try', 'S2'),
      { op: 'add', kind: 'subProcess', id: 'Inner', name: 'Inner work', after: 'T1' },
      { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'Done?', after: 'Inner' },
      end('E2', 'G', undefined, { flowName: 'yes' }),
      { op: 'connect', source: 'G', target: 'T1', name: 'retry' },
      start('S3', undefined, { in: 'Inner' }),
      task('T3', 'Work', 'S3'),
      end('E3', 'T3'),
    ]);
    const L = await layout('nested-sub-loop', doc);
    expectClean(L);
    expectLabelsClear(L);
    expect(L.planes).toHaveLength(1);
    expect(L.shape('Sub').expanded).toBe(true);
    expect(L.shape('Inner').expanded).toBe(true);
    expectStraightLine(L, ['S', 'Sub', 'E']);
    expectStraightLine(L, ['S2', 'T1', 'Inner', 'G', 'E2']);
    expectStraightLine(L, ['S3', 'T3', 'E3']);
    // children stay inside their (expanded) parent, with room for the header
    for (const id of ['S2', 'T1', 'Inner', 'G', 'E2']) expect(contains(L.box('Sub'), L.box(id)), `${id} inside Sub`).toBe(true);
    for (const id of ['S3', 'T3', 'E3']) expect(contains(L.box('Inner'), L.box(id)), `${id} inside Inner`).toBe(true);
    expect(L.box('S2').y).toBeGreaterThan(L.box('Sub').y + 30);
    // the internal loop stays inside the sub-process and goes around T1 .. G
    const loop = flowBetween(L, 'G', 'T1');
    expectRoutedAround(L, loop, ['T1', 'Inner', 'G'], 'T1');
    for (const p of loop.points) {
      expect(p.x).toBeGreaterThan(L.box('Sub').x);
      expect(p.x).toBeLessThan(right(L.box('Sub')));
      expect(p.y).toBeGreaterThan(L.box('Sub').y);
      expect(p.y).toBeLessThan(bottom(L.box('Sub')));
    }
  });

  it('a flow between two expanded sub-processes of one row is horizontal when their heights differ in parity', async () => {
    // a three-line title and a named gateway in the first row make Long even in height, Ship is odd: their centres differ by half a pixel
    const doc = proc([
      start('S'),
      { op: 'add', kind: 'subProcess', id: 'Long', name: 'Check the order and every item in it against the stock, the credit limit of the customer, the delivery dates we promised and the terms of the framework contract', after: 'S' },
      { op: 'add', kind: 'subProcess', id: 'Ship', name: 'Ship', after: 'Long' },
      task('T', 'Bill', 'Ship'),
      end('E', 'T'),
      start('S2', undefined, { in: 'Long' }),
      { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'Is it ok?', after: 'S2' },
      task('T1', 'Do it', 'G'),
      task('T2', 'Fix it', 'G'),
      start('S3', undefined, { in: 'Ship' }),
      task('T3', 'Pack', 'S3'),
    ]);
    const L = await layout('subprocess-row-parity', doc);
    expect(L.box('Long').height % 2).not.toBe(L.box('Ship').height % 2);
    expectClean(L);
    for (const [a, b] of [['Long', 'Ship'], ['Ship', 'T']]) {
      const pts = flowBetween(L, a!, b!).points;
      expect(pts, `${a} -> ${b}`).toHaveLength(2);
      expect(pts[0]!.y, `${a} -> ${b}`).toBe(pts[1]!.y);
    }
  });

  it('collapsed sub-process gets its own diagram whose plane holds the children', async () => {
    const doc = proc([
      start('S'),
      { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Details', after: 'S', collapsed: true },
      end('E', 'Sub'),
      start('S2', undefined, { in: 'Sub' }),
      task('T1', 'One', 'S2'),
      task('T2', 'Two', 'T1'),
      end('E2', 'T2'),
    ]);
    expect(collapsedIds(doc)).toEqual(['Sub']);
    const L = await layout('collapsed-sub', doc, { collapse: collapsedIds(doc) });
    expectClean(L);
    expectLabelsClear(L);
    expect(L.planes).toHaveLength(2);
    const [main, sub] = L.planes as [Plane, Plane];
    expect(idOf(main.el)).toBe('P');
    expect(idOf(sub.el)).toBe('Sub');
    expect(main.shapes.map((s) => s.id).sort()).toEqual(['E', 'S', 'Sub']);
    expect(sub.shapes.map((s) => s.id).sort()).toEqual(['E2', 'S2', 'T1', 'T2']);
    expect(sub.edges).toHaveLength(3);
    expect(main.shapes.find((s) => s.id === 'Sub')!.expanded).toBe(false);
    expectStraightLine(L, ['S', 'Sub', 'E']);
    expectStraightLine(L, ['S2', 'T1', 'T2', 'E2']);
    // the collapsed marker is a task-sized box, and the re-import remembers the collapse
    expect(L.box('Sub')).toMatchObject({ width: 100, height: 80 });
    expect(L.xml).toMatch(/bpmnElement="Sub"(?! isExpanded="true")/);
  });

  it('event sub-process sits below the main content', async () => {
    const doc = proc([
      start('S'),
      task('A', 'Do work', 'S'),
      task('B', 'More work', 'A'),
      end('E', 'B'),
      { op: 'add', kind: 'eventSubProcess', id: 'ES', name: 'On failure', in: 'P' },
      { op: 'add', kind: 'startEvent:error', id: 'ES_S', name: 'failed', in: 'ES', error: 'Failed' },
      task('ES_T', 'Clean up', 'ES_S'),
      end('ES_E', 'ES_T'),
    ]);
    const L = await layout('event-sub', doc);
    expectClean(L);
    expectLabelsClear(L);
    expectStraightLine(L, ['S', 'A', 'B', 'E']);
    expectStraightLine(L, ['ES_S', 'ES_T', 'ES_E']);
    const es = L.box('ES');
    expect(L.shape('ES').expanded).toBe(true);
    const mainBottom = Math.max(...['S', 'A', 'B', 'E'].map((id) => bottom(L.box(id))));
    expect(es.y).toBeGreaterThan(mainBottom);
    expect(es.x).toBeGreaterThanOrEqual(L.box('S').x);
    for (const id of ['ES_S', 'ES_T', 'ES_E']) expect(contains(es, L.box(id)), `${id} inside ES`).toBe(true);
  });

  it('collaboration: 2 pools + black box, pools stacked, message flows orthogonal', async () => {
    const doc = proc(
      [
        start('CS', 'Need goods'),
        task('C1', 'Place order', 'CS'),
        { op: 'add', kind: 'receiveTask', id: 'C2', name: 'Receive goods', after: 'C1' },
        end('CE', 'C2', 'Satisfied'),
        { op: 'add', kind: 'participant', id: 'Customer', name: 'Customer' },
        { op: 'add', kind: 'participant', id: 'Shop', name: 'Shop' },
        { op: 'add', kind: 'startEvent:message', id: 'SS', name: 'Order received', in: 'Process_Shop', message: 'Order' },
        task('S1', 'Process order', 'SS'),
        { op: 'add', kind: 'sendTask', id: 'S2', name: 'Ship goods', after: 'S1' },
        end('SE', 'S2'),
        { op: 'add', kind: 'participant', id: 'Bank', name: 'Bank', blackBox: true },
        { op: 'connect', source: 'C1', target: 'SS', name: 'order', message: 'Order' },
        { op: 'connect', source: 'S2', target: 'C2', name: 'goods' },
        { op: 'connect', source: 'S1', target: 'Bank', name: 'charge' },
      ],
      'P_Customer',
    );
    expect(doc.messageFlows()).toHaveLength(3);
    const L = await layout('collab', doc);
    expectClean(L);
    expectLabelsClear(L);
    expect(L.planes).toHaveLength(1);
    expect(idOf(L.planes[0]!.el)).toBe(doc.collaboration()!.get('id'));
    // named after the process of its first pool
    expect(idOf(L.planes[0]!.el)).toBe('Collaboration_Customer');
    const customer = L.box('Customer'), shop = L.box('Shop'), bank = L.box('Bank');
    // stacked vertically in declaration order, left-aligned, same width
    expect(customer.y + customer.height).toBeLessThan(shop.y);
    expect(shop.y + shop.height).toBeLessThan(bank.y);
    expect(new Set([customer.x, shop.x, bank.x]).size).toBe(1);
    expect(new Set([customer.width, shop.width, bank.width]).size).toBe(1);
    expect(bank.height).toBeLessThan(shop.height);
    // every node sits in its pool, right of the header
    for (const id of ['CS', 'C1', 'C2', 'CE']) expect(contains({ ...customer, x: customer.x + 30, width: customer.width - 30 }, L.box(id)), `${id} in Customer`).toBe(true);
    for (const id of ['SS', 'S1', 'S2', 'SE']) expect(contains({ ...shop, x: shop.x + 30, width: shop.width - 30 }, L.box(id)), `${id} in Shop`).toBe(true);
    expectStraightLine(L, ['CS', 'C1', 'C2', 'CE']);
    expectStraightLine(L, ['SS', 'S1', 'S2', 'SE']);
    // message flows dock on the top / bottom borders and the one to the black box ends on the pool
    for (const mf of L.out.messageFlows()) {
      const e = L.edge(idOf(mf));
      const s = L.box(idOf(mf.get<El>('sourceRef'))), t = L.box(idOf(mf.get<El>('targetRef')));
      const first = e.points[0]!, last = e.points[e.points.length - 1]!;
      expect([s.y, bottom(s)]).toContain(first.y);
      expect([t.y, bottom(t)]).toContain(last.y);
      expect(e.label).toBeDefined();
    }
  });

  /**
   * Three lanes, one pool. `lanes` maps every node to its lane; the flow is S -> A -> B -> C -> D -> F -> G -> E.
   * Returns the model and the lane boxes to check the nodes against.
   */
  function lanesDoc(lanes: Record<string, 'L1' | 'L2' | 'L3'>): Doc {
    const members = (lane: string): string[] => Object.keys(lanes).filter((id) => lanes[id] === lane);
    return proc([
      start('S'),
      task('A', 'Enter request', 'S'),
      task('B', 'Check budget', 'A'),
      task('C', 'Approve', 'B'),
      task('D', 'Order', 'C'),
      { op: 'add', kind: 'userTask', id: 'F', name: 'Sign off', after: 'D' },
      task('G', 'Confirm receipt', 'F'),
      end('E', 'G'),
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
      { op: 'add', kind: 'lane', id: 'L1', name: 'Employee', in: 'P', members: members('L1') },
      { op: 'add', kind: 'lane', id: 'L2', name: 'Controlling', in: 'P', members: members('L2') },
      { op: 'add', kind: 'lane', id: 'L3', name: 'Management', in: 'P', members: members('L3') },
    ]);
  }

  /** Lane conventions: horizontal bands filling the pool, nodes inside their lane, left to right, flows docked on sensible borders. */
  function expectLaneConventions(L: Laid, lanes: Record<string, 'L1' | 'L2' | 'L3'>): void {
    const pool = L.box('Org');
    const l1 = L.box('L1'), l2 = L.box('L2'), l3 = L.box('L3');
    // bands: same x and width, stacked without gaps, filling the pool right of its header
    expect(l1.x).toBe(l2.x);
    expect(l2.x).toBe(l3.x);
    expect(l1.width).toBe(l2.width);
    expect(bottom(l1)).toBe(l2.y);
    expect(bottom(l2)).toBe(l3.y);
    expect(l1.y).toBe(pool.y);
    expect(bottom(l3)).toBe(bottom(pool));
    expect(l1.x).toBe(pool.x + 30);
    expect(right(l1)).toBe(right(pool));
    const boxes = { L1: l1, L2: l2, L3: l3 };
    for (const [id, lane] of Object.entries(lanes)) expect(contains(boxes[lane], L.box(id)), `${id} inside ${lane}`).toBe(true);
    // still left to right, and the nodes of one lane line up
    const order = ['S', 'A', 'B', 'C', 'D', 'F', 'G', 'E'];
    for (let i = 0; i + 1 < order.length; i++) expect(L.box(order[i + 1]!).x).toBeGreaterThan(right(L.box(order[i]!)));
    for (const lane of ['L1', 'L2', 'L3']) {
      const ys = Object.keys(lanes).filter((id) => lanes[id] === lane).map((id) => cy(L.box(id)));
      expect(new Set(ys).size, `nodes of ${lane} on one line`).toBe(1);
    }
    // every flow leaves through the right or bottom border and enters through the left, top or bottom border
    for (const flow of L.out.allSequenceFlows()) {
      const e = L.edge(idOf(flow));
      const s = L.box(idOf(flow.get<El>('sourceRef'))), t = L.box(idOf(flow.get<El>('targetRef')));
      const first = e.points[0]!, last = e.points[e.points.length - 1]!;
      expect(first.x === right(s) || first.y === bottom(s), `${e.id} leaves ${idOf(flow.get<El>('sourceRef'))} right or below`).toBe(true);
      expect(last.x === t.x || last.y === bottom(t) || last.y === t.y, `${e.id} enters ${idOf(flow.get<El>('targetRef'))} left, above or below`).toBe(true);
    }
  }

  it('lanes (3) with a zig-zag flow: lanes are horizontal bands, nodes stay in their lane', async () => {
    // Employee -> Controlling -> Management -> Controlling -> Employee -> Employee -> Management -> Employee
    const lanes = { S: 'L1', A: 'L2', B: 'L3', C: 'L2', D: 'L1', F: 'L1', G: 'L3', E: 'L1' } as const;
    const L = await layout('lanes-zigzag', lanesDoc(lanes));
    expectClean(L);
    expectLabelsClear(L);
    expectLaneConventions(L, lanes);
  });

  // ENGINE DEFECT (route.ts: entryX and exitX are both the node centre): at a peak (D: in from the lane below,
  // out to the lane below) the incoming and the outgoing flow share the vertical line under D, which reads as
  // one line with an arrow in the middle.
  it('lanes zig-zag with a peak: the flows into and out of the peak do not share a line', async () => {
    // Employee -> Controlling -> Management -> Controlling -> Employee (peak) -> Management -> Employee
    const lanes = { S: 'L1', A: 'L2', B: 'L3', C: 'L2', D: 'L1', F: 'L3', G: 'L1', E: 'L1' } as const;
    const L = await layout('lanes-peak', lanesDoc(lanes));
    expectClean(L);
    expectLabelsClear(L);
    expectLaneConventions(L, lanes);
  });

  it('lanes: a loop below the last row of a lane runs inside the lane, which grows around its channel', async () => {
    // Done? loops back into the join J, whose bottom vertex Check credit in the lane below rises into; Again? loops into the free merge M
    const loops = (merge: boolean): Doc =>
      proc([
        start('S', 'Start'),
        { op: 'split', after: 'S', id: 'G', name: 'Kind?', joinId: 'J', branches: [{ flowName: 'A', nodes: [{ kind: 'task', id: 'A', name: 'Offer' }] }, { flowName: 'B', nodes: [{ kind: 'task', id: 'B', name: 'Check credit' }] }] },
        task('T', 'Process', 'J'),
        { op: 'add', kind: 'exclusiveGateway', id: 'C', name: 'Done?', after: 'T' },
        ...(merge
          ? [
              { op: 'add', kind: 'exclusiveGateway', id: 'M', after: 'C', flowName: 'yes' } as AddOp,
              task('U', 'Update', 'M'),
              { op: 'add', kind: 'exclusiveGateway', id: 'K', name: 'Again?', after: 'U' } as AddOp,
              end('E', 'K', 'End', { flowName: 'no' }),
              { op: 'connect', source: 'K', target: 'M', name: 'yes' } as Op,
            ]
          : [end('E', 'C', 'End', { flowName: 'yes' })]),
        { op: 'connect', source: 'C', target: 'J', name: 'no' },
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L1', name: 'Sales', in: 'P', members: ['S', 'G', 'A', 'J', 'T', 'C', 'E', ...(merge ? ['M', 'U', 'K'] : [])] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Review', in: 'P', members: ['B'] },
      ]);
    for (const [name, merge, flows] of [
      ['lane-loop-join', false, [['C', 'J']]],
      ['lane-loop-merge', true, [['C', 'J'], ['K', 'M']]],
    ] as const) {
      const L = await layout(name, loops(merge));
      expectClean(L);
      const l1 = L.box('L1');
      expect(bottom(l1), name).toBe(L.box('L2').y);
      for (const [from, to] of flows) {
        const y = longestHorizontalY(flowBetween(L, from, to).points)!;
        expect(y, `${name} ${from} -> ${to}`).toBeGreaterThan(bottom(L.box(to)));
        expect(y, `${name} ${from} -> ${to}`).toBeLessThanOrEqual(bottom(l1) - 15);
      }
    }
  });

  it('lanes: a loop over the first row of a lane runs inside the lane, which grows above its channel', async () => {
    // the branch Book -> Bill runs under Work and Check, so Ok? loops back to Work over the top; in the first lane and in the second
    for (const first of [true, false]) {
      const main = ['S', 'G', 'T', 'T2', 'B1', 'B2', 'J', 'C', 'E'];
      const doc = proc([
        start('S', 'Start'),
        { op: 'split', after: 'S', kind: 'parallelGateway', id: 'G', joinId: 'J', branches: [{ nodes: [{ kind: 'task', id: 'T', name: 'Work' }, { kind: 'task', id: 'T2', name: 'Check' }] }, { nodes: [{ kind: 'task', id: 'B1', name: 'Book' }, { kind: 'task', id: 'B2', name: 'Bill' }] }] },
        { op: 'add', kind: 'exclusiveGateway', id: 'C', name: 'Ok?', after: 'J' },
        end('E', 'C', 'End', { flowName: 'yes' }),
        { op: 'connect', source: 'C', target: 'T' },
        start('S2', 'Start 2'),
        task('P2', 'Archive', 'S2'),
        end('E2', 'P2', 'Done 2'),
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L1', name: 'One', in: 'P', members: first ? main : ['S2', 'P2', 'E2'] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Two', in: 'P', members: first ? ['S2', 'P2', 'E2'] : main },
      ]);
      const L = await layout(`lane-loop-top-${first ? 'first' : 'second'}`, doc);
      expectClean(L);
      const lane = L.box(first ? 'L1' : 'L2');
      expect(bottom(L.box('L1'))).toBe(L.box('L2').y);
      const y = longestHorizontalY(flowBetween(L, 'C', 'T').points)!;
      expect(y, `first lane: ${first}`).toBeLessThan(L.box('T').y);
      expect(y, `first lane: ${first}`).toBeGreaterThanOrEqual(lane.y + 15);
    }
  });

  /** Every end point of the sequence flows lies on the border of its shape. */
  function expectFlowsAttached(L: Laid): void {
    const onBorder = (p: Point, b: Box): boolean =>
      p.x >= b.x && p.x <= right(b) && p.y >= b.y && p.y <= bottom(b) && (p.x === b.x || p.x === right(b) || p.y === b.y || p.y === bottom(b));
    for (const flow of L.out.allSequenceFlows()) {
      const e = L.edge(idOf(flow));
      const s = idOf(flow.get<El>('sourceRef')), t = idOf(flow.get<El>('targetRef'));
      expect(onBorder(e.points[0]!, L.box(s)), `${e.id} starts on ${s}`).toBe(true);
      expect(onBorder(e.points[e.points.length - 1]!, L.box(t)), `${e.id} ends on ${t}`).toBe(true);
    }
  }

  /** The loop `source` -> `target` runs inside `laneId` 15 px from its borders; its name 4 px above its run, inside the lane. */
  function expectLoopInLane(L: Laid, source: string, target: string, laneId: string, named = true): void {
    const e = flowBetween(L, source, target), lane = L.box(laneId);
    for (const [p, q] of segments(e.points)) {
      if (p.y !== q.y) continue;
      expect(p.y, `${e.id} runs inside ${laneId}`).toBeGreaterThanOrEqual(lane.y + 15);
      expect(p.y, `${e.id} runs inside ${laneId}`).toBeLessThanOrEqual(bottom(lane) - 15);
    }
    if (!named) return;
    expect(bottom(e.label!), `${e.id} label next to its run`).toBe(longestHorizontalY(e.points)! - 4);
    expect(contains(lane, e.label!), `${e.id} label inside ${laneId}`).toBe(true);
  }

  it('lanes: a named loop over the first row of the second lane takes its label along when the lane grows above it', async () => {
    // the router lays the channel of Ok? -> Work on the lane divider, its label above it in the first lane
    const doc = proc([
      start('S', 'Start'),
      { op: 'split', after: 'S', kind: 'parallelGateway', id: 'G', joinId: 'J', branches: [{ nodes: [{ kind: 'task', id: 'T', name: 'Work' }, { kind: 'task', id: 'T2', name: 'Check' }] }, { nodes: [{ kind: 'task', id: 'B1', name: 'Book' }, { kind: 'task', id: 'B2', name: 'Bill' }] }] },
      { op: 'add', kind: 'exclusiveGateway', id: 'C', name: 'Ok?', after: 'J' },
      end('E', 'C', 'End', { flowName: 'yes' }),
      { op: 'connect', source: 'C', target: 'T', name: 'no, redo' },
      start('S2', 'Start 2'),
      task('P2', 'Archive', 'S2'),
      end('E2', 'P2', 'Done 2'),
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
      { op: 'add', kind: 'lane', id: 'L1', name: 'One', in: 'P', members: ['S2', 'P2', 'E2'] },
      { op: 'add', kind: 'lane', id: 'L2', name: 'Two', in: 'P', members: ['S', 'G', 'T', 'T2', 'B1', 'B2', 'J', 'C', 'E'] },
    ]);
    const L = await layout('lane-loop-top-label', doc);
    expectClean(L);
    expectFlowsAttached(L);
    expect(longestHorizontalY(flowBetween(L, 'C', 'T').points)!).toBeLessThan(L.box('T').y);
    expectLoopInLane(L, 'C', 'T', 'L2');
  });

  it('lanes: nested named loops over the first row of the second lane take their labels along', async () => {
    // Really ok? -> Work runs over Ok? -> Check, both over the top: the outer label lay 49 px above its run, in the first lane
    const doc = proc([
      start('S', 'Start'),
      { op: 'split', after: 'S', kind: 'parallelGateway', id: 'G', joinId: 'J', branches: [{ nodes: [{ kind: 'task', id: 'T', name: 'Work' }, { kind: 'task', id: 'T2', name: 'Check' }] }, { nodes: [{ kind: 'task', id: 'B1', name: 'Book' }, { kind: 'task', id: 'B2', name: 'Bill' }] }] },
      { op: 'add', kind: 'exclusiveGateway', id: 'C', name: 'Ok?', after: 'J' },
      { op: 'add', kind: 'exclusiveGateway', id: 'C2', name: 'Really ok?', after: 'C', flowName: 'yes' },
      end('E', 'C2', 'End', { flowName: 'yes' }),
      { op: 'connect', source: 'C', target: 'T2', name: 'recheck' },
      { op: 'connect', source: 'C2', target: 'T', name: 'redo all' },
      start('S2', 'Start 2'),
      task('P2', 'Archive', 'S2'),
      task('P3', 'Store', 'P2', { flowName: 'to the store' }),
      end('E2', 'P3', 'Done 2'),
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
      { op: 'add', kind: 'lane', id: 'L1', name: 'One', in: 'P', members: ['S2', 'P2', 'P3', 'E2'] },
      { op: 'add', kind: 'lane', id: 'L2', name: 'Two', in: 'P', members: ['S', 'G', 'T', 'T2', 'B1', 'B2', 'J', 'C', 'C2', 'E'] },
    ]);
    const L = await layout('lane-loops-top-nested', doc);
    expectClean(L);
    expectFlowsAttached(L);
    for (const [from, to] of [['C', 'T2'], ['C2', 'T']] as const) {
      expect(longestHorizontalY(flowBetween(L, from, to).points)!).toBeLessThan(L.box(to).y);
      expectLoopInLane(L, from, to, 'L2');
    }
  });

  it('lanes: a named self loop in a lane that is not the last keeps its label, below the run, inside the lane', async () => {
    const doc = proc([
      start('S', 'Start'),
      task('T', 'Poll status', 'S'),
      task('B', 'Book', 'T'),
      end('E', 'B', 'Done'),
      { op: 'connect', source: 'T', target: 'T', name: 'call again' },
      start('S3', 'Start 3'),
      task('X', 'Archive', 'S3'),
      end('E3', 'X', 'Done 3'),
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
      { op: 'add', kind: 'lane', id: 'L1', name: 'One', in: 'P', members: ['S3', 'X', 'E3'] },
      { op: 'add', kind: 'lane', id: 'L2', name: 'Two', in: 'P', members: ['S', 'T', 'B', 'E'] },
      { op: 'add', kind: 'lane', id: 'L3', name: 'Three', in: 'P', members: [] },
    ]);
    const L = await layout('lane-self-loop-label', doc);
    expectClean(L);
    expectFlowsAttached(L);
    const loop = flowBetween(L, 'T', 'T');
    expect(loop.label!.y).toBeGreaterThan(longestHorizontalY(loop.points)!);
    expect(contains(L.box('L2'), loop.label!), 'label inside L2').toBe(true);
    expect(bottom(L.box('L2'))).toBe(L.box('L3').y);
  });

  it('lanes: the label of the next lane\'s loop on the divider does not push a lane\'s event sub-process down', async () => {
    const doc = proc([
      start('S2', 'Start 2'),
      task('P2', 'Receive', 'S2'),
      end('E2', 'P2', 'Done 2'),
      { op: 'add', kind: 'eventSubProcess', id: 'ES', name: 'Cancel handling', in: 'P' },
      { op: 'add', kind: 'startEvent:message', id: 'ES_S', name: 'Cancelled', in: 'ES', message: 'Cancel' },
      task('ES_T', 'Undo', 'ES_S'),
      end('ES_E', 'ES_T'),
      start('S', 'Start'),
      { op: 'split', after: 'S', kind: 'parallelGateway', id: 'G', joinId: 'J', branches: [{ nodes: [{ kind: 'task', id: 'T', name: 'Work' }, { kind: 'task', id: 'T2', name: 'Check' }] }, { nodes: [{ kind: 'task', id: 'B1', name: 'Book' }] }] },
      { op: 'add', kind: 'exclusiveGateway', id: 'C', name: 'Ok?', after: 'J' },
      end('E', 'C', 'End', { flowName: 'yes' }),
      { op: 'connect', source: 'C', target: 'T', name: 'no, do the whole work again' },
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
      { op: 'add', kind: 'lane', id: 'L1', name: 'One', in: 'P', members: ['S2', 'P2', 'E2', 'ES'] },
      { op: 'add', kind: 'lane', id: 'L2', name: 'Two', in: 'P', members: ['S', 'G', 'T', 'T2', 'B1', 'J', 'C', 'E'] },
    ]);
    const L = await layout('lane-event-sub-loop-label', doc);
    expectFlowsAttached(L);
    const loop = flowBetween(L, 'C', 'T');
    expect(contains(L.box('L2'), loop.label!), 'loop label inside L2').toBe(true);
    // the event sub-process sits one vertical gap below its lane's content, not below the other lane's label
    const content = Math.max(...['S2', 'P2', 'E2'].map((id) => bottom(L.box(id))));
    expect(L.box('ES').y).toBeLessThanOrEqual(content + 60);
    expect(contains(L.box('L1'), L.box('ES'))).toBe(true);
  });

  it('lanes: a loop below the first lane and one over the second lane each stay in their lane, attached to their nodes', async () => {
    // Again? -> Archive runs on the divider, so the router lays Ok? -> Work over the top higher, inside lane One (on Archive's bottom)
    for (const named of [true, false]) {
      const doc = proc([
        start('S', 'Start'),
        { op: 'split', after: 'S', kind: 'parallelGateway', id: 'G', joinId: 'J', branches: [{ nodes: [{ kind: 'task', id: 'T', name: 'Work' }, { kind: 'task', id: 'T2', name: 'Check' }] }, { nodes: [{ kind: 'task', id: 'B1', name: 'Book' }, { kind: 'task', id: 'B2', name: 'Bill' }] }] },
        { op: 'add', kind: 'exclusiveGateway', id: 'C', name: 'Ok?', after: 'J' },
        end('E', 'C', 'End', { flowName: 'yes' }),
        { op: 'connect', source: 'C', target: 'T', ...(named ? { name: 'no, redo' } : {}) },
        start('S2', 'Start 2'),
        task('P2', 'Archive', 'S2'),
        { op: 'add', kind: 'exclusiveGateway', id: 'K2', name: 'Again?', after: 'P2' },
        end('E2', 'K2', 'Done 2', { flowName: 'no' }),
        { op: 'connect', source: 'K2', target: 'P2', name: 'retry archive' },
        { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
        { op: 'add', kind: 'lane', id: 'L1', name: 'One', in: 'P', members: ['S2', 'P2', 'K2', 'E2'] },
        { op: 'add', kind: 'lane', id: 'L2', name: 'Two', in: 'P', members: ['S', 'G', 'T', 'T2', 'B1', 'B2', 'J', 'C', 'E'] },
      ]);
      const L = await layout(`lane-loops-two-lanes${named ? '-named' : ''}`, doc);
      expectClean(L);
      expectFlowsAttached(L);
      expect(bottom(L.box('L1'))).toBe(L.box('L2').y);
      expect(longestHorizontalY(flowBetween(L, 'K2', 'P2').points)!).toBeGreaterThan(bottom(L.box('P2')));
      expectLoopInLane(L, 'K2', 'P2', 'L1');
      expect(longestHorizontalY(flowBetween(L, 'C', 'T').points)!).toBeLessThan(L.box('T').y);
      expectLoopInLane(L, 'C', 'T', 'L2', named);
    }
  });

  /**
   * The maintainer's model r013 (generated): Pick invoice -> parallel split -> (Pack order -> Inform order), (Notify
   * data -> Book data) -> join -> Pack data -> End. With `lanes` the split, Inform order and Notify data are in lane 0,
   * Book data in lane 1, Pack order in lane 2 (and lane 3 is empty); `full`: with r013's boundary paths (an error on
   * Inform order with Approve goods -> Archive case into the join, Approve goods writing Record; a timer on Pick
   * invoice into Pack data) and its event sub-process.
   */
  function splitLanesDoc(lanes: boolean, full: boolean): Doc {
    return proc([
      start('S', 'Start'),
      { op: 'add', kind: 'userTask', id: 'A1', name: 'Pick invoice', after: 'S' },
      { op: 'split', after: 'A1', kind: 'parallelGateway', id: 'G2', joinId: 'J3', branches: [{ nodes: [{ kind: 'task', id: 'T4', name: 'Pack order' }, { kind: 'sendTask', id: 'T5', name: 'Inform order' }] }, { nodes: [{ kind: 'serviceTask', id: 'T6', name: 'Notify data' }, { kind: 'task', id: 'T7', name: 'Book data' }] }] },
      task('F', 'Pack data', 'J3'),
      end('E', 'F', 'End'),
      ...(full
        ? ([
            { op: 'add', kind: 'boundaryEvent:error', id: 'BE8', on: 'T5', name: '2 days', error: 'Failure' },
            { op: 'add', kind: 'serviceTask', id: 'H9', name: 'Approve goods', after: 'BE8' },
            { op: 'add', kind: 'serviceTask', id: 'H10', name: 'Archive case', after: 'H9' },
            { op: 'add', kind: 'dataObjectReference', id: 'DS11', name: 'Record', in: 'P' },
            { op: 'connect', source: 'H9', target: 'DS11' },
            { op: 'connect', source: 'H10', target: 'J3' },
            { op: 'add', kind: 'boundaryEvent:timer', id: 'BE12', on: 'A1', name: 'Payment failed', timer: 'P2D', nonInterrupting: true },
            { op: 'connect', source: 'BE12', target: 'F' },
            { op: 'add', kind: 'eventSubProcess', id: 'ES', name: 'On cancel', in: 'P' },
            { op: 'add', kind: 'startEvent:signal', id: 'ESS', name: 'Cancel', in: 'ES', signal: 'Stop' },
            task('EST', 'Cancel order', 'ESS'),
            end('ESE', 'EST', 'Cancelled'),
          ] as Op[])
        : []),
      ...(lanes
        ? ([
            { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
            { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: ['S', 'A1', 'T5', 'T6', 'G2', 'J3', 'F', 'E', ...(full ? ['H9', 'H10'] : [])] },
            { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: ['T7'] },
            { op: 'add', kind: 'lane', id: 'L2', name: 'Lane 2', in: 'P', members: ['T4', ...(full ? ['ES'] : [])] },
            { op: 'add', kind: 'lane', id: 'L3', name: 'Lane 3', in: 'P', members: [] },
          ] as Op[])
        : []),
    ]);
  }

  it('lanes: a split whose happy path runs on in another lane sends its branch in its own lane out through its right vertex: Notify data moves up onto the split\'s row (r013)', async () => {
    for (const full of [false, true]) {
      const what = full ? 'r013' : 'r013 without its boundary paths';
      const lines: string[] = [];
      const L = await withLayoutDebug(
        (line) => lines.push(line),
        async () => layout(`lanes-split-branch-up${full ? '-r013' : ''}`, splitLanesDoc(true, full)),
      );
      const g = L.box('G2'), notify = L.box('T6');
      expect(cy(notify), what).toBe(cy(g));
      expect(flowBetween(L, 'G2', 'T6').points, what).toEqual([{ x: right(g), y: cy(g) }, { x: notify.x, y: cy(g) }]);
      // the happy path's branch drops from the bottom vertex into lane 2, Notify data's flow drops into lane 1
      expect(flowBetween(L, 'G2', 'T4').points[0], what).toEqual({ x: cx(g), y: bottom(g) });
      expect(flowBetween(L, 'T6', 'T7').points[0], what).toEqual({ x: cx(notify), y: bottom(notify) });
      expect(contains(L.box('L0'), notify), what).toBe(true);
      expectStraightLine(L, ['S', 'A1', 'G2', 'T6']);
      // the move adds no crossing (the routes measured before and after it)
      const trial = lines.find((l) => l.startsWith('[lifts] T6 '));
      expect(trial, what).toMatch(/^\[lifts\] T6 moves up onto row 0/);
      const [, was, now] = /: (\{.*?\}) -> (\{.*?\})/.exec(trial!)!;
      expect((JSON.parse(now!) as { crossings: number }).crossings, what).toBeLessThanOrEqual((JSON.parse(was!) as { crossings: number }).crossings);
      expect(L.report.through, what).toEqual([]);
      expect(L.report.overlaps, what).toEqual([]);
      // with the boundary paths the timer path goes over the top from Pick invoice's top border (it crosses nothing), and
      // the crossing the lanes force stays
      if (full) expect(L.report.crossings, what).toEqual(['Flow_PackOrderToInformOrderxFlow_BookDataToGateway']);
      if (!full) {
        // only the crossing the lanes force: Pack order's way up into Inform order crosses Book data's into the join
        expect(L.report.crossings).toEqual(['Flow_PackOrderToInformOrderxFlow_BookDataToGateway']);
        expect(L.report.inOutOverlaps).toEqual([]);
        expectLabelsClear(L);
      }
    }
  });

  it('without lanes the happy path takes the split\'s row: the other branch stays on its own row below', async () => {
    const L = await layout('split-branch-no-lanes', splitLanesDoc(false, false));
    expectClean(L);
    expectStraightLine(L, ['S', 'A1', 'G2', 'T4', 'T5', 'J3', 'F', 'E']);
    expect(L.box('T6').y).toBeGreaterThan(bottom(L.box('T4')));
  });

  it('lanes: a branch stays below where the happy path\'s flow runs along the split\'s row past the columns its other nodes leave empty', async () => {
    // agent__o2c without its other lanes: ok runs from Credit ok? straight along the row to the parallel split; not ok's
    // Request prepayment would take a cell of that row (moved up, it bent the happy path into a band under the row)
    const lines: string[] = [];
    const L = await withLayoutDebug(
      (line) => lines.push(line),
      async () =>
        layout(
          'lanes-split-branch-stays-happy-line',
          proc([
            start('S', 'Order received'),
            task('C', 'Check credit', 'S'),
            { op: 'add', kind: 'exclusiveGateway', id: 'D', name: 'Credit ok?', after: 'C' },
            { op: 'add', kind: 'parallelGateway', id: 'M', after: 'D', flowName: 'ok' },
            task('R', 'Request prepayment', 'D', { flowName: 'not ok' }),
            task('W', 'Wait for prepayment', 'R'),
            { op: 'connect', source: 'W', target: 'M' },
            task('I', 'Create invoice', 'M'),
            task('K', 'Pick and pack', 'M'),
            { op: 'add', kind: 'parallelGateway', id: 'Q', after: 'I' },
            { op: 'connect', source: 'K', target: 'Q' },
            end('E', 'Q', 'Done'),
            { op: 'add', kind: 'participant', id: 'Org', name: 'Shop' },
            { op: 'add', kind: 'lane', id: 'L1', name: 'Finance', in: 'P', members: ['S', 'C', 'D', 'M', 'R', 'W', 'I', 'Q', 'E'] },
            { op: 'add', kind: 'lane', id: 'L2', name: 'Warehouse', in: 'P', members: ['K'] },
          ]),
        ),
    );
    expect(lines.filter((l) => l.startsWith('[lifts] R '))).toEqual([]);
    const d = L.box('D'), m = L.box('M');
    expect(flowBetween(L, 'D', 'M').points).toEqual([{ x: right(d), y: cy(d) }, { x: m.x, y: cy(d) }]);
    expect(L.box('R').y).toBeGreaterThan(bottom(d));
    expectClean(L);
  });

  /**
   * Generated (p035) in small: Notify data (an error path Notify invoice -> Stopped) -> Approve customer -> Pack
   * customer? (b0: Book data in lane 2 -> Archive claim in lane 1; b1: Pick order; b2: Pick customer) -> join -> End,
   * the rest in lane 0. Stopped lies under the split, so b0 leaves it through its right vertex, right, down.
   */
  function sharedVertexDoc(): Doc {
    return proc([
      start('S', 'Start'),
      task('A', 'Notify data', 'S'),
      { op: 'add', kind: 'boundaryEvent:error', id: 'BE', on: 'A', name: 'Failed', error: 'Failure' },
      task('N', 'Notify invoice', 'BE'),
      end('X', 'N', 'Stopped'),
      task('B', 'Approve customer', 'A'),
      { op: 'split', after: 'B', kind: 'inclusiveGateway', id: 'G', joinId: 'J', name: 'Pack customer?', branches: [{ flowName: 'b0', nodes: [{ kind: 'task', id: 'T8', name: 'Book data' }, { kind: 'task', id: 'T9', name: 'Archive claim' }] }, { flowName: 'b1', nodes: [{ kind: 'task', id: 'T10', name: 'Pick order' }] }, { flowName: 'b2', nodes: [{ kind: 'task', id: 'T11', name: 'Pick customer' }] }] },
      end('E', 'J', 'End'),
      { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
      { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: ['S', 'A', 'N', 'X', 'B', 'G', 'T10', 'T11', 'J', 'E'] },
      { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: ['T9'] },
      { op: 'add', kind: 'lane', id: 'L2', name: 'Lane 2', in: 'P', members: ['T8'] },
    ]);
  }

  it('lanes: a branch stays below where its flow, moved up, would leave the split through the vertex the happy path\'s way down takes (p035)', async () => {
    // moved up, Pick order's flow would run on b0's first piece out of the right vertex, its label on b0's
    const lines: string[] = [];
    const L = await withLayoutDebug(
      (line) => lines.push(line),
      async () => layout('lanes-split-branch-stays-shared-vertex', sharedVertexDoc()),
    );
    expect(lines.filter((l) => l.startsWith('[lifts]')).map((l) => l.split(':')[0])).toEqual(['[lifts] T10 stays', '[lifts] T11 stays']);
    const g = L.box('G');
    expect(flowBetween(L, 'G', 'T8').points[0]).toEqual({ x: right(g), y: cy(g) });
    for (const id of ['T10', 'T11']) expect(flowBetween(L, 'G', id).points[0], id).toEqual({ x: cx(g), y: bottom(g) });
    expect(L.report.labelClashes).toEqual([]);
    expect(L.report.inOutOverlaps).toEqual([]);
  });

  /** The rows of a scope laid out again by lane, as engine.ts applyLanes does (each lane's rows stacked from its top), the lanes in the order of `lanes`. */
  function arrangeByLane(scope: ScopeLayout, lanes: string[][]): () => void {
    const of = lanes.map((ids) => scope.nodes.filter((n) => ids.includes(n.id)));
    return () => {
      let y = 0;
      const bands = of.map((nodes) => {
        const top = y;
        let rowY = y + 30;
        for (const r of [...new Set(nodes.map((n) => n.row))].sort((a, b) => a - b)) {
          const inRow = nodes.filter((n) => n.row === r);
          const rh = Math.max(...inRow.map((n) => n.height + (n.boundary.length ? 38 : 0)));
          for (const n of inRow) shiftNode(n, 0, Math.round(rowY + rh / 2 - n.height / 2 - n.box.y));
          rowY += rh + 60;
        }
        y = Math.max(rowY - 30, top + 120);
        return { nodes: new Set(nodes), top, bottom: y };
      });
      scope.height = y;
      placeAttachedArtifacts(scope);
      scope.laneBands = bands;
    };
  }

  it('a branch\'s move up that is not kept is undone exactly; one that is kept leaves the branch on the split\'s row', async () => {
    const laneIds = (doc: Doc): string[][] => many(many(doc.require('P'), 'laneSets')[0]!, 'lanes').map((l) => (l.get<El[] | undefined>('flowNodeRef') ?? []).map(idOf));
    /** the scope arranged by lane, then liftChains on it: the debug lines, and whether it changed anything the arrangement sets */
    const run = async (doc: Doc): Promise<{ scope: ScopeLayout; changed: boolean; lines: string[] }> => {
      const scope = layoutScope(doc.require('P'), { expanded: new Set(), collapsedScopes: new Map() });
      const state = (): string =>
        JSON.stringify({
          nodes: scope.nodes.flatMap((n) => [n, ...n.boundary]).map((n) => [n.id, n.layer, n.row, n.band, n.width, n.box, n.topUsed]),
          edges: scope.edges.map((e) => [e.id, e.bandRow, e.bandY, e.points, e.label, e.runsBelow]),
          artifacts: scope.artifacts.map((a) => a.box),
          size: [scope.width, scope.height],
          lanes: scope.laneBands!.map((b) => [b.top, b.bottom]),
        });
      const arrange = arrangeByLane(scope, laneIds(doc));
      arrange();
      const arranged = state();
      const lines: string[] = [];
      await withLayoutDebug(
        (line) => lines.push(line),
        async () => liftChains(scope, arrange),
      );
      return { scope, changed: state() !== arranged, lines };
    };
    // the routes of the trials share the right vertex: both moves are tried (routed) and undone
    const rejected = await run(sharedVertexDoc());
    expect(rejected.lines.map((l) => l.split(':')[0])).toEqual(['[lifts] T10 stays', '[lifts] T11 stays']);
    expect(rejected.lines.every((l) => / stays: \{/.test(l))).toBe(true);
    expect(rejected.changed).toBe(false);
    const kept = await run(splitLanesDoc(true, false));
    expect(kept.lines.map((l) => l.split(':')[0])).toEqual(['[lifts] T6 moves up onto row 0']);
    expect(kept.changed).toBe(true);
    const node = (id: string): GNode => kept.scope.nodes.find((n) => n.id === id)!;
    expect(node('T6').row).toBe(node('G2').row);
    expect(cy(node('T6').box)).toBe(cy(node('G2').box));
  });

  it('data object and data store hang below their tasks with associations', async () => {
    const doc = proc([
      start('S'),
      task('A', 'Create order', 'S'),
      task('B', 'Check order', 'A'),
      task('C', 'Store order', 'B'),
      end('E', 'C'),
      { op: 'add', kind: 'dataObject', id: 'DO', name: 'Order', in: 'P' },
      { op: 'connect', source: 'A', target: 'DO' },
      { op: 'connect', source: 'DO', target: 'B' },
      { op: 'add', kind: 'dataStore', id: 'DS', name: 'Orders DB', in: 'P' },
      { op: 'connect', source: 'C', target: 'DS' },
    ]);
    const L = await layout('data', doc);
    expectClean(L);
    expectLabelsClear(L);
    expectStraightLine(L, ['S', 'A', 'B', 'C', 'E']);
    const spineBottom = Math.max(...['A', 'B', 'C'].map((id) => bottom(L.box(id))));
    expect(L.box('DO').y).toBeGreaterThan(spineBottom);
    expect(L.box('DS').y).toBeGreaterThan(spineBottom);
    expect(L.box('DO').x).toBeLessThan(L.box('DS').x);
    expect(L.shape('DO').label!.y).toBeGreaterThanOrEqual(bottom(L.box('DO')));
    const dataEdges = L.planes[0]!.edges.filter((e) => is(e.el, 'bpmn:DataAssociation'));
    expect(dataEdges).toHaveLength(3);
    for (const e of dataEdges) expect(e.points).toHaveLength(2);
    // the association ends on the borders of the artifact and the task
    const outA = dataEdges.find((e) => is(e.el, 'bpmn:DataOutputAssociation') && e.ends.has('A'))!;
    expect(outA.points[1]!.y).toBe(L.box('DO').y);
    expect(outA.points[0]!.y).toBe(bottom(L.box('A')));
  });

  /** start -> "Check twice" -> "Send" -> end with a note on the task (N1) and a note on the flow between the tasks (N2). */
  function annotatedDoc(): Doc {
    return proc([
      start('S'),
      task('A', 'Check twice', 'S'),
      task('B', 'Send', 'A', { flowId: 'F_AB' }),
      end('E', 'B'),
      { op: 'add', kind: 'textAnnotation', id: 'N1', text: 'Four eyes principle applies here', to: 'A' },
      { op: 'add', kind: 'textAnnotation', id: 'N2', text: 'via the message queue', to: 'F_AB' },
    ]);
  }

  it('text annotation on a task sits above it, centred, and its association docks on the task', async () => {
    const doc = annotatedDoc();
    runOps(doc, [{ op: 'remove', ids: ['N2'] }]);
    const L = await layout('annotation-task', doc);
    expectClean(L);
    expectLabelsClear(L);
    expectStraightLine(L, ['S', 'A', 'B', 'E']);
    const a = L.box('A'), n1 = L.box('N1');
    expect(bottom(n1)).toBeLessThan(a.y);
    expect(Math.abs(cx(n1) - cx(a))).toBeLessThan(1);
    const assocs = L.planes[0]!.edges.filter((e) => is(e.el, 'bpmn:Association'));
    expect(assocs).toHaveLength(1);
    expect(assocs[0]!.ends.has('A')).toBe(true);
    expect(assocs[0]!.points.some((p) => p.y === a.y)).toBe(true);
    expect(assocs[0]!.points.some((p) => p.y === bottom(n1))).toBe(true);
  });

  // ENGINE DEFECT (place.ts buildArtifacts/placeArtifacts): the anchor of an annotation on a sequence flow is
  // captured before the annotation band shifts the content down, so the association ends exactly one band
  // (annotation height + vGap) above the flow, in mid-air, and may cut through the other annotation.
  it('text annotations on a task and on a flow: both above, the flow association ends on the flow', async () => {
    const L = await layout('annotations', annotatedDoc());
    expectClean(L);
    expectLabelsClear(L);
    expectStraightLine(L, ['S', 'A', 'B', 'E']);
    const a = L.box('A'), n1 = L.box('N1'), n2 = L.box('N2');
    expect(bottom(n1)).toBeLessThan(a.y);
    expect(Math.abs(cx(n1) - cx(a))).toBeLessThan(1);
    const fab = L.edge('F_AB');
    expect(bottom(n2)).toBeLessThan(fab.points[0]!.y);
    const assocs = L.planes[0]!.edges.filter((e) => is(e.el, 'bpmn:Association'));
    expect(assocs).toHaveLength(2);
    // the association to the flow ends on the flow's segment, the one to the task on the task's top border
    const onFlow = assocs.find((e) => e.ends.has('F_AB'))!;
    const flowEnd = onFlow.points.find((p) => p.y === fab.points[0]!.y);
    expect(flowEnd, `${onFlow.id} ends on F_AB (y=${fab.points[0]!.y}): ${JSON.stringify(onFlow.points)}`).toBeDefined();
    expect(flowEnd!.x).toBeGreaterThan(fab.points[0]!.x);
    expect(flowEnd!.x).toBeLessThan(fab.points[1]!.x);
    const onTask = assocs.find((e) => e.ends.has('A'))!;
    expect(onTask.points.some((p) => p.y === a.y)).toBe(true);
  });

  it('compensation boundary event with its handler hanging underneath', async () => {
    const doc = proc([
      start('S'),
      { op: 'add', kind: 'serviceTask', id: 'Charge', name: 'Charge card', after: 'S' },
      task('Book', 'Book flight', 'Charge'),
      end('E', 'Book'),
      { op: 'add', kind: 'boundaryEvent:compensate', id: 'Comp', on: 'Charge' },
      { op: 'add', kind: 'serviceTask', id: 'Refund', name: 'Refund card', in: 'P', set: { isForCompensation: 'true' } },
      { op: 'connect', source: 'Comp', target: 'Refund' },
    ]);
    const L = await layout('compensation', doc);
    expectClean(L);
    expectLabelsClear(L);
    expectStraightLine(L, ['S', 'Charge', 'Book', 'E']);
    const ev = L.box('Comp'), handler = L.box('Refund');
    expect(cy(ev)).toBe(bottom(L.box('Charge')));
    expect(cx(handler)).toBe(cx(ev));
    expect(handler.y).toBeGreaterThan(bottom(ev));
    const assoc = L.planes[0]!.edges.find((e) => is(e.el, 'bpmn:Association'))!;
    expect(assoc.points).toEqual([
      { x: cx(ev), y: bottom(ev) },
      { x: cx(ev), y: handler.y },
    ]);
  });

  it('~30 nodes with two split macros, a terminating branch, a boundary path and a loop', async () => {
    const doc = proc([
      start('S', 'Order received'),
      task('Receive', 'Receive order', 'S'),
      { op: 'add', kind: 'serviceTask', id: 'Validate', name: 'Validate order', after: 'Receive' },
      task('Prepare', 'Prepare shipment', 'Validate'),
      { op: 'add', kind: 'serviceTask', id: 'Ship', name: 'Ship order', after: 'Prepare' },
      { op: 'add', kind: 'exclusiveGateway', id: 'G3', name: 'Delivered?', after: 'Ship' },
      task('Close', 'Close order', 'G3', { flowName: 'yes' }),
      task('Archive', 'Archive order', 'Close'),
      end('E', 'Archive', 'Order done'),
      task('Track', 'Track parcel', 'G3', { flowName: 'no' }),
      { op: 'connect', source: 'Track', target: 'Ship', name: 'resend' },
      {
        op: 'split',
        after: 'Validate',
        id: 'G1',
        name: 'Valid?',
        joinId: 'GJ1',
        branches: [
          { flowName: 'yes', nodes: [{ kind: 'serviceTask', id: 'Reserve', name: 'Reserve stock' }, { kind: 'businessRuleTask', id: 'Price', name: 'Calculate price' }] },
          {
            flowName: 'no',
            nodes: [{ kind: 'sendTask', id: 'Notify', name: 'Notify customer' }, { kind: 'task', id: 'Log', name: 'Log rejection' }, { kind: 'endEvent', id: 'Rejected', name: 'Rejected' }],
          },
          { flowName: 'unclear', nodes: [{ kind: 'userTask', id: 'Review', name: 'Manual review' }] },
        ],
      },
      {
        op: 'split',
        after: 'Prepare',
        kind: 'parallelGateway',
        id: 'G2',
        joinId: 'GJ2',
        branches: [
          { nodes: [{ kind: 'task', id: 'Pack', name: 'Pack items' }, { kind: 'task', id: 'Label', name: 'Print label' }] },
          { nodes: [{ kind: 'serviceTask', id: 'Invoice', name: 'Create invoice' }, { kind: 'sendTask', id: 'SendInvoice', name: 'Send invoice' }] },
          { nodes: [{ kind: 'serviceTask', id: 'Crm', name: 'Update CRM' }] },
        ],
      },
      { op: 'add', kind: 'boundaryEvent:timer', id: 'Late', name: 'after 2 days', on: 'Review', timer: 'PT2D' },
      task('Escalate', 'Escalate to lead', 'Late'),
      end('EscalatedEnd', 'Escalate', 'Escalated'),
      { op: 'add', kind: 'boundaryEvent:error', id: 'ShipFailed', name: 'failed', on: 'Ship', error: 'CarrierError' },
      { op: 'add', kind: 'userTask', id: 'FixShipment', name: 'Fix shipment', after: 'ShipFailed' },
      { op: 'connect', source: 'FixShipment', target: 'Ship' },
    ]);
    const nodeCount = doc.flowNodes(doc.get('P')!).length;
    expect(nodeCount).toBeGreaterThanOrEqual(28);
    const L = await layout('big', doc);
    expectClean(L);
    expectLabelsClear(L);
    expect(L.report.shapes).toBe(nodeCount);
    expectStraightLine(L, ['S', 'Receive', 'Validate', 'G1', 'Reserve', 'Price', 'GJ1', 'Prepare', 'G2', 'Pack', 'Label', 'GJ2', 'Ship', 'G3', 'Close', 'Archive', 'E']);
    // bands in declaration order below their split
    expect(cy(L.box('Notify'))).toBeGreaterThan(bottom(L.box('Reserve')));
    expect(cy(L.box('Review'))).toBeGreaterThan(bottom(L.box('Notify')));
    expect(cy(L.box('Invoice'))).toBeGreaterThan(bottom(L.box('Pack')));
    expect(cy(L.box('Crm'))).toBeGreaterThan(bottom(L.box('Invoice')));
    expectStraightLine(L, ['Notify', 'Log', 'Rejected']);
    expectStraightLine(L, ['Invoice', 'SendInvoice']);
    // boundary handlers below their hosts
    expect(L.box('Escalate').y).toBeGreaterThan(bottom(L.box('Review')));
    expect(L.box('FixShipment').y).toBeGreaterThan(bottom(L.box('Ship')));
    // the loops go around the nodes they span and enter Ship from below or above
    expectRoutedAround(L, flowBetween(L, 'Track', 'Ship'), ['Ship', 'G3'], 'Ship');
    expectRoutedAround(L, flowBetween(L, 'FixShipment', 'Ship'), ['Ship'], 'Ship');
  });
});

/* ------------------------------------------------------------------ */
/* groups over a full redraw                                            */
/* ------------------------------------------------------------------ */

const GALLERY = readFileSync(join(import.meta.dirname, 'fixtures', 'render', 'gallery.bpmn'), 'utf8');
/** the shapes whose centre lies in gallery.bpmn's Group_FirstTasks box */
const FIRST_TASKS = ['Activity_UserTask', 'Activity_ServiceTask', 'Event_TwoDays', 'Event_Reminder'];

const DI_NS = 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';
const diShape = (id: string, [x, y, w, h]: number[], extra = ''): string => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${extra}><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`;
const diEdge = (id: string, pts: number[][]): string => `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${pts.map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`).join('')}</bpmndi:BPMNEdge>`;
const seq = (id: string, from: string, to: string): string => `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}" />`;
const groupXml = (root: string, body: string, di: string[], categories = ''): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ${DI_NS} id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
${body}
${categories}
  <bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="${root}">${di.join('')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** Every shape of the drawing by element id (all planes). */
async function shapesOf(xml: string): Promise<Map<string, DShape>> {
  const doc = await Doc.fromXml(xml);
  return new Map(diagramPlanes(doc.definitions).flatMap((p) => [...p.shapes.values()].map((s) => [s.id, s] as [string, DShape])));
}

/** The group's box holds the members whole and cuts no other leaf shape. */
function expectGroupAround(shapes: Map<string, DShape>, groupId: string, members: string[]): Box {
  const g = shapes.get(groupId);
  expect(g, `${groupId} is drawn`).toBeDefined();
  for (const id of members) expect(contains(g!.bounds, shapes.get(id)!.bounds), `${id} inside ${groupId}`).toBe(true);
  for (const s of shapes.values()) {
    if (s.id === groupId || s.container || s.kind === 'group' || members.includes(s.id)) continue;
    expect(boxesOverlap(g!.bounds, s.bounds) && !contains(g!.bounds, s.bounds), `${groupId}'s border cuts ${s.id}`).toBe(false);
  }
  return g!.bounds;
}

describe('groups over a full redraw', () => {
  it('`layout` draws gallery.bpmn\'s group around the elements it held, with its DI id, and a second redraw changes nothing', async () => {
    const r = await layoutDoc(await Doc.fromXml(GALLERY));
    const before = await shapesOf(GALLERY);
    const after = await shapesOf(r.xml);
    expect(after.size).toBe(before.size);
    expectGroupAround(after, 'Group_FirstTasks', FIRST_TASKS);
    expect(r.xml).toContain('<bpmndi:BPMNShape id="BPMNShape_Group_FirstTasks" bpmnElement="Group_FirstTasks">');
    // the quality line no longer presents the group as overlaps it resolved
    expect(JSON.stringify(r.layout.metrics)).not.toContain('Group_FirstTasks');
    expect(r.layout.notes).toBeUndefined();
    const again = await layoutDoc(await Doc.fromXml(r.xml));
    expect(again.unchanged).toBe(true);
  });

  it('an edit to the redrawn file finds it engine-owned and keeps the group (layout auto)', async () => {
    const drawn = await layoutDoc(await Doc.fromXml(GALLERY));
    const r = await mutateDoc(await Doc.fromXml(drawn.xml), [{ op: 'set', id: 'Activity_UserTask', values: { name: 'User task, renamed' } }]);
    expect(r.layout.mode).toBe('full');
    expect(r.layout.reason).toMatch(/engine-owned/);
    expectGroupAround(await shapesOf(r.xml), 'Group_FirstTasks', FIRST_TASKS);
  });

  it('--relayout (an edit with layout full) keeps the group around its members', async () => {
    const r = await mutateDoc(await Doc.fromXml(GALLERY), [{ op: 'set', id: 'Activity_ServiceTask', values: { name: 'Service task with a longer name' } }], { layout: 'full' });
    expectGroupAround(await shapesOf(r.xml), 'Group_FirstTasks', FIRST_TASKS);
  });

  it('--engine auto keeps the group around its members, without GROUP_MEMBERS_NOT_FOUND', async () => {
    const r = await layoutDoc(await Doc.fromXml(GALLERY), { engine: 'auto' });
    expectGroupAround(await shapesOf(r.xml), 'Group_FirstTasks', FIRST_TASKS);
    expect(r.layout.warnings.map((w) => w.code)).not.toContain('GROUP_MEMBERS_NOT_FOUND');
    expect(r.xml).toContain('<bpmndi:BPMNShape id="BPMNShape_Group_FirstTasks" bpmnElement="Group_FirstTasks">');
  });

  it('a group around nothing keeps its box and the result says so', async () => {
    const xml = groupXml(
      'P',
      `<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:task id="T" name="Do it" /><bpmn:endEvent id="E" />${seq('F1', 'S', 'T')}${seq('F2', 'T', 'E')}<bpmn:group id="Group_Empty" /></bpmn:process>`,
      [diShape('S', [100, 100, 36, 36]), diShape('T', [200, 78, 100, 80]), diShape('E', [360, 100, 36, 36]), diEdge('F1', [[136, 118], [200, 118]]), diEdge('F2', [[300, 118], [360, 118]]), diShape('Group_Empty', [600, 300, 120, 90])],
    );
    const r = await layoutDoc(await Doc.fromXml(xml));
    expect((await shapesOf(r.xml)).get('Group_Empty')!.bounds).toEqual({ x: 600, y: 300, width: 120, height: 90 });
    expect(r.xml).toContain('<bpmndi:BPMNShape id="Group_Empty_di" bpmnElement="Group_Empty">');
    expect(r.layout.notes).toEqual(['group Group_Empty kept its box: no element inside it is drawn']);
  });

  it('a group of the collaboration is drawn around its members in two pools, without DI_NOT_CREATED', async () => {
    const proc = (p: string, s: string, t: string, e: string): string => `<bpmn:process id="${p}"><bpmn:startEvent id="${s}" /><bpmn:task id="${t}" name="${t}" /><bpmn:endEvent id="${e}" />${seq(`${p}_F1`, s, t)}${seq(`${p}_F2`, t, e)}</bpmn:process>`;
    const xml = groupXml(
      'Collab',
      `<bpmn:collaboration id="Collab"><bpmn:participant id="Pool_A" name="A" processRef="PA" /><bpmn:participant id="Pool_B" name="B" processRef="PB" /><bpmn:group id="Group_Both" categoryValueRef="CV_Both" /></bpmn:collaboration>${proc('PA', 'SA', 'Task_A', 'EA')}${proc('PB', 'SB', 'Task_B', 'EB')}`,
      [
        diShape('Pool_A', [100, 50, 600, 200], ' isHorizontal="true"'), diShape('SA', [180, 132, 36, 36]), diShape('Task_A', [280, 110, 100, 80]), diShape('EA', [452, 132, 36, 36]),
        diEdge('PA_F1', [[216, 150], [280, 150]]), diEdge('PA_F2', [[380, 150], [452, 150]]),
        diShape('Pool_B', [100, 300, 600, 200], ' isHorizontal="true"'), diShape('SB', [180, 382, 36, 36]), diShape('Task_B', [280, 360, 100, 80]), diShape('EB', [452, 382, 36, 36]),
        diEdge('PB_F1', [[216, 400], [280, 400]]), diEdge('PB_F2', [[380, 400], [452, 400]]),
        diShape('Group_Both', [260, 90, 140, 370]),
      ],
      '<bpmn:category id="Cat"><bpmn:categoryValue id="CV_Both" value="Both sides" /></bpmn:category>',
    );
    const r = await layoutDoc(await Doc.fromXml(xml));
    expect(r.layout.warnings).toEqual([]);
    const box = expectGroupAround(await shapesOf(r.xml), 'Group_Both', ['Task_A', 'Task_B']);
    const shapes = await shapesOf(r.xml);
    // room above the members for the group's name
    expect(Math.min(shapes.get('Task_A')!.bounds.y, shapes.get('Task_B')!.bounds.y) - box.y).toBeGreaterThan(20);
    expect((await layoutDoc(await Doc.fromXml(r.xml))).unchanged).toBe(true);
  });

  it('the parts of a group no flow connects stay together, so the boxes of two groups do not overlap', async () => {
    const chain = (n: number): string => `<bpmn:startEvent id="Start_${n}" /><bpmn:task id="Task_${n}" name="Task ${n}" /><bpmn:endEvent id="End_${n}" />${seq(`Flow_${n}a`, `Start_${n}`, `Task_${n}`)}${seq(`Flow_${n}b`, `Task_${n}`, `End_${n}`)}`;
    const chainDi = (n: number, x: number, y: number): string[] => [diShape(`Start_${n}`, [x, y + 22, 36, 36]), diShape(`Task_${n}`, [x + 100, y, 100, 80]), diShape(`End_${n}`, [x + 260, y + 22, 36, 36])];
    // declared 1, 2, 3; drawn as two columns: Group_Left holds 1 and 3, Group_Right holds 2
    const xml = groupXml(
      'P',
      `<bpmn:process id="P">${chain(1)}${chain(2)}${chain(3)}<bpmn:group id="Group_Left" /><bpmn:group id="Group_Right" /></bpmn:process>`,
      [...chainDi(1, 100, 100), ...chainDi(3, 100, 240), ...chainDi(2, 500, 100), diShape('Group_Left', [80, 80, 340, 260]), diShape('Group_Right', [480, 80, 340, 120])],
    );
    const r = await layoutDoc(await Doc.fromXml(xml));
    const shapes = await shapesOf(r.xml);
    const left = expectGroupAround(shapes, 'Group_Left', ['Start_1', 'Task_1', 'End_1', 'Start_3', 'Task_3', 'End_3']);
    const right = expectGroupAround(shapes, 'Group_Right', ['Start_2', 'Task_2', 'End_2']);
    expect(boxesOverlap(left, right)).toBe(false);
    expect((await layoutDoc(await Doc.fromXml(r.xml))).unchanged).toBe(true);
  });

  it('a group inside a group stays inside it; two groups side by side do not overlap', async () => {
    const xml = groupXml(
      'P',
      `<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:task id="A" name="A" /><bpmn:task id="B" name="B" /><bpmn:task id="C" name="C" /><bpmn:endEvent id="E" />${seq('F1', 'S', 'A')}${seq('F2', 'A', 'B')}${seq('F3', 'B', 'C')}${seq('F4', 'C', 'E')}<bpmn:group id="Group_Outer" /><bpmn:group id="Group_Inner" /><bpmn:group id="Group_Last" /></bpmn:process>`,
      [
        diShape('S', [100, 122, 36, 36]), diShape('A', [200, 100, 100, 80]), diShape('B', [360, 100, 100, 80]), diShape('C', [520, 100, 100, 80]), diShape('E', [680, 122, 36, 36]),
        diEdge('F1', [[136, 140], [200, 140]]), diEdge('F2', [[300, 140], [360, 140]]), diEdge('F3', [[460, 140], [520, 140]]), diEdge('F4', [[620, 140], [680, 140]]),
        diShape('Group_Outer', [180, 60, 300, 140]), diShape('Group_Inner', [190, 80, 120, 110]), diShape('Group_Last', [500, 80, 140, 120]),
      ],
    );
    const r = await layoutDoc(await Doc.fromXml(xml));
    const shapes = await shapesOf(r.xml);
    const outer = expectGroupAround(shapes, 'Group_Outer', ['A', 'B']);
    const inner = expectGroupAround(shapes, 'Group_Inner', ['A']);
    const last = expectGroupAround(shapes, 'Group_Last', ['C']);
    expect(contains(outer, inner)).toBe(true);
    expect(boxesOverlap(outer, last)).toBe(false);
    expect(contains(inner, shapes.get('B')!.bounds)).toBe(false);
    // the old DI order
    expect(r.xml.indexOf('bpmnElement="Group_Outer"')).toBeLessThan(r.xml.indexOf('bpmnElement="Group_Inner"'));
    expect((await layoutDoc(await Doc.fromXml(r.xml))).unchanged).toBe(true);
    expect(layoutProblems((await Doc.fromXml(r.xml)).definitions).problems.filter((p) => p.ids.some((id) => id.startsWith('Group_')))).toEqual([]);
  });

  it('two stacked groups come back the same on a second redraw, and an edit to the first result finds it engine-owned', async () => {
    const xml = readFileSync(join(import.meta.dirname, 'fixtures', 'incremental', 'groups.bpmn'), 'utf8');
    const r = await layoutDoc(await Doc.fromXml(xml));
    const shapes = await shapesOf(r.xml);
    const g1 = expectGroupAround(shapes, 'G1', ['S1', 'A', 'E1', 'S2', 'B', 'E2']);
    const g2 = expectGroupAround(shapes, 'G2', ['S3', 'C', 'E3', 'D']);
    expect(boxesOverlap(g1, g2)).toBe(false);
    expect((await layoutDoc(await Doc.fromXml(r.xml))).unchanged).toBe(true);
    const edit = await mutateDoc(await Doc.fromXml(r.xml), [{ op: 'set', id: 'A', values: { name: 'Renamed' } }]);
    expect(edit.layout.mode).toBe('full');
    expect(edit.layout.reason).toMatch(/engine-owned/);
  });

  const LINE = (ids: string[]): { body: string; di: string[] } => {
    const flows = ids.slice(1).map((id, i) => seq(`F${i + 1}`, ids[i]!, id));
    const kinds = ids.map((id, i) => (i === 0 ? `<bpmn:startEvent id="${id}" />` : i === ids.length - 1 ? `<bpmn:endEvent id="${id}" />` : `<bpmn:task id="${id}" name="${id}" />`));
    const di: string[] = [];
    let x = 100;
    ids.forEach((id, i) => {
      const event = i === 0 || i === ids.length - 1;
      di.push(diShape(id, event ? [x, 122, 36, 36] : [x, 100, 100, 80]));
      if (i < ids.length - 1) di.push(diEdge(`F${i + 1}`, [[x + (event ? 36 : 100), 140], [x + (event ? 36 : 100) + 60, 140]]));
      x += (event ? 36 : 100) + 60;
    });
    return { body: kinds.join('') + flows.join(''), di };
  };

  it('a group inside a group that loses its last member is no member of the outer group (remove with --relayout)', async () => {
    const line = LINE(['S', 'A', 'B', 'C', 'D', 'E']);
    // B at 292, C at 452, D at 612: Group_Outer around B..D, Group_Inner around D
    const xml = groupXml('P', `<bpmn:process id="P">${line.body}<bpmn:group id="Group_Outer" /><bpmn:group id="Group_Inner" /></bpmn:process>`, [...line.di, diShape('Group_Outer', [272, 60, 460, 140]), diShape('Group_Inner', [592, 80, 140, 110])]);
    const r = await mutateDoc(await Doc.fromXml(xml), [{ op: 'remove', ids: ['D'] }], { layout: 'full' });
    const shapes = await shapesOf(r.xml);
    const outer = expectGroupAround(shapes, 'Group_Outer', ['B', 'C']);
    expect(contains(outer, shapes.get('E')!.bounds)).toBe(false);
    expect(contains(outer, shapes.get('Group_Inner')!.bounds)).toBe(false);
    const inner = shapes.get('Group_Inner')!.bounds;
    expect([...shapes.values()].filter((s) => s.id !== 'Group_Inner' && boxesOverlap(inner, s.bounds)).map((s) => s.id)).toEqual([]);
    expect(r.layout.notes).toEqual(['group Group_Inner moved below the drawing: no element inside it is drawn and the redraw put shapes on its box']);
  });

  it('a group around nothing whose box the redraw covers moves below the drawing at its size; a second redraw keeps it, an edit finds the drawing engine-owned', async () => {
    const line = LINE(['Start', 'Prepare', 'Print', 'Hand', 'Shipped']);
    // in the gap between Prepare (196..296) and Print (356..456), where the redraw puts Print
    const xml = groupXml('P', `<bpmn:process id="P">${line.body}<bpmn:group id="Group_Handover" /></bpmn:process>`, [...line.di, diShape('Group_Handover', [300, 95, 50, 90])]);
    const r = await layoutDoc(await Doc.fromXml(xml));
    const shapes = await shapesOf(r.xml);
    const g = shapes.get('Group_Handover')!.bounds;
    expect([g.width, g.height]).toEqual([50, 90]);
    expect([...shapes.values()].filter((s) => s.id !== 'Group_Handover' && boxesOverlap(g, s.bounds)).map((s) => s.id)).toEqual([]);
    expect(g.y).toBeGreaterThan(Math.max(...[...shapes.values()].filter((s) => s.id !== 'Group_Handover').map((s) => s.bounds.y + s.bounds.height)));
    expect(r.layout.notes).toEqual(['group Group_Handover moved below the drawing: no element inside it is drawn and the redraw put shapes on its box']);
    const again = await layoutDoc(await Doc.fromXml(r.xml));
    expect(again.unchanged).toBe(true);
    expect(again.layout.notes).toEqual(['group Group_Handover kept its box: no element inside it is drawn']);
    const edit = await mutateDoc(await Doc.fromXml(r.xml), [{ op: 'set', id: 'Hand', values: { name: 'Hand over' } }]);
    expect(edit.layout.mode).toBe('full');
  });

  const CHAIN = (n: number, start = true): string =>
    `${start ? `<bpmn:startEvent id="Start_${n}" />` : ''}<bpmn:task id="Task_${n}" name="Task ${n}" /><bpmn:endEvent id="End_${n}" />${start ? seq(`Flow_${n}a`, `Start_${n}`, `Task_${n}`) : ''}${seq(`Flow_${n}b`, `Task_${n}`, `End_${n}`)}`;
  const CHAIN_DI = (n: number, x: number, y: number, start = true): string[] => [...(start ? [diShape(`Start_${n}`, [x, y + 22, 36, 36])] : []), diShape(`Task_${n}`, [x + 100, y, 100, 80]), diShape(`End_${n}`, [x + 260, y + 22, 36, 36])];

  it('the parts of a group stay together when its box held only their tasks, and when a part has no start event', async () => {
    // declared 1, 2, 3; drawn as two columns: Group_Left around the tasks of 1 and 3, Group_Right around the task of 2
    const tasksOnly = groupXml(
      'P',
      `<bpmn:process id="P">${CHAIN(1)}${CHAIN(2)}${CHAIN(3)}<bpmn:group id="Group_Left" /><bpmn:group id="Group_Right" /></bpmn:process>`,
      [...CHAIN_DI(1, 100, 100), ...CHAIN_DI(3, 100, 240), ...CHAIN_DI(2, 500, 100), diShape('Group_Left', [180, 80, 140, 260]), diShape('Group_Right', [580, 80, 140, 120])],
    );
    let r = await layoutDoc(await Doc.fromXml(tasksOnly));
    let shapes = await shapesOf(r.xml);
    let left = expectGroupAround(shapes, 'Group_Left', ['Task_1', 'Task_3']);
    let right = expectGroupAround(shapes, 'Group_Right', ['Task_2']);
    expect(boxesOverlap(left, right)).toBe(false);
    expect((await layoutDoc(await Doc.fromXml(r.xml))).unchanged).toBe(true);
    // chain 3 starts at its task: it still goes next to chain 1
    const noStart = groupXml(
      'P',
      `<bpmn:process id="P">${CHAIN(1)}${CHAIN(2)}${CHAIN(3, false)}<bpmn:group id="Group_Left" /><bpmn:group id="Group_Right" /></bpmn:process>`,
      [...CHAIN_DI(1, 100, 100), ...CHAIN_DI(3, 100, 240, false), ...CHAIN_DI(2, 500, 100), diShape('Group_Left', [80, 80, 340, 260]), diShape('Group_Right', [480, 80, 340, 120])],
    );
    r = await layoutDoc(await Doc.fromXml(noStart));
    shapes = await shapesOf(r.xml);
    left = expectGroupAround(shapes, 'Group_Left', ['Start_1', 'Task_1', 'End_1', 'Task_3', 'End_3']);
    right = expectGroupAround(shapes, 'Group_Right', ['Start_2', 'Task_2', 'End_2']);
    expect(boxesOverlap(left, right)).toBe(false);
    expect((await layoutDoc(await Doc.fromXml(r.xml))).unchanged).toBe(true);
  });

  it('two groups that overlap without nesting come back the same on a second redraw', async () => {
    // five chains drawn in the rows 2, 4, 1, 5, 3; Group_A holds rows 2, 4, 1 and Group_B rows 1, 5
    const order = [2, 4, 1, 5, 3];
    const xml = groupXml(
      'P',
      `<bpmn:process id="P">${[1, 2, 3, 4, 5].map((n) => CHAIN(n)).join('')}<bpmn:group id="Group_A" /><bpmn:group id="Group_B" /></bpmn:process>`,
      [...order.flatMap((n, i) => CHAIN_DI(n, 100, 100 + i * 140)), diShape('Group_A', [80, 80, 340, 400]), diShape('Group_B', [60, 340, 380, 240])],
    );
    const r = await layoutDoc(await Doc.fromXml(xml));
    const shapes = await shapesOf(r.xml);
    expectGroupAround(shapes, 'Group_A', ['Task_2', 'Task_4', 'Task_1']);
    expectGroupAround(shapes, 'Group_B', ['Task_1', 'Task_5']);
    expect((await layoutDoc(await Doc.fromXml(r.xml))).unchanged).toBe(true);
    const edit = await mutateDoc(await Doc.fromXml(r.xml), [{ op: 'set', id: 'Task_1', values: { name: 'Task one' } }]);
    expect(edit.layout.mode).toBe('full');
  });

  it('a boundary event joins a group only together with its host', async () => {
    // as an engine left it: members M1 and M2 one above the other, a wide host beside them, its event's centre on their right edge
    const xml = groupXml(
      'P',
      `<bpmn:process id="P"><bpmn:task id="M1" /><bpmn:task id="M2" /><bpmn:task id="Host" /><bpmn:boundaryEvent id="Event_Late" attachedToRef="Host" /><bpmn:group id="Group_M" /></bpmn:process>`,
      [diShape('M1', [100, 100, 100, 80]), diShape('M2', [100, 320, 100, 80]), diShape('Host', [180, 200, 200, 80]), diShape('Event_Late', [182, 262, 36, 36])],
    );
    const doc = await Doc.fromXml(xml);
    const { redrawGroups } = await import('../src/diagram/groups.js');
    const out = redrawGroups(doc.moddle, doc.definitions, [{ id: 'Group_M', bounds: { x: 80, y: 80, width: 140, height: 340 }, members: ['M1', 'M2'] }]);
    expect(out).toEqual({ drawn: ['Group_M'], kept: [], moved: [] });
    expectGroupAround(await shapesOf(await doc.toXml()), 'Group_M', ['M1', 'M2', 'Host', 'Event_Late']);
  });

  it('the group keeps a DI id of its own and its colour; an association to it says why it is not drawn; empty groups share one note', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ${DI_NS} xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:category id="Cat"><bpmn:categoryValue id="CV_Work" value="Work" /></bpmn:category>
  <bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:task id="T" name="Do it" /><bpmn:endEvent id="E" />${seq('F1', 'S', 'T')}${seq('F2', 'T', 'E')}
    <bpmn:group id="Group_Work" categoryValueRef="CV_Work" /><bpmn:group id="Group_Empty1" /><bpmn:group id="Group_Empty2" />
    <bpmn:textAnnotation id="TextAnnotation_Work"><bpmn:text>About the work</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="Association_Work" sourceRef="TextAnnotation_Work" targetRef="Group_Work" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="P">
    ${diShape('S', [100, 122, 36, 36])}${diShape('T', [200, 100, 100, 80])}${diShape('E', [360, 122, 36, 36])}${diEdge('F1', [[136, 140], [200, 140]])}${diEdge('F2', [[300, 140], [360, 140]])}
    <bpmndi:BPMNShape id="Shape_0xyz" bpmnElement="Group_Work" bioc:stroke="#e53935" color:border-color="#e53935"><dc:Bounds x="180" y="60" width="140" height="140" /><bpmndi:BPMNLabel><dc:Bounds x="220" y="64" width="60" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    ${diShape('Group_Empty1', [600, 400, 120, 90])}${diShape('Group_Empty2', [800, 400, 120, 90])}
    ${diShape('TextAnnotation_Work', [360, 20, 120, 30])}${diEdge('Association_Work', [[360, 35], [320, 70]])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const r = await layoutDoc(await Doc.fromXml(xml));
    expect(r.xml).toMatch(/<bpmndi:BPMNShape id="Shape_0xyz" bpmnElement="Group_Work" bioc:stroke="#e53935" color:border-color="#e53935">/);
    expectGroupAround(await shapesOf(r.xml), 'Group_Work', ['T']);
    expect(r.layout.warnings).toEqual([{ code: 'DI_NOT_CREATED', elementId: 'Association_Work', message: 'No DI created for Association_Work (an end is a group: its box is drawn after the layout)', relatedElementIds: [] }]);
    expect(r.layout.notes).toEqual(['groups Group_Empty1, Group_Empty2 kept their boxes: no element inside them is drawn']);
  });
});
