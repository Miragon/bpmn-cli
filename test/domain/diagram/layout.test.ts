/**
 * Invariant tests of the "clean" layout engine (src/domain/diagram/layout/).
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
import { LayoutDebug } from '../../../src/domain/diagram/layout/LayoutDebug.js';
import type { DShape, GNode, ScopeLayout } from '../../../src/domain/diagram/di/types.js';
import { titleBox } from '../../../src/domain/diagram/utils/text.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import { type LayoutOptions, type LayoutWarningInfo, FullLayout } from '../../../src/domain/diagram/layout/FullLayout.js';
import { ScopeArtifactPlacer } from '../../../src/domain/diagram/layout/clean/ScopeArtifactPlacer.js';
import { ChainLiftTrial } from '../../../src/domain/diagram/layout/clean/ChainLiftTrial.js';
import { JoinColumnTrial } from '../../../src/domain/diagram/layout/clean/JoinColumnTrial.js';
import { ScopeGrid } from '../../../src/domain/diagram/layout/clean/ScopeGrid.js';
import { ScopePlacer } from '../../../src/domain/diagram/layout/clean/ScopePlacer.js';
import { shiftNode } from '../../../src/domain/diagram/utils/scope.js';
import { LayoutAnalysis } from '../../../src/domain/diagram/di/LayoutAnalysis.js';
import { DiagramReader } from '../../../src/domain/diagram/di/DiagramReader.js';
import { is, many, type El } from '../../../src/domain/document/utils/moddle.js';
import { runOps } from '../../../src/index.js';
import type { AddElement, EditCommand } from '../../../src/domain/commands/types.js';
import { layoutDoc, mutateDoc } from '../../../src/index.js';

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
    const readPlane: Plane = { el: plane.get<El>('bpmnElement'), shapes: [], edges: [] };
    for (const di of many(plane, 'planeElement')) {
      const el = di.get<El | undefined>('bpmnElement');
      if (!el) continue;
      if (is(di, 'bpmndi:BPMNShape')) {
        const expanded = di.get<boolean | undefined>('isExpanded') === true;
        readPlane.shapes.push({ id: idOf(el), el, box: boxOf(di.get<El>('bounds')), expanded, container: isContainer(el, expanded), label: labelOf(di) });
      } else if (is(di, 'bpmndi:BPMNEdge')) {
        readPlane.edges.push({ id: idOf(el), el, points: many(di, 'waypoint').map((waypoint) => ({ x: waypoint.get<number>('x'), y: waypoint.get<number>('y') })), ends: endsOf(el), label: labelOf(di) });
      }
    }
    planes.push(readPlane);
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
    for (const artifact of many(scope, 'artifacts')) if (is(artifact, 'bpmn:TextAnnotation') || is(artifact, 'bpmn:Association')) need.add(idOf(artifact));
  };
  for (const root of many(doc.definitions, 'rootElements')) {
    if (is(root, 'bpmn:Process')) walk(root);
    if (is(root, 'bpmn:Collaboration')) {
      for (const participant of many(root, 'participants')) need.add(idOf(participant));
      for (const messageFlow of many(root, 'messageFlows')) need.add(idOf(messageFlow));
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
  for (let index = 0; index + 1 < points.length; index++) out.push([points[index]!, points[index + 1]!]);
  return out;
}

function orient(first: Point, second: Point, third: Point): number {
  return Math.sign((second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x));
}

/** Proper crossing: shared endpoints and collinear overlaps do not count. */
function properCross([start, end]: Segment, [otherStart, otherEnd]: Segment): boolean {
  const o1 = orient(start, end, otherStart), o2 = orient(start, end, otherEnd), o3 = orient(otherStart, otherEnd, start), o4 = orient(otherStart, otherEnd, end);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

function segmentHitsBox([start, end]: Segment, box: Box, shrink = 2): boolean {
  const x1 = Math.min(start.x, end.x), x2 = Math.max(start.x, end.x), y1 = Math.min(start.y, end.y), y2 = Math.max(start.y, end.y);
  return x1 < box.x + box.width - shrink && x2 > box.x + shrink && y1 < box.y + box.height - shrink && y2 > box.y + shrink;
}

function boxesOverlap(box: Box, other: Box): boolean {
  return box.x < other.x + other.width && other.x < box.x + box.width && box.y < other.y + other.height && other.y < box.y + box.height;
}

function contains(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

const cx = (box: Box): number => box.x + box.width / 2;
const cy = (box: Box): number => box.y + box.height / 2;
const bottom = (box: Box): number => box.y + box.height;
const right = (box: Box): number => box.x + box.width;

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
function segmentCutsBox([start, end]: Segment, box: Box): boolean {
  return segmentHitsBox([start, end], box, 0);
}

/** Length of the collinear overlap of two axis-parallel segments (0 when they are not collinear). */
function collinearOverlap([start, end]: Segment, [otherStart, otherEnd]: Segment): number {
  if (start.x === end.x && otherStart.x === otherEnd.x && start.x === otherStart.x) {
    return Math.min(Math.max(start.y, end.y), Math.max(otherStart.y, otherEnd.y)) - Math.max(Math.min(start.y, end.y), Math.min(otherStart.y, otherEnd.y));
  }
  if (start.y === end.y && otherStart.y === otherEnd.y && start.y === otherStart.y) {
    return Math.min(Math.max(start.x, end.x), Math.max(otherStart.x, otherEnd.x)) - Math.max(Math.min(start.x, end.x), Math.min(otherStart.x, otherEnd.x));
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
    if (!values.every((coordinate) => Number.isInteger(coordinate))) report.nonInteger.push(what);
  };
  for (const plane of planes) {
    report.shapes += plane.shapes.length;
    report.edges += plane.edges.length;
    for (const shape of plane.shapes) {
      seen.add(shape.id);
      integer(shape.id, shape.box.x, shape.box.y, shape.box.width, shape.box.height);
      if (shape.label) integer(`${shape.id}#label`, shape.label.x, shape.label.y, shape.label.width, shape.label.height);
    }
    for (const edge of plane.edges) {
      seen.add(edge.id);
      for (const point of edge.points) integer(edge.id, point.x, point.y);
      if (edge.label) integer(`${edge.id}#label`, edge.label.x, edge.label.y, edge.label.width, edge.label.height);
    }
    const leaf = plane.shapes.filter((shape) => !shape.container);
    for (let index = 0; index < leaf.length; index++) {
      for (let otherIndex = index + 1; otherIndex < leaf.length; otherIndex++) {
        const first = leaf[index]!, second = leaf[otherIndex]!;
        const boundaryPair = (is(first.el, 'bpmn:BoundaryEvent') && attachedTo(first.el) === second.id) || (is(second.el, 'bpmn:BoundaryEvent') && attachedTo(second.el) === first.id);
        if (!boundaryPair && boxesOverlap(first.box, second.box)) report.overlaps.push(`${first.id}~${second.id}`);
      }
    }
    for (const edge of plane.edges) {
      for (const seg of segments(edge.points)) {
        if (isFlow(edge.el) && seg[0].x !== seg[1].x && seg[0].y !== seg[1].y) report.diagonal.push(edge.id);
        for (const shape of leaf) {
          if (edge.ends.has(shape.id)) continue;
          if (is(shape.el, 'bpmn:BoundaryEvent') && edge.ends.has(attachedTo(shape.el) ?? '')) continue;
          if (segmentHitsBox(seg, shape.box)) report.through.push(`${edge.id}->${shape.id}`);
        }
      }
    }
    for (let index = 0; index < plane.edges.length; index++) {
      for (let otherIndex = index + 1; otherIndex < plane.edges.length; otherIndex++) {
        const first = plane.edges[index]!, second = plane.edges[otherIndex]!;
        if (segments(first.points).some((s1) => segments(second.points).some((s2) => properCross(s1, s2)))) report.crossings.push(`${first.id}x${second.id}`);
      }
    }
    // labels: against leaf shapes, other labels and edge segments
    const labels: Array<{ owner: string; box: Box; text: Box }> = [];
    for (const shape of plane.shapes) if (shape.label) labels.push({ owner: shape.id, box: shape.label, text: glyphBox(shape.label, shape.el.get<string | undefined>('name') ?? '') });
    for (const edge of plane.edges) if (edge.label) labels.push({ owner: edge.id, box: edge.label, text: glyphBox(edge.label, edge.el.get<string | undefined>('name') ?? '') });
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index]!;
      for (const shape of leaf) if (shape.id !== label.owner && boxesOverlap(label.box, shape.box)) report.labelClashes.push(`${label.owner}#label~${shape.id}`);
      for (let otherIndex = index + 1; otherIndex < labels.length; otherIndex++) if (boxesOverlap(label.box, labels[otherIndex]!.box)) report.labelClashes.push(`${label.owner}#label~${labels[otherIndex]!.owner}#label`);
      for (const edge of plane.edges) if (segments(edge.points).some((seg) => segmentCutsBox(seg, label.text))) report.labelOnLine.push(`${label.owner}#label~${edge.id}`);
    }
    // an incoming and an outgoing flow of one node must not share a line
    const flows = plane.edges.filter((edge) => is(edge.el, 'bpmn:SequenceFlow'));
    for (const shape of plane.shapes) {
      const into = flows.filter((edge) => idOf(edge.el.get<El>('targetRef')) === shape.id);
      const outOf = flows.filter((edge) => idOf(edge.el.get<El>('sourceRef')) === shape.id);
      for (const incoming of into) {
        for (const outgoing of outOf) {
          if (incoming === outgoing) continue;
          if (segments(incoming.points).some((s1) => segments(outgoing.points).some((s2) => collinearOverlap(s1, s2) > 0))) report.inOutOverlaps.push(`${incoming.id}|${outgoing.id}@${shape.id}`);
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
  const { xml, warnings } = await new FullLayout(doc.model, opts).run();
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${name}.bpmn`), xml);
  }
  const out = await Doc.fromXml(xml);
  const planes = readPlanes(out);
  const report = checkDi(out, planes);
  const shape = (id: string): Shape => {
    for (const plane of planes) {
      const shape = plane.shapes.find((candidate) => candidate.id === id);
      if (shape) return shape;
    }
    throw new Error(`no shape for ${id}`);
  };
  const edge = (id: string): Edge => {
    for (const plane of planes) {
      const edge = plane.edges.find((candidate) => candidate.id === id);
      if (edge) return edge;
    }
    throw new Error(`no edge for ${id}`);
  };
  return { xml, warnings, out, planes, report, shape, edge, box: (id) => shape(id).box, points: (id) => edge(id).points };
}

/** The invariants every scenario must satisfy. */
function expectClean(laid: Laid): void {
  expect(laid.out.importWarnings).toEqual([]);
  expect(laid.warnings).toEqual([]);
  expect(laid.report.missing).toEqual([]);
  expect(laid.report.nonInteger).toEqual([]);
  expect(laid.report.overlaps).toEqual([]);
  expect(laid.report.through).toEqual([]);
  expect(laid.report.diagonal).toEqual([]);
  expect(laid.report.crossings).toEqual([]);
  expect(laid.report.labelClashes).toEqual([]);
  expect(laid.report.inOutOverlaps).toEqual([]);
  for (const plane of laid.planes) for (const edge of plane.edges) expect(edge.points.length, `${edge.id} has waypoints`).toBeGreaterThanOrEqual(2);
}

/** No label text is crossed by a line. */
function expectLabelsClear(laid: Laid): void {
  expect(laid.report.labelOnLine).toEqual([]);
}

/**
 * The listed nodes form a straight line: same centre y (an odd-height container
 * may sit half a pixel off), each right of the previous one, and every flow
 * between neighbours is one horizontal segment.
 */
function expectStraightLine(laid: Laid, ids: string[]): void {
  const ys = ids.map((id) => cy(laid.box(id)));
  expect(Math.max(...ys) - Math.min(...ys), `centre y of ${ids.join(' -> ')}: ${ys.join(', ')}`).toBeLessThanOrEqual(0.5);
  for (let index = 0; index + 1 < ids.length; index++) {
    const sourceId = ids[index]!, targetId = ids[index + 1]!;
    expect(laid.box(targetId).x, `${targetId} right of ${sourceId}`).toBeGreaterThan(right(laid.box(sourceId)));
    const flow = laid.out.outgoing(laid.out.require(sourceId)).find((outgoing) => idOf(outgoing.get<El>('targetRef')) === targetId);
    if (!flow) continue;
    const pts = laid.edge(idOf(flow)).points;
    expect(pts, `${idOf(flow)} (${sourceId} -> ${targetId}) is one horizontal segment`).toHaveLength(2);
    expect(pts[0]!.y).toBe(pts[1]!.y);
    expect(pts[0]!.x).toBe(right(laid.box(sourceId)));
    expect(pts[1]!.x).toBe(laid.box(targetId).x);
  }
}

/** The single longest horizontal segment of a polyline (its y), undefined when there is none. */
function longestHorizontalY(points: Point[]): number | undefined {
  let best: Segment | undefined;
  for (const segment of segments(points)) {
    if (segment[0].y !== segment[1].y) continue;
    if (!best || Math.abs(segment[1].x - segment[0].x) > Math.abs(best[1].x - best[0].x)) best = segment;
  }
  return best?.[0].y;
}

/** The sequence flow between two nodes (by ids) in the laid-out document. */
function flowBetween(laid: Laid, source: string, target: string): Edge {
  const flow = laid.out.outgoing(laid.out.require(source)).find((outgoing) => idOf(outgoing.get<El>('targetRef')) === target);
  if (!flow) throw new Error(`no flow ${source} -> ${target}`);
  return laid.edge(idOf(flow));
}

/** A loop (or any edge) goes around the nodes it spans: its horizontal run is below or above every one of them and it ends on the target's border. */
function expectRoutedAround(laid: Laid, edge: Edge, spanned: string[], targetId: string): void {
  const runY = longestHorizontalY(edge.points);
  expect(runY, `${edge.id} has a horizontal run`).toBeDefined();
  const boxes = spanned.map((id) => laid.box(id));
  const below = boxes.every((box) => runY! >= bottom(box));
  const above = boxes.every((box) => runY! <= box.y);
  expect(below || above, `${edge.id} runs at y=${runY} around ${spanned.join(', ')}`).toBe(true);
  const last = edge.points[edge.points.length - 1]!;
  const targetBox = laid.box(targetId);
  expect([targetBox.y, bottom(targetBox)], `${edge.id} enters ${targetId} from above or below`).toContain(last.y);
  expect(last.x).toBeGreaterThan(targetBox.x);
  expect(last.x).toBeLessThan(right(targetBox));
}

function proc(ops: EditCommand[], processId = 'P'): Doc {
  const doc = Doc.create({ processId });
  runOps(doc, ops);
  return doc;
}

const start = (id: string, name?: string, extra: Partial<AddElement> = {}): AddElement => ({ op: 'add', kind: 'startEvent', id, ...(name ? { name } : {}), ...extra });
const end = (id: string, after: string, name?: string, extra: Partial<AddElement> = {}): AddElement => ({ op: 'add', kind: 'endEvent', id, after, ...(name ? { name } : {}), ...extra });
const task = (id: string, name: string, after: string, extra: Partial<AddElement> = {}): AddElement => ({ op: 'add', kind: 'task', id, name, after, ...extra });

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
    const laid = await layout('linear', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expect(laid.report).toMatchObject({ planes: 1, shapes: 5, edges: 4 });
    expectStraightLine(laid, ['S', 'A', 'B', 'C', 'E']);
    for (const plane of laid.planes) for (const edge of plane.edges) expect(edge.points, `${edge.id} is one straight segment`).toHaveLength(2);
    // event labels below, and every element sits inside the plane at positive coordinates
    expect(laid.shape('S').label!.y).toBeGreaterThan(bottom(laid.box('S')));
    for (const shape of laid.planes[0]!.shapes) expect(Math.min(shape.box.x, shape.box.y)).toBeGreaterThan(0);
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
    const laid = await layout('xor-3', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightLine(laid, ['S', 'A', 'G', 'T1', 'GJ', 'E']);
    expectStraightLine(laid, ['T2a', 'T2b']);
    expect(cy(laid.box('T2a'))).toBeGreaterThan(bottom(laid.box('T1')));
    expect(cy(laid.box('T3'))).toBeGreaterThan(bottom(laid.box('T2a')));
    // bands start right of the split and drop straight down from it
    for (const id of ['T2a', 'T3']) {
      const drop = flowBetween(laid, 'G', id);
      expect(drop.points[0]).toEqual({ x: cx(laid.box('G')), y: bottom(laid.box('G')) });
      expect(laid.box(id).x).toBeGreaterThan(right(laid.box('G')));
    }
    // joins are entered from below
    for (const id of ['T2b', 'T3']) {
      const into = flowBetween(laid, id, 'GJ');
      expect(into.points[into.points.length - 1]).toEqual({ x: cx(laid.box('GJ')), y: bottom(laid.box('GJ')) });
    }
    // gateway label above, flow labels above their first horizontal segment
    expect(bottom(laid.shape('G').label!)).toBeLessThanOrEqual(laid.box('G').y);
    const ok = flowBetween(laid, 'G', 'T1');
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
    const laid = await layout('parallel-3', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightLine(laid, ['S', 'A', 'G', 'T1', 'T1b', 'GJ', 'E']);
    expect(cy(laid.box('T2'))).toBeGreaterThan(bottom(laid.box('T1')));
    expect(cy(laid.box('T3'))).toBeGreaterThan(bottom(laid.box('T2')));
    expect(laid.box('T2').x).toBe(laid.box('T1').x);
    expect(laid.box('T3').x).toBe(laid.box('T1').x);
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
    const laid = await layout('loop-back', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightLine(laid, ['S', 'A', 'B', 'G', 'C', 'E']);
    const loop = flowBetween(laid, 'G', 'A');
    expect(loop.points.length).toBeGreaterThanOrEqual(4);
    expectRoutedAround(laid, loop, ['A', 'B', 'G'], 'A');
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
    const mergeBox = merge.box('M');
    for (const id of ['F', 'Q']) expect(flowBetween(merge, id, 'M').points.at(-1), id).toEqual({ x: cx(mergeBox), y: bottom(mergeBox) });
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
    const laid = await layout(
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
    expectClean(laid);
    const gatewayBox = laid.box('G');
    const vertices = [`${cx(gatewayBox)},${gatewayBox.y}`, `${cx(gatewayBox)},${bottom(gatewayBox)}`, `${gatewayBox.x},${gatewayBox.y + gatewayBox.height / 2}`, `${right(gatewayBox)},${gatewayBox.y + gatewayBox.height / 2}`];
    const first = flowBetween(laid, 'G', 'J').points[0]!;
    expect(vertices).toContain(`${first.x},${first.y}`);
  });

  it('the label of a gateway a loop leaves through the top stays clear of the loop as bpmn-js draws it (on one line, wider than its box)', async () => {
    // s20: "yes, another claim" rises from the top vertex of "Another claim?", whose name bpmn-js draws on one line
    const doc = await Doc.fromXml(readFileSync(join(import.meta.dirname, '..', '..', '..', 'tools', 'scenarios', 'controlflow__s20.bpmn'), 'utf8'));
    const laid = await layout('top-loop-label', doc);
    const gatewayBox = laid.box('Gateway_Another');
    expect(flowBetween(laid, 'Gateway_Another', 'Activity_Claim').points[0]).toEqual({ x: cx(gatewayBox), y: gatewayBox.y });
    expect(LayoutAnalysis.of(laid.out.definitions).problems.filter((problem) => problem.kind === 'labelOnLine' && problem.ids[0] === 'Gateway_Another')).toEqual([]);
  });

  it('lanes: a join whose entries rise into its bottom vertex leaves for a target below through its right vertex; a split with one entry keeps its drops', async () => {
    // the branches and the join's successor lie in the lane below split and join: Ship would leave J down the line Pack and Label rise on
    for (const kind of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway'] as const) {
      const named = kind !== 'parallelGateway';
      const laid = await layout(
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
      expectClean(laid);
      const gatewayBox = laid.box('G'), joinBox = laid.box('J'), taskBox = laid.box('T');
      for (const id of ['B1', 'B2']) {
        expect(flowBetween(laid, 'G', id).points[0], `${kind}: G -> ${id}`).toEqual({ x: cx(gatewayBox), y: bottom(gatewayBox) });
        expect(flowBetween(laid, id, 'J').points.at(-1), `${kind}: ${id} -> J`).toEqual({ x: cx(joinBox), y: bottom(joinBox) });
      }
      const out = flowBetween(laid, 'J', 'T').points;
      expect(out, kind).toEqual([{ x: right(joinBox), y: cy(joinBox) }, { x: right(joinBox) + 15, y: cy(joinBox) }, { x: right(joinBox) + 15, y: cy(taskBox) }, { x: taskBox.x, y: cy(taskBox) }]);
    }
    // o2c: the join's entries from Finance and Warehouse, and the fork's entry from Finance (it merges "ok" too): both leave for the lanes below through the right vertex
    const doc = await Doc.fromXml(readFileSync(join(import.meta.dirname, '..', '..', '..', 'tools', 'scenarios', 'agent__o2c.bpmn'), 'utf8'));
    const o2c = await layout('o2c-join-exits', doc);
    expect(LayoutAnalysis.of(o2c.out.definitions).problems.filter((problem) => problem.kind === 'inOut')).toEqual([]);
    const fork = o2c.box('Gateway_Fork'), join2 = o2c.box('Gateway_Join');
    for (const target of ['Activity_CreateInvoice', 'Activity_PickAndPack']) expect(flowBetween(o2c, 'Gateway_Fork', target).points[0], target).toEqual({ x: right(fork), y: cy(fork) });
    expect(flowBetween(o2c, 'Gateway_Join', 'Activity_ShipGoods').points[0]).toEqual({ x: right(join2), y: cy(join2) });
  });

  it('a loop into a gateway keeps off the top vertex a branch leaves through, as off a bottom vertex with a drop', async () => {
    // "other" leaves Which? up through its top (Step A blocks the way right), "rare" drops from its bottom: the loop "no" must not run down onto "other"
    const laid = await layout(
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
    const gatewayBox = laid.box('G');
    expect(flowBetween(laid, 'G', 'B').points[0]).toEqual({ x: cx(gatewayBox), y: gatewayBox.y });
    expect(flowBetween(laid, 'C', 'G').points.at(-1)).not.toEqual({ x: cx(gatewayBox), y: gatewayBox.y });
    expect(laid.report.inOutOverlaps).toEqual([]);
  });

  /** Order received -> Extras booked? (gift, express, an empty default branch "none") -> join -> Hand over parcel -> Done. */
  function emptyBranchDoc(lanes: Record<string, readonly string[]> | undefined, empty = true): Doc {
    const branches = [{ flowName: 'gift', nodes: [{ kind: 'task' as const, id: 'X', name: 'Wrap gift' }] }, { flowName: 'express', nodes: [{ kind: 'task' as const, id: 'Y', name: 'Book express' }] }, ...(empty ? [{ flowName: 'none', default: true, nodes: [] }] : [])];
    return proc([
      start('S', 'Order received'),
      { op: 'split', after: 'S', kind: 'inclusiveGateway', id: 'G', name: 'Extras booked?', joinId: 'J', branches },
      task('T', 'Hand over parcel', 'J'),
      end('E', 'T', 'Done'),
      ...(lanes ? [{ op: 'add', kind: 'participant', id: 'Org', name: 'Shop' } as EditCommand, ...Object.entries(lanes).map(([id, members]) => ({ op: 'add', kind: 'lane', id, name: id, in: 'P', members: [...members] }) as EditCommand)] : []),
    ]);
  }

  it('lanes: an empty branch whose row between split and join is free runs straight from the split into the join, and its band leaves no strip', async () => {
    // gift and express run in the lane below, so the split's row up to the join is empty
    const lanes = { Service: ['S', 'G', 'J', 'E'], Warehouse: ['X', 'Y', 'T'] } as const;
    const laid = await layout('lanes-empty-branch-straight', emptyBranchDoc(lanes));
    expectClean(laid);
    expectLabelsClear(laid);
    const gatewayBox = laid.box('G'), otherIndex = laid.box('J');
    expect(flowBetween(laid, 'G', 'J').points).toEqual([{ x: right(gatewayBox), y: cy(gatewayBox) }, { x: otherIndex.x, y: cy(otherIndex) }]);
    const without = await layout('lanes-no-empty-branch', emptyBranchDoc(lanes, false));
    for (const id of ['Service', 'Warehouse']) expect(laid.box(id), id).toEqual(without.box(id));
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
  function expectStraightRises(laid: Laid, joinId: string, sources: string[], what: string): void {
    const joinBox = laid.box(joinId);
    for (const id of sources) {
      const shapeBox = laid.box(id);
      expect(flowBetween(laid, id, joinId).points, `${what}: ${id} -> ${joinId}`).toEqual([{ x: right(shapeBox), y: cy(shapeBox) }, { x: cx(joinBox), y: cy(shapeBox) }, { x: cx(joinBox), y: bottom(joinBox) }]);
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
          ] as EditCommand[])
        : []),
    ]);
  }

  it('the entries of a join from below rise straight into its bottom vertex: a boundary path ending in the join\'s column moves the join one column right (without and with lanes)', async () => {
    for (const kind of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway'] as const) {
      for (const lanes of [false, true]) {
        const what = `${kind}${lanes ? ', lanes' : ''}`;
        const laid = await layout(`join-column-free-${kind}${lanes ? '-lanes' : ''}`, boundaryEndDoc(kind, lanes));
        expectClean(laid);
        expectLabelsClear(laid);
        expectStraightRises(laid, 'J', ['C', 'FB'], what);
        // Reminded keeps its place right after Send reminder, in its row; the join moved past it, the happy path stays straight
        const er = laid.box('ER'), sr = laid.box('SR');
        expect(cy(er), what).toBe(cy(sr));
        expect(flowBetween(laid, 'SR', 'ER').points, what).toEqual([{ x: right(sr), y: cy(sr) }, { x: er.x, y: cy(sr) }]);
        expect(right(er), what).toBeLessThan(laid.box('J').x);
        expectStraightLine(laid, ['S', 'R', 'G', 'Au', 'J', 'F', 'E']);
      }
    }
  });

  it('lanes: the order model in small: the entries from the lanes below rise straight into the join, which moves past the end of the boundary path in its lane', async () => {
    // Pick has a timer path Late -> Inform -> Informed in the join's lane; Informed would sit in the join's column, under it
    for (const kind of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway'] as const) {
      const laid = await layout(
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
      expect(laid.report.through, kind).toEqual([]);
      expect(laid.report.overlaps, kind).toEqual([]);
      expectStraightRises(laid, 'GJ', ['T1b', 'T2', 'T3'], kind);
      expect(right(laid.box('EL')), kind).toBeLessThan(laid.box('GJ').x);
      expectStraightLine(laid, ['S', 'A', 'G', 'GJ', 'E']);
      // only the timer path's way up to Inform crosses a line (Pack's into the join), as before
      expect(laid.report.crossings.length, kind).toBeLessThanOrEqual(1);
    }
  });

  it('a join moves as far right as the boundary path in its column goes on (two columns: Print goods, then Stopped)', async () => {
    const laid = await layout(
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
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightRises(laid, 'J', ['U1'], 'two columns');
    expect(right(laid.box('X'))).toBeLessThan(laid.box('J').x);
    expectStraightLine(laid, ['S', 'A', 'G', 'T0', 'T1', 'T2', 'J', 'B', 'E']);
  });

  it('a label in the join\'s column moves the join too: the entries keep off it, the label stays under its event', async () => {
    // the end of the reminder path sits left of the join's column, its one-word name reaches across it
    const laid = await layout(
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
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightRises(laid, 'J', ['C', 'FB'], 'label');
    const label = laid.shape('ER').label!;
    expect(cx(label)).toBe(cx(laid.box('ER')));
    expect(label.y).toBeGreaterThan(bottom(laid.box('ER')));
    expect(right(label)).toBeLessThan(cx(laid.box('J')));
  });

  it('a join stays where moving it right would add a crossing (Review case\'s run would cross the way up into Fine?, its route over the top does not)', async () => {
    const laid = await layout(
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
    expect(cx(laid.box('J'))).toBe(cx(laid.box('DX')));
    expect(flowBetween(laid, 'R', 'J').points[0]).toEqual({ x: cx(laid.box('R')), y: laid.box('R').y });
    expect(laid.report.crossings).toHaveLength(1);
  });

  it('a join stays where moving it right straightens none of its entries (controlflow__s22: the end event under it is in the way of its entry\'s own row)', async () => {
    const doc = await Doc.fromXml(readFileSync(join(import.meta.dirname, '..', '..', '..', 'tools', 'scenarios', 'controlflow__s22.bpmn'), 'utf8'));
    const laid = await layout('join-stays-s22', doc);
    // Gave up? -> Abandoned runs in the row the entry would run along: the entry leaves Gave up? upwards as before
    expect(cx(laid.box('Gateway_Complete_join'))).toBe(cx(laid.box('Event_Abandoned')));
    expect(flowBetween(laid, 'Gateway_GaveUp', 'Gateway_Complete_join').points[0]).toEqual({ x: cx(laid.box('Gateway_GaveUp')), y: laid.box('Gateway_GaveUp').y });
  });

  it('a join\'s move that is not kept is undone exactly, also on a scope the passes after placement already ran on (as in a process with lanes)', async () => {
    // controlflow__s22 laid out and routed; its join's column is still taken, so JoinColumnTrial tries the move once more
    const doc = await Doc.fromXml(readFileSync(join(import.meta.dirname, '..', '..', '..', 'tools', 'scenarios', 'controlflow__s22.bpmn'), 'utf8'));
    const scope = new ScopePlacer({ expanded: new Set(), collapsedScopes: new Map() }).layOut(doc.require('Process_S22'));
    const state = (): string =>
      JSON.stringify({
        nodes: scope.nodes.flatMap((node) => [node, ...node.boundary]).map((node) => [node.id, node.layer, node.row, node.band, node.width, node.box, node.topUsed]),
        edges: scope.edges.map((edge) => [edge.id, edge.bandRow, edge.bandY, edge.points, edge.label]),
        artifacts: scope.artifacts.map((artifact) => artifact.box),
        size: [scope.width, scope.height],
      });
    const drawn = state();
    const lines: string[] = [];
    await LayoutDebug.during(
      (line) => lines.push(line),
      async () =>
        new JoinColumnTrial(scope, (shifts) => {
          new ScopeGrid(scope).arrange(shifts);
          new ScopeArtifactPlacer(scope).placeAttached();
        }).run(),
    );
    expect(lines.filter((line) => line.startsWith('[joins]')).map((line) => line.split(':')[0])).toEqual(['[joins] Gateway_Complete_join stays']);
    expect(state()).toBe(drawn);
  });

  it('lanes: a join\'s trial measures the empty band where it is drawn (a loop over the top moved the content down, the band with it)', async () => {
    // generated (L118): b1 is an empty branch; the band of Print invoice? runs under Pack order only with the offset the loop over the top gave it
    const laid = await layout(
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
    expect(laid.report.through).toEqual([]);
    expect(longestHorizontalY(flowBetween(laid, 'G0', 'J0').points)).toBeGreaterThan(bottom(laid.box('U')));
    const joinBox = laid.box('J0');
    for (const id of ['G0', 'U']) {
      const [beforeLast, last] = flowBetween(laid, id, 'J0').points.slice(-2);
      expect([beforeLast, last], `${id} -> J0`).toEqual([{ x: cx(joinBox), y: beforeLast!.y }, { x: cx(joinBox), y: bottom(joinBox) }]);
    }
    expect(laid.box('H5').x).toBeLessThan(cx(joinBox));
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
    const laid = await layout('join-own-data', doc);
    expectClean(laid);
    expectStraightRises(laid, 'J', ['B2'], 'data');
    expect(laid.box('D').x).toBeGreaterThan(cx(laid.box('J')));
  });

  /**
   * The flow of boundary event `eventId` leaves the event downwards to a run that keeps 15 px from the shapes `passed`
   * and from the labels of them and of the event, and (`straight`) rises straight into the bottom of `targetId`, the
   * target right above its line. Returns the run's y.
   */
  function expectRunBelow(laid: Laid, eventId: string, targetId: string, passed: string[], what: string, straight = true): number {
    const ev = laid.box(eventId), targetBox = laid.box(targetId);
    const pts = flowBetween(laid, eventId, targetId).points;
    expect(pts[0], `${what}: out of the event's bottom`).toEqual({ x: cx(ev), y: bottom(ev) });
    expect(pts[1]!.x, what).toBe(cx(ev));
    const run = pts[1]!.y;
    expect(pts[2]!.y, `${what}: a horizontal run`).toBe(run);
    for (const id of [eventId, ...passed]) {
      const shape = laid.shape(id);
      for (const box of [shape.box, ...(shape.label ? [shape.label] : [])]) expect(run - bottom(box), `${what}: the run keeps off ${id}`).toBeGreaterThanOrEqual(15);
    }
    if (straight) expect(pts.slice(2), `${what}: straight up into ${targetId}`).toEqual([{ x: cx(targetBox), y: run }, { x: cx(targetBox), y: bottom(targetBox) }]);
    return run;
  }

  it('lanes: a boundary path into the lane above leaves its event downwards, runs below the host\'s row and its label, and rises straight into the handler, which moves right past the host\'s next task (the order model in small)', async () => {
    // Pick goods has a timer path After 2 days -> Inform customer -> Customer informed in the lane above; Inform customer
    // would sit in the column of Pack goods, the task after the host: the flow ran along Pack goods' bottom border and hooked in
    for (const kind of ['parallelGateway', 'exclusiveGateway', 'inclusiveGateway'] as const) {
      const laid = await layout(
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
      expect(laid.report.through, kind).toEqual([]);
      expect(laid.report.overlaps, kind).toEqual([]);
      expectLabelsClear(laid);
      expectRunBelow(laid, 'BT', 'TL', ['T1', 'T1b'], kind);
      // the handler right of Pack goods, its end right after it; the join right of both, its entries still rising straight
      const tl = laid.box('TL'), el = laid.box('EL');
      expect(tl.x, kind).toBeGreaterThan(right(laid.box('T1b')));
      expect(flowBetween(laid, 'TL', 'EL').points, kind).toEqual([{ x: right(tl), y: cy(tl) }, { x: el.x, y: cy(tl) }]);
      expectStraightRises(laid, 'GJ', ['T1b', 'T2', 'T3'], kind);
      expect(right(el), kind).toBeLessThan(laid.box('GJ').x);
      expectStraightLine(laid, ['S', 'A', 'G', 'GJ', 'E']);
      // only the timer's way up crosses a line (Pack goods' into the join), as before
      expect(laid.report.crossings.length, kind).toBeLessThanOrEqual(1);
    }
  });

  it('lanes: the lane of a boundary event holds the run of its way to the lane above 15 px from its bottom border (a label of two lines pushes the run down)', async () => {
    const laid = await layout(
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
    expectClean(laid);
    expect(laid.shape('BF').label!.height).toBeGreaterThan(20);
    const run = expectRunBelow(laid, 'BF', 'H', ['A', 'B'], 'two-line label');
    expect(bottom(laid.box('L2')) - run).toBeGreaterThanOrEqual(15);
    for (const id of ['A', 'B', 'E']) expect(bottom(laid.box(id)), id).toBeLessThan(bottom(laid.box('L2')));
  });

  it('a boundary flow into a node on the row above leaves its event downwards and runs below the host\'s row and the event\'s label, not along the host\'s bottom border (without lanes)', async () => {
    // Review claim (the second branch) has a timer whose path goes on with Notify, the task after the join
    const laid = await layout(
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
    expectClean(laid);
    expectLabelsClear(laid);
    expect(cy(laid.box('B'))).toBeGreaterThan(cy(laid.box('C')));
    expectRunBelow(laid, 'BT', 'C', ['B'], 'row above');
    expectStraightLine(laid, ['S', 'G', 'A', 'J', 'C', 'E']);
  });

  it('the run below the host\'s row on the bottom row is part of the scope: a pool or an expanded sub-process without lanes holds it 15 px from its border, an event sub-process below keeps off it (boundary labels of two and three lines)', async () => {
    // the scope without lanes was sized without the run: it lay on the frame's bottom border or below it, and through the
    // event sub-process placed under the content
    const claim = (name: string): EditCommand[] => [
      { op: 'split', after: 'S', id: 'G', name: 'Which way?', joinId: 'J', branches: [{ flowName: 'fast', nodes: [{ kind: 'task', id: 'A', name: 'Check order' }] }, { flowName: 'slow', nodes: [{ kind: 'userTask', id: 'B', name: 'Review claim' }] }] },
      task('C', 'Notify customer', 'J'),
      end('E', 'C', 'Done'),
      { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name, on: 'B', timer: 'P2D', nonInterrupting: true },
      { op: 'connect', source: 'BT', target: 'C' },
    ];
    const cancel: EditCommand[] = [
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
      for (const [laid, frame, where] of [[pool, 'Org', 'pool'], [sub, 'SP', 'expanded sub-process']] as const) {
        expect(laid.report.through, what(where)).toEqual([]);
        expect(laid.report.overlaps, what(where)).toEqual([]);
        const run = expectRunBelow(laid, 'BT', 'C', ['B'], what(where), false);
        const frameBox = laid.box(frame);
        expect(bottom(frameBox) - run, what(`${where}: the run keeps off the frame's bottom border`)).toBeGreaterThanOrEqual(15);
        for (const point of flowBetween(laid, 'BT', 'C').points) expect(contains(frameBox, { ...point, width: 0, height: 0 }), what(`${where}: (${point.x}, ${point.y}) inside`)).toBe(true);
      }
      const run = expectRunBelow(esp, 'BT', 'C', ['B'], what('event sub-process'), false);
      const box = esp.box('ESP');
      expect(box.y - run, what('event sub-process: below the run')).toBeGreaterThanOrEqual(15);
      expect(segments(flowBetween(esp, 'BT', 'C').points).some((segment) => segmentCutsBox(segment, box)), what('event sub-process: the flow keeps out')).toBe(false);
    }
  });

  it('a boundary flow into a node on the row above rises straight into it: the node moves right past the host\'s next task, which stood under it (without lanes)', async () => {
    // Late on Pick goods (the second branch) goes on with Inform customer on the first; Inform customer would sit in the
    // column of Pack goods, the task after the host
    const laid = await layout(
      'boundary-handler-column-free',
      proc([
        start('S', 'Start'),
        { op: 'split', after: 'S', kind: 'parallelGateway', id: 'G', joinId: 'J', branches: [{ nodes: [{ kind: 'task', id: 'PO', name: 'Prepare order' }, { kind: 'sendTask', id: 'Q', name: 'Inform customer' }] }, { nodes: [{ kind: 'userTask', id: 'K', name: 'Pick goods' }, { kind: 'task', id: 'N', name: 'Pack goods' }] }] },
        end('E', 'J', 'Done'),
        { op: 'add', kind: 'boundaryEvent:timer', id: 'BT', name: 'Late', on: 'K', timer: 'P2D', nonInterrupting: true },
        { op: 'connect', source: 'BT', target: 'Q' },
      ]),
    );
    expect(laid.report.through).toEqual([]);
    expect(laid.report.overlaps).toEqual([]);
    expectLabelsClear(laid);
    expectRunBelow(laid, 'BT', 'Q', ['K', 'N'], 'no lanes');
    expect(laid.box('Q').x).toBeGreaterThan(right(laid.box('N')));
    expectStraightRises(laid, 'J', ['N'], 'no lanes');
    expectStraightLine(laid, ['S', 'G', 'PO', 'Q', 'J', 'E']);
    // the way up crosses Pack goods' flow into the join, as the hook did
    expect(laid.report.crossings).toHaveLength(1);
  });

  it('a boundary flow to a target below whose way down would cut a data store hanging under the event keeps its side exit, not a line through the store', async () => {
    // the second data element of the host shifts right, under the boundary event
    const laid = await layout(
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
    const ev = laid.box('BT'), store = laid.box('D1');
    expect(store.x).toBeLessThan(cx(ev));
    expect(right(store)).toBeGreaterThan(cx(ev));
    expect(laid.report.through).toEqual([]);
    expect(laid.report.overlaps).toEqual([]);
  });

  it('lanes: a handler stays where moving it right would add a crossing (Inform\'s way up would cross Failed\'s into Fix), and Fix moves instead', async () => {
    // generated: two boundary paths into the lane above, Inform (Late on Pick) and Fix (Failed on Invoice), both in the column of Pack
    const lines: string[] = [];
    const laid = await LayoutDebug.during(
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
    const trials = lines.filter((line) => /^\[joins\] [HX] /.test(line));
    expect(trials.map((line) => line.split(':')[0])).toEqual(['[joins] H stays', '[joins] X moves 1 right']);
    // Inform's move would have given one more crossing (and no fewer cut shapes or labels run through)
    const [, was, would] = /: (\{.*?\}) -> (\{.*?\})/.exec(trials[0]!)!;
    const before = JSON.parse(was!) as { crossings: number; hits: number; rises: number }, after = JSON.parse(would!) as { crossings: number; hits: number; rises: number };
    expect(after.crossings).toBeGreaterThan(before.crossings);
    expect(after.hits).toBeGreaterThanOrEqual(before.hits);
    expect(cx(laid.box('H'))).toBe(cx(laid.box('V')));
    expect(laid.box('X').x).toBeGreaterThan(right(laid.box('V')));
    expectRunBelow(laid, 'B2', 'X', ['R'], 'Fix');
    // Late's way still leaves its event downwards and keeps off Pick's row, and hooks into Inform from the column gap
    expectRunBelow(laid, 'B', 'H', ['K', 'V'], 'Inform', false);
    expect(laid.report.through).toEqual([]);
    expect(laid.report.crossings).toHaveLength(3);
  });

  /** The id of the sequence flow from `source` to `target` in `doc`. */
  function flowId(doc: Doc, source: string, target: string): string {
    return idOf(doc.outgoing(doc.require(source)).find((outgoing) => idOf(outgoing.get<El>('targetRef')) === target)!);
  }

  /** `doc` with the sequence flow `id` moved to the start (`first`) or the end of its process's flow elements. */
  function moveFlow(doc: Doc, id: string, first = true): Doc {
    const process = many(doc.definitions, 'rootElements').find((root) => is(root, 'bpmn:Process'))!;
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
    const ops: EditCommand[] = [
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
      const laid = await layout(`boundary-run-routed-late-${routes.length}`, doc);
      expect(laid.report.crossings, order).toEqual([]);
      expect(laid.report.through, order).toEqual([]);
      expectRunBelow(laid, 'BE11', 'F', ['A1'], order, false);
      routes.push(flowBetween(laid, 'BE11', 'F').points);
    }
    expect(routes[1]).toEqual(routes[0]);
    expect(routes[2]).toEqual(routes[0]);
  });

  it('boundary events on one host take their runs below its row right to left: the rightmost event\'s run is the highest, so no sibling\'s drop crosses it (both file orders)', async () => {
    // generated (d-9): Late (right) goes on with the join, Escalated (left) with Ship goods after it; stacked in file
    // order, Late's drop crossed Escalated's run when Escalated's flow came first
    const ops: EditCommand[] = [
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
      const laid = await layout(`boundary-siblings-right-to-left-${first}`, doc);
      const what = `${first}'s flow first`;
      expect(laid.box('BL').x, what).toBeGreaterThan(laid.box('BS').x);
      expect(laid.report.crossings, what).toEqual([]);
      expect(laid.report.through, what).toEqual([]);
      const late = expectRunBelow(laid, 'BL', 'J', ['T8'], what, false), escalated = expectRunBelow(laid, 'BS', 'F', ['T8'], what, false);
      expect(late, what).toBeLessThan(escalated);
    }
  });

  it('a join moves right when that removes a crossing, though no entry rises straight more than before (as many straight rises, nothing worse)', async () => {
    // generated (r048): moving J4 right of the boundary path's end was rejected as it gained no straight rise; Check
    // customer's way into J4 then crossed Book case's flow and hooked into the join
    const lines: string[] = [];
    const laid = await LayoutDebug.during(
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
    const trial = lines.find((line) => line.startsWith('[joins] J4 '));
    expect(trial).toMatch(/^\[joins\] J4 moves \d right/);
    const [, was, now] = /: (\{.*?\}) -> (\{.*?\})/.exec(trial!)!;
    const before = JSON.parse(was!) as { crossings: number; rises: number }, after = JSON.parse(now!) as { crossings: number; rises: number };
    expect(after.crossings).toBeLessThan(before.crossings);
    expect(after.rises).toBe(before.rises);
    expect(laid.report.crossings).toEqual([]);
    expect(laid.report.through).toEqual([]);
    expectLabelsClear(laid);
    // the join right of Book case, Check customer's flow into its bottom vertex
    const joinBox = laid.box('J4'), pts = flowBetween(laid, 'T5', 'J4').points;
    expect(joinBox.x).toBeGreaterThan(right(laid.box('H9')));
    expect(pts[pts.length - 1]).toEqual({ x: cx(joinBox), y: bottom(joinBox) });
  });

  it('a node moves right when that uncuts a shape, at the cost of no more crossings than the shapes it uncuts', async () => {
    // generated (s-5): Ended (x) stood above Call invoice, the task after its host; every way up into it cut Call
    // invoice. Moving it right takes a crossing with Cancelled by customer's way, which a cut shape is worse than
    const laid = await layout(
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
    expect(laid.report.through).toEqual([]);
    expect(laid.report.crossings.length).toBeLessThanOrEqual(1);
    expect(laid.box('EE8').x).toBeGreaterThan(right(laid.box('F')));
  });

  it('two boundary flows into one task rise at different slots of its bottom, not on one line', async () => {
    // generated (m-5): Conditional and Signal received on Call order both go on with Call claim; both rose at its centre
    const laid = await layout(
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
    expect(laid.report.through).toEqual([]);
    expect(laid.report.crossings).toEqual([]);
    const callBox = laid.box('F');
    const ends = ['BE3', 'BE6'].map((id) => {
      const pts = flowBetween(laid, id, 'F').points;
      const [beforeLast, last] = pts.slice(-2) as [Point, Point];
      expect(last.y, `${id} ends on the bottom of Call claim`).toBe(bottom(callBox));
      expect(beforeLast.x, `${id} rises straight`).toBe(last.x);
      return last.x;
    });
    expect(ends[0]).not.toBe(ends[1]);
    expect(laid.report.inOutOverlaps).toEqual([]);
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
    expect(doc.layoutRequests.expansion().collapse).toEqual(['SP']);
    const laid = await layout('lanes-collapsed-boundary-labels', doc, { collapse: doc.layoutRequests.expansion().collapse });
    expect(laid.report.through).toEqual([]);
    expect(laid.report.labelClashes).toEqual([]);
    expectLabelsClear(laid);
    const bf = laid.shape('BF'), bt = laid.shape('BT');
    expect(bf.box.x).toBeLessThan(bt.box.x);
    // the left event's label left of it, the right one's right of it
    expect(right(bf.label!)).toBeLessThanOrEqual(bf.box.x);
    expect(bt.label!.x).toBeGreaterThanOrEqual(right(bt.box));
    expectLabelsOffRuns(laid);
  });

  /** No label of a shape sits on a horizontal run: the run keeps more than 2 px from its top and bottom edge (or crosses it: labelOnLine). */
  function expectLabelsOffRuns(laid: Laid): void {
    for (const plane of laid.planes) {
      for (const shape of plane.shapes.filter((candidate) => candidate.label)) {
        for (const edge of plane.edges) {
          for (const [start, end] of segments(edge.points)) {
            if (start.y !== end.y || Math.max(start.x, end.x) <= shape.label!.x || Math.min(start.x, end.x) >= right(shape.label!)) continue;
            expect(Math.abs(start.y - shape.label!.y) > 2 && Math.abs(start.y - bottom(shape.label!)) > 2, `${shape.id}'s label off ${edge.id} at y ${start.y}`).toBe(true);
          }
        }
      }
    }
  }

  it('lanes: a boundary event\'s label is not left on a horizontal run that only touches its box (it moves to a free spot)', async () => {
    // generated (r077): the hook of the split's flow into Ship case ran along the bottom edge of Failed's label
    const laid = await layout(
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
    expect(laid.report.through).toEqual([]);
    expectLabelsOffRuns(laid);
  });

  /**
   * The way of a boundary event over the top into its target (EdgeRouter): down out of the event's bottom, a short run
   * into a column gap beside the host, up past the host's row, along a run at least 15 px from every shape and label
   * in its x range (but its own label), down into the target's top. Returns the run's y.
   */
  function expectOverTop(laid: Laid, eventId: string, targetId: string, hostId: string, what: string): number {
    const ev = laid.box(eventId), targetBox = laid.box(targetId), host = laid.box(hostId);
    const flow = flowBetween(laid, eventId, targetId);
    const pts = flow.points;
    expect(pts, `${what}: ${pts.map((point) => `(${point.x}, ${point.y})`).join(' ')}`).toHaveLength(6);
    expect(pts[0], `${what}: out of the event's bottom`).toEqual({ x: cx(ev), y: bottom(ev) });
    expect(pts[1]!.x, `${what}: down`).toBe(cx(ev));
    expect(pts[2]!.y, `${what}: a short run below the host's row`).toBe(pts[1]!.y);
    const gx = pts[2]!.x;
    expect(gx < host.x || gx > right(host), `${what}: up beside the host (x ${gx})`).toBe(true);
    expect(pts[3]!.x, `${what}: up`).toBe(gx);
    const run = pts[3]!.y;
    expect(run, `${what}: over the host's row`).toBeLessThan(host.y);
    const tx = pts[5]!.x;
    expect(pts.slice(4), `${what}: along and down into ${targetId}'s top`).toEqual([{ x: tx, y: run }, { x: tx, y: targetBox.y }]);
    expect(tx > targetBox.x && tx < right(targetBox), `${what}: into ${targetId}'s top`).toBe(true);
    const lo = Math.min(gx, tx), hi = Math.max(gx, tx);
    for (const plane of laid.planes) {
      const boxes = [...plane.shapes.filter((shape) => !shape.container).flatMap((shape) => [shape.box, ...(shape.label ? [shape.label] : [])]), ...plane.edges.filter((edge) => edge !== flow && edge.label).map((edge) => edge.label!)];
      for (const box of boxes) {
        if (right(box) <= lo || box.x >= hi) continue;
        expect(box.y >= run + 15 || bottom(box) <= run - 15, `${what}: the run at ${run} keeps 15 px from (${box.x}, ${box.y}, ${box.width}, ${box.height})`).toBe(true);
      }
    }
    return run;
  }

  /**
   * A boundary event on its host's top border whose way goes over the top (TopBorderTrial, EdgeRouter):
   * straight up out of the event's top, along a run at least 15 px from every shape and label in its x range (its own
   * label above the host included), down into the target's top (`side`: into its left side from the column gap
   * before it). The event's label lies above the host, below the run. Returns the run's y.
   */
  function expectUpOverTop(laid: Laid, eventId: string, targetId: string, hostId: string, what: string, side = false): number {
    const ev = laid.box(eventId), targetBox = laid.box(targetId), host = laid.box(hostId);
    expect(cy(ev), `${what}: ${eventId} on ${hostId}'s top border`).toBe(host.y);
    const flow = flowBetween(laid, eventId, targetId);
    const pts = flow.points;
    expect(pts, `${what}: ${pts.map((point) => `(${point.x}, ${point.y})`).join(' ')}`).toHaveLength(side ? 5 : 4);
    expect(pts[0], `${what}: out of the event's top`).toEqual({ x: cx(ev), y: ev.y });
    expect(pts[1]!.x, `${what}: straight up`).toBe(cx(ev));
    const run = pts[1]!.y;
    expect(run, `${what}: over the host's row`).toBeLessThan(host.y);
    const tx = pts[2]!.x;
    expect(pts[2]!.y, `${what}: along`).toBe(run);
    if (side) {
      expect(tx, `${what}: down the gap before ${targetId}`).toBeLessThan(targetBox.x);
      expect(pts.slice(3), `${what}: into ${targetId}'s left side`).toEqual([{ x: tx, y: cy(targetBox) }, { x: targetBox.x, y: cy(targetBox) }]);
    } else {
      expect(pts[3], `${what}: down into ${targetId}'s top`).toEqual({ x: tx, y: targetBox.y });
      expect(tx > targetBox.x && tx < right(targetBox), `${what}: into ${targetId}'s top`).toBe(true);
    }
    const label = laid.shape(eventId).label;
    if (label) {
      expect(bottom(label), `${what}: ${eventId}'s label above the host`).toBeLessThanOrEqual(host.y);
      expect(label.x >= right(ev) || right(label) <= ev.x, `${what}: ${eventId}'s label beside the event`).toBe(true);
    }
    const lo = Math.min(cx(ev), tx), hi = Math.max(cx(ev), tx);
    for (const plane of laid.planes) {
      const boxes = [...plane.shapes.filter((shape) => !shape.container).flatMap((shape) => [shape.box, ...(shape.label ? [shape.label] : [])]), ...plane.edges.filter((edge) => edge !== flow && edge.label).map((edge) => edge.label!)];
      for (const box of boxes) {
        if (right(box) <= lo || box.x >= hi) continue;
        expect(box.y >= run + 15 || bottom(box) <= run - 15, `${what}: the run at ${run} keeps 15 px from (${box.x}, ${box.y}, ${box.width}, ${box.height})`).toBe(true);
      }
    }
    return run;
  }

  /** The crossings of the drawing that one flow takes part in. */
  const crossingsOf = (crossing: Laid, flowId: string): string[] => crossing.report.crossings.filter((crossing) => crossing.startsWith(`${flowId}x`) || crossing.endsWith(`x${flowId}`));

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
      ...(check ? [1, 2, 3, 4].flatMap((docNumber): EditCommand[] => [{ op: 'add', kind: 'dataObjectReference', id: `D${docNumber}`, name: `Doc ${docNumber}`, in: 'P' }, { op: 'connect', source: 'X', target: `D${docNumber}` }]) : []),
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
    const laid = await LayoutDebug.during(
      (line) => lines.push(line),
      async () => layout('lanes-boundary-over-top', paymentFailedDoc()),
    );
    expect(laid.report.through).toEqual([]);
    expect(laid.report.overlaps).toEqual([]);
    expect(laid.report.labelClashes).toEqual([]);
    expect(lines.filter((line) => line.startsWith('[boundary] BE12 '))).toEqual([expect.stringMatching(/^\[boundary\] BE12 moves to the top border/)]);
    const run = expectUpOverTop(laid, 'BE12', 'F', 'A1', 'r013');
    expect(run - laid.box('L0').y, 'the run keeps 15 px from the lane\'s top border').toBeGreaterThanOrEqual(15);
    const flow = flowBetween(laid, 'BE12', 'F');
    // it crosses no line; the drawing keeps the crossing the lanes force (score 5)
    expect(crossingsOf(laid, flow.id)).toEqual([]);
    expect(laid.report.crossings).toEqual(['Flow_PackOrderToInformOrderxFlow_BookDataToGateway']);
    expect(LayoutAnalysis.of(laid.out.model.definitions).score).toBeLessThanOrEqual(5);
    // the label to the upper right of the event, clear of the flows into and out of Pick invoice
    const label = laid.shape('BE12').label!, host = laid.box('A1');
    expect(label.x).toBeGreaterThan(right(laid.box('BE12')));
    expect(bottom(label)).toBeLessThanOrEqual(host.y);
    expect(laid.box('BE8').y, '2 days stays on the bottom border of Inform order').toBe(bottom(laid.box('T5')) - 18);
    const borders = ['L0', 'L1', 'L2', 'L3'].flatMap((id) => [laid.box(id).y, bottom(laid.box(id))]);
    for (const point of flow.points) expect(borders, `(${point.x}, ${point.y}) off the lane borders`).not.toContain(point.y);
  });

  it('lanes: a host in the first column sends its boundary flow over the top from its top border (r013 without the start event)', async () => {
    const doc = paymentFailedDoc();
    runOps(doc, [{ op: 'remove', ids: ['S'] }]);
    const laid = await layout('lanes-boundary-over-top-first-column', doc);
    expect(laid.report.through).toEqual([]);
    const host = laid.box('A1');
    expect(host.x, 'Pick invoice comes first').toBe(Math.min(...laid.planes[0]!.shapes.filter((shape) => !shape.container).map((shape) => shape.box.x)));
    expectUpOverTop(laid, 'BE12', 'F', 'A1', 'first column');
    expect(crossingsOf(laid, flowBetween(laid, 'BE12', 'F').id)).toEqual([]);
  });

  it('lanes: the lane of host and target grows to hold a way over the top and its label (a lane that is not the first: the lane above keeps its place and height)', async () => {
    // the split's three-line name above its diamond puts the run near the lane's top border, the flow's label above it
    const laid = await layout(
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
    expect(laid.report.through).toEqual([]);
    expect(laid.report.overlaps).toEqual([]);
    expect(laid.report.labelClashes).toEqual([]);
    // from the host's top border; the upper right of the event is the split's three-line label's, so the event's label
    // goes to its upper left
    const run = expectUpOverTop(laid, 'BT', 'F', 'A', 'middle lane');
    const lane = laid.box('L1'), flow = flowBetween(laid, 'BT', 'F'), label = flow.label!, own = laid.shape('BT').label!;
    expect(right(own), 'Payment failed left of the event').toBeLessThanOrEqual(laid.box('BT').x);
    expect(run - lane.y, 'the run keeps 15 px from the lane\'s top border').toBeGreaterThanOrEqual(15);
    expect(label.y, 'its label inside the lane').toBeGreaterThanOrEqual(lane.y);
    expect(bottom(label)).toBeLessThanOrEqual(run);
    expect(contains(lane, own), 'the event\'s label inside the lane').toBe(true);
    const office = laid.box('L0');
    expect(office.height, 'the empty lane above keeps its height').toBe(120);
    expect(bottom(office)).toBe(lane.y);
    // the way below crossed the split's drops and the branches' ways into the join (four lines), the way over the top
    // from the bottom border Start's flow; this one none
    expect(laid.report.crossings).toEqual([]);
  });

  /** generated (on-34): Failed on Inform data goes on with the second join; the compensation handler under its sibling blocks the way below everything */
  const failedToJoinOps = (where = 'P'): EditCommand[] => [
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
      const laid = await layout(`boundary-over-top-${where}`, doc);
      expect(laid.report.through, where).toEqual([]);
      expect(laid.report.overlaps, where).toEqual([]);
      expect(laid.report.labelClashes, where).toEqual([]);
      const run = expectUpOverTop(laid, 'BE12', 'J8', 'A1', where);
      const joinBox = laid.box('J8'), flow = flowBetween(laid, 'BE12', 'J8');
      expect(flow.points[flow.points.length - 1], `${where}: into the top vertex`).toEqual({ x: cx(joinBox), y: joinBox.y });
      expect(laid.report.crossings, where).toEqual([]);
      // the compensation event stays on the bottom border, its handler right under it
      const comp = laid.box('BE13'), handler = laid.box('C14');
      expect(cy(comp), `${where}: Signal received on the bottom border`).toBe(bottom(laid.box('A1')));
      expect(cx(handler), `${where}: Undo customer under Signal received`).toBe(cx(comp));
      if (!frame) continue;
      const frameBox = laid.box(frame);
      expect(run - frameBox.y, `${where}: the run keeps 15 px from the frame's top border`).toBeGreaterThanOrEqual(15);
      for (const label of [flow.label!, laid.shape('BE12').label!]) expect(contains(frameBox, label), `${where}: the labels inside the frame`).toBe(true);
      expect(contains(frameBox, laid.box('BE12')), `${where}: the event inside the frame`).toBe(true);
    }
  });

  it('a loop over the top keeps off a boundary event\'s way over the top: it does not hook into its target along that run', async () => {
    // generated (om-19): 2 days on Inform order goes on with Notify order over the top; the loop again from Ok? back to
    // Inform order hooked into Inform order's top along the run (two flows on one line for 80 px)
    const laid = await layout(
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
    expect(laid.report.through).toEqual([]);
    // from its host's top border: the run starts above the host, the loop runs below
    expectUpOverTop(laid, 'BE6', 'F', 'A1', 'om-19');
    const way = segments(flowBetween(laid, 'BE6', 'F').points), loop = segments(flowBetween(laid, 'D', 'A1').points);
    for (const waySegment of way) for (const loopSegment of loop) expect(collinearOverlap(waySegment, loopSegment), `${JSON.stringify(waySegment)} / ${JSON.stringify(loopSegment)}`).toBeLessThanOrEqual(0);
  });

  it('lanes: a node that a boundary event\'s way enters over the top is not moved for a rise into its bottom it does not have (r013 with data objects in Pack data\'s column)', async () => {
    // JoinColumnTrial moved Pack data right past the data object under it, for the straight rise of a way it then
    // drew over the top
    const lines: string[] = [];
    const laid = await LayoutDebug.during(
      (line) => lines.push(line),
      async () => layout('lanes-boundary-over-top-no-move', paymentFailedDoc(true)),
    );
    expect(lines.filter((line) => line.startsWith('[joins] F '))).toEqual(['[joins] F stays: entered over the top']);
    expect(laid.report.through).toEqual([]);
    // then the event goes to the top border (TopBorderTrial runs after the joins' moves)
    expectUpOverTop(laid, 'BE12', 'F', 'A1', 'r013 with data');
  });

  it('lanes: a way over the top passes under no other boundary event of its host (their drops are routed after it): the three ways of Book invoice cross none of each other', async () => {
    // generated (ot-50): 2 days, the rightmost event, went over the top through the gap before Book invoice; its short run
    // passed under Failed and Late, whose drops then crossed it
    const laid = await layout(
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
    expect(laid.report.through).toEqual([]);
    const ways = [flowBetween(laid, 'BE14', 'J3'), flowBetween(laid, 'BE15', 'J9'), flowBetween(laid, 'BE16', 'F')];
    for (const way of ways) for (const otherWay of ways) if (way !== otherWay) expect(laid.report.crossings, `${way.id} / ${otherWay.id}`).not.toContain(`${way.id}x${otherWay.id}`);
    for (const [ev, way] of [['BE14', ways[0]!], ['BE15', ways[1]!], ['BE16', ways[2]!]] as const) {
      // the ways over the top
      if (Math.min(...way.points.map((point) => point.y)) >= laid.box('A1').y) continue;
      const [start, end] = [way.points[1]!, way.points[2]!];
      for (const other of ['BE14', 'BE15', 'BE16']) {
        if (other === ev) continue;
        const centerX = cx(laid.box(other));
        expect(centerX > Math.min(start.x, end.x) && centerX < Math.max(start.x, end.x), `${ev}'s run below the row passes under ${other}`).toBe(false);
      }
    }
  });

  it('a boundary flow keeps its way below where that crosses no line but runs through labels (they move off it) and a way over the top from the bottom border would cross one; from the top border of its host (an expanded sub-process) it crosses none and runs through no label', async () => {
    // generated (ol-23): Cancelled by customer on Inform invoice rose straight into Book claim through the default spots
    // of Book claim's boundary labels; the way over the top crossed Start's flow. Book claim's events rise straight into
    // Pack invoice, clean: they stay on the bottom border
    const laid = await layout(
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
    expect(laid.report.through).toEqual([]);
    expect(laid.report.crossings).toEqual([]);
    for (const [ev, targetId] of [['BE7', 'F'], ['BE8', 'F']] as const) {
      const pts = flowBetween(laid, ev, targetId).points;
      expect(Math.min(...pts.map((point) => point.y)), `${ev} -> ${targetId} enters from below`).toBe(bottom(laid.box(targetId)));
      expect(cy(laid.box(ev)), `${ev} on the bottom border`).toBe(bottom(laid.box('A5')));
    }
    const run = expectUpOverTop(laid, 'BE6', 'A5', 'SP1', 'ol-23');
    // the event at the right end of the sub-process's top border, off its title; its label inside the lane
    const sp = laid.box('SP1'), ev = laid.box('BE6'), title = titleBox(sp, 'Inform invoice')!;
    expect(cx(ev)).toBe(right(sp) - 25);
    expect(ev.x).toBeGreaterThan(right(title));
    expect(run - laid.box('L2').y).toBeGreaterThanOrEqual(15);
    expect(contains(laid.box('L2'), laid.shape('BE6').label!)).toBe(true);
  });

  /**
   * Pick invoice (no lanes) with the timer Payment failed going on with Pack data after the join and the error event
   * Rejected with its own handler below (`host`: the host, an expanded sub-process with content when `sub`).
   */
  function twoEventsDoc(sub = false): Doc {
    return proc([
      start('S', 'Start'),
      ...(sub
        ? [{ op: 'add', kind: 'subProcess', id: 'A1', name: 'Handle claim', after: 'S' } as AddElement, start('SS', undefined, { in: 'A1' }), task('ST', 'Check claim', 'SS'), end('SE', 'ST')]
        : [{ op: 'add', kind: 'userTask', id: 'A1', name: 'Pick invoice', after: 'S' } as AddElement]),
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
      const laid = await LayoutDebug.during(
        (line) => lines.push(line),
        async () => layout(`boundary-top-border-one-of-two${sub ? '-sub' : ''}`, twoEventsDoc(sub)),
      );
      expect(laid.report.through, what).toEqual([]);
      expect(laid.report.overlaps, what).toEqual([]);
      expect(laid.report.labelClashes, what).toEqual([]);
      // from the bottom border the way below everything crossed Rejected's drop (score 5)
      expect(laid.report.crossings, what).toEqual([]);
      expect(lines.filter((line) => line.startsWith('[boundary] ')), what).toEqual([expect.stringMatching(/^\[boundary\] BE12 moves to the top border/)]);
      expectUpOverTop(laid, 'BE12', 'F', 'A1', what);
      const host = laid.box('A1'), rejected = laid.box('BE13');
      expect(cx(laid.box('BE12')), `${what}: Payment failed at the right end of the top border`).toBe(right(host) - 25);
      expect(cy(rejected), `${what}: Rejected on the bottom border`).toBe(bottom(host));
      expect(cx(rejected), `${what}: Rejected keeps its place, the second from the right`).toBe(right(host) - 69);
      expect(flowBetween(laid, 'BE13', 'H').points[0], `${what}: Rejected's flow leaves downwards`).toEqual({ x: cx(rejected), y: bottom(rejected) });
      expect(laid.shape('BE13').label!.x, `${what}: its label right of it, below the host`).toBeGreaterThan(right(rejected));
      if (sub) expect(laid.box('BE12').x, 'off the title').toBeGreaterThan(right(titleBox(host, 'Handle claim')!));
      expect(LayoutAnalysis.of(laid.out.model.definitions).score, what).toBe(0);
    }
  });

  it('lanes: two boundary events of one host on its top border nest their ways (the one with the nearer target on the right): no crossing, their labels apart (r013 with a second event into the join)', async () => {
    const doc = paymentFailedDoc();
    runOps(doc, [
      { op: 'add', kind: 'boundaryEvent:message', id: 'BE14', on: 'A1', name: 'Paid', message: 'Paid', nonInterrupting: true },
      { op: 'connect', source: 'BE14', target: 'J3' },
    ]);
    const laid = await layout('lanes-boundary-top-border-two', doc);
    expect(laid.report.through).toEqual([]);
    expect(laid.report.overlaps).toEqual([]);
    expect(laid.report.labelClashes).toEqual([]);
    // from the bottom border: score 30 (the ways below cross the branches in the lanes below, the one over the top Start's flow)
    expect(laid.report.crossings).toEqual(['Flow_PackOrderToInformOrderxFlow_BookDataToGateway']);
    const host = laid.box('A1');
    expect(cx(laid.box('BE14')), 'Paid (into the join) on the right').toBe(right(host) - 25);
    expect(cx(laid.box('BE12')), 'Payment failed (into Pack data) left of it').toBe(right(host) - 69);
    const inner = expectUpOverTop(laid, 'BE14', 'J3', 'A1', 'Paid');
    const outer = expectUpOverTop(laid, 'BE12', 'F', 'A1', 'Payment failed');
    expect(outer, 'the outer way runs above the inner one').toBeLessThan(inner);
    const paid = laid.shape('BE14').label!, failed = laid.shape('BE12').label!;
    expect(paid.x, 'Paid\'s label to its upper right').toBeGreaterThan(right(laid.box('BE14')));
    expect(right(failed), 'Payment failed\'s label to its upper left').toBeLessThan(laid.box('BE12').x);
    expect(boxesOverlap(paid, failed)).toBe(false);
  });

  it('a boundary event stays on the bottom border where its way from the top border would be worse: the node of the row above stands right above its host', async () => {
    // generated: Too late on Order goods (the "no" branch) goes on with Ship order; Check stock (the "yes" branch) is in
    // its column on the row above, so a way up out of the top border cuts it; the way below crosses Wait for goods' way
    // into the join and stays
    const lines: string[] = [];
    const laid = await LayoutDebug.during(
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
    expect(lines.filter((line) => line.startsWith('[boundary] '))).toEqual([expect.stringMatching(/^\[boundary\] BT stays on the bottom border: .* \(not up\)$/)]);
    const host = laid.box('H'), ev = laid.box('BT');
    expect(cy(ev)).toBe(bottom(host));
    expect(flowBetween(laid, 'BT', 'F').points[0]).toEqual({ x: cx(ev), y: bottom(ev) });
    expect(laid.report.through).toEqual([]);
    expect(laid.report.crossings).toHaveLength(1);
  });

  it('lanes: a boundary event\'s flow to an end below whose drop is blocked runs in a channel its lane holds 15 px from its border, also when no way below holds the lane open (m-9: the other event goes over the top from its top border)', async () => {
    // generated (m-9): 2 days on Book order drops through the data store into a channel below Undo data; Cancelled by
    // customer's way below everything held the lane open, from the top border it no longer does (the channel lay on the
    // lane border)
    const laid = await layout(
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
    expectUpOverTop(laid, 'BE5', 'F', 'A1', 'm-9');
    const channel = flowBetween(laid, 'BE6', 'EE7').points[1]!.y;
    expect(bottom(laid.box('L0')) - channel, 'the channel 15 px inside its lane').toBeGreaterThanOrEqual(15);
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
    const laid = await layout('pools-boundary-top-border-message', doc);
    expectUpOverTop(laid, 'BE12', 'F', 'A1', 'with a message flow into Pick invoice');
    const message = laid.planes.flatMap((plane) => plane.edges).find((edge) => is(edge.el, 'bpmn:MessageFlow'))!;
    const ev = laid.box('BE12'), label = laid.shape('BE12').label!;
    expect(message.points[message.points.length - 1]!.y, 'into the top of Pick invoice').toBe(laid.box('A1').y);
    for (const segment of segments(message.points)) {
      expect(segmentHitsBox(segment, ev, 0), `${JSON.stringify(segment)} keeps off Payment failed`).toBe(false);
      expect(segmentHitsBox(segment, label, 0), `${JSON.stringify(segment)} keeps off its label`).toBe(false);
    }
    expect(laid.report.crossings).toEqual([]);
  });

  it('a boundary event with a note keeps the bottom border (the note hangs below the host): its way goes over the top from there (r013 with a note on the timer)', async () => {
    const doc = paymentFailedDoc();
    runOps(doc, [{ op: 'add', kind: 'textAnnotation', id: 'N', text: 'Reminder after two days', to: 'BE12' }]);
    const lines: string[] = [];
    const laid = await LayoutDebug.during(
      (line) => lines.push(line),
      async () => layout('lanes-boundary-note-bottom', doc),
    );
    expect(lines.filter((line) => line.startsWith('[boundary] '))).toEqual([]);
    expect(cy(laid.box('BE12'))).toBe(bottom(laid.box('A1')));
    expectOverTop(laid, 'BE12', 'F', 'A1', 'with a note');
    expect(laid.box('N').y, 'the note below the host').toBeGreaterThan(bottom(laid.box('A1')));
  });

  /** start -> "Poll status" -> end with a named self loop on the task. */
  function selfLoopDoc(): Doc {
    return proc([start('S'), task('A', 'Poll status', 'S'), end('E', 'A'), { op: 'connect', source: 'A', target: 'A', name: 'again' }]);
  }

  it('self loop is drawn as a small orthogonal loop under the task', async () => {
    const laid = await layout('self-loop', selfLoopDoc());
    expectClean(laid);
    expectStraightLine(laid, ['S', 'A', 'E']);
    const loop = flowBetween(laid, 'A', 'A');
    const taskBox = laid.box('A');
    expect(loop.points).toHaveLength(4);
    for (const point of loop.points) {
      expect(point.y).toBeGreaterThanOrEqual(bottom(taskBox));
      expect(point.x).toBeGreaterThan(taskBox.x);
      expect(point.x).toBeLessThan(right(taskBox));
    }
    expect(loop.points[0]!.y).toBe(bottom(taskBox));
    expect(loop.points[3]!.y).toBe(bottom(taskBox));
  });

  // ENGINE DEFECT (EdgeRouter flowLabel for back edges): the self-loop label is put left of the loop's right end,
  // inside the loop, where the loop's left vertical line runs through the text.
  it('self loop label sits outside the loop, clear of its lines', async () => {
    const laid = await layout('self-loop-label', selfLoopDoc());
    expectClean(laid);
    expectLabelsClear(laid);
    const loop = flowBetween(laid, 'A', 'A');
    const label = loop.label!;
    const loopY = Math.max(...loop.points.map((point) => point.y));
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
    const laid = await layout('boundary', boundaryDoc());
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightLine(laid, ['S', 'A', 'B', 'E']);
    const taskBox = laid.box('A');
    for (const taskId of ['T', 'X']) {
      const eb = laid.box(taskId);
      // on the bottom border of the host, inside its width
      expect(cy(eb)).toBe(bottom(taskBox));
      expect(eb.x).toBeGreaterThanOrEqual(taskBox.x);
      expect(right(eb)).toBeLessThanOrEqual(right(taskBox));
    }
    // label to the right of the event, below the host
    const tl = laid.shape('T').label!;
    expect(tl.x).toBeGreaterThanOrEqual(right(laid.box('T')));
    expect(tl.y).toBeGreaterThanOrEqual(bottom(taskBox));
    expect(laid.box('T').x).not.toBe(laid.box('X').x);
    // handler paths are bands below the host, in declaration order, and start with a drop from the event
    expect(laid.box('R').y).toBeGreaterThan(bottom(taskBox));
    expect(laid.box('H').y).toBeGreaterThan(bottom(laid.box('R')));
    expectStraightLine(laid, ['R', 'RE']);
    expectStraightLine(laid, ['H', 'HE']);
    for (const [ev, handler] of [
      ['T', 'R'],
      ['X', 'H'],
    ] as const) {
      const drop = flowBetween(laid, ev, handler);
      expect(drop.points[0]).toEqual({ x: cx(laid.box(ev)), y: bottom(laid.box(ev)) });
      expect(drop.points[drop.points.length - 1]!.y).toBe(cy(laid.box(handler)));
    }
  });

  // ENGINE DEFECT (ScopeLabels.of 'boundary'): every boundary label goes right of its event, so with two
  // named boundary events on one host the label of the left one runs into the right event and its label.
  it('two named boundary events on one host: their labels collide with nothing', async () => {
    const laid = await layout('boundary-two-names', boundaryDoc('failed'));
    expectClean(laid);
    expectLabelsClear(laid);
    const xl = laid.shape('X').label!;
    expect(boxesOverlap(xl, laid.box('T'))).toBe(false);
    expect(boxesOverlap(xl, laid.shape('T').label!)).toBe(false);
  });

  // ENGINE DEFECT (ScopeLabels.of 'boundary' + label size estimate): a boundary name estimated at two
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
    const laid = await layout('boundary-long-name', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expect(laid.shape('ShipFailed').label!.y).toBeGreaterThanOrEqual(bottom(laid.box('Ship')));
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
    const laid = await layout('nested-sub-loop', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expect(laid.planes).toHaveLength(1);
    expect(laid.shape('Sub').expanded).toBe(true);
    expect(laid.shape('Inner').expanded).toBe(true);
    expectStraightLine(laid, ['S', 'Sub', 'E']);
    expectStraightLine(laid, ['S2', 'T1', 'Inner', 'G', 'E2']);
    expectStraightLine(laid, ['S3', 'T3', 'E3']);
    // children stay inside their (expanded) parent, with room for the header
    for (const id of ['S2', 'T1', 'Inner', 'G', 'E2']) expect(contains(laid.box('Sub'), laid.box(id)), `${id} inside Sub`).toBe(true);
    for (const id of ['S3', 'T3', 'E3']) expect(contains(laid.box('Inner'), laid.box(id)), `${id} inside Inner`).toBe(true);
    expect(laid.box('S2').y).toBeGreaterThan(laid.box('Sub').y + 30);
    // the internal loop stays inside the sub-process and goes around T1 .. G
    const loop = flowBetween(laid, 'G', 'T1');
    expectRoutedAround(laid, loop, ['T1', 'Inner', 'G'], 'T1');
    for (const point of loop.points) {
      expect(point.x).toBeGreaterThan(laid.box('Sub').x);
      expect(point.x).toBeLessThan(right(laid.box('Sub')));
      expect(point.y).toBeGreaterThan(laid.box('Sub').y);
      expect(point.y).toBeLessThan(bottom(laid.box('Sub')));
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
    const laid = await layout('subprocess-row-parity', doc);
    expect(laid.box('Long').height % 2).not.toBe(laid.box('Ship').height % 2);
    expectClean(laid);
    for (const [sourceId, targetId] of [['Long', 'Ship'], ['Ship', 'T']]) {
      const pts = flowBetween(laid, sourceId!, targetId!).points;
      expect(pts, `${sourceId} -> ${targetId}`).toHaveLength(2);
      expect(pts[0]!.y, `${sourceId} -> ${targetId}`).toBe(pts[1]!.y);
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
    expect(doc.layoutRequests.expansion().collapse).toEqual(['Sub']);
    const laid = await layout('collapsed-sub', doc, { collapse: doc.layoutRequests.expansion().collapse });
    expectClean(laid);
    expectLabelsClear(laid);
    expect(laid.planes).toHaveLength(2);
    const [main, sub] = laid.planes as [Plane, Plane];
    expect(idOf(main.el)).toBe('P');
    expect(idOf(sub.el)).toBe('Sub');
    expect(main.shapes.map((shape) => shape.id).sort()).toEqual(['E', 'S', 'Sub']);
    expect(sub.shapes.map((shape) => shape.id).sort()).toEqual(['E2', 'S2', 'T1', 'T2']);
    expect(sub.edges).toHaveLength(3);
    expect(main.shapes.find((shape) => shape.id === 'Sub')!.expanded).toBe(false);
    expectStraightLine(laid, ['S', 'Sub', 'E']);
    expectStraightLine(laid, ['S2', 'T1', 'T2', 'E2']);
    // the collapsed marker is a task-sized box, and the re-import remembers the collapse
    expect(laid.box('Sub')).toMatchObject({ width: 100, height: 80 });
    expect(laid.xml).toMatch(/bpmnElement="Sub"(?! isExpanded="true")/);
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
    const laid = await layout('event-sub', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightLine(laid, ['S', 'A', 'B', 'E']);
    expectStraightLine(laid, ['ES_S', 'ES_T', 'ES_E']);
    const es = laid.box('ES');
    expect(laid.shape('ES').expanded).toBe(true);
    const mainBottom = Math.max(...['S', 'A', 'B', 'E'].map((id) => bottom(laid.box(id))));
    expect(es.y).toBeGreaterThan(mainBottom);
    expect(es.x).toBeGreaterThanOrEqual(laid.box('S').x);
    for (const id of ['ES_S', 'ES_T', 'ES_E']) expect(contains(es, laid.box(id)), `${id} inside ES`).toBe(true);
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
    const laid = await layout('collab', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expect(laid.planes).toHaveLength(1);
    expect(idOf(laid.planes[0]!.el)).toBe(doc.collaboration()!.get('id'));
    // named after the process of its first pool
    expect(idOf(laid.planes[0]!.el)).toBe('Collaboration_Customer');
    const customer = laid.box('Customer'), shop = laid.box('Shop'), bank = laid.box('Bank');
    // stacked vertically in declaration order, left-aligned, same width
    expect(customer.y + customer.height).toBeLessThan(shop.y);
    expect(shop.y + shop.height).toBeLessThan(bank.y);
    expect(new Set([customer.x, shop.x, bank.x]).size).toBe(1);
    expect(new Set([customer.width, shop.width, bank.width]).size).toBe(1);
    expect(bank.height).toBeLessThan(shop.height);
    // every node sits in its pool, right of the header
    for (const id of ['CS', 'C1', 'C2', 'CE']) expect(contains({ ...customer, x: customer.x + 30, width: customer.width - 30 }, laid.box(id)), `${id} in Customer`).toBe(true);
    for (const id of ['SS', 'S1', 'S2', 'SE']) expect(contains({ ...shop, x: shop.x + 30, width: shop.width - 30 }, laid.box(id)), `${id} in Shop`).toBe(true);
    expectStraightLine(laid, ['CS', 'C1', 'C2', 'CE']);
    expectStraightLine(laid, ['SS', 'S1', 'S2', 'SE']);
    // message flows dock on the top / bottom borders and the one to the black box ends on the pool
    for (const mf of laid.out.messageFlows()) {
      const edge = laid.edge(idOf(mf));
      const sourceBox = laid.box(idOf(mf.get<El>('sourceRef'))), targetBox = laid.box(idOf(mf.get<El>('targetRef')));
      const first = edge.points[0]!, last = edge.points[edge.points.length - 1]!;
      expect([sourceBox.y, bottom(sourceBox)]).toContain(first.y);
      expect([targetBox.y, bottom(targetBox)]).toContain(last.y);
      expect(edge.label).toBeDefined();
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
  function expectLaneConventions(laid: Laid, lanes: Record<string, 'L1' | 'L2' | 'L3'>): void {
    const pool = laid.box('Org');
    const l1 = laid.box('L1'), l2 = laid.box('L2'), l3 = laid.box('L3');
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
    for (const [id, lane] of Object.entries(lanes)) expect(contains(boxes[lane], laid.box(id)), `${id} inside ${lane}`).toBe(true);
    // still left to right, and the nodes of one lane line up
    const order = ['S', 'A', 'B', 'C', 'D', 'F', 'G', 'E'];
    for (let index = 0; index + 1 < order.length; index++) expect(laid.box(order[index + 1]!).x).toBeGreaterThan(right(laid.box(order[index]!)));
    for (const lane of ['L1', 'L2', 'L3']) {
      const ys = Object.keys(lanes).filter((id) => lanes[id] === lane).map((id) => cy(laid.box(id)));
      expect(new Set(ys).size, `nodes of ${lane} on one line`).toBe(1);
    }
    // every flow leaves through the right or bottom border and enters through the left, top or bottom border
    for (const flow of laid.out.allSequenceFlows()) {
      const edge = laid.edge(idOf(flow));
      const sourceBox = laid.box(idOf(flow.get<El>('sourceRef'))), targetBox = laid.box(idOf(flow.get<El>('targetRef')));
      const first = edge.points[0]!, last = edge.points[edge.points.length - 1]!;
      expect(first.x === right(sourceBox) || first.y === bottom(sourceBox), `${edge.id} leaves ${idOf(flow.get<El>('sourceRef'))} right or below`).toBe(true);
      expect(last.x === targetBox.x || last.y === bottom(targetBox) || last.y === targetBox.y, `${edge.id} enters ${idOf(flow.get<El>('targetRef'))} left, above or below`).toBe(true);
    }
  }

  it('lanes (3) with a zig-zag flow: lanes are horizontal bands, nodes stay in their lane', async () => {
    // Employee -> Controlling -> Management -> Controlling -> Employee -> Employee -> Management -> Employee
    const lanes = { S: 'L1', A: 'L2', B: 'L3', C: 'L2', D: 'L1', F: 'L1', G: 'L3', E: 'L1' } as const;
    const laid = await layout('lanes-zigzag', lanesDoc(lanes));
    expectClean(laid);
    expectLabelsClear(laid);
    expectLaneConventions(laid, lanes);
  });

  // ENGINE DEFECT (EdgeRouter: entryX and exitX are both the node centre): at a peak (D: in from the lane below,
  // out to the lane below) the incoming and the outgoing flow share the vertical line under D, which reads as
  // one line with an arrow in the middle.
  it('lanes zig-zag with a peak: the flows into and out of the peak do not share a line', async () => {
    // Employee -> Controlling -> Management -> Controlling -> Employee (peak) -> Management -> Employee
    const lanes = { S: 'L1', A: 'L2', B: 'L3', C: 'L2', D: 'L1', F: 'L3', G: 'L1', E: 'L1' } as const;
    const laid = await layout('lanes-peak', lanesDoc(lanes));
    expectClean(laid);
    expectLabelsClear(laid);
    expectLaneConventions(laid, lanes);
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
              { op: 'add', kind: 'exclusiveGateway', id: 'M', after: 'C', flowName: 'yes' } as AddElement,
              task('U', 'Update', 'M'),
              { op: 'add', kind: 'exclusiveGateway', id: 'K', name: 'Again?', after: 'U' } as AddElement,
              end('E', 'K', 'End', { flowName: 'no' }),
              { op: 'connect', source: 'K', target: 'M', name: 'yes' } as EditCommand,
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
      const laid = await layout(name, loops(merge));
      expectClean(laid);
      const l1 = laid.box('L1');
      expect(bottom(l1), name).toBe(laid.box('L2').y);
      for (const [from, to] of flows) {
        const runY = longestHorizontalY(flowBetween(laid, from, to).points)!;
        expect(runY, `${name} ${from} -> ${to}`).toBeGreaterThan(bottom(laid.box(to)));
        expect(runY, `${name} ${from} -> ${to}`).toBeLessThanOrEqual(bottom(l1) - 15);
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
      const laid = await layout(`lane-loop-top-${first ? 'first' : 'second'}`, doc);
      expectClean(laid);
      const lane = laid.box(first ? 'L1' : 'L2');
      expect(bottom(laid.box('L1'))).toBe(laid.box('L2').y);
      const runY = longestHorizontalY(flowBetween(laid, 'C', 'T').points)!;
      expect(runY, `first lane: ${first}`).toBeLessThan(laid.box('T').y);
      expect(runY, `first lane: ${first}`).toBeGreaterThanOrEqual(lane.y + 15);
    }
  });

  /** Every end point of the sequence flows lies on the border of its shape. */
  function expectFlowsAttached(laid: Laid): void {
    const onBorder = (point: Point, box: Box): boolean =>
      point.x >= box.x && point.x <= right(box) && point.y >= box.y && point.y <= bottom(box) && (point.x === box.x || point.x === right(box) || point.y === box.y || point.y === bottom(box));
    for (const flow of laid.out.allSequenceFlows()) {
      const edge = laid.edge(idOf(flow));
      const sourceId = idOf(flow.get<El>('sourceRef')), targetId = idOf(flow.get<El>('targetRef'));
      expect(onBorder(edge.points[0]!, laid.box(sourceId)), `${edge.id} starts on ${sourceId}`).toBe(true);
      expect(onBorder(edge.points[edge.points.length - 1]!, laid.box(targetId)), `${edge.id} ends on ${targetId}`).toBe(true);
    }
  }

  /** The loop `source` -> `target` runs inside `laneId` 15 px from its borders; its name 4 px above its run, inside the lane. */
  function expectLoopInLane(laid: Laid, source: string, target: string, laneId: string, named = true): void {
    const edge = flowBetween(laid, source, target), lane = laid.box(laneId);
    for (const [start, end] of segments(edge.points)) {
      if (start.y !== end.y) continue;
      expect(start.y, `${edge.id} runs inside ${laneId}`).toBeGreaterThanOrEqual(lane.y + 15);
      expect(start.y, `${edge.id} runs inside ${laneId}`).toBeLessThanOrEqual(bottom(lane) - 15);
    }
    if (!named) return;
    expect(bottom(edge.label!), `${edge.id} label next to its run`).toBe(longestHorizontalY(edge.points)! - 4);
    expect(contains(lane, edge.label!), `${edge.id} label inside ${laneId}`).toBe(true);
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
    const laid = await layout('lane-loop-top-label', doc);
    expectClean(laid);
    expectFlowsAttached(laid);
    expect(longestHorizontalY(flowBetween(laid, 'C', 'T').points)!).toBeLessThan(laid.box('T').y);
    expectLoopInLane(laid, 'C', 'T', 'L2');
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
    const laid = await layout('lane-loops-top-nested', doc);
    expectClean(laid);
    expectFlowsAttached(laid);
    for (const [from, to] of [['C', 'T2'], ['C2', 'T']] as const) {
      expect(longestHorizontalY(flowBetween(laid, from, to).points)!).toBeLessThan(laid.box(to).y);
      expectLoopInLane(laid, from, to, 'L2');
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
    const laid = await layout('lane-self-loop-label', doc);
    expectClean(laid);
    expectFlowsAttached(laid);
    const loop = flowBetween(laid, 'T', 'T');
    expect(loop.label!.y).toBeGreaterThan(longestHorizontalY(loop.points)!);
    expect(contains(laid.box('L2'), loop.label!), 'label inside L2').toBe(true);
    expect(bottom(laid.box('L2'))).toBe(laid.box('L3').y);
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
    const laid = await layout('lane-event-sub-loop-label', doc);
    expectFlowsAttached(laid);
    const loop = flowBetween(laid, 'C', 'T');
    expect(contains(laid.box('L2'), loop.label!), 'loop label inside L2').toBe(true);
    // the event sub-process sits one vertical gap below its lane's content, not below the other lane's label
    const content = Math.max(...['S2', 'P2', 'E2'].map((id) => bottom(laid.box(id))));
    expect(laid.box('ES').y).toBeLessThanOrEqual(content + 60);
    expect(contains(laid.box('L1'), laid.box('ES'))).toBe(true);
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
      const laid = await layout(`lane-loops-two-lanes${named ? '-named' : ''}`, doc);
      expectClean(laid);
      expectFlowsAttached(laid);
      expect(bottom(laid.box('L1'))).toBe(laid.box('L2').y);
      expect(longestHorizontalY(flowBetween(laid, 'K2', 'P2').points)!).toBeGreaterThan(bottom(laid.box('P2')));
      expectLoopInLane(laid, 'K2', 'P2', 'L1');
      expect(longestHorizontalY(flowBetween(laid, 'C', 'T').points)!).toBeLessThan(laid.box('T').y);
      expectLoopInLane(laid, 'C', 'T', 'L2', named);
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
          ] as EditCommand[])
        : []),
      ...(lanes
        ? ([
            { op: 'add', kind: 'participant', id: 'Org', name: 'Company' },
            { op: 'add', kind: 'lane', id: 'L0', name: 'Lane 0', in: 'P', members: ['S', 'A1', 'T5', 'T6', 'G2', 'J3', 'F', 'E', ...(full ? ['H9', 'H10'] : [])] },
            { op: 'add', kind: 'lane', id: 'L1', name: 'Lane 1', in: 'P', members: ['T7'] },
            { op: 'add', kind: 'lane', id: 'L2', name: 'Lane 2', in: 'P', members: ['T4', ...(full ? ['ES'] : [])] },
            { op: 'add', kind: 'lane', id: 'L3', name: 'Lane 3', in: 'P', members: [] },
          ] as EditCommand[])
        : []),
    ]);
  }

  it('lanes: a split whose happy path runs on in another lane sends its branch in its own lane out through its right vertex: Notify data moves up onto the split\'s row (r013)', async () => {
    for (const full of [false, true]) {
      const what = full ? 'r013' : 'r013 without its boundary paths';
      const lines: string[] = [];
      const laid = await LayoutDebug.during(
        (line) => lines.push(line),
        async () => layout(`lanes-split-branch-up${full ? '-r013' : ''}`, splitLanesDoc(true, full)),
      );
      const gatewayBox = laid.box('G2'), notify = laid.box('T6');
      expect(cy(notify), what).toBe(cy(gatewayBox));
      expect(flowBetween(laid, 'G2', 'T6').points, what).toEqual([{ x: right(gatewayBox), y: cy(gatewayBox) }, { x: notify.x, y: cy(gatewayBox) }]);
      // the happy path's branch drops from the bottom vertex into lane 2, Notify data's flow drops into lane 1
      expect(flowBetween(laid, 'G2', 'T4').points[0], what).toEqual({ x: cx(gatewayBox), y: bottom(gatewayBox) });
      expect(flowBetween(laid, 'T6', 'T7').points[0], what).toEqual({ x: cx(notify), y: bottom(notify) });
      expect(contains(laid.box('L0'), notify), what).toBe(true);
      expectStraightLine(laid, ['S', 'A1', 'G2', 'T6']);
      // the move adds no crossing (the routes measured before and after it)
      const trial = lines.find((line) => line.startsWith('[lifts] T6 '));
      expect(trial, what).toMatch(/^\[lifts\] T6 moves up onto row 0/);
      const [, was, now] = /: (\{.*?\}) -> (\{.*?\})/.exec(trial!)!;
      expect((JSON.parse(now!) as { crossings: number }).crossings, what).toBeLessThanOrEqual((JSON.parse(was!) as { crossings: number }).crossings);
      expect(laid.report.through, what).toEqual([]);
      expect(laid.report.overlaps, what).toEqual([]);
      // with the boundary paths the timer path goes over the top from Pick invoice's top border (it crosses nothing), and
      // the crossing the lanes force stays
      if (full) expect(laid.report.crossings, what).toEqual(['Flow_PackOrderToInformOrderxFlow_BookDataToGateway']);
      if (!full) {
        // only the crossing the lanes force: Pack order's way up into Inform order crosses Book data's into the join
        expect(laid.report.crossings).toEqual(['Flow_PackOrderToInformOrderxFlow_BookDataToGateway']);
        expect(laid.report.inOutOverlaps).toEqual([]);
        expectLabelsClear(laid);
      }
    }
  });

  it('without lanes the happy path takes the split\'s row: the other branch stays on its own row below', async () => {
    const laid = await layout('split-branch-no-lanes', splitLanesDoc(false, false));
    expectClean(laid);
    expectStraightLine(laid, ['S', 'A1', 'G2', 'T4', 'T5', 'J3', 'F', 'E']);
    expect(laid.box('T6').y).toBeGreaterThan(bottom(laid.box('T4')));
  });

  it('lanes: a branch stays below where the happy path\'s flow runs along the split\'s row past the columns its other nodes leave empty', async () => {
    // agent__o2c without its other lanes: ok runs from Credit ok? straight along the row to the parallel split; not ok's
    // Request prepayment would take a cell of that row (moved up, it bent the happy path into a band under the row)
    const lines: string[] = [];
    const laid = await LayoutDebug.during(
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
    expect(lines.filter((line) => line.startsWith('[lifts] R '))).toEqual([]);
    const dBox = laid.box('D'), mBox = laid.box('M');
    expect(flowBetween(laid, 'D', 'M').points).toEqual([{ x: right(dBox), y: cy(dBox) }, { x: mBox.x, y: cy(dBox) }]);
    expect(laid.box('R').y).toBeGreaterThan(bottom(dBox));
    expectClean(laid);
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
    const laid = await LayoutDebug.during(
      (line) => lines.push(line),
      async () => layout('lanes-split-branch-stays-shared-vertex', sharedVertexDoc()),
    );
    expect(lines.filter((line) => line.startsWith('[lifts]')).map((line) => line.split(':')[0])).toEqual(['[lifts] T10 stays', '[lifts] T11 stays']);
    const gatewayBox = laid.box('G');
    expect(flowBetween(laid, 'G', 'T8').points[0]).toEqual({ x: right(gatewayBox), y: cy(gatewayBox) });
    for (const id of ['T10', 'T11']) expect(flowBetween(laid, 'G', id).points[0], id).toEqual({ x: cx(gatewayBox), y: bottom(gatewayBox) });
    expect(laid.report.labelClashes).toEqual([]);
    expect(laid.report.inOutOverlaps).toEqual([]);
  });

  /** The rows of a scope laid out again by lane, as LaneArranger does (each lane's rows stacked from its top), the lanes in the order of `lanes`. */
  function arrangeByLane(scope: ScopeLayout, lanes: string[][]): () => void {
    const of = lanes.map((ids) => scope.nodes.filter((node) => ids.includes(node.id)));
    return () => {
      let laneY = 0;
      const bands = of.map((nodes) => {
        const top = laneY;
        let rowY = laneY + 30;
        for (const row of [...new Set(nodes.map((node) => node.row))].sort((earlier, later) => earlier - later)) {
          const inRow = nodes.filter((node) => node.row === row);
          const rh = Math.max(...inRow.map((node) => node.height + (node.boundary.length ? 38 : 0)));
          for (const node of inRow) shiftNode(node, 0, Math.round(rowY + rh / 2 - node.height / 2 - node.box.y));
          rowY += rh + 60;
        }
        laneY = Math.max(rowY - 30, top + 120);
        return { nodes: new Set(nodes), top, bottom: laneY };
      });
      scope.height = laneY;
      new ScopeArtifactPlacer(scope).placeAttached();
      scope.laneBands = bands;
    };
  }

  it('a branch\'s move up that is not kept is undone exactly; one that is kept leaves the branch on the split\'s row', async () => {
    const laneIds = (doc: Doc): string[][] => many(many(doc.require('P'), 'laneSets')[0]!, 'lanes').map((lane) => (lane.get<El[] | undefined>('flowNodeRef') ?? []).map(idOf));
    /** the scope arranged by lane, then ChainLiftTrial on it: the debug lines, and whether it changed anything the arrangement sets */
    const run = async (doc: Doc): Promise<{ scope: ScopeLayout; changed: boolean; lines: string[] }> => {
      const scope = new ScopePlacer({ expanded: new Set(), collapsedScopes: new Map() }).layOut(doc.require('P'));
      const state = (): string =>
        JSON.stringify({
          nodes: scope.nodes.flatMap((node) => [node, ...node.boundary]).map((node) => [node.id, node.layer, node.row, node.band, node.width, node.box, node.topUsed]),
          edges: scope.edges.map((edge) => [edge.id, edge.bandRow, edge.bandY, edge.points, edge.label, edge.runsBelow]),
          artifacts: scope.artifacts.map((artifact) => artifact.box),
          size: [scope.width, scope.height],
          lanes: scope.laneBands!.map((band) => [band.top, band.bottom]),
        });
      const arrange = arrangeByLane(scope, laneIds(doc));
      arrange();
      const arranged = state();
      const lines: string[] = [];
      await LayoutDebug.during(
        (line) => lines.push(line),
        async () => new ChainLiftTrial(scope, arrange).run(),
      );
      return { scope, changed: state() !== arranged, lines };
    };
    // the routes of the trials share the right vertex: both moves are tried (routed) and undone
    const rejected = await run(sharedVertexDoc());
    expect(rejected.lines.map((line) => line.split(':')[0])).toEqual(['[lifts] T10 stays', '[lifts] T11 stays']);
    expect(rejected.lines.every((line) => / stays: \{/.test(line))).toBe(true);
    expect(rejected.changed).toBe(false);
    const kept = await run(splitLanesDoc(true, false));
    expect(kept.lines.map((line) => line.split(':')[0])).toEqual(['[lifts] T6 moves up onto row 0']);
    expect(kept.changed).toBe(true);
    const node = (id: string): GNode => kept.scope.nodes.find((node) => node.id === id)!;
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
    const laid = await layout('data', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightLine(laid, ['S', 'A', 'B', 'C', 'E']);
    const spineBottom = Math.max(...['A', 'B', 'C'].map((id) => bottom(laid.box(id))));
    expect(laid.box('DO').y).toBeGreaterThan(spineBottom);
    expect(laid.box('DS').y).toBeGreaterThan(spineBottom);
    expect(laid.box('DO').x).toBeLessThan(laid.box('DS').x);
    expect(laid.shape('DO').label!.y).toBeGreaterThanOrEqual(bottom(laid.box('DO')));
    const dataEdges = laid.planes[0]!.edges.filter((edge) => is(edge.el, 'bpmn:DataAssociation'));
    expect(dataEdges).toHaveLength(3);
    for (const edge of dataEdges) expect(edge.points).toHaveLength(2);
    // the association ends on the borders of the artifact and the task
    const outA = dataEdges.find((edge) => is(edge.el, 'bpmn:DataOutputAssociation') && edge.ends.has('A'))!;
    expect(outA.points[1]!.y).toBe(laid.box('DO').y);
    expect(outA.points[0]!.y).toBe(bottom(laid.box('A')));
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
    const laid = await layout('annotation-task', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightLine(laid, ['S', 'A', 'B', 'E']);
    const taskBox = laid.box('A'), n1 = laid.box('N1');
    expect(bottom(n1)).toBeLessThan(taskBox.y);
    expect(Math.abs(cx(n1) - cx(taskBox))).toBeLessThan(1);
    const assocs = laid.planes[0]!.edges.filter((edge) => is(edge.el, 'bpmn:Association'));
    expect(assocs).toHaveLength(1);
    expect(assocs[0]!.ends.has('A')).toBe(true);
    expect(assocs[0]!.points.some((point) => point.y === taskBox.y)).toBe(true);
    expect(assocs[0]!.points.some((point) => point.y === bottom(n1))).toBe(true);
  });

  // ENGINE DEFECT (ScopeArtifactPlacer build/placeAnnotations): the anchor of an annotation on a sequence flow is
  // captured before the annotation band shifts the content down, so the association ends exactly one band
  // (annotation height + vGap) above the flow, in mid-air, and may cut through the other annotation.
  it('text annotations on a task and on a flow: both above, the flow association ends on the flow', async () => {
    const laid = await layout('annotations', annotatedDoc());
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightLine(laid, ['S', 'A', 'B', 'E']);
    const taskBox = laid.box('A'), n1 = laid.box('N1'), n2 = laid.box('N2');
    expect(bottom(n1)).toBeLessThan(taskBox.y);
    expect(Math.abs(cx(n1) - cx(taskBox))).toBeLessThan(1);
    const fab = laid.edge('F_AB');
    expect(bottom(n2)).toBeLessThan(fab.points[0]!.y);
    const assocs = laid.planes[0]!.edges.filter((edge) => is(edge.el, 'bpmn:Association'));
    expect(assocs).toHaveLength(2);
    // the association to the flow ends on the flow's segment, the one to the task on the task's top border
    const onFlow = assocs.find((edge) => edge.ends.has('F_AB'))!;
    const flowEnd = onFlow.points.find((point) => point.y === fab.points[0]!.y);
    expect(flowEnd, `${onFlow.id} ends on F_AB (y=${fab.points[0]!.y}): ${JSON.stringify(onFlow.points)}`).toBeDefined();
    expect(flowEnd!.x).toBeGreaterThan(fab.points[0]!.x);
    expect(flowEnd!.x).toBeLessThan(fab.points[1]!.x);
    const onTask = assocs.find((edge) => edge.ends.has('A'))!;
    expect(onTask.points.some((point) => point.y === taskBox.y)).toBe(true);
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
    const laid = await layout('compensation', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expectStraightLine(laid, ['S', 'Charge', 'Book', 'E']);
    const ev = laid.box('Comp'), handler = laid.box('Refund');
    expect(cy(ev)).toBe(bottom(laid.box('Charge')));
    expect(cx(handler)).toBe(cx(ev));
    expect(handler.y).toBeGreaterThan(bottom(ev));
    const assoc = laid.planes[0]!.edges.find((edge) => is(edge.el, 'bpmn:Association'))!;
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
    const laid = await layout('big', doc);
    expectClean(laid);
    expectLabelsClear(laid);
    expect(laid.report.shapes).toBe(nodeCount);
    expectStraightLine(laid, ['S', 'Receive', 'Validate', 'G1', 'Reserve', 'Price', 'GJ1', 'Prepare', 'G2', 'Pack', 'Label', 'GJ2', 'Ship', 'G3', 'Close', 'Archive', 'E']);
    // bands in declaration order below their split
    expect(cy(laid.box('Notify'))).toBeGreaterThan(bottom(laid.box('Reserve')));
    expect(cy(laid.box('Review'))).toBeGreaterThan(bottom(laid.box('Notify')));
    expect(cy(laid.box('Invoice'))).toBeGreaterThan(bottom(laid.box('Pack')));
    expect(cy(laid.box('Crm'))).toBeGreaterThan(bottom(laid.box('Invoice')));
    expectStraightLine(laid, ['Notify', 'Log', 'Rejected']);
    expectStraightLine(laid, ['Invoice', 'SendInvoice']);
    // boundary handlers below their hosts
    expect(laid.box('Escalate').y).toBeGreaterThan(bottom(laid.box('Review')));
    expect(laid.box('FixShipment').y).toBeGreaterThan(bottom(laid.box('Ship')));
    // the loops go around the nodes they span and enter Ship from below or above
    expectRoutedAround(laid, flowBetween(laid, 'Track', 'Ship'), ['Ship', 'G3'], 'Ship');
    expectRoutedAround(laid, flowBetween(laid, 'FixShipment', 'Ship'), ['Ship'], 'Ship');
  });
});

/* ------------------------------------------------------------------ */
/* groups over a full redraw                                            */
/* ------------------------------------------------------------------ */

const GALLERY = readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'render', 'gallery.bpmn'), 'utf8');
/** the shapes whose centre lies in gallery.bpmn's Group_FirstTasks box */
const FIRST_TASKS = ['Activity_UserTask', 'Activity_ServiceTask', 'Event_TwoDays', 'Event_Reminder'];

const DI_NS = 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';
const diShape = (id: string, [left, top, boundsWidth, boundsHeight]: number[], extra = ''): string => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${extra}><dc:Bounds x="${left}" y="${top}" width="${boundsWidth}" height="${boundsHeight}" /></bpmndi:BPMNShape>`;
const diEdge = (id: string, pts: number[][]): string => `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${pts.map(([pointX, pointY]) => `<di:waypoint x="${pointX}" y="${pointY}" />`).join('')}</bpmndi:BPMNEdge>`;
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
  return new Map(new DiagramReader(doc.definitions).planes().flatMap((plane) => [...plane.shapes.values()].map((shape) => [shape.id, shape] as [string, DShape])));
}

/** The group's box holds the members whole and cuts no other leaf shape. */
function expectGroupAround(shapes: Map<string, DShape>, groupId: string, members: string[]): Box {
  const group = shapes.get(groupId);
  expect(group, `${groupId} is drawn`).toBeDefined();
  for (const id of members) expect(contains(group!.bounds, shapes.get(id)!.bounds), `${id} inside ${groupId}`).toBe(true);
  for (const shape of shapes.values()) {
    if (shape.id === groupId || shape.container || shape.kind === 'group' || members.includes(shape.id)) continue;
    expect(boxesOverlap(group!.bounds, shape.bounds) && !contains(group!.bounds, shape.bounds), `${groupId}'s border cuts ${shape.id}`).toBe(false);
  }
  return group!.bounds;
}

describe('groups over a full redraw', () => {
  it('`layout` draws gallery.bpmn\'s group around the elements it held, with its DI id, and a second redraw changes nothing', async () => {
    const result = await layoutDoc(await Doc.fromXml(GALLERY));
    const before = await shapesOf(GALLERY);
    const after = await shapesOf(result.xml);
    expect(after.size).toBe(before.size);
    expectGroupAround(after, 'Group_FirstTasks', FIRST_TASKS);
    expect(result.xml).toContain('<bpmndi:BPMNShape id="BPMNShape_Group_FirstTasks" bpmnElement="Group_FirstTasks">');
    // the quality line no longer presents the group as overlaps it resolved
    expect(JSON.stringify(result.layout.metrics)).not.toContain('Group_FirstTasks');
    expect(result.layout.notes).toBeUndefined();
    const again = await layoutDoc(await Doc.fromXml(result.xml));
    expect(again.unchanged).toBe(true);
  });

  it('an edit to the redrawn file finds it engine-owned and keeps the group (layout auto)', async () => {
    const drawn = await layoutDoc(await Doc.fromXml(GALLERY));
    const result = await mutateDoc(await Doc.fromXml(drawn.xml), [{ op: 'set', id: 'Activity_UserTask', values: { name: 'User task, renamed' } }]);
    expect(result.layout.mode).toBe('full');
    expect(result.layout.reason).toMatch(/engine-owned/);
    expectGroupAround(await shapesOf(result.xml), 'Group_FirstTasks', FIRST_TASKS);
  });

  it('--relayout (an edit with layout full) keeps the group around its members', async () => {
    const result = await mutateDoc(await Doc.fromXml(GALLERY), [{ op: 'set', id: 'Activity_ServiceTask', values: { name: 'Service task with a longer name' } }], { layout: 'full' });
    expectGroupAround(await shapesOf(result.xml), 'Group_FirstTasks', FIRST_TASKS);
  });

  it('--engine auto keeps the group around its members, without GROUP_MEMBERS_NOT_FOUND', async () => {
    const result = await layoutDoc(await Doc.fromXml(GALLERY), { engine: 'auto' });
    expectGroupAround(await shapesOf(result.xml), 'Group_FirstTasks', FIRST_TASKS);
    expect(result.layout.warnings.map((warning) => warning.code)).not.toContain('GROUP_MEMBERS_NOT_FOUND');
    expect(result.xml).toContain('<bpmndi:BPMNShape id="BPMNShape_Group_FirstTasks" bpmnElement="Group_FirstTasks">');
  });

  it('a group around nothing keeps its box and the result says so', async () => {
    const xml = groupXml(
      'P',
      `<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:task id="T" name="Do it" /><bpmn:endEvent id="E" />${seq('F1', 'S', 'T')}${seq('F2', 'T', 'E')}<bpmn:group id="Group_Empty" /></bpmn:process>`,
      [diShape('S', [100, 100, 36, 36]), diShape('T', [200, 78, 100, 80]), diShape('E', [360, 100, 36, 36]), diEdge('F1', [[136, 118], [200, 118]]), diEdge('F2', [[300, 118], [360, 118]]), diShape('Group_Empty', [600, 300, 120, 90])],
    );
    const result = await layoutDoc(await Doc.fromXml(xml));
    expect((await shapesOf(result.xml)).get('Group_Empty')!.bounds).toEqual({ x: 600, y: 300, width: 120, height: 90 });
    expect(result.xml).toContain('<bpmndi:BPMNShape id="Group_Empty_di" bpmnElement="Group_Empty">');
    expect(result.layout.notes).toEqual(['group Group_Empty kept its box: no element inside it is drawn']);
  });

  it('a group of the collaboration is drawn around its members in two pools, without DI_NOT_CREATED', async () => {
    const proc = (processId: string, startId: string, taskId: string, endId: string): string => `<bpmn:process id="${processId}"><bpmn:startEvent id="${startId}" /><bpmn:task id="${taskId}" name="${taskId}" /><bpmn:endEvent id="${endId}" />${seq(`${processId}_F1`, startId, taskId)}${seq(`${processId}_F2`, taskId, endId)}</bpmn:process>`;
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
    const result = await layoutDoc(await Doc.fromXml(xml));
    expect(result.layout.warnings).toEqual([]);
    const box = expectGroupAround(await shapesOf(result.xml), 'Group_Both', ['Task_A', 'Task_B']);
    const shapes = await shapesOf(result.xml);
    // room above the members for the group's name
    expect(Math.min(shapes.get('Task_A')!.bounds.y, shapes.get('Task_B')!.bounds.y) - box.y).toBeGreaterThan(20);
    expect((await layoutDoc(await Doc.fromXml(result.xml))).unchanged).toBe(true);
  });

  it('the parts of a group no flow connects stay together, so the boxes of two groups do not overlap', async () => {
    const chain = (chainNumber: number): string => `<bpmn:startEvent id="Start_${chainNumber}" /><bpmn:task id="Task_${chainNumber}" name="Task ${chainNumber}" /><bpmn:endEvent id="End_${chainNumber}" />${seq(`Flow_${chainNumber}a`, `Start_${chainNumber}`, `Task_${chainNumber}`)}${seq(`Flow_${chainNumber}b`, `Task_${chainNumber}`, `End_${chainNumber}`)}`;
    const chainDi = (chainNumber: number, left: number, top: number): string[] => [diShape(`Start_${chainNumber}`, [left, top + 22, 36, 36]), diShape(`Task_${chainNumber}`, [left + 100, top, 100, 80]), diShape(`End_${chainNumber}`, [left + 260, top + 22, 36, 36])];
    // declared 1, 2, 3; drawn as two columns: Group_Left holds 1 and 3, Group_Right holds 2
    const xml = groupXml(
      'P',
      `<bpmn:process id="P">${chain(1)}${chain(2)}${chain(3)}<bpmn:group id="Group_Left" /><bpmn:group id="Group_Right" /></bpmn:process>`,
      [...chainDi(1, 100, 100), ...chainDi(3, 100, 240), ...chainDi(2, 500, 100), diShape('Group_Left', [80, 80, 340, 260]), diShape('Group_Right', [480, 80, 340, 120])],
    );
    const result = await layoutDoc(await Doc.fromXml(xml));
    const shapes = await shapesOf(result.xml);
    const left = expectGroupAround(shapes, 'Group_Left', ['Start_1', 'Task_1', 'End_1', 'Start_3', 'Task_3', 'End_3']);
    const right = expectGroupAround(shapes, 'Group_Right', ['Start_2', 'Task_2', 'End_2']);
    expect(boxesOverlap(left, right)).toBe(false);
    expect((await layoutDoc(await Doc.fromXml(result.xml))).unchanged).toBe(true);
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
    const result = await layoutDoc(await Doc.fromXml(xml));
    const shapes = await shapesOf(result.xml);
    const outer = expectGroupAround(shapes, 'Group_Outer', ['A', 'B']);
    const inner = expectGroupAround(shapes, 'Group_Inner', ['A']);
    const last = expectGroupAround(shapes, 'Group_Last', ['C']);
    expect(contains(outer, inner)).toBe(true);
    expect(boxesOverlap(outer, last)).toBe(false);
    expect(contains(inner, shapes.get('B')!.bounds)).toBe(false);
    // the old DI order
    expect(result.xml.indexOf('bpmnElement="Group_Outer"')).toBeLessThan(result.xml.indexOf('bpmnElement="Group_Inner"'));
    expect((await layoutDoc(await Doc.fromXml(result.xml))).unchanged).toBe(true);
    expect(LayoutAnalysis.of((await Doc.fromXml(result.xml)).definitions).problems.filter((problem) => problem.ids.some((id) => id.startsWith('Group_')))).toEqual([]);
  });

  it('two stacked groups come back the same on a second redraw, and an edit to the first result finds it engine-owned', async () => {
    const xml = readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'incremental', 'groups.bpmn'), 'utf8');
    const result = await layoutDoc(await Doc.fromXml(xml));
    const shapes = await shapesOf(result.xml);
    const g1 = expectGroupAround(shapes, 'G1', ['S1', 'A', 'E1', 'S2', 'B', 'E2']);
    const g2 = expectGroupAround(shapes, 'G2', ['S3', 'C', 'E3', 'D']);
    expect(boxesOverlap(g1, g2)).toBe(false);
    expect((await layoutDoc(await Doc.fromXml(result.xml))).unchanged).toBe(true);
    const edit = await mutateDoc(await Doc.fromXml(result.xml), [{ op: 'set', id: 'A', values: { name: 'Renamed' } }]);
    expect(edit.layout.mode).toBe('full');
    expect(edit.layout.reason).toMatch(/engine-owned/);
  });

  const LINE = (ids: string[]): { body: string; di: string[] } => {
    const flows = ids.slice(1).map((id, index) => seq(`F${index + 1}`, ids[index]!, id));
    const kinds = ids.map((id, index) => (index === 0 ? `<bpmn:startEvent id="${id}" />` : index === ids.length - 1 ? `<bpmn:endEvent id="${id}" />` : `<bpmn:task id="${id}" name="${id}" />`));
    const di: string[] = [];
    let left = 100;
    ids.forEach((id, index) => {
      const event = index === 0 || index === ids.length - 1;
      di.push(diShape(id, event ? [left, 122, 36, 36] : [left, 100, 100, 80]));
      if (index < ids.length - 1) di.push(diEdge(`F${index + 1}`, [[left + (event ? 36 : 100), 140], [left + (event ? 36 : 100) + 60, 140]]));
      left += (event ? 36 : 100) + 60;
    });
    return { body: kinds.join('') + flows.join(''), di };
  };

  it('a group inside a group that loses its last member is no member of the outer group (remove with --relayout)', async () => {
    const line = LINE(['S', 'A', 'B', 'C', 'D', 'E']);
    // B at 292, C at 452, D at 612: Group_Outer around B..D, Group_Inner around D
    const xml = groupXml('P', `<bpmn:process id="P">${line.body}<bpmn:group id="Group_Outer" /><bpmn:group id="Group_Inner" /></bpmn:process>`, [...line.di, diShape('Group_Outer', [272, 60, 460, 140]), diShape('Group_Inner', [592, 80, 140, 110])]);
    const result = await mutateDoc(await Doc.fromXml(xml), [{ op: 'remove', ids: ['D'] }], { layout: 'full' });
    const shapes = await shapesOf(result.xml);
    const outer = expectGroupAround(shapes, 'Group_Outer', ['B', 'C']);
    expect(contains(outer, shapes.get('E')!.bounds)).toBe(false);
    expect(contains(outer, shapes.get('Group_Inner')!.bounds)).toBe(false);
    const inner = shapes.get('Group_Inner')!.bounds;
    expect([...shapes.values()].filter((shape) => shape.id !== 'Group_Inner' && boxesOverlap(inner, shape.bounds)).map((shape) => shape.id)).toEqual([]);
    expect(result.layout.notes).toEqual(['group Group_Inner moved below the drawing: no element inside it is drawn and the redraw put shapes on its box']);
  });

  it('a group around nothing whose box the redraw covers moves below the drawing at its size; a second redraw keeps it, an edit finds the drawing engine-owned', async () => {
    const line = LINE(['Start', 'Prepare', 'Print', 'Hand', 'Shipped']);
    // in the gap between Prepare (196..296) and Print (356..456), where the redraw puts Print
    const xml = groupXml('P', `<bpmn:process id="P">${line.body}<bpmn:group id="Group_Handover" /></bpmn:process>`, [...line.di, diShape('Group_Handover', [300, 95, 50, 90])]);
    const result = await layoutDoc(await Doc.fromXml(xml));
    const shapes = await shapesOf(result.xml);
    const groupBounds = shapes.get('Group_Handover')!.bounds;
    expect([groupBounds.width, groupBounds.height]).toEqual([50, 90]);
    expect([...shapes.values()].filter((shape) => shape.id !== 'Group_Handover' && boxesOverlap(groupBounds, shape.bounds)).map((shape) => shape.id)).toEqual([]);
    expect(groupBounds.y).toBeGreaterThan(Math.max(...[...shapes.values()].filter((shape) => shape.id !== 'Group_Handover').map((shape) => shape.bounds.y + shape.bounds.height)));
    expect(result.layout.notes).toEqual(['group Group_Handover moved below the drawing: no element inside it is drawn and the redraw put shapes on its box']);
    const again = await layoutDoc(await Doc.fromXml(result.xml));
    expect(again.unchanged).toBe(true);
    expect(again.layout.notes).toEqual(['group Group_Handover kept its box: no element inside it is drawn']);
    const edit = await mutateDoc(await Doc.fromXml(result.xml), [{ op: 'set', id: 'Hand', values: { name: 'Hand over' } }]);
    expect(edit.layout.mode).toBe('full');
  });

  const CHAIN = (chainNumber: number, start = true): string =>
    `${start ? `<bpmn:startEvent id="Start_${chainNumber}" />` : ''}<bpmn:task id="Task_${chainNumber}" name="Task ${chainNumber}" /><bpmn:endEvent id="End_${chainNumber}" />${start ? seq(`Flow_${chainNumber}a`, `Start_${chainNumber}`, `Task_${chainNumber}`) : ''}${seq(`Flow_${chainNumber}b`, `Task_${chainNumber}`, `End_${chainNumber}`)}`;
  const CHAIN_DI = (chainNumber: number, left: number, top: number, start = true): string[] => [...(start ? [diShape(`Start_${chainNumber}`, [left, top + 22, 36, 36])] : []), diShape(`Task_${chainNumber}`, [left + 100, top, 100, 80]), diShape(`End_${chainNumber}`, [left + 260, top + 22, 36, 36])];

  it('the parts of a group stay together when its box held only their tasks, and when a part has no start event', async () => {
    // declared 1, 2, 3; drawn as two columns: Group_Left around the tasks of 1 and 3, Group_Right around the task of 2
    const tasksOnly = groupXml(
      'P',
      `<bpmn:process id="P">${CHAIN(1)}${CHAIN(2)}${CHAIN(3)}<bpmn:group id="Group_Left" /><bpmn:group id="Group_Right" /></bpmn:process>`,
      [...CHAIN_DI(1, 100, 100), ...CHAIN_DI(3, 100, 240), ...CHAIN_DI(2, 500, 100), diShape('Group_Left', [180, 80, 140, 260]), diShape('Group_Right', [580, 80, 140, 120])],
    );
    let result = await layoutDoc(await Doc.fromXml(tasksOnly));
    let shapes = await shapesOf(result.xml);
    let left = expectGroupAround(shapes, 'Group_Left', ['Task_1', 'Task_3']);
    let right = expectGroupAround(shapes, 'Group_Right', ['Task_2']);
    expect(boxesOverlap(left, right)).toBe(false);
    expect((await layoutDoc(await Doc.fromXml(result.xml))).unchanged).toBe(true);
    // chain 3 starts at its task: it still goes next to chain 1
    const noStart = groupXml(
      'P',
      `<bpmn:process id="P">${CHAIN(1)}${CHAIN(2)}${CHAIN(3, false)}<bpmn:group id="Group_Left" /><bpmn:group id="Group_Right" /></bpmn:process>`,
      [...CHAIN_DI(1, 100, 100), ...CHAIN_DI(3, 100, 240, false), ...CHAIN_DI(2, 500, 100), diShape('Group_Left', [80, 80, 340, 260]), diShape('Group_Right', [480, 80, 340, 120])],
    );
    result = await layoutDoc(await Doc.fromXml(noStart));
    shapes = await shapesOf(result.xml);
    left = expectGroupAround(shapes, 'Group_Left', ['Start_1', 'Task_1', 'End_1', 'Task_3', 'End_3']);
    right = expectGroupAround(shapes, 'Group_Right', ['Start_2', 'Task_2', 'End_2']);
    expect(boxesOverlap(left, right)).toBe(false);
    expect((await layoutDoc(await Doc.fromXml(result.xml))).unchanged).toBe(true);
  });

  it('two groups that overlap without nesting come back the same on a second redraw', async () => {
    // five chains drawn in the rows 2, 4, 1, 5, 3; Group_A holds rows 2, 4, 1 and Group_B rows 1, 5
    const order = [2, 4, 1, 5, 3];
    const xml = groupXml(
      'P',
      `<bpmn:process id="P">${[1, 2, 3, 4, 5].map((chainNumber) => CHAIN(chainNumber)).join('')}<bpmn:group id="Group_A" /><bpmn:group id="Group_B" /></bpmn:process>`,
      [...order.flatMap((chainNumber, position) => CHAIN_DI(chainNumber, 100, 100 + position * 140)), diShape('Group_A', [80, 80, 340, 400]), diShape('Group_B', [60, 340, 380, 240])],
    );
    const result = await layoutDoc(await Doc.fromXml(xml));
    const shapes = await shapesOf(result.xml);
    expectGroupAround(shapes, 'Group_A', ['Task_2', 'Task_4', 'Task_1']);
    expectGroupAround(shapes, 'Group_B', ['Task_1', 'Task_5']);
    expect((await layoutDoc(await Doc.fromXml(result.xml))).unchanged).toBe(true);
    const edit = await mutateDoc(await Doc.fromXml(result.xml), [{ op: 'set', id: 'Task_1', values: { name: 'Task one' } }]);
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
    const { Groups } = await import('../../../src/domain/diagram/di/Groups.js');
    const out = new Groups(doc.definitions).redraw(doc.moddle, [{ id: 'Group_M', bounds: { x: 80, y: 80, width: 140, height: 340 }, members: ['M1', 'M2'] }]);
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
    const result = await layoutDoc(await Doc.fromXml(xml));
    expect(result.xml).toMatch(/<bpmndi:BPMNShape id="Shape_0xyz" bpmnElement="Group_Work" bioc:stroke="#e53935" color:border-color="#e53935">/);
    expectGroupAround(await shapesOf(result.xml), 'Group_Work', ['T']);
    expect(result.layout.warnings).toEqual([{ code: 'DI_NOT_CREATED', elementId: 'Association_Work', message: 'No DI created for Association_Work (an end is a group: its box is drawn after the layout)', relatedElementIds: [] }]);
    expect(result.layout.notes).toEqual(['groups Group_Empty1, Group_Empty2 kept their boxes: no element inside them is drawn']);
  });
});
