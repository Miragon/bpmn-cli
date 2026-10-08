/**
 * Regression tests for the incremental layout and the format ops around
 * frames (expanded sub-processes, pools, lanes), and for the layout metrics
 * that report frame defects (src/diagram/).
 *
 *  - a frame that grows never grows over a shape that is not its content
 *    (space.ts frame mode): nested sub-processes, branch rows, expansion
 *  - an unconnected node is placed below its own container's content
 *  - place / align never push a reference's frames away (E_NO_ROOM)
 *  - metrics: frameIntrusion, frameOverlap, degenerateEdge, a real
 *    segment-rectangle test for `through` (and the same test where the
 *    engine decides whether a kept connection now cuts a shape)
 *  - no connection is written with fewer than two waypoints or zero length
 *
 * The fixtures in test/fixtures/step1/ are small synthetic hand drawings.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { diffProblems, layoutProblems, layoutProblemsOfXml, type LayoutProblem, type MetricKey } from '../src/diagram/metrics.js';
import { readPlanes, type DEdge, type DShape, type Plane } from '../src/diagram/plane.js';
import { brokenEdge } from '../src/diagram/reroute.js';
import { makeSpace } from '../src/diagram/space.js';
import { writePlanes } from '../src/diagram/write.js';
import { isCliError } from '../src/errors.js';
import type { El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, mutateFile, type MutationOptions, type MutationResult } from '../src/pipeline.js';
import { definitionsXml } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
  return readFileSync(join(HERE, 'fixtures', 'step1', name), 'utf8');
}

async function run(xml: string, ops: Op[], opts: MutationOptions = {}): Promise<{ r: MutationResult; after: Doc }> {
  const r = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, layout: 'incremental', ...opts });
  const after = await Doc.fromXml(r.xml);
  expect(after.importWarnings).toEqual([]);
  return { r, after };
}

async function failure(xml: string, ops: Op[]): Promise<{ code: string; message: string; related?: string[] }> {
  try {
    await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  } catch (err) {
    if (isCliError(err)) return { code: err.code, message: err.message, ...err.details } as Awaited<ReturnType<typeof failure>>;
    throw err;
  }
  throw new Error('expected the mutation to fail');
}

function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const p of readPlanes(doc.definitions)) for (const s of p.shapes.values()) if (!out.has(s.id)) out.set(s.id, s);
  return out;
}

function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const p of readPlanes(doc.definitions)) for (const e of p.edges.values()) if (!out.has(e.id)) out.set(e.id, e);
  return out;
}

const right = (s: DShape): number => s.bounds.x + s.bounds.width;
const bottom = (s: DShape): number => s.bounds.y + s.bounds.height;
const overlap = (a: DShape, b: DShape): boolean => a.bounds.x < right(b) && b.bounds.x < right(a) && a.bounds.y < bottom(b) && b.bounds.y < bottom(a);

/** Problems of the given kinds in the drawing. */
function problems(doc: Doc, kinds: MetricKey[]): LayoutProblem[] {
  return layoutProblems(doc.definitions).problems.filter((p) => kinds.includes(p.kind));
}

const FRAME_DEFECTS: MetricKey[] = ['frameIntrusion', 'frameOverlap', 'outsideSub', 'outsideLane', 'outsidePool', 'overlaps', 'degenerateEdge'];

/* ------------------------------------------------------------------ */
/* frames never grow over foreign shapes                                */
/* ------------------------------------------------------------------ */

