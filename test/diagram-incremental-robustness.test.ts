/**
 * Regression tests for defects found by the robustness and geometry reviews
 * of the incremental layout (src/diagram/), one block per finding. The
 * fixtures in test/fixtures/incremental/ are small synthetic hand drawings.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/domain/document/Doc.js';
import type { DEdge, DShape } from '../src/domain/diagram/di/types.js';
import { LayoutAnalysis } from '../src/domain/diagram/di/LayoutAnalysis.js';
import { DiagramReader } from '../src/domain/diagram/di/DiagramReader.js';
import { Drawing } from '../src/domain/diagram/layout/incremental/Drawing.js';
import { is, type El } from '../src/domain/document/utils/moddle.js';
import type { EditCommand } from '../src/domain/commands/types.js';
import { mutateDoc } from '../src/index.js';
import { type MutationOptions, type MutationResult } from '../src/domain/batch/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
  return readFileSync(join(HERE, 'fixtures', 'incremental', name), 'utf8');
}

async function run(xml: string, ops: EditCommand[], opts: MutationOptions = {}): Promise<{ result: MutationResult; after: Doc }> {
  const result = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, ...opts });
  const after = await Doc.fromXml(result.xml);
  return { result, after };
}

function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const plane of new DiagramReader(doc.definitions).planes()) for (const shape of plane.shapes.values()) if (!out.has(shape.id)) out.set(shape.id, shape);
  return out;
}

function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const plane of new DiagramReader(doc.definitions).planes()) for (const edge of plane.edges.values()) if (!out.has(edge.id)) out.set(edge.id, edge);
  return out;
}

/** BPMNShapes / BPMNEdges per `plane|element` (more than one: a duplicate). */
function diCounts(doc: Doc): Map<string, number> {
  const out = new Map<string, number>();
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    const plane = diagram.get<El>('plane');
    for (const pe of plane.get<El[]>('planeElement')) {
      const key = `${plane.get<string>('id')}|${pe.get<El | undefined>('bpmnElement')?.get<string>('id')}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

function duplicates(doc: Doc): string[] {
  return [...diCounts(doc)].filter(([, count]) => count > 1).map(([diKey]) => diKey);
}

const right = (shape: DShape): number => shape.bounds.x + shape.bounds.width;
const bottom = (shape: DShape): number => shape.bounds.y + shape.bounds.height;
const cx = (shape: DShape): number => shape.bounds.x + shape.bounds.width / 2;
const cy = (shape: DShape): number => shape.bounds.y + shape.bounds.height / 2;
const inside = (inner: DShape, frame: DShape, tol = 0): boolean => inner.bounds.x >= frame.bounds.x - tol && inner.bounds.y >= frame.bounds.y - tol && right(inner) <= right(frame) + tol && bottom(inner) <= bottom(frame) + tol;

/** The event's centre lies on the host's border (a few px tolerance). */
function attached(event: DShape, host: DShape, tol = 3): boolean {
  const centerX = cx(event);
  const centerY = cy(event);
  const within = centerX >= host.bounds.x - tol && centerX <= right(host) + tol && centerY >= host.bounds.y - tol && centerY <= bottom(host) + tol;
  const onBorder = Math.min(Math.abs(centerX - host.bounds.x), Math.abs(centerX - right(host)), Math.abs(centerY - host.bounds.y), Math.abs(centerY - bottom(host))) <= tol;
  return within && onBorder;
}

/** Distance between a label and its shape (0 when they touch). */
function labelGap(shape: DShape): number {
  const label = shape.label!;
  const dx = Math.max(label.x - right(shape), shape.bounds.x - (label.x + label.width), 0);
  const dy = Math.max(label.y - bottom(shape), shape.bounds.y - (label.y + label.height), 0);
  return Math.hypot(dx, dy);
}

function boundsOf(doc: Doc): Map<string, string> {
  return new Map([...shapes(doc)].map(([id, shape]) => [id, JSON.stringify(shape.bounds)]));
}

/* ------------------------------------------------------------------ */

describe('boundary events of an expanded sub-process', () => {
  it('a new boundary event sits on the sub-process border, the frames do not explode', async () => {
    const { result, after } = await run(fixture('orders.bpmn'), [{ op: 'add', kind: 'boundaryEvent:error', id: 'B_Sub', on: 'Sub_1' }]);
    expect(result.layout.mode).toBe('incremental');
    const now = shapes(after);
    const sub = now.get('Sub_1')!;
    expect(attached(now.get('B_Sub')!, sub)).toBe(true);
    expect(Math.abs(cy(now.get('B_Sub')!) - bottom(sub))).toBeLessThanOrEqual(2);
    expect(now.get('Pool_A')!.bounds.height).toBeLessThan(700);
    expect(duplicates(after)).toEqual([]);
  });

  it('follow the bottom border when the sub-process grows', async () => {
    const { after } = await run(fixture('sub2.bpmn'), [{ op: 'add', kind: 'task', name: 'N', id: 'N', in: 'SP' }]);
    const now = shapes(after);
    expect(bottom(now.get('SP')!)).toBeGreaterThan(300);
    expect(attached(now.get('BE')!, now.get('SP')!)).toBe(true);
    expect(labelGap(now.get('BE')!)).toBeLessThan(30);
  });

  it('stay on the border of a sub-process retyped to a task', async () => {
    const { after } = await run(fixture('sub2.bpmn'), [{ op: 'retype', id: 'SP', kind: 'task' }], { force: true }); // deleting the content needs --force
    const now = shapes(after);
    expect(now.get('SP')!.bounds.width).toBe(100);
    expect(attached(now.get('BE')!, now.get('SP')!)).toBe(true);
  });

  it('collapse keeps every boundary event on the border, in order, with its label', async () => {
    const before = shapes(await Doc.fromXml(fixture('sub3.bpmn')));
    const { after } = await run(fixture('sub3.bpmn'), [{ op: 'set', id: 'SP', values: { expanded: 'false' } }]);
    const now = shapes(after);
    const sp = now.get('SP')!;
    expect(sp.bounds.width).toBe(100);
    const events = [...now.values()].filter((shape) => shape.hostId === 'SP');
    expect(events.length).toBe(3);
    for (const event of events) expect(attached(event, sp)).toBe(true);
    for (const event of events) if (event.label) expect(labelGap(event)).toBeLessThan(40);
    // the ones still on the bottom border keep their left-to-right order
    const bottomRow = events.filter((event) => Math.abs(cy(event) - bottom(sp)) <= 2).sort((first, second) => cx(first) - cx(second)).map((event) => event.id);
    const oldOrder = [...before.values()].filter((shape) => shape.hostId === 'SP').sort((first, second) => cx(first) - cx(second)).map((shape) => shape.id).filter((id) => bottomRow.includes(id));
    expect(bottomRow).toEqual(oldOrder);
  });

  it('the label of a top-border boundary event stays above the host after a rename', async () => {
    const { after } = await run(fixture('subtop2.bpmn'), [{ op: 'set', id: 'BE', values: { name: 'A much longer timeout label text here' } }]);
    const be = shapes(after).get('BE')!;
    const sp = shapes(after).get('SP')!;
    expect(be.label!.y + be.label!.height).toBeLessThanOrEqual(sp.bounds.y + 1);
    expect(labelGap(be)).toBeLessThan(40);
  });
});

describe('relocation keeps one DI per element', () => {
  it('moving a host with a boundary event brings the event along, no second shape', async () => {
    const { result, after } = await run(fixture('boundary.bpmn'), [{ op: 'move', ids: ['A'], after: 'C' }]);
    expect(result.layout.mode).toBe('incremental');
    expect(duplicates(after)).toEqual([]);
    const now = shapes(after);
    expect(attached(now.get('B')!, now.get('A')!)).toBe(true);
    expect(now.get('B')!.di!.get('id')).toBe('B_di');
  });

  it('moving an expanded sub-process brings its content and keeps its size', async () => {
    const { after } = await run(fixture('sub2.bpmn'), [{ op: 'move', ids: ['SP'], after: 'T' }]);
    expect(duplicates(after)).toEqual([]);
    const now = shapes(after);
    const sp = now.get('SP')!;
    expect(sp.bounds.width).toBe(400);
    for (const id of ['SS', 'ST', 'SE']) expect(inside(now.get(id)!, sp)).toBe(true);
    expect(attached(now.get('BE')!, sp)).toBe(true);
  });

  it('re-attaching a boundary event (move --on) puts its shape on the new host', async () => {
    const { result, after } = await run(fixture('orders-boundaries.bpmn'), [{ op: 'move', ids: ['Timer_1'], on: 'Task_Notify' }]);
    const now = shapes(after);
    expect(attached(now.get('Timer_1')!, now.get('Task_Notify')!)).toBe(true);
    expect(now.get('Timer_1')!.di!.get('id')).toBe('Timer_1_di');
    expect(result.layout.rerouted).toContain('F9');
    expect(duplicates(after)).toEqual([]);
  });
});

describe('renaming ids (set id=)', () => {
  it('renaming the process moves nothing', async () => {
    const xml = fixture('sub2.bpmn');
    const { result, after } = await run(xml, [{ op: 'set', id: 'P1', values: { id: 'Renamed' } }]);
    expect(result.layout).toMatchObject({ mode: 'incremental', placed: [], moved: [], rerouted: [] });
    expect(boundsOf(after)).toEqual(boundsOf(await Doc.fromXml(xml)));
    expect(duplicates(after)).toEqual([]);
  });

  it('renaming a sub-process keeps its content where it is', async () => {
    const xml = fixture('sub2.bpmn');
    const { result, after } = await run(xml, [{ op: 'set', id: 'SP', values: { id: 'X' } }]);
    expect(result.layout.moved).toEqual([]);
    const old = boundsOf(await Doc.fromXml(xml));
    const now = boundsOf(after);
    for (const id of ['SS', 'ST', 'SE', 'BE', 'T']) expect(now.get(id)).toBe(old.get(id));
    expect(now.get('X')).toBe(old.get('SP'));
  });

  it('renaming a connected node keeps the hand-drawn route of its flows', async () => {
    const xml = fixture('orders-detour.bpmn');
    const { result, after } = await run(xml, [{ op: 'set', id: 'Task_Esc', values: { id: 'Task_Escalate' } }]);
    expect(result.layout.rerouted).toEqual([]);
    expect(edges(after).get('F9')!.points).toEqual(edges(await Doc.fromXml(xml)).get('F9')!.points);
  });
});

describe('closing a strip inside a sub-process', () => {
  it('shrinks only the sub-process: pool, lanes and the shapes in other lanes stay', async () => {
    const xml = fixture('lanesub.bpmn');
    const old = shapes(await Doc.fromXml(xml));
    const { after } = await run(xml, [{ op: 'remove', ids: ['X'] }]);
    const now = shapes(after);
    for (const id of ['Pool', 'L1', 'L2']) expect(now.get(id)!.bounds).toEqual(old.get(id)!.bounds);
    for (const id of ['T3', 'E']) {
      expect(inside(now.get(id)!, now.get('L1')!)).toBe(true);
      expect(inside(now.get(id)!, now.get('Pool')!)).toBe(true);
    }
    expect(right(now.get('SP')!)).toBeLessThan(right(old.get('SP')!));
  });

  it('the same on a hand drawing with an end event right of the sub-process in another lane', async () => {
    const xml = fixture('orders.bpmn').replace(/(<bpmndi:BPMNShape id="End_1_di"[^>]*>\s*<dc:Bounds x=")\d+/, '$11312');
    const { result, after } = await run(xml, [{ op: 'remove', ids: ['S_Task'] }]);
    const now = shapes(after);
    expect(inside(now.get('End_1')!, now.get('Pool_A')!)).toBe(true);
    expect(inside(now.get('End_1')!, now.get('Lane_1')!)).toBe(true);
    expect((result.layout.metrics?.added ?? []).map((problem) => problem.kind)).not.toContain('outsidePool');
  });
});

describe('several diagrams, partial and unusual DI', () => {
  it('a second view of the same process keeps its own connections', async () => {
    const { after } = await run(fixture('twoviews.bpmn'), [{ op: 'set', id: 'C', values: { name: 'Renamed' } }]);
    const planes = new DiagramReader(after.definitions).planes();
    expect(planes.map((plane) => [plane.shapes.size, plane.edges.size])).toEqual([
      [7, 5],
      [7, 5],
    ]);
    expect(duplicates(after)).toEqual([]);
  });

  it('a second view loses the edges of the flows whose ends changed and keeps the rest; with --no-layout both views do', async () => {
    const xml = fixture('twoviews.bpmn');
    const viewEdges = (doc: Doc): string[][] => new DiagramReader(doc.definitions).planes().map((plane) => [...plane.edges.keys()].sort());
    // C after D: the bridge F2 (A -> D) and D -> C (F4) get other ends, C -> D (F3) goes, C -> E is new
    const { result, after } = await run(xml, [{ op: 'move', ids: ['C'], after: 'D' }], { layout: 'incremental' });
    expect(viewEdges(after)).toEqual([
      ['F1', 'F2', 'F4', 'F5', 'F_TaskCToE'],
      ['F1', 'F5'],
    ]);
    expect(result.layout.notes).toEqual(['edge(s) of F2, F4 removed from a further diagram of the same root: their ends changed, and further diagrams are not laid out']);
    expect(new DiagramReader(after.definitions).planes().flatMap((plane) => [...plane.edges.values()].filter((edge) => new Drawing(plane).detachedEnds(edge).length))).toEqual([]);
    expect(duplicates(after)).toEqual([]);
    // a rename of an end is no end change: both views keep every edge
    const renamed = await run(xml, [{ op: 'set', id: 'C', values: { id: 'Activity_C' } }], { layout: 'incremental' });
    expect(viewEdges(renamed.after).map((planeEdges) => planeEdges.length)).toEqual([5, 5]);
    const skipped = await run(xml, [{ op: 'move', ids: ['C'], after: 'D' }], { layout: false });
    expect(viewEdges(skipped.after)).toEqual([
      ['F1', 'F5'],
      ['F1', 'F5'],
    ]);
    expect(skipped.result.changes.notes).toContain('removed 6 stale diagram element(s), among them the edge(s) of F2, F4 (their ends changed; the next model edit without --no-layout draws them, or `bpmn route <file> <flowId>`)');
  });

  it('a shape without bounds gets bounds on its own DI (colour kept), no second shape', async () => {
    for (const name of ['nobounds.bpmn', 'nan.bpmn']) {
      const { result, after } = await run(fixture(name), [{ op: 'set', id: 'E2', values: { name: 'x' } }]);
      expect(result.layout.placed).toContain('C');
      expect(duplicates(after)).toEqual([]);
      const shapeC = shapes(after).get('C')!;
      expect(shapeC.di!.get('id')).toBe('C_di');
      expect(Number.isFinite(shapeC.bounds.x)).toBe(true);
      if (name === 'nobounds.bpmn') expect(shapeC.di!.get('bioc:fill')).toBe('#ff0000');
    }
  });

  it('a host drawn for the first time gets its existing boundary event back on its border', async () => {
    const { after } = await run(fixture('nohost.bpmn'), [{ op: 'set', id: 'E2', values: { name: 'x' } }]);
    const now = shapes(after);
    expect(attached(now.get('B')!, now.get('A')!)).toBe(true);
    expect(now.get('B')!.di!.get('id')).toBe('B_di');
  });

  it('a plane without bpmnElement shows the first process (like bpmn-js): kept, not redrawn', async () => {
    const xml = fixture('noroot.bpmn');
    const { result, after } = await run(xml, [{ op: 'add', kind: 'task', name: 'N', id: 'N', after: 'A' }]);
    expect(result.layout.mode).toBe('incremental');
    const now = shapes(after);
    expect(now.get('S')!.di!.get('id')).toBe('S_di');
    expect(now.get('S')!.bounds).toEqual(shapes(await Doc.fromXml(xml.replace('<bpmndi:BPMNPlane id="PL1">', '<bpmndi:BPMNPlane id="PL1" bpmnElement="P1">'))).get('S')!.bounds);
    expect(after.definitions.get<El[]>('diagrams')[0]!.get<El>('plane').get<El>('bpmnElement').get('id')).toBe('P1');
  });

  it('vertical pools are not edited with horizontal logic: auto redraws, incremental refuses', async () => {
    const xml = fixture('vertical.bpmn');
    const ops: EditCommand[] = [{ op: 'move', ids: ['A'], lane: 'L2' }];
    const auto = await run(xml, ops);
    expect(auto.result.layout.mode).toBe('full');
    expect(auto.result.layout.warnings.map((warning) => warning.code)).toContain('INCREMENTAL_FAILED');
    await expect(run(xml, ops, { layout: 'incremental' })).rejects.toMatchObject({ code: 'E_LAYOUT_INCREMENTAL' });
    // nothing to place or move: the drawing is kept
    const rename = await run(xml, [{ op: 'set', id: 'A', values: { name: 'Renamed' } }]);
    expect(rename.result.layout.mode).toBe('incremental');
  });

  it('a line that does not reach its end on a plane with vertical pools stays as drawn: a rename keeps the drawing, the metric still reports it', async () => {
    // F3 ends 22 px left of End E (x 182..218)
    const xml = fixture('vertical.bpmn').replace('<di:waypoint x="218" y="550"/>', '<di:waypoint x="160" y="550"/>');
    const ops: EditCommand[] = [{ op: 'set', id: 'A', values: { name: 'Task A2' } }];
    for (const layout of ['auto', 'incremental'] as const) {
      const { result, after } = await run(xml, ops, { layout });
      expect(result.layout.mode, layout).toBe('incremental');
      expect(result.layout.rerouted ?? [], layout).toEqual([]);
      expect(result.layout.notes ?? [], layout).toEqual([]);
      expect(edges(after).get('F3')!.points.at(-1), layout).toEqual({ x: 160, y: 550 });
      expect(LayoutAnalysis.of(after.definitions).problems.filter((problem) => problem.kind === 'detachedEdge').map((problem) => problem.ids)).toEqual([['F3', 'E']]);
    }
  });

  it('a retype and a rename of the same node in one batch are no end change: both views keep its edges, with and without layout', async () => {
    const xml = fixture('twoviews.bpmn');
    const viewEdges = (doc: Doc): string[][] => new DiagramReader(doc.definitions).planes().map((plane) => [...plane.edges.keys()].sort());
    const ops: EditCommand[] = [
      { op: 'retype', id: 'C', kind: 'userTask' },
      { op: 'set', id: 'C', values: { id: 'Activity_C' } },
    ];
    for (const layout of ['incremental', false] as const) {
      const { result, after } = await run(xml, ops, { layout });
      expect(viewEdges(after), String(layout)).toEqual([
        ['F1', 'F2', 'F3', 'F4', 'F5'],
        ['F1', 'F2', 'F3', 'F4', 'F5'],
      ]);
      expect([...(result.layout.notes ?? []), ...result.changes.notes].filter((note) => note.includes('ends changed')), String(layout)).toEqual([]);
    }
  });
});

describe('frames and obstacles', () => {
  it('a tall new shape next to a node near the pool top stays inside the pool', async () => {
    const { after } = await run(fixture('pool.bpmn'), [{ op: 'add', kind: 'subProcess', name: 'New sub', id: 'N', after: 'A' }]);
    const now = shapes(after);
    expect(inside(now.get('N')!, now.get('Pool')!)).toBe(true);
  });

  it('a new event sub-process at the bottom of a pool keeps its content inside while the pool grows', async () => {
    // a taller pool: the new sub-process straddles its bottom border, its start event lies below the line the pool grows at
    const xml = fixture('pool.bpmn').replace('<dc:Bounds x="100" y="80" width="700" height="160"/>', '<dc:Bounds x="100" y="80" width="700" height="220"/>');
    const { result, after } = await run(xml, [{ op: 'add', kind: 'eventSubProcess:message', name: 'On msg', id: 'N', in: 'P1', message: 'Mx' }]);
    const now = shapes(after);
    const start = [...now.values()].find((shape) => shape.parentId === 'N')!;
    expect(start).toBeDefined();
    expect(inside(start, now.get('N')!)).toBe(true);
    expect(inside(now.get('N')!, now.get('Pool')!)).toBe(true);
    expect((result.layout.metrics?.added ?? []).map((problem) => problem.kind)).toEqual([]);
  });

  it('the strip a node leaves when it moves into a sub-process closes in the frame it left', async () => {
    // an annotation right of the moved node, below the sub-process band: it moves left with everything else
    const xml = fixture('sub2.bpmn')
      .replace('<bpmn:sequenceFlow id="F3" sourceRef="T" targetRef="E"/>', '<bpmn:sequenceFlow id="F3" sourceRef="T" targetRef="E"/>\n    <bpmn:textAnnotation id="Note"><bpmn:text>later</bpmn:text></bpmn:textAnnotation>')
      .replace('</bpmndi:BPMNPlane>', '<bpmndi:BPMNShape id="Note_di" bpmnElement="Note"><dc:Bounds x="900" y="360" width="100" height="30"/></bpmndi:BPMNShape></bpmndi:BPMNPlane>');
    const old = shapes(await Doc.fromXml(xml));
    const { after } = await run(xml, [{ op: 'move', ids: ['T'], in: 'SP' }]);
    const now = shapes(after);
    const dx = now.get('E')!.bounds.x - old.get('E')!.bounds.x;
    expect(dx).toBeLessThan(0);
    expect(now.get('Note')!.bounds.x - old.get('Note')!.bounds.x).toBe(dx);
    expect(inside(now.get('T')!, now.get('SP')!)).toBe(true);
  });

  it('a collaboration-level annotation moves with the pool it is drawn in', async () => {
    const xml = fixture('collabnote.bpmn');
    const old = shapes(await Doc.fromXml(xml));
    const { after } = await run(xml, [
      { op: 'add', kind: 'boundaryEvent:timer', name: 'T', id: 'BT', on: 'A', timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', name: 'Late', id: 'EL', after: 'BT' },
    ]);
    const now = shapes(after);
    const dy = now.get('PB')!.bounds.y - old.get('PB')!.bounds.y;
    expect(dy).toBeGreaterThan(0);
    expect(now.get('Note')!.bounds.y - old.get('Note')!.bounds.y).toBe(dy);
  });

  it('a new task in a lane avoids an annotation drawn in that lane', async () => {
    const xml = readFileSync(join(HERE, '..', 'tools', 'scenarios', 'subproc__s15-lanes-sub-eventsub.bpmn'), 'utf8');
    const { result, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'Z_T', name: 'Z free', in: 'Process_Main', lane: 'Lane_WH' }]);
    expect(result.layout.notes ?? []).not.toContainEqual(expect.stringMatching(/overlap left/));
    const now = shapes(after);
    const shapeT = now.get('Z_T')!;
    for (const shape of now.values()) {
      if (shape.id === 'Z_T' || shape.container || shape.kind === 'group' || shape.kind === 'lane' || shape.kind === 'participant') continue;
      const apart = shapeT.bounds.x >= right(shape) || shape.bounds.x >= right(shapeT) || shapeT.bounds.y >= bottom(shape) || shape.bounds.y >= bottom(shapeT);
      expect(apart, `Z_T overlaps ${shape.id}`).toBe(true);
    }
  });

  it('a node after an anchor inside a group goes into that group; other columns stay', async () => {
    const xml = fixture('groups.bpmn');
    const old = shapes(await Doc.fromXml(xml));
    const { after } = await run(xml, [
      { op: 'add', kind: 'boundaryEvent:timer', id: 'T', name: 'Late', on: 'A', timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', id: 'TE', name: 'Timed out', after: 'T' },
    ]);
    const now = shapes(after);
    expect(inside(now.get('TE')!, now.get('G1')!)).toBe(true);
    for (const id of ['G2', 'S3', 'C', 'E3', 'D']) expect(now.get(id)!.bounds).toEqual(old.get(id)!.bounds);
  });
});

describe('connections', () => {
  it('a kept message flow that a grown sub-process now covers is rerouted', async () => {
    const { result } = await run(fixture('orders.bpmn'), [{ op: 'add', kind: 'task', id: 'T_New', name: 'In sub', after: 'S_Task' }]);
    expect(result.layout.rerouted).toContain('Msg_1');
    expect((result.layout.metrics?.added ?? []).map((problem) => problem.kind)).toEqual([]);
  });

  it('a new boundary event does not sit on the dock of an existing connection', async () => {
    const xml = fixture('orders.bpmn');
    const { result, after } = await run(xml, [
      { op: 'add', kind: 'boundaryEvent:timer', id: 'B_New', name: 'late', on: 'Task_Notify', timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', id: 'E_New', name: 'Late end', after: 'B_New' },
    ]);
    const dock = edges(await Doc.fromXml(xml)).get('Msg_1')!.points[0]!;
    const boundary = shapes(after).get('B_New')!;
    expect(dock.x < boundary.bounds.x - 4 || dock.x > right(boundary) + 4).toBe(true);
    expect(result.layout.rerouted).not.toContain('Msg_1');
  });
});

/* ------------------------------------------------------------------ */
/* engine ownership                                                     */
/* ------------------------------------------------------------------ */

const BASE: EditCommand[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
];

async function engineXml(ops: EditCommand[]): Promise<string> {
  const result = await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true });
  expect(result.layout.mode).toBe('full');
  return result.xml;
}

describe('engine ownership (auto mode)', () => {
  it('an untouched engine drawing is redrawn in full', async () => {
    const { result } = await run(await engineXml(BASE), [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'B' }]);
    expect(result.layout).toMatchObject({ mode: 'full', reason: 'engine-owned diagram: redrawn' });
  });

  it('a moved annotation, a hand bend or a dragged label makes it hand-made', async () => {
    const xml = await engineXml([...BASE, { op: 'add', kind: 'textAnnotation', id: 'Note', text: 'Remember', to: 'A' }]);
    const moveNote = async (): Promise<string> => {
      const doc = await Doc.fromXml(xml);
      for (const diagram of doc.definitions.get<El[]>('diagrams')) {
        for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
          if (pe.get<El>('bpmnElement').get('id') === 'Note') pe.get<El>('bounds').set('x', pe.get<El>('bounds').get<number>('x') + 200);
        }
      }
      return doc.toXml();
    };
    const add: EditCommand[] = [{ op: 'add', kind: 'task', id: 'N', name: 'New', after: 'B' }];
    expect((await run(await moveNote(), add)).result.layout.mode).toBe('incremental');
    // a format op that only reroutes or moves a label: the next edit keeps it
    const routed = await run(xml, [{ op: 'route', id: (await flowId(xml, 'G', 'C'))!, exit: 'bottom', entry: 'top' } as EditCommand]);
    const next = await run(routed.result.xml, add);
    expect(next.result.layout.mode).toBe('incremental');
    const flow = (await flowId(xml, 'G', 'C'))!;
    expect(edges(next.after).get(flow)!.points).toEqual(edges(routed.after).get(flow)!.points);
    const labelled = await run(xml, [{ op: 'label', id: 'S', side: 'above' } as EditCommand]);
    expect((await run(labelled.result.xml, add)).result.layout.mode).toBe('incremental');
  });

  it('a node added with --no-layout does not make an engine drawing hand-made', async () => {
    const xml = await engineXml(BASE);
    const stale = await run(xml, [{ op: 'add', kind: 'task', id: 'Off', name: 'Offline step', after: 'A' }], { layout: false });
    expect(stale.result.layout.status).toBe('skipped');
    const { result } = await run(stale.result.xml, [{ op: 'add', kind: 'task', id: 'N', name: 'Next', after: 'B' }]);
    expect(result.layout.mode).toBe('full');
    expect(result.layout.reason).toMatch(/engine-owned diagram \(1 flow node\(s\) had no shape/);
  });

  it('a hand drawing with a node added by --no-layout says why it is kept', async () => {
    const stale = await run(fixture('boundary.bpmn'), [{ op: 'add', kind: 'task', id: 'Off', name: 'Off', after: 'A' }], { layout: false });
    const { result, after } = await run(stale.result.xml, [{ op: 'add', kind: 'task', id: 'On', name: 'On', after: 'C' }]);
    expect(result.layout.mode).toBe('incremental');
    expect(result.layout.reason).toMatch(/1 flow node\(s\) had no shape/);
    expect(shapes(after).has('Off')).toBe(true);
  });
});

async function flowId(xml: string, source: string, target: string): Promise<string | undefined> {
  const doc = await Doc.fromXml(xml);
  for (const [id, el] of doc.byId()) {
    if (is(el, 'bpmn:SequenceFlow') && el.get<El>('sourceRef').get('id') === source && el.get<El>('targetRef').get('id') === target) return id;
  }
  return undefined;
}
