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
import { layoutProblems } from '../src/diagram/metrics.js';
import { readPlanes as diagramPlanes, type DShape } from '../src/diagram/plane.js';
import { Doc } from '../src/document.js';
import { layoutModel, type LayoutOptions, type LayoutWarningInfo } from '../src/layout.js';
import { is, many, type El } from '../src/model.js';
import { collapsedIds } from '../src/ops/add.js';
import { runOps } from '../src/ops/index.js';
import type { AddOp, Op } from '../src/ops/types.js';
import { layoutDoc, mutateDoc } from '../src/pipeline.js';

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