describe('a growing frame makes room around it instead of growing over foreign shapes', () => {
  it('nested sub-process grows right: what is in the way moves at every level, inside-out', async () => {
    const xml = fixture('nested.bpmn');
    const before = shapes(await Doc.fromXml(xml));
    const { r, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'I1' }]);
    expect(r.layout.mode).toBe('incremental');
    const s = shapes(after);
    const [inner, outer, rightTask, afterTask] = ['IN', 'OUT', 'RIGHT', 'AFTER'].map((id) => s.get(id)!) as [DShape, DShape, DShape, DShape];
    expect(right(inner)).toBeGreaterThan(right(before.get('IN')!));
    // RIGHT (in OUT, on IN's row) and AFTER (right of OUT, below IN's rows) keep their distance to the frame that grew
    expect(rightTask.bounds.x - right(inner)).toBe(before.get('RIGHT')!.bounds.x - right(before.get('IN')!));
    expect(afterTask.bounds.x - right(outer)).toBe(before.get('AFTER')!.bounds.x - right(before.get('OUT')!));
    expect(problems(after, FRAME_DEFECTS)).toEqual([]);
  });

  it('nested sub-process grows down: the parent grows, a shape below the parent outside the column moves', async () => {
    const xml = fixture('nested.bpmn');
    const { after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'Extra', in: 'IN' }]);
    const s = shapes(after);
    expect(s.get('N')!.parentId).toBe('IN');
    expect(bottom(s.get('IN')!)).toBeGreaterThan(270);
    expect(s.get('LOW')!.bounds.y).toBeGreaterThanOrEqual(bottom(s.get('IN')!));
    expect(s.get('BELOW')!.bounds.y).toBeGreaterThanOrEqual(bottom(s.get('OUT')!));
    expect(problems(after, FRAME_DEFECTS)).toEqual([]);
  });

  it('a frame with room inside its parent grows into it: the parent and the shapes around it stay', async () => {
    const xml = fixture('nested-room.bpmn');
    const before = shapes(await Doc.fromXml(xml));
    const { r, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'EH' }]);
    const s = shapes(after);
    expect(right(s.get('EV')!)).toBeGreaterThan(right(before.get('EV')!));
    for (const id of ['OUT', 'AFTER', 'E', 'OT', 'OE']) expect(s.get(id)!.bounds).toEqual(before.get(id)!.bounds);
    expect(r.layout.moved).not.toContain('OUT');
    expect(problems(after, FRAME_DEFECTS)).toEqual([]);
  });

  it('the rows of a branch after a growing sub-process move together (no row left behind)', async () => {
    const xml = fixture('pool-branch.bpmn');
    const before = shapes(await Doc.fromXml(xml));
    const { after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'Label parcel', after: 'ST' }]);
    const s = shapes(after);
    const shift = (id: string): number => s.get(id)!.bounds.x - before.get(id)!.bounds.x;
    expect(shift('G')).toBeGreaterThan(0);
    for (const id of ['T_UP', 'E1', 'T_LOW', 'E2']) expect(shift(id)).toBe(shift('G'));
    expect(s.get('T_LOW')!.bounds.x).toBeGreaterThan(right(s.get('G')!));
    expect(right(s.get('G')!)).toBeLessThanOrEqual(right(s.get('Pool')!));
    expect(problems(after, FRAME_DEFECTS)).toEqual([]);
  });

  it('expanding a sub-process inside a parent never makes the parent overlap a sibling frame', async () => {
    const xml = fixture('expand-sibling.bpmn');
    const { after } = await run(xml, [{ op: 'set', id: 'C', values: { expanded: 'true' } }]);
    const s = shapes(after);
    expect(s.get('C')!.expanded).toBe(true);
    expect(overlap(s.get('P')!, s.get('Q')!)).toBe(false);
    expect(s.get('QT')!.bounds.y).toBeGreaterThan(s.get('Q')!.bounds.y);
    expect(problems(after, FRAME_DEFECTS)).toEqual([]);
  });

  it('makeSpace in frame mode: nothing outside the frame changes while the frame has room', () => {
    const el = {} as El;
    const sh = (id: string, kind: DShape['kind'], b: [number, number, number, number], extra: Partial<DShape> = {}): DShape => ({
      id,
      el,
      kind,
      container: kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && extra.expanded === true),
      bounds: { x: b[0], y: b[1], width: b[2], height: b[3] },
      ...extra,
    });
    const list = [
      sh('Pool', 'participant', [100, 100, 900, 400]),
      sh('L', 'lane', [130, 100, 870, 400], { poolId: 'Pool' }),
      sh('F', 'subProcess', [200, 300, 300, 150], { expanded: true, laneId: 'L', poolId: 'Pool' }),
      sh('A', 'task', [250, 340, 100, 80], { parentId: 'F', laneId: 'L', poolId: 'Pool' }),
      sh('B', 'task', [380, 340, 100, 80], { parentId: 'F', laneId: 'L', poolId: 'Pool' }),
      sh('Up', 'task', [600, 150, 100, 80], { laneId: 'L', poolId: 'Pool' }),
    ];
    const plane: Plane = { id: 'p', rootId: 'r', root: el, shapes: new Map(list.map((s) => [s.id, s])), edges: new Map(), dropped: [] };
    const r = makeSpace(plane, { axis: 'x', line: 351, delta: 120, anchors: ['A'], frame: 'F' });
    expect(plane.shapes.get('F')!.bounds.width).toBe(420);
    expect(plane.shapes.get('B')!.bounds.x).toBe(500);
    // Up is beyond the line but outside the frame: it stays; the lane and the pool do not grow
    expect(plane.shapes.get('Up')!.bounds.x).toBe(600);
    expect([...r.resized]).toEqual(['F']);
    expect(plane.shapes.get('Pool')!.bounds.width).toBe(900);
  });
});

/* ------------------------------------------------------------------ */
/* unconnected nodes                                                    */
/* ------------------------------------------------------------------ */

describe('an unconnected node goes below its own container content', () => {
  it('a label of a flow outside the sub-process does not count', async () => {
    const { after } = await run(fixture('far-label.bpmn'), [{ op: 'add', kind: 'task', id: 'X', name: 'Extra', in: 'SUB' }]);
    const s = shapes(after);
    const x = s.get('X')!;
    expect(x.parentId).toBe('SUB');
    // right below the inner row (bottom 200), far above the label of F4 (y 560)
    expect(x.bounds.y).toBeGreaterThan(200);
    expect(x.bounds.y).toBeLessThan(320);
    expect(bottom(s.get('SUB')!)).toBeLessThan(420);
    expect(problems(after, FRAME_DEFECTS)).toEqual([]);
  });

  it('a node moved into a lane without a free row goes below that lane\'s content, not below a label elsewhere', async () => {
    const { after } = await run(fixture('lane-label.bpmn'), [{ op: 'move', ids: ['M'], lane: 'L1' }]);
    const s = shapes(after);
    const lane = s.get('L1')!;
    expect(s.get('M')!.laneId).toBe('L1');
    expect(lane.bounds.height).toBeLessThan(320);
    expect(s.get('M')!.bounds.y).toBeGreaterThanOrEqual(170);
    expect(problems(after, FRAME_DEFECTS)).toEqual([]);
  });

  it('a lane row used as tightly as the drawing uses it takes a moved node without growing the lane', async () => {
    const xml = fixture('lane-tight.bpmn');
    const before = shapes(await Doc.fromXml(xml));
    const { r, after } = await run(xml, [{ op: 'move', ids: ['X'], lane: 'L1' }]);
    const s = shapes(after);
    expect(s.get('X')!.bounds.y).toBe(before.get('A')!.bounds.y);
    for (const id of ['Pool', 'L1', 'L2', 'E']) expect(s.get(id)!.bounds).toEqual(before.get(id)!.bounds);
    expect(r.layout.moved).toEqual(['X']);
  });
});

/* ------------------------------------------------------------------ */
/* place / align with a reference in another pool                       */
/* ------------------------------------------------------------------ */

describe('place / align never push the reference or its frames away', () => {
  it('refuses a row in another pool that its own pool could only reach by pushing that pool away', async () => {
    const xml = fixture('two-pools.bpmn');
    for (const op of [{ op: 'place', ids: ['Need'], rowOf: 'Pick' }, { op: 'align', ids: ['Need'], axis: 'row', to: 'Pick' }] as Op[]) {
      const e = await failure(xml, [op]);
      expect(e.code).toBe('E_NO_ROOM');
      expect(e.message).toMatch(/push away pool Supplier of Pick/);
      expect(e.related).toEqual(['Pick', 'Supplier']);
    }
  });

  it('writes nothing when it refuses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bpmn-step1-'));
    try {
      const file = join(dir, 'two.bpmn');
      const xml = fixture('two-pools.bpmn');
      writeFileSync(file, xml);
      await expect(mutateFile(file, [{ op: 'place', ids: ['Need'], rowOf: 'Pick' }])).rejects.toMatchObject({ code: 'E_NO_ROOM' });
      expect(readFileSync(file, 'utf8')).toBe(xml);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still places in the own pool', async () => {
    const { after } = await run(fixture('two-pools.bpmn'), [{ op: 'place', ids: ['Done'], below: 'Send' }]);
    const s = shapes(after);
    expect(s.get('Done')!.bounds.y).toBeGreaterThan(bottom(s.get('Send')!));
    expect(s.get('Supplier')!.bounds.y - bottom(s.get('Customer')!)).toBeGreaterThan(0);
    expect(problems(after, FRAME_DEFECTS)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* degenerate connections                                               */
/* ------------------------------------------------------------------ */

describe('connections always keep two distinct waypoints', () => {
  it('a zero-length connection counts as broken and is routed again', async () => {
    const { r, after } = await run(fixture('zero-edge.bpmn'), [{ op: 'set', id: 'S', values: { name: 'Go' } }]);
    expect(r.layout.rerouted).toContain('F2');
    const pts = edges(after).get('F2')!.points;
    expect(pts.length).toBeGreaterThanOrEqual(2);
    expect(pts.some((p) => p.x !== pts[0]!.x || p.y !== pts[0]!.y)).toBe(true);
    expect(problems(after, ['degenerateEdge'])).toEqual([]);
  });

  it('a straight association whose end moved and that now really cuts a shape is routed again', async () => {
    // before the edit its bounding box covers X but the line passes above it: not a cut
    const { r, after } = await run(fixture('diagonal-assoc.bpmn'), [{ op: 'add', kind: 'task', id: 'B', name: 'Before', after: 'S' }]);
    expect(r.layout.rerouted).toContain('DIA');
    expect(problems(after, ['through'])).toEqual([]);
  });

  it('brokenEdge: two waypoints on one point', async () => {
    const doc = await Doc.fromXml(fixture('zero-edge.bpmn'));
    const plane = readPlanes(doc.definitions)[0]!;
    expect(brokenEdge(plane, plane.edges.get('F2')!, undefined)).toBe(true);
    expect(brokenEdge(plane, plane.edges.get('F1')!, undefined)).toBe(false);
  });

  it('rounding never merges the two ends of a connection into one waypoint', async () => {
    const doc = await Doc.fromXml(fixture('zero-edge.bpmn'));
    const planes = readPlanes(doc.definitions);
    planes[0]!.edges.get('F3')!.points = [
      { x: 350.2, y: 140 },
      { x: 350.4, y: 140.2 },
    ];
    writePlanes(doc.moddle, doc.definitions, planes);
    const written = (await Doc.fromXml(await doc.toXml())).definitions;
    const edge = readPlanes(written)[0]!.edges.get('F3')!;
    expect(edge.points).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* metrics                                                              */
/* ------------------------------------------------------------------ */

const DI_NS =
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';

type Rect = [x: number, y: number, width: number, height: number];

function shape(id: string, [x, y, width, height]: Rect, expanded?: boolean): string {
  const exp = expanded === undefined ? '' : ` isExpanded="${expanded}"`;
  return `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${exp}><dc:Bounds x="${x}" y="${y}" width="${width}" height="${height}" /></bpmndi:BPMNShape>`;
}

function edge(id: string, points: Array<[number, number]>): string {
  return `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${points.map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`).join('')}</bpmndi:BPMNEdge>`;
}

function diagramXml(body: string, planeOf: string, di: string[], extraRoots = ''): string {
  const diagram = `<bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="${planeOf}">${di.join('')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`;
  return definitionsXml(body, { nsDecl: DI_NS, extraRoots: `${extraRoots}${diagram}` });
}

const kindsOf = async (xml: string, kinds: MetricKey[]): Promise<LayoutProblem[]> => (await layoutProblemsOfXml(xml)).problems.filter((p) => kinds.includes(p.kind));

describe('metrics: frame defects and real segment tests', () => {
  const SUBS = `
    <bpmn:subProcess id="SubA"><bpmn:task id="InA" /><bpmn:subProcess id="Nested"><bpmn:task id="Deep" /></bpmn:subProcess></bpmn:subProcess>
    <bpmn:subProcess id="SubB"><bpmn:task id="InB" /></bpmn:subProcess>
    <bpmn:task id="Top" />
    <bpmn:boundaryEvent id="Timer" attachedToRef="SubA"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>`;
  const subsDi = (top: Rect, subB: Rect): string[] => [
    shape('SubA', [100, 100, 500, 300], true),
    shape('InA', [130, 150, 100, 80]),
    shape('Nested', [300, 130, 250, 200], true),
    shape('Deep', [350, 180, 100, 80]),
    shape('Timer', [400, 382, 36, 36]),
    shape('SubB', subB, true),
    shape('Top', top),
  ];

  it('is clean for content in its own frames, a boundary event on its host and nested frames', async () => {
    const xml = diagramXml(SUBS, 'Process_1', subsDi([700, 150, 100, 80], [100, 450, 300, 150]));
    expect(await kindsOf(xml, ['frameIntrusion', 'frameOverlap'])).toEqual([]);
  });

  it('frameIntrusion: a node whose centre lies in a sub-process that is not its own', async () => {
    const xml = diagramXml(SUBS, 'Process_1', subsDi([380, 280, 100, 80], [100, 450, 300, 150]));
    expect(await kindsOf(xml, ['frameIntrusion'])).toEqual([
      { kind: 'frameIntrusion', ids: ['Top', 'SubA'] },
      { kind: 'frameIntrusion', ids: ['Top', 'Nested'] },
    ]);
  });

  it('frameOverlap: two sub-processes, neither inside the other, overlapping', async () => {
    const xml = diagramXml(SUBS, 'Process_1', subsDi([700, 150, 100, 80], [450, 350, 300, 150]));
    expect(await kindsOf(xml, ['frameOverlap'])).toEqual([{ kind: 'frameOverlap', ids: ['SubA', 'SubB'] }]);
    const a = { kind: 'frameOverlap' as const, ids: ['SubA', 'SubB'] };
    expect(diffProblems([a], [{ ...a, ids: ['SubB', 'SubA'] }])).toEqual({ added: [], resolved: [] });
  });

  it('pools and lanes: a node in a foreign pool intrudes, lane-less artifacts and collaboration notes do not', async () => {
    const body = `
      <bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>T1</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="L2" /></bpmn:laneSet>
      <bpmn:task id="T1" /><bpmn:dataObjectReference id="DO" dataObjectRef="D" /><bpmn:dataObject id="D" />`;
    const roots = `
      <bpmn:process id="Process_2"><bpmn:task id="T2" /></bpmn:process>
      <bpmn:collaboration id="Collab"><bpmn:participant id="PoolA" processRef="Process_1" /><bpmn:participant id="PoolB" processRef="Process_2" />
        <bpmn:textAnnotation id="Note"><bpmn:text>n</bpmn:text></bpmn:textAnnotation></bpmn:collaboration>`;
    const di = (t2: Rect): string[] => [
      shape('PoolA', [100, 100, 600, 300]),
      shape('L1', [130, 100, 570, 150]),
      shape('L2', [130, 250, 570, 150]),
      shape('T1', [200, 130, 100, 80]),
      shape('DO', [400, 300, 36, 50]),
      shape('Note', [500, 300, 100, 30]),
      shape('PoolB', [100, 450, 600, 200]),
      shape('T2', t2),
    ];
    expect(await kindsOf(diagramXml(body, 'Collab', di([200, 500, 100, 80]), roots), ['frameIntrusion', 'frameOverlap'])).toEqual([]);
    const moved = await layoutProblemsOfXml(diagramXml(body, 'Collab', di([200, 270, 100, 80]), roots));
    expect(moved.problems.filter((p) => p.kind === 'frameIntrusion')).toEqual([
      { kind: 'frameIntrusion', ids: ['T2', 'PoolA'] },
      { kind: 'frameIntrusion', ids: ['T2', 'L2'] },
    ]);
    expect(moved.counts.outsidePool).toBe(1);
    const overlapping = diagramXml(body, 'Collab', [...di([200, 500, 100, 80]).slice(0, 6), shape('PoolB', [100, 380, 600, 200]), shape('T2', [200, 450, 100, 80])], roots);
    expect(await kindsOf(overlapping, ['frameOverlap'])).toEqual([{ kind: 'frameOverlap', ids: ['PoolA', 'PoolB'] }]);
  });

  it('degenerateEdge: one waypoint, or two on one point', async () => {
    const body = `<bpmn:task id="A" /><bpmn:task id="B" /><bpmn:sequenceFlow id="F1" sourceRef="A" targetRef="B" /><bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="B" /><bpmn:sequenceFlow id="F3" sourceRef="A" targetRef="B" />`;
    const di = [shape('A', [100, 100, 100, 80]), shape('B', [300, 100, 100, 80]), edge('F1', [[200, 140]]), edge('F2', [[200, 140], [200, 140]]), edge('F3', [[200, 140], [300, 140]])];
    const m = await layoutProblemsOfXml(diagramXml(body, 'Process_1', di));
    expect(m.problems.filter((p) => p.kind === 'degenerateEdge')).toEqual([
      { kind: 'degenerateEdge', ids: ['F1'] },
      { kind: 'degenerateEdge', ids: ['F2'] },
    ]);
    expect(m.score).toBeGreaterThanOrEqual(20);
  });

  it('through: a diagonal line passing beside a shape is not through it; one crossing it is', async () => {
    const body = `
      <bpmn:task id="A"><bpmn:dataInputAssociation id="DIA"><bpmn:sourceRef>DO</bpmn:sourceRef></bpmn:dataInputAssociation></bpmn:task>
      <bpmn:dataObjectReference id="DO" dataObjectRef="D" /><bpmn:dataObject id="D" /><bpmn:startEvent id="Ev" />`;
    const di = (line: Array<[number, number]>): string[] => [shape('DO', [238, 318, 36, 50]), shape('A', [462, 228, 100, 80]), shape('Ev', [366, 237, 36, 36]), edge('DIA', line)];
    // (274,318) -> (462,268) passes 11 px below the event's box, which its bounding box covers
    expect(await kindsOf(diagramXml(body, 'Process_1', di([[274, 318], [462, 268]])), ['through'])).toEqual([]);
    expect(await kindsOf(diagramXml(body, 'Process_1', di([[274, 318], [462, 228]])), ['through'])).toEqual([{ kind: 'through', ids: ['DIA', 'Ev'] }]);
  });
});
