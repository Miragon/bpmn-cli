/**
 * Regression tests for the clean full-layout engine (src/domain/diagram/layout/clean/*): lane
 * bands that follow the content, message flows that avoid shapes and pick
 * the pool order, notes on boundary events, the lines of a scope's notes, notes on data
 * objects, event sub-processes in their own lane and collapsible, and text annotations owned by
 * the collaboration.
 *
 * Fixtures are synthetic scenarios of the layout harness
 * (tools/scenarios/*.bpmn) or inline models. Every test lays the model out
 * with the engine (`layoutModel`, as `bpmn layout` does) and checks the
 * diagram interchange geometrically.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type LayoutOptions, type LayoutWarningInfo, FullLayout } from '../../../../../src/domain/diagram/layout/FullLayout.js';
import { MessageFlowRouter, type MessageFlowJob, type MessagePool } from '../../../../../src/domain/diagram/layout/clean/MessageFlowRouter.js';
import { LinkRouter } from '../../../../../src/domain/diagram/layout/clean/LinkRouter.js';
import type { ScopeLayout } from '../../../../../src/domain/diagram/di/types.js';
import { pathHits, polylinesCross } from '../../../../../src/domain/diagram/utils/geom.js';
import { is, many, parseXml, type El, type Model } from '../../../../../src/domain/document/utils/moddle.js';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const scenario = (name: string): string => readFileSync(join(HERE, '..', 'tools', 'scenarios', name), 'utf8');

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
interface Drawn {
  model: Model;
  warnings: LayoutWarningInfo[];
  /** shapes of the main plane by element id */
  shapes: Map<string, { el: El; box: Box; expanded: boolean; label?: Box }>;
  /** edges of the main plane by element id */
  edges: Map<string, { el: El; points: Point[]; label?: Box }>;
  /** bpmnElement ids of every plane */
  planes: string[];
  byId: Map<string, El>;
}

const boxOf = (element: El): Box => ({ x: element.get<number>('x'), y: element.get<number>('y'), width: element.get<number>('width'), height: element.get<number>('height') });

async function drawn(xml: string, opts: LayoutOptions = {}): Promise<Drawn> {
  const source = await parseXml(xml);
  const { xml: out, warnings } = await new FullLayout(source, opts).run();
  const model = await parseXml(out);
  const shapes: Drawn['shapes'] = new Map();
  const edges: Drawn['edges'] = new Map();
  const planes: string[] = [];
  const diagrams = many(model.definitions, 'diagrams');
  diagrams.forEach((diagram, index) => {
    const plane = diagram.get<El>('plane');
    planes.push(plane.get<El>('bpmnElement').get<string>('id'));
    if (index > 0) return;
    for (const pe of many(plane, 'planeElement')) {
      const el = pe.get<El>('bpmnElement');
      const label = pe.get<El | undefined>('label')?.get<El | undefined>('bounds');
      if (is(pe, 'bpmndi:BPMNShape')) {
        shapes.set(el.get<string>('id'), { el, box: boxOf(pe.get<El>('bounds')), expanded: pe.get<boolean | undefined>('isExpanded') === true, ...(label ? { label: boxOf(label) } : {}) });
      } else {
        edges.set(el.get<string>('id'), { el, points: many(pe, 'waypoint').map((waypoint) => ({ x: waypoint.get<number>('x'), y: waypoint.get<number>('y') })), ...(label ? { label: boxOf(label) } : {}) });
      }
    }
  });
  const byId = new Map<string, El>();
  const visit = (el: El): void => {
    const id = el.get<string | undefined>('id');
    if (id) byId.set(id, el);
    for (const key of ['rootElements', 'flowElements', 'artifacts', 'participants', 'messageFlows', 'laneSets', 'lanes']) {
      for (const child of (el.get<El[] | undefined>(key) ?? []) as El[]) {
        visit(child);
      }
    }
    const child = el.get<El | undefined>('childLaneSet');
    if (child) visit(child);
  };
  visit(model.definitions);
  return { model, warnings, shapes, edges, planes, byId };
}

const inside = (inner: Box, outer: Box): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const overlap = (first: Box, second: Box): boolean => first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;
/** a segment cuts a box (2 px tolerance at the border, as the harness counts it) */
const cuts = (segmentStart: Point, segmentEnd: Point, box: Box): boolean =>
  Math.min(segmentStart.x, segmentEnd.x) < box.x + box.width - 2 && Math.max(segmentStart.x, segmentEnd.x) > box.x + 2 && Math.min(segmentStart.y, segmentEnd.y) < box.y + box.height - 2 && Math.max(segmentStart.y, segmentEnd.y) > box.y + 2;
const segments = (pts: Point[]): Array<[Point, Point]> => pts.slice(1).map((point, index) => [pts[index]!, point]);
const bottomOf = (box: Box): number => box.y + box.height;
const rightOf = (box: Box): number => box.x + box.width;
/** a point on the border of a box (1 px tolerance) */
const onBorder = (point: Point, box: Box): boolean =>
  point.x >= box.x - 1 && point.x <= rightOf(box) + 1 && point.y >= box.y - 1 && point.y <= bottomOf(box) + 1 && Math.min(Math.abs(point.x - box.x), Math.abs(point.x - rightOf(box)), Math.abs(point.y - box.y), Math.abs(point.y - bottomOf(box))) <= 1;
/** a point on an orthogonal polyline (1 px tolerance) */
const onPolyline = (point: Point, pts: Point[]): boolean =>
  segments(pts).some(([segmentStart, segmentEnd]) => point.x >= Math.min(segmentStart.x, segmentEnd.x) - 1 && point.x <= Math.max(segmentStart.x, segmentEnd.x) + 1 && point.y >= Math.min(segmentStart.y, segmentEnd.y) - 1 && point.y <= Math.max(segmentStart.y, segmentEnd.y) + 1);
/** the length two polylines run on top of each other, or side by side `from` to `to` px apart */
function sharedRun(first: Point[], second: Point[], from = 0, to = 0): number {
  let run = 0;
  const overlap = (lo: number, hi: number, otherLo: number, otherHi: number): number => Math.max(0, Math.min(Math.max(lo, hi), Math.max(otherLo, otherHi)) - Math.max(Math.min(lo, hi), Math.min(otherLo, otherHi)));
  const apart = (first: number, second: number): boolean => Math.abs(first - second) >= from && Math.abs(first - second) <= to;
  for (const [start, end] of segments(first)) {
    for (const [otherStart, otherEnd] of segments(second)) {
      if (start.y === end.y && otherStart.y === otherEnd.y && apart(start.y, otherStart.y)) {
        run += overlap(start.x, end.x, otherStart.x, otherEnd.x);
      } else if (start.x === end.x && otherStart.x === otherEnd.x && apart(start.x, otherStart.x)) {
        run += overlap(start.y, end.y, otherStart.y, otherEnd.y);
      }
    }
  }
  return run;
}

/** Leaf lanes with their flow nodes (boundary events excluded: they sit on the host's border). */
function leafLanes(drawing: Drawn): Array<{ id: string; nodes: string[] }> {
  const out: Array<{ id: string; nodes: string[] }> = [];
  const visit = (lane: El): void => {
    const child = lane.get<El | undefined>('childLaneSet');
    if (child && many(child, 'lanes').length) {
      return many(child, 'lanes').forEach(visit);
    }
    const nodes = (lane.get<El[] | undefined>('flowNodeRef') ?? []).filter((node) => !is(node, 'bpmn:BoundaryEvent')).map((node) => node.get<string>('id'));
    out.push({ id: lane.get<string>('id'), nodes });
  };
  for (const el of drawing.byId.values()) {
    if (is(el, 'bpmn:LaneSet') && !is(el.$parent as El, 'bpmn:Lane')) {
      many(el, 'lanes').forEach(visit);
    }
  }
  return out;
}

function outsideLane(drawing: Drawn): string[] {
  const bad: string[] = [];
  for (const lane of leafLanes(drawing)) {
    const lb = drawing.shapes.get(lane.id)?.box;
    if (!lb) continue;
    for (const id of lane.nodes) {
      const shape = drawing.shapes.get(id);
      if (shape && !inside(shape.box, lb)) bad.push(`${id} outside ${lane.id}`);
    }
  }
  return bad;
}

const isContainer = (shape: { el: El; expanded: boolean }): boolean => is(shape.el, 'bpmn:Participant') || is(shape.el, 'bpmn:Lane') || shape.expanded;

function leafOverlaps(drawing: Drawn): string[] {
  const leaves = [...drawing.shapes].filter(([, shape]) => !isContainer(shape));
  const host = (el: El): string | undefined => el.get<El | undefined>('attachedToRef')?.get<string>('id');
  const bad: string[] = [];
  for (let index = 0; index < leaves.length; index++) {
    for (let otherIndex = index + 1; otherIndex < leaves.length; otherIndex++) {
      const [firstId, sa] = leaves[index]!, [secondId, sb] = leaves[otherIndex]!;
      if (host(sa.el) === secondId || host(sb.el) === firstId) continue;
      if (overlap(sa.box, sb.box)) bad.push(`${firstId}~${secondId}`);
    }
  }
  return bad;
}

/** Leaf shapes an edge cuts although it does not connect them (nor their host / boundary events). */
function cutShapes(drawing: Drawn, edgeId: string): string[] {
  const edge = drawing.edges.get(edgeId)!;
  const ends = new Set<string>();
  for (const key of ['sourceRef', 'targetRef']) {
    const end = edge.el.get<El | undefined>(key);
    if (end) ends.add(end.get<string>('id'));
  }
  const bad: string[] = [];
  for (const [id, shape] of drawing.shapes) {
    if (isContainer(shape) || ends.has(id)) continue;
    const host = shape.el.get<El | undefined>('attachedToRef')?.get<string>('id');
    if (host && ends.has(host)) continue;
    if (segments(edge.points).some(([segmentStart, segmentEnd]) => cuts(segmentStart, segmentEnd, shape.box))) {
      bad.push(id);
    }
  }
  return bad;
}

const messageFlowIds = (drawing: Drawn): string[] => [...drawing.edges].filter(([, edge]) => is(edge.el, 'bpmn:MessageFlow')).map(([id]) => id);

/* ------------------------------------------------------------------ */

describe('lane bands follow the content after routing', () => {
  // a loop drawn over the top (or an annotation strip) moved every node down; the bands stayed where the rows were
  it.each(['lanes__complaint-t1.bpmn', 'lanes__complaint-t2.bpmn', 'subproc__s19-lanes-loop-3.bpmn'])('%s: every node lies inside its lane', async (file) => {
    const drawing = await drawn(scenario(file));
    expect(outsideLane(drawing)).toEqual([]);
  });

  it.each(['lanes__complaint-t1.bpmn', 'lanes__complaint-t2.bpmn'])('%s: lanes stack without gaps and fill the pool', async (file) => {
    const drawing = await drawn(scenario(file));
    const lanes = leafLanes(drawing).map((lane) => drawing.shapes.get(lane.id)!.box);
    for (let index = 1; index < lanes.length; index++) {
      expect(lanes[index]!.y).toBe(lanes[index - 1]!.y + lanes[index - 1]!.height);
    }
    const pool = drawing.shapes.get('Participant_Reklamationsbearbeitung')!.box;
    expect(lanes[0]!.y).toBe(pool.y);
    expect(lanes[lanes.length - 1]!.y + lanes[lanes.length - 1]!.height).toBe(pool.y + pool.height);
  });

  it.each(['lanes__complaint-t1.bpmn', 'lanes__complaint-t2.bpmn'])('%s: no two shapes overlap', async (file) => {
    const drawing = await drawn(scenario(file));
    expect(leafOverlaps(drawing)).toEqual([]);
  });
});

describe('message flows', () => {
  it.each(['lanes__complaint-t1.bpmn', 'lanes__complaint-t2.bpmn', 'subproc__s08-collab3.bpmn', 'agent__onb.bpmn'])('%s: no message flow cuts a shape', async (file) => {
    const drawing = await drawn(scenario(file));
    const ids = messageFlowIds(drawing);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(cutShapes(drawing, id), id).toEqual([]);
    }
  });

  it('a black-box pool whose flows end in the top lane is drawn above the process pool', async () => {
    const drawing = await drawn(scenario('lanes__complaint-t1.bpmn'));
    const customer = drawing.shapes.get('Participant_Kunde')!.box;
    const process = drawing.shapes.get('Participant_Reklamationsbearbeitung')!.box;
    expect(customer.y + customer.height).toBeLessThan(process.y);
  });

  it('pools are ordered so that no message flow has to skip a pool', async () => {
    // declared order Shop, Customer, Supplier: Shop <-> Supplier flows had to run around the Customer pool
    const drawing = await drawn(scenario('subproc__s08-collab3.bpmn'));
    for (const id of messageFlowIds(drawing)) {
      expect(drawing.edges.get(id)!.points.length, id).toBeLessThanOrEqual(4);
    }
  });

  it('a message flow does not run on top of a sequence flow leaving the same element', async () => {
    const drawing = await drawn(scenario('collab__notes-on-collaboration.bpmn'));
    const msg = segments(drawing.edges.get('Flow_Order')!.points);
    const seq = segments(drawing.edges.get('Flow_1')!.points);
    const collinear = msg.some(([messageStart, messageEnd]) => seq.some(([seqStart, seqEnd]) => messageStart.x === messageEnd.x && seqStart.x === seqEnd.x && messageStart.x === seqStart.x && Math.min(Math.max(messageStart.y, messageEnd.y), Math.max(seqStart.y, seqEnd.y)) > Math.max(Math.min(messageStart.y, messageEnd.y), Math.min(seqStart.y, seqEnd.y))));
    expect(collinear).toBe(false);
  });

  it('the label of a straight message flow sits in the gap between the pools', async () => {
    const drawing = await drawn(scenario('artifacts__17-pool-notes-msg.bpmn'));
    const pools = [...drawing.shapes.values()].filter((shape) => is(shape.el, 'bpmn:Participant')).map((shape) => shape.box).sort((first, second) => first.y - second.y);
    const gapTop = pools[0]!.y + pools[0]!.height, gapBottom = pools[1]!.y;
    for (const id of messageFlowIds(drawing)) {
      const label = drawing.edges.get(id)!.label;
      if (!label) continue;
      expect(label.y, id).toBeGreaterThanOrEqual(gapTop);
      expect(label.y + label.height, id).toBeLessThanOrEqual(gapBottom);
    }
  });

  it('routes a flow around a shape between its element and the pool border (pure geometry)', () => {
    // upper pool: the source in the middle, a shape right below it; lower pool: a black box
    const source: Box = { x: 200, y: 100, width: 100, height: 80 };
    const blocker: Box = { x: 200, y: 240, width: 100, height: 80 };
    const upper: MessagePool = { box: { x: 0, y: 0, width: 600, height: 400 }, obstacles: [source, blocker], lines: [], contentLeft: 30 };
    const target: Box = { x: 0, y: 480, width: 600, height: 60 };
    const lower: MessagePool = { box: target, obstacles: [], lines: [], contentLeft: 30 };
    const job = { el: fakeEl('bpmn:Task'), source: fakeEl('bpmn:Task'), target: fakeEl('bpmn:Participant'), sourceBox: source, targetBox: target, sourceOwn: [], targetOwn: [], sourcePool: upper, targetPool: lower } as unknown as MessageFlowJob;
    const [route] = new MessageFlowRouter([job], [upper, lower]).route();
    expect(segments(route!.points).some(([segmentStart, segmentEnd]) => cuts(segmentStart, segmentEnd, blocker))).toBe(false);
    expect(route!.points[0]).toEqual({ x: 250, y: 180 });
    for (const [segmentStart, segmentEnd] of segments(route!.points)) {
      expect(segmentStart.x === segmentEnd.x || segmentStart.y === segmentEnd.y).toBe(true);
    }
  });

  it('leaves its element across an annotation line rather than one exit further (pure geometry)', () => {
    // the middle exit is blocked; a line crosses the way down from the left exit, so the right one wins unless it is an annotation line
    const source: Box = { x: 200, y: 100, width: 100, height: 80 };
    const blocker: Box = { x: 240, y: 250, width: 20, height: 20 };
    const line: [Point, Point] = [
      { x: 210, y: 300 },
      { x: 235, y: 300 },
    ];
    const target: Box = { x: 0, y: 480, width: 600, height: 60 };
    const exitOf = (crossable?: Array<[Point, Point]>): Point => {
      const upper: MessagePool = { box: { x: 0, y: 0, width: 600, height: 400 }, obstacles: [source, blocker], lines: [line], ...(crossable ? { crossable } : {}), contentLeft: 30 };
      const lower: MessagePool = { box: target, obstacles: [], lines: [], contentLeft: 30 };
      const job = { el: fakeEl('bpmn:MessageFlow'), source: fakeEl('bpmn:Task'), target: fakeEl('bpmn:Participant'), sourceBox: source, targetBox: target, sourceOwn: [], targetOwn: [], sourcePool: upper, targetPool: lower } as unknown as MessageFlowJob;
      return new MessageFlowRouter([job], [upper, lower]).route()[0]!.points[0]!;
    };
    expect(exitOf()).toEqual({ x: 275, y: 180 });
    expect(exitOf([])).toEqual({ x: 225, y: 180 });
  });

  it('keeps the declaration order when no order is better', () => {
    const upperPool: MessagePool = { box: { x: 0, y: 0, width: 600, height: 200 }, obstacles: [], lines: [], contentLeft: 30 };
    const lowerPool: MessagePool = { box: { x: 0, y: 280, width: 600, height: 60 }, obstacles: [], lines: [], contentLeft: 30 };
    const job = { el: fakeEl('bpmn:MessageFlow'), source: fakeEl('bpmn:Task'), target: fakeEl('bpmn:Participant'), sourceBox: { x: 100, y: 60, width: 100, height: 80 }, targetBox: lowerPool.box, sourceOwn: [], targetOwn: [], sourcePool: upperPool, targetPool: lowerPool } as unknown as MessageFlowJob;
    const order = new MessageFlowRouter([job], [upperPool, lowerPool]).poolOrder();
    expect(order).toEqual([upperPool, lowerPool]);
  });
});

/** Just enough of a moddle element for the pure geometry functions (they only ask `$instanceOf`). */
function fakeEl(type: string): El {
  return { $instanceOf: (candidateType: string) => candidateType === type, get: () => undefined } as unknown as El;
}

describe('notes on boundary events', () => {
  it('a note does not cover a sibling boundary event or its outgoing flow', async () => {
    const drawing = await drawn(scenario('lanes__complaint-t2.bpmn'));
    const note = drawing.shapes.get('TextAnnotation_Fristen')!.box;
    expect(overlap(note, drawing.shapes.get('Event_Erinnerung3Tage')!.box)).toBe(false);
    expect(cutShapes(drawing, 'Flow_33')).toEqual([]);
  });

  it('inline model: two boundary events with handlers, a note on the first', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:startEvent id="S" />
    <bpmn:userTask id="T" name="Wait for reply" />
    <bpmn:endEvent id="E" />
    <bpmn:boundaryEvent id="B1" name="Five days" attachedToRef="T"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="B2" name="Three days" cancelActivity="false" attachedToRef="T"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
    <bpmn:task id="H1" name="Close case" />
    <bpmn:task id="H2" name="Send reminder" />
    <bpmn:endEvent id="E1" />
    <bpmn:endEvent id="E2" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T" />
    <bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="E" />
    <bpmn:sequenceFlow id="F3" sourceRef="B1" targetRef="H1" />
    <bpmn:sequenceFlow id="F4" sourceRef="B2" targetRef="H2" />
    <bpmn:sequenceFlow id="F5" sourceRef="H1" targetRef="E1" />
    <bpmn:sequenceFlow id="F6" sourceRef="H2" targetRef="E2" />
    <bpmn:textAnnotation id="N"><bpmn:text>open question: which deadline applies</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="A" sourceRef="N" targetRef="B1" />
  </bpmn:process>
</bpmn:definitions>`;
    const drawing = await drawn(xml);
    expect(leafOverlaps(drawing)).toEqual([]);
    for (const id of ['F3', 'F4', 'F5', 'F6']) {
      expect(cutShapes(drawing, id), id).toEqual([]);
    }
  });
});

describe('the lines of a scope\'s notes', () => {
  const laneSet = `<bpmn:laneSet id="LS">
      <bpmn:lane id="Office" name="Office"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>Prepare</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Warehouse" name="Warehouse"><bpmn:flowNodeRef>Print</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>`;
  /** Two notes on Prepare shipment, side by side in the band above it; with lanes Print label is in the second lane. */
  const twoNotes = (lanes: boolean): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  ${lanes ? '<bpmn:collaboration id="C"><bpmn:participant id="Pool" name="Shipping" processRef="P" /></bpmn:collaboration>' : ''}
  <bpmn:process id="P" isExecutable="true">
    ${lanes ? laneSet : ''}
    <bpmn:startEvent id="S" name="Start" />
    <bpmn:task id="Prepare" name="Prepare shipment" />
    <bpmn:task id="Print" name="Print label" />
    <bpmn:endEvent id="E" name="Shipped" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Prepare" />
    <bpmn:sequenceFlow id="F2" sourceRef="Prepare" targetRef="Print" />
    <bpmn:sequenceFlow id="F3" sourceRef="Print" targetRef="E" />
    <bpmn:textAnnotation id="NoteA"><bpmn:text>Use packaging type B for fragile goods</bpmn:text></bpmn:textAnnotation>
    <bpmn:textAnnotation id="NoteB"><bpmn:text>Weigh the parcel before closing it</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="AssocA" sourceRef="NoteA" targetRef="Prepare" />
    <bpmn:association id="AssocB" sourceRef="NoteB" targetRef="Prepare" />
  </bpmn:process>
</bpmn:definitions>`;

  /** the notes a line runs through, its own included (a line ending on a note's border does not count) */
  const notesCut = (drawing: Drawn, edgeId: string): string[] =>
    [...drawing.shapes].filter(([, shape]) => is(shape.el, 'bpmn:TextAnnotation') && pathHits(drawing.edges.get(edgeId)!.points, shape.box)).map(([id]) => id);

  it('the line of a note beside another one in the band runs under it into their task, not through its text (without and with lanes)', async () => {
    const plain = await drawn(twoNotes(false));
    expect(plain.shapes.get('NoteA')!.box).toEqual({ x: 86, y: 80, width: 280, height: 30 });
    expect(plain.shapes.get('NoteB')!.box).toEqual({ x: 386, y: 80, width: 260, height: 30 });
    expect(plain.edges.get('AssocB')!.points).toEqual([
      { x: 516, y: 110 },
      { x: 516, y: 125 },
      { x: 256, y: 125 },
      { x: 256, y: 170 },
    ]);
    const laned = await drawn(twoNotes(true));
    expect(laned.shapes.get('NoteB')!.box.x).toBeGreaterThan(laned.shapes.get('NoteA')!.box.x);
    for (const drawing of [plain, laned]) {
      expect(notesCut(drawing, 'AssocA')).toEqual([]);
      expect(notesCut(drawing, 'AssocB')).toEqual([]);
    }
  });

  it.each(['artifacts__01-annotations-basic.bpmn', 'artifacts__02-annotations-multi.bpmn', 'artifacts__16-annotations-events-loop.bpmn'])('%s: no note line runs through a note, nor back through its own one', async (file) => {
    const drawing = await drawn(scenario(file));
    const lines = [...drawing.edges].filter(([, edge]) => is(edge.el, 'bpmn:Association')).map(([id]) => id);
    expect(lines.length).toBeGreaterThan(1);
    for (const id of lines) {
      expect(notesCut(drawing, id), id).toEqual([]);
    }
  });

  it('the line of a note on a sequence flow starts on its note, also when the note sits far from the flow, and keeps off the run of another note\'s line', async () => {
    const drawing = await drawn(scenario('artifacts__01-annotations-basic.bpmn'));
    const line = drawing.edges.get('Association_4')!.points;
    expect(onBorder(line[0]!, drawing.shapes.get('TextAnnotation_Flow')!.box), JSON.stringify(line)).toBe(true);
    expect(onPolyline(line.at(-1)!, drawing.edges.get('Flow_Yes')!.points), JSON.stringify(line)).toBe(true);
    expect(sharedRun(line, drawing.edges.get('Association_2')!.points)).toBe(0);
  });

  it('lanes: the line of a note on a sequence flow ends on the flow as the lanes draw it', async () => {
    const drawing = await drawn(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="Sales" name="Sales"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>Create</bpmn:flowNodeRef><bpmn:flowNodeRef>Send</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Ops" name="Ops"><bpmn:flowNodeRef>Check</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S" name="Start" />
    <bpmn:task id="Create" name="Create order" />
    <bpmn:task id="Send" name="Send order" />
    <bpmn:task id="Check" name="Check stock" />
    <bpmn:endEvent id="E" name="Done" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Create" />
    <bpmn:sequenceFlow id="F2" sourceRef="Create" targetRef="Send" />
    <bpmn:sequenceFlow id="F3" sourceRef="Send" targetRef="Check" />
    <bpmn:sequenceFlow id="F4" sourceRef="Check" targetRef="E" />
    <bpmn:textAnnotation id="N"><bpmn:text>Sent by mail</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="A" sourceRef="N" targetRef="F2" />
  </bpmn:process>
</bpmn:definitions>`);
    const line = drawing.edges.get('A')!.points;
    expect(onBorder(line[0]!, drawing.shapes.get('N')!.box), JSON.stringify(line)).toBe(true);
    expect(onPolyline(line.at(-1)!, drawing.edges.get('F2')!.points), JSON.stringify(line)).toBe(true);
  });

  it('lanes: the line of a note on a flow that drops two lanes ends on the flow without running down it', async () => {
    const drawing = await drawn(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="Sales" name="Sales"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>Create</bpmn:flowNodeRef><bpmn:flowNodeRef>Send</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Billing" name="Billing"><bpmn:flowNodeRef>Bill</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Ops" name="Ops"><bpmn:flowNodeRef>Check</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S" name="Start" />
    <bpmn:task id="Create" name="Create order" />
    <bpmn:task id="Send" name="Send order" />
    <bpmn:task id="Bill" name="Bill order" />
    <bpmn:task id="Check" name="Check stock" />
    <bpmn:endEvent id="E" name="Done" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Create" />
    <bpmn:sequenceFlow id="F2" sourceRef="Create" targetRef="Send" />
    <bpmn:sequenceFlow id="F3" sourceRef="Send" targetRef="Check" />
    <bpmn:sequenceFlow id="F4" sourceRef="Check" targetRef="Bill" />
    <bpmn:sequenceFlow id="F5" sourceRef="Bill" targetRef="E" />
    <bpmn:textAnnotation id="N"><bpmn:text>Sent by mail</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="A" sourceRef="N" targetRef="F3" />
  </bpmn:process>
</bpmn:definitions>`);
    const flow = drawing.edges.get('F3')!.points;
    const [longest] = segments(flow).sort(([a, b], [c, d]) => Math.abs(d.x - c.x) + Math.abs(d.y - c.y) - Math.abs(b.x - a.x) - Math.abs(b.y - a.y));
    expect(longest![0].x, JSON.stringify(flow)).toBe(longest![1].x);
    const line = drawing.edges.get('A')!.points;
    expect(onBorder(line[0]!, drawing.shapes.get('N')!.box), JSON.stringify(line)).toBe(true);
    expect(onPolyline(line.at(-1)!, flow), JSON.stringify(line)).toBe(true);
    expect(sharedRun(line, flow), JSON.stringify(line)).toBe(0);
    // it runs level into the flow
    expect(line, JSON.stringify(line)).toHaveLength(3);
    expect(line[1]!.y).toBe(line[2]!.y);
  });

  it('lanes: a note on a flow whose spot above would cross its lane\'s top border goes under the flow, in that lane', async () => {
    // Clerk holds two rows under a split; the lower task's flow up into the end event in Office carries the tall note N
    const drawing = await drawn(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="Office" name="Office"><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Clerk" name="Clerk"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>G</bpmn:flowNodeRef><bpmn:flowNodeRef>Enter</bpmn:flowNodeRef><bpmn:flowNodeRef>Check</bpmn:flowNodeRef><bpmn:flowNodeRef>E2</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S" name="Start" />
    <bpmn:exclusiveGateway id="G" name="Kind?" />
    <bpmn:task id="Enter" name="Enter claim" />
    <bpmn:task id="Check" name="Check claim" />
    <bpmn:endEvent id="E" name="Done" />
    <bpmn:endEvent id="E2" name="Filed" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="G" />
    <bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="Enter" />
    <bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="Check" />
    <bpmn:sequenceFlow id="F4" sourceRef="Enter" targetRef="E2" />
    <bpmn:sequenceFlow id="F5" sourceRef="Check" targetRef="E" />
    <bpmn:textAnnotation id="N"><bpmn:text>Above 500 euros the claim is checked by the office before it is paid, with the receipts and the bank details of the claimant attached to it</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="A" sourceRef="N" targetRef="F5" />
  </bpmn:process>
</bpmn:definitions>`);
    const lane = drawing.shapes.get('Clerk')!.box;
    const box = drawing.shapes.get('N')!.box;
    expect(inside(box, lane), `${JSON.stringify(box)} in ${JSON.stringify(lane)}`).toBe(true);
    const flow = drawing.edges.get('F5')!.points;
    const line = drawing.edges.get('A')!.points;
    // the spot above, 16 px over the flow's point, would reach over the lane's top border
    expect(line.at(-1)!.y - 16 - box.height, JSON.stringify(line)).toBeLessThan(lane.y);
    expect(box.y, JSON.stringify(line)).toBeGreaterThan(line.at(-1)!.y);
    expect(onPolyline(line.at(-1)!, flow), JSON.stringify(line)).toBe(true);
    expect(sharedRun(line, flow), JSON.stringify(line)).toBe(0);
  });

  it('lanes: a note on a flow just under its lane\'s top border stays above the flow when that spot lies clear in the lane above', async () => {
    const drawing = await drawn(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="Office" name="Office"><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Clerk" name="Clerk"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>Enter</bpmn:flowNodeRef><bpmn:flowNodeRef>Check</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S" name="Start" />
    <bpmn:task id="Enter" name="Enter claim" />
    <bpmn:task id="Check" name="Check claim" />
    <bpmn:endEvent id="E" name="Done" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Enter" />
    <bpmn:sequenceFlow id="F2" sourceRef="Enter" targetRef="Check" />
    <bpmn:sequenceFlow id="F3" sourceRef="Check" targetRef="E" />
    <bpmn:textAnnotation id="N"><bpmn:text>Above 500 euros</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="A" sourceRef="N" targetRef="F3" />
  </bpmn:process>
</bpmn:definitions>`);
    const lane = drawing.shapes.get('Office')!.box;
    const box = drawing.shapes.get('N')!.box;
    expect(inside(box, lane), `${JSON.stringify(box)} in ${JSON.stringify(lane)}`).toBe(true);
    const flow = drawing.edges.get('F3')!.points;
    const line = drawing.edges.get('A')!.points;
    expect(bottomOf(box), JSON.stringify(line)).toBeLessThan(line.at(-1)!.y);
    expect(onPolyline(line.at(-1)!, flow), JSON.stringify(line)).toBe(true);
    expect(sharedRun(line, flow), JSON.stringify(line)).toBe(0);
  });

  /** A laned process (no pool): the first lane holds `tasks` in a row, the second one stays empty. */
  const bandNotes = (tasks: string[], body: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="L1" name="Office">${['S', ...tasks, 'E'].map((id) => `<bpmn:flowNodeRef>${id}</bpmn:flowNodeRef>`).join('')}</bpmn:lane>
      <bpmn:lane id="L2" name="Warehouse" />
    </bpmn:laneSet>
    <bpmn:startEvent id="S" name="Start" />
    ${tasks.map((id) => `<bpmn:task id="${id}" name="Task ${id}" />`).join('\n    ')}
    <bpmn:endEvent id="E" name="Done" />
    ${['S', ...tasks, 'E'].slice(1).map((id, index, ids) => `<bpmn:sequenceFlow id="F${index}" sourceRef="${index ? ids[index - 1] : 'S'}" targetRef="${id}" />`).join('\n    ')}
    ${body}
  </bpmn:process>
</bpmn:definitions>`;
  const note = (id: string, target: string, text: string): string => `<bpmn:textAnnotation id="${id}"><bpmn:text>${text}</bpmn:text></bpmn:textAnnotation><bpmn:association id="A${id}" sourceRef="${id}" targetRef="${target}" />`;

  it('lanes: the line of a note in the band stays in its task\'s lane: not over the top of the lanes, not under the row into the next lane', async () => {
    // far right in the band, a tall note's line to the last task has no free way under the band
    const overTheTop = bandNotes(['T3', 'T4', 'T5'], [
      note('N1', 'T5', 'Urgent'),
      note('N2', 'T5', 'The shipping clerk checks the address against the customer record, books the carrier with the lowest rate for the weight and sends the tracking number to the customer within one hour'),
      note('N3', 'T4', 'Two copies'),
      note('N4', 'T4', 'Only above 500 euros!'),
      note('N5', 'T3', 'Ask the warehouse lead when the stock count is unclear'),
      note('N6', 'T3', 'Four-eyes control.'),
    ].join('\n    '));
    // a short note right of two tall ones on its task: its line runs under them, not under the row
    const underTheRow = bandNotes(['T1', 'T2', 'T3'], [
      '<bpmn:dataObjectReference id="D1" name="Credit" dataObjectRef="Credit" /><bpmn:dataObject id="Credit" />',
      note('N1', 'D1', 'Kept for ten years as the tax office asks for the books'),
      note('N2', 'T2', 'The customer gets a reminder by mail when the invoice is still open after fourteen days, and a second one with a fee after another week'),
      note('N3', 'T2', 'A credit note is written by the accounts team when the customer sends goods back, and it is booked against the first invoice with the same reference and the same tax rate'),
      note('N6', 'T2', 'Twice a day'),
    ].join('\n    ')).replace('<bpmn:task id="T2" name="Task T2" />', '<bpmn:task id="T2" name="Task T2"><bpmn:dataInputAssociation id="DI1"><bpmn:sourceRef>D1</bpmn:sourceRef></bpmn:dataInputAssociation></bpmn:task>').replace('<bpmn:task id="T3" name="Task T3" />', '<bpmn:task id="T3" name="Task T3"><bpmn:dataOutputAssociation id="DO1"><bpmn:targetRef>D1</bpmn:targetRef></bpmn:dataOutputAssociation></bpmn:task>');
    for (const xml of [overTheTop, underTheRow]) {
      const drawing = await drawn(xml);
      const lane = drawing.shapes.get('L1')!.box;
      const lines = [...drawing.edges].filter(([, edge]) => is(edge.el, 'bpmn:Association') && is(edge.el.get<El>('targetRef'), 'bpmn:Task'));
      expect(lines.length).toBeGreaterThan(2);
      for (const [id, edge] of lines) {
        expect(edge.points.every((point) => point.y >= lane.y && point.y <= bottomOf(lane)), `${id}: ${JSON.stringify(edge.points)} in ${lane.y}..${bottomOf(lane)}`).toBe(true);
      }
    }
  });
});

describe('notes on data objects', () => {
  const xmlOf = (body: string, laneSet = ''): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true">
    ${laneSet}
    ${body}
  </bpmn:process>
</bpmn:definitions>`;

  it('a data link goes round the note beside its data object rather than through a boundary event of its task', async () => {
    // the note sits left of Booking (Receipt holds the right side), on the way Booking's link takes round the timers
    const drawing = await drawn(
      xmlOf(`<bpmn:startEvent id="S" name="Start" />
    <bpmn:task id="Receive" name="Receive invoice" />
    <bpmn:task id="Book" name="Book payment">
      <bpmn:dataOutputAssociation id="ToBooking"><bpmn:targetRef>Booking</bpmn:targetRef></bpmn:dataOutputAssociation>
      <bpmn:dataOutputAssociation id="ToReceipt"><bpmn:targetRef>Receipt</bpmn:targetRef></bpmn:dataOutputAssociation>
    </bpmn:task>
    <bpmn:task id="Approve" name="Approve" />
    <bpmn:endEvent id="E" name="Done" />
    <bpmn:boundaryEvent id="B1" name="5 days" attachedToRef="Book"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
    <bpmn:endEvent id="E1" name="aborted" />
    <bpmn:boundaryEvent id="B2" name="5 days" attachedToRef="Book"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
    <bpmn:endEvent id="E2" name="aborted" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Receive" />
    <bpmn:sequenceFlow id="F2" sourceRef="Receive" targetRef="Book" />
    <bpmn:sequenceFlow id="F3" sourceRef="Book" targetRef="Approve" />
    <bpmn:sequenceFlow id="F4" sourceRef="Approve" targetRef="E" />
    <bpmn:sequenceFlow id="F5" sourceRef="B1" targetRef="E1" />
    <bpmn:sequenceFlow id="F6" sourceRef="B2" targetRef="E2" />
    <bpmn:dataObjectReference id="Booking" name="Booking" dataObjectRef="BookingData" /><bpmn:dataObject id="BookingData" />
    <bpmn:dataObjectReference id="Receipt" name="Receipt" dataObjectRef="ReceiptData" /><bpmn:dataObject id="ReceiptData" />
    <bpmn:textAnnotation id="N"><bpmn:text>Kept ten years</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="A" sourceRef="N" targetRef="Booking" />`),
    );
    const link = drawing.edges.get('ToBooking')!.points;
    const cut = [...drawing.shapes].filter(([id, shape]) => !isContainer(shape) && id !== 'Book' && id !== 'Booking' && pathHits(link, shape.box)).map(([id]) => id);
    expect(cut, JSON.stringify(link)).toEqual([]);
  });

  it('lanes: a note taller than its data object stays in the data object\'s lane; in the last lane, which grows to hold it, it stays centred on the data object', async () => {
    /** Send order writes Order; `sendInOps` moves it from the first lane into the last one */
    const orderXml = (sendInOps: boolean): string =>
      xmlOf(
        `<bpmn:startEvent id="S" name="Start" />
    <bpmn:task id="Create" name="Create order" />
    <bpmn:task id="Send" name="Send order"><bpmn:dataOutputAssociation id="ToOrder"><bpmn:targetRef>Order</bpmn:targetRef></bpmn:dataOutputAssociation></bpmn:task>
    <bpmn:task id="Check" name="Check stock" />
    <bpmn:endEvent id="E" name="Done" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Create" />
    <bpmn:sequenceFlow id="F2" sourceRef="Create" targetRef="Send" />
    <bpmn:sequenceFlow id="F3" sourceRef="Send" targetRef="Check" />
    <bpmn:sequenceFlow id="F4" sourceRef="Check" targetRef="E" />
    <bpmn:dataObjectReference id="Order" name="Order" dataObjectRef="OrderData" /><bpmn:dataObject id="OrderData" />
    <bpmn:textAnnotation id="N"><bpmn:text>The order is stored as a signed JSON document and kept for ten years for the auditors of the tax office and the external accountants of the group</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="A" sourceRef="N" targetRef="Order" />`,
        `<bpmn:laneSet id="LS">
      <bpmn:lane id="Sales" name="Sales"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>Create</bpmn:flowNodeRef>${sendInOps ? '' : '<bpmn:flowNodeRef>Send</bpmn:flowNodeRef>'}</bpmn:lane>
      <bpmn:lane id="Ops" name="Ops">${sendInOps ? '<bpmn:flowNodeRef>Send</bpmn:flowNodeRef>' : ''}<bpmn:flowNodeRef>Check</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>`,
      );
    for (const [sendInOps, laneId] of [[false, 'Sales'], [true, 'Ops']] as const) {
      const drawing = await drawn(orderXml(sendInOps));
      const note = drawing.shapes.get('N')!.box, data = drawing.shapes.get('Order')!.box;
      expect(note.height).toBeGreaterThan(data.height);
      expect(note.x, 'beside the data object').toBe(rightOf(data) + 20);
      expect(inside(note, drawing.shapes.get(laneId)!.box), `${laneId}: ${JSON.stringify(note)}`).toBe(true);
      if (sendInOps) {
        expect(note.y + note.height / 2).toBeCloseTo(data.y + data.height / 2, 0);
      }
    }
  });

  it('a note beside a data object keeps off the compensation association running down past it', async () => {
    const drawing = await drawn(
      xmlOf(`<bpmn:startEvent id="S" name="Start" />
    <bpmn:task id="Pick" name="Pick goods" />
    <bpmn:task id="Ship" name="Ship goods"><bpmn:dataInputAssociation id="FromOrder"><bpmn:sourceRef>Order</bpmn:sourceRef></bpmn:dataInputAssociation></bpmn:task>
    <bpmn:endEvent id="E" name="Done" />
    <bpmn:boundaryEvent id="Undo" name="undo" attachedToRef="Ship"><bpmn:compensateEventDefinition /></bpmn:boundaryEvent>
    <bpmn:task id="Unship" name="Undo shipping" isForCompensation="true" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Pick" />
    <bpmn:sequenceFlow id="F2" sourceRef="Pick" targetRef="Ship" />
    <bpmn:sequenceFlow id="F3" sourceRef="Ship" targetRef="E" />
    <bpmn:dataObjectReference id="Order" name="Order" dataObjectRef="OrderData" /><bpmn:dataObject id="OrderData" />
    <bpmn:textAnnotation id="N"><bpmn:text>payment</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="Compensation" sourceRef="Undo" targetRef="Unship" associationDirection="One" />
    <bpmn:association id="A" sourceRef="N" targetRef="Order" />`),
    );
    const note = drawing.shapes.get('N')!.box, data = drawing.shapes.get('Order')!.box;
    expect(note.y + note.height / 2, 'at the height of the data object').toBeCloseTo(data.y + data.height / 2, 0);
    expect(pathHits(drawing.edges.get('Compensation')!.points, note), JSON.stringify(note)).toBe(false);
  });
});

describe('event sub-processes', () => {
  it('an event sub-process is drawn in its own lane, not in the last one', async () => {
    const drawing = await drawn(scenario('lanes__eventsub-own-lane.bpmn'));
    expect(inside(drawing.shapes.get('Activity_OnCancel')!.box, drawing.shapes.get('Lane_Sales')!.box)).toBe(true);
    expect(outsideLane(drawing)).toEqual([]);
    expect(leafOverlaps(drawing)).toEqual([]);
    for (const id of ['Flow_4', 'Flow_5', 'Flow_6', 'Flow_7', 'Flow_8', 'Flow_9']) {
      expect(cutShapes(drawing, id), id).toEqual([]);
    }
    // no flow runs through the event sub-process frame either
    const frame = drawing.shapes.get('Activity_OnCancel')!.box;
    for (const id of ['Flow_4', 'Flow_5']) {
      expect(segments(drawing.edges.get(id)!.points).some(([segmentStart, segmentEnd]) => cuts(segmentStart, segmentEnd, frame)), id).toBe(false);
    }
  });

  it('collapse is honoured for an event sub-process (option)', async () => {
    const drawing = await drawn(scenario('lanes__eventsub-own-lane.bpmn'), { collapse: ['Activity_OnCancel'] });
    const shape = drawing.shapes.get('Activity_OnCancel')!;
    expect(shape.expanded).toBe(false);
    expect(shape.box.width).toBe(100);
    expect(drawing.planes).toContain('Activity_OnCancel');
    expect(drawing.shapes.has('Activity_Refund')).toBe(false); // on its own plane
  });

  it('collapse is honoured for an event sub-process (existing DI)', async () => {
    const first = await drawn(scenario('lanes__eventsub-own-lane.bpmn'), { collapse: ['Activity_OnCancel'] });
    const xml = (await first.model.moddle.toXML(first.model.definitions)).xml;
    const again = await drawn(xml);
    expect(again.shapes.get('Activity_OnCancel')!.expanded).toBe(false);
    const expanded = await drawn(xml, { expand: ['Activity_OnCancel'] });
    expect(expanded.shapes.get('Activity_OnCancel')!.expanded).toBe(true);
  });
});

describe('text annotations owned by the collaboration', () => {
  it('every note and association gets DI, without warnings', async () => {
    const drawing = await drawn(scenario('collab__notes-on-collaboration.bpmn'));
    for (const id of ['TextAnnotation_Sla', 'TextAnnotation_Portal', 'TextAnnotation_Pdf', 'TextAnnotation_Loose']) {
      expect(drawing.shapes.has(id), id).toBe(true);
    }
    for (const id of ['Association_Sla', 'Association_Portal', 'Association_Pdf']) {
      expect(drawing.edges.get(id)?.points.length, id).toBe(2);
    }
    expect(drawing.warnings.filter((warning) => warning.code === 'DI_NOT_CREATED')).toEqual([]);
  });

  it('notes cover no shape, label or pool they do not belong to', async () => {
    const drawing = await drawn(scenario('collab__notes-on-collaboration.bpmn'));
    expect(leafOverlaps(drawing)).toEqual([]);
    const pools = [...drawing.shapes.values()].filter((shape) => is(shape.el, 'bpmn:Participant')).map((shape) => shape.box);
    for (const id of ['TextAnnotation_Portal', 'TextAnnotation_Pdf', 'TextAnnotation_Loose']) {
      const note = drawing.shapes.get(id)!.box;
      expect(pools.some((pool) => overlap(pool, note)), id).toBe(false);
    }
    const labels = [...drawing.shapes.values(), ...drawing.edges.values()].flatMap((drawnElement) => (drawnElement.label ? [drawnElement.label] : []));
    for (const id of ['TextAnnotation_Sla', 'TextAnnotation_Portal', 'TextAnnotation_Pdf']) {
      const note = drawing.shapes.get(id)!.box;
      expect(labels.some((label) => overlap(label, note)), id).toBe(false);
    }
  });

  it('a note on a message flow sits next to the flow, between the pools', async () => {
    const drawing = await drawn(scenario('collab__notes-on-collaboration.bpmn'));
    const note = drawing.shapes.get('TextAnnotation_Pdf')!.box;
    const pools = [...drawing.shapes.values()].filter((shape) => is(shape.el, 'bpmn:Participant')).map((shape) => shape.box).sort((first, second) => first.y - second.y);
    expect(note.y).toBeGreaterThanOrEqual(pools[0]!.y + pools[0]!.height);
    expect(note.y + note.height).toBeLessThanOrEqual(pools[1]!.y);
  });
});

describe('associations between scope levels', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:startEvent id="S" />
    <bpmn:subProcess id="Sub" name="Handle claim">
      <bpmn:startEvent id="S2" />
      <bpmn:task id="Inner" name="Check claim" />
      <bpmn:subProcess id="Nested" name="Nested">
        <bpmn:startEvent id="S3" />
        <bpmn:task id="Deep" name="Deep task" />
        <bpmn:sequenceFlow id="G1" sourceRef="S3" targetRef="Deep" />
      </bpmn:subProcess>
      <bpmn:sequenceFlow id="F2" sourceRef="S2" targetRef="Inner" />
      <bpmn:sequenceFlow id="F3" sourceRef="Inner" targetRef="Nested" />
      <bpmn:textAnnotation id="NoteDeep"><bpmn:text>deep note</bpmn:text></bpmn:textAnnotation>
      <bpmn:association id="AssocDeep" sourceRef="NoteDeep" targetRef="Deep" />
    </bpmn:subProcess>
    <bpmn:endEvent id="E" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Sub" />
    <bpmn:sequenceFlow id="F4" sourceRef="Sub" targetRef="E" />
    <bpmn:textAnnotation id="Note"><bpmn:text>four-eyes check</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="Assoc" sourceRef="Note" targetRef="Inner" />
  </bpmn:process>
</bpmn:definitions>`;

  it('a process-level note on a task inside an expanded sub-process gets an association edge', async () => {
    const drawing = await drawn(xml);
    expect(drawing.edges.get('Assoc')?.points.length).toBe(2);
    expect(drawing.edges.get('AssocDeep')?.points.length).toBe(2);
    expect(drawing.warnings).toEqual([]);
  });

  it('collapsed: the association whose ends are on two planes is reported, the one inside the plane is drawn', async () => {
    const drawing = await drawn(xml, { collapse: ['Sub'] });
    expect(drawing.warnings.map((warning) => `${warning.code}:${warning.elementId}`)).toEqual(['DI_NOT_CREATED:Assoc']);
    const subPlane = many(drawing.model.definitions, 'diagrams').map((diagram) => diagram.get<El>('plane')).find((plane) => plane.get<El>('bpmnElement').get<string>('id') === 'Sub')!;
    const drawnThere = many(subPlane, 'planeElement').map((pe) => pe.get<El>('bpmnElement').get<string>('id'));
    expect(drawnThere).toContain('AssocDeep');
  });
});

describe('artifact links across an annotation line', () => {
  /**
   * A note line (an annotation's or a data association) runs up from N into T2 across the straight
   * way of the data association from D into T (pure geometry).
   */
  function dataLink(note: 'annotation' | 'dataObject'): { points: Point[]; line: Point[]; box: Box } {
    const noteEl = fakeEl(note === 'annotation' ? 'bpmn:TextAnnotation' : 'bpmn:DataObjectReference');
    const first = { el: noteEl, id: 'N', kind: note, width: 100, height: 30, box: { x: 250, y: 380, width: 100, height: 30 }, links: [] as unknown[] };
    first.links.push({ el: note === 'annotation' ? { ...fakeEl('bpmn:Association'), sourceRef: noteEl } : fakeEl('bpmn:DataOutputAssociation'), id: 'AN', from: first, to: { box: { x: 250, y: 200, width: 100, height: 80 } }, points: [] });
    const data = { el: fakeEl('bpmn:DataObjectReference'), id: 'D', kind: 'dataObject', width: 36, height: 50, box: { x: 100, y: 310, width: 36, height: 50 }, links: [] as unknown[] };
    const link = { el: fakeEl('bpmn:DataInputAssociation'), id: 'AD', from: data, to: { box: { x: 450, y: 300, width: 100, height: 80 } }, points: [] as Point[] };
    data.links.push(link);
    new LinkRouter({ nodes: [], edges: [], compensations: [], artifacts: [first, data] } as unknown as ScopeLayout).route();
    return { points: link.points, line: (first.links[0] as { points: Point[] }).points, box: first.box };
  }

  it('a data association goes straight across an annotation line', () => {
    expect(dataLink('annotation').points).toEqual([
      { x: 136, y: 335 },
      { x: 450, y: 335 },
    ]);
  });

  it('it still goes round a data association in the same place', () => {
    const { points, line, box } = dataLink('dataObject');
    expect(points.length).toBeGreaterThan(2);
    expect(polylinesCross(points, line), JSON.stringify(points)).toBe(false);
    expect(pathHits(points, box), JSON.stringify(points)).toBe(false);
  });

  /**
   * A note (or a data object) left of a task, a flow coming down between them and a tall shape
   * beside the flow: only a run under the tall shape keeps off the flow (pure geometry).
   */
  function pastFlow(kind: 'annotation' | 'dataObject'): Point[] {
    const el = fakeEl(kind === 'annotation' ? 'bpmn:TextAnnotation' : 'bpmn:DataObjectReference');
    const artifact = { el, id: 'N', kind, width: 100, height: 30, box: { x: 0, y: 200, width: 100, height: 30 }, links: [] as unknown[] };
    const link = { el: kind === 'annotation' ? { ...fakeEl('bpmn:Association'), sourceRef: el } : fakeEl('bpmn:DataInputAssociation'), id: 'AN', from: artifact, to: { box: { x: 500, y: 180, width: 100, height: 80 } }, points: [] as Point[] };
    artifact.links.push(link);
    const flow = { points: [{ x: 300, y: 100 }, { x: 300, y: 700 }] };
    const tall = { box: { x: 320, y: 300, width: 100, height: 400 }, boundary: [] };
    new LinkRouter({ nodes: [tall], edges: [flow], compensations: [], artifacts: [artifact] } as unknown as ScopeLayout).route();
    return link.points;
  }

  it('the line of a note on a vertical flow ends on it without running down it, also when it has to come from the far side (pure geometry)', () => {
    // the flow's point is (300, 300); a small shape right of it blocks a level way in from the note's side
    const el = fakeEl('bpmn:TextAnnotation');
    const note = { el, id: 'N', kind: 'annotation', width: 100, height: 30, box: { x: 320, y: 140, width: 100, height: 30 }, links: [] as unknown[] };
    const flow = { points: [{ x: 300, y: 100 }, { x: 300, y: 500 }, { x: 500, y: 500 }] };
    const link = { el: { ...fakeEl('bpmn:Association'), sourceRef: el }, id: 'AN', from: note, to: { box: { x: 300, y: 300, width: 0, height: 0 }, flow }, points: [] as Point[] };
    note.links.push(link);
    const blocker = { x: 304, y: 290, width: 12, height: 20 };
    new LinkRouter({ nodes: [{ box: blocker, boundary: [] }], edges: [flow], compensations: [], artifacts: [note] } as unknown as ScopeLayout).route();
    const line = link.points;
    expect(line.at(-1), JSON.stringify(line)).toEqual({ x: 300, y: 300 });
    expect(sharedRun(line, flow.points), JSON.stringify(line)).toBe(0);
    expect(segments(line).every(([start, end]) => start.x === end.x || start.y === end.y), JSON.stringify(line)).toBe(true);
    expect(segments(line).some(([start, end]) => cuts(start, end, blocker)), JSON.stringify(line)).toBe(false);
  });

  it('a note line keeps off the tops of the row 16 px under its note: it runs in the middle of the gap (pure geometry)', () => {
    // a row of tasks under the note, its line goes to the first one; a shape left of the note blocks the way level with it
    const el = fakeEl('bpmn:TextAnnotation');
    const note = { el, id: 'N', kind: 'annotation', width: 300, height: 54, box: { x: 1000, y: 100, width: 300, height: 54 }, links: [] as unknown[] };
    const row = [100, 300, 500, 700].map((x) => ({ box: { x, y: 170, width: 100, height: 80 }, boundary: [] }));
    const blocker = { box: { x: 600, y: 90, width: 300, height: 60 }, boundary: [] };
    const link = { el: { ...fakeEl('bpmn:Association'), sourceRef: el }, id: 'AN', from: note, to: row[0], points: [] as Point[] };
    note.links.push(link);
    new LinkRouter({ nodes: [...row, blocker], edges: [], compensations: [], artifacts: [note] } as unknown as ScopeLayout).route();
    expect(link.points).toEqual([
      { x: 1150, y: 154 },
      { x: 1150, y: 162 },
      { x: 180, y: 162 },
      { x: 180, y: 170 },
    ]);
  });

  it('a note line crosses a flow rather than take a long detour round it; a data association still goes round', () => {
    const length = (pts: Point[]): number => segments(pts).reduce((sum, [start, end]) => sum + Math.abs(end.x - start.x) + Math.abs(end.y - start.y), 0);
    const line = pastFlow('annotation');
    expect(line, JSON.stringify(line)).toEqual([
      { x: 100, y: 215 },
      { x: 500, y: 215 },
    ]);
    const data = pastFlow('dataObject');
    expect(length(data), JSON.stringify(data)).toBeGreaterThan(1000);
    expect(polylinesCross(data, [{ x: 300, y: 100 }, { x: 300, y: 700 }]), JSON.stringify(data)).toBe(false);
  });
});

describe('annotation lines beside other lines and along borders', () => {
  /**
   * Routes the line of every note (or data object) to its target in order, with the scope's notes
   * placed, between `nodes` and `flows` and in `bands` (pure geometry). A note on a flow names it
   * (`flow`, one of `flows`) and its point (`to`, a box without size).
   */
  function lines(notes: Array<{ box: Box; to: Box; kind?: 'annotation' | 'dataObject'; flow?: Point[] }>, nodes: Box[], flows: Point[][] = [], bands?: Array<{ top: number; bottom: number }>): Point[][] {
    const artifacts = notes.map(({ box, to, kind = 'annotation', flow }, index) => {
      const el = fakeEl(kind === 'annotation' ? 'bpmn:TextAnnotation' : 'bpmn:DataObjectReference');
      const artifact = { el, id: `N${index}`, kind, width: box.width, height: box.height, box, links: [] as Array<{ points: Point[] }> };
      artifact.links.push({ el: kind === 'annotation' ? { ...fakeEl('bpmn:Association'), sourceRef: el } : fakeEl('bpmn:DataInputAssociation'), id: `A${index}`, from: artifact, to: flow ? { box: to, flow: { points: flow } } : { box: to }, points: [] } as { points: Point[] });
      return artifact;
    });
    const laneBands = bands?.map((band) => ({ ...band, nodes: new Set() }));
    new LinkRouter({ nodes: nodes.map((box) => ({ box, boundary: [] })), edges: flows.map((points) => ({ points })), compensations: [], artifacts, laneBands } as unknown as ScopeLayout, true).route();
    return artifacts.map((artifact) => artifact.links[0]!.points);
  }
  /** a row of tasks at y 250 joined by flows; the notes sit in a band above it */
  const row = [100, 300, 500].map((x) => ({ x, y: 250, width: 100, height: 80 }));
  const rowFlows = [[{ x: 200, y: 290 }, { x: 300, y: 290 }], [{ x: 400, y: 290 }, { x: 500, y: 290 }]];

  it('a note line and a data association keep off running 1-4 px beside a flow', () => {
    // the flow runs 2 px over the way level with the note (or data object) into the task
    const flow = [{ x: 150, y: 113 }, { x: 650, y: 113 }];
    for (const kind of ['annotation', 'dataObject'] as const) {
      const [line] = lines([{ box: { x: 600, y: 100, width: 100, height: 30 }, to: { x: 100, y: 300, width: 100, height: 80 }, kind }], [{ x: 100, y: 300, width: 100, height: 80 }], [flow]);
      expect(sharedRun(line!, flow, 0, 4), `${kind}: ${JSON.stringify(line)}`).toBe(0);
    }
  });

  it('two notes on one event: the second line joins the first one\'s way in rather than run 2 px beside it', () => {
    const event = { x: 140, y: 260, width: 36, height: 36 };
    const [first, second] = lines([{ box: { x: 100, y: 80, width: 300, height: 68 }, to: event }, { box: { x: 460, y: 80, width: 300, height: 54 }, to: event }], [event]);
    expect(sharedRun(second!, first!, 1, 4), JSON.stringify([first, second])).toBe(0);
    expect(sharedRun(second!, first!), JSON.stringify([first, second])).toBeGreaterThan(0);
    expect(second!.at(-1)).toEqual(first!.at(-1));
  });

  it('a band note whose way into its task another note\'s line took joins that line rather than go round under the row', () => {
    const [first, second] = lines([{ box: { x: 640, y: 80, width: 300, height: 68 }, to: row[1]! }, { box: { x: 960, y: 80, width: 300, height: 68 }, to: row[1]! }], row, rowFlows);
    expect(second!.every((point) => point.y <= row[1]!.y), JSON.stringify(second)).toBe(true);
    expect(sharedRun(second!, first!), JSON.stringify([first, second])).toBeGreaterThan(0);
  });

  it('a band note whose run another note\'s line to another task took runs further out, not round under the row', () => {
    // a shape left of the first note blocks its way level with it, so it takes the run under the band
    const blocker = { x: 560, y: 100, width: 60, height: 30 };
    const [first, second] = lines([{ box: { x: 640, y: 80, width: 300, height: 68 }, to: row[0]! }, { box: { x: 960, y: 80, width: 300, height: 68 }, to: row[1]! }], [...row, blocker], rowFlows);
    expect(second!.every((point) => point.y <= row[1]!.y), JSON.stringify(second)).toBe(true);
    expect(sharedRun(second!, first!, 0, 4), JSON.stringify([first, second])).toBe(0);
  });

  it('a note line does not squeeze into a gap of 8 px between its note and the row under it', () => {
    const tasks = [100, 300, 500, 700].map((x) => ({ x, y: 162, width: 100, height: 80 }));
    // a shape left of the note blocks the way level with it
    const [line] = lines([{ box: { x: 1000, y: 100, width: 300, height: 54 }, to: tasks[0]! }], [...tasks, { x: 600, y: 90, width: 300, height: 60 }]);
    expect(segments(line!).some(([start, end]) => start.y === end.y && start.y > 154 && start.y < 162), JSON.stringify(line)).toBe(false);
  });

  it('a note line keeps 6 px off the boxes it runs along: level with its note it would pass 3 px over a row, so it runs in the middle of the gap', () => {
    const task = { x: 100, y: 330, width: 100, height: 80 };
    // two tasks 3 px under the level way, a note 13 px over it
    const [line] = lines([{ box: { x: 800, y: 200, width: 300, height: 54 }, to: task }], [task, { x: 300, y: 230, width: 100, height: 80 }, { x: 500, y: 230, width: 100, height: 80 }, { x: 300, y: 146, width: 300, height: 68 }]);
    expect(line).toEqual([
      { x: 800, y: 222 },
      { x: 180, y: 222 },
      { x: 180, y: 330 },
    ]);
  });

  it('a note line keeps off the top of its own task too, but for the leg it enters by', () => {
    // the run 15 px under the note would pass 2 px over the task's top; a shape left of the note blocks the way level with it
    const task = { x: 100, y: 147, width: 100, height: 80 };
    const [line] = lines([{ box: { x: 500, y: 100, width: 100, height: 30 }, to: task }], [task, { x: 300, y: 105, width: 100, height: 20 }]);
    expect(segments(line!).slice(0, -1).some(([start, end]) => start.y === end.y && Math.abs(start.y - task.y) <= 5), JSON.stringify(line)).toBe(false);
  });

  it('a note line in the last lane stays inside it when the way under the row is taken', () => {
    // a shape over the row blocks every way above it, a flow runs where the way under the row goes, 10 px over the lane's bottom
    const task = { x: 100, y: 230, width: 100, height: 80 };
    const nodes = [task, { x: 300, y: 230, width: 100, height: 80 }, { x: 500, y: 230, width: 100, height: 80 }, { x: 0, y: 200, width: 1000, height: 28 }];
    const [line] = lines([{ box: { x: 800, y: 240, width: 100, height: 40 }, to: task }], nodes, [[{ x: 50, y: 330 }, { x: 950, y: 330 }]], [{ top: 0, bottom: 200 }, { top: 200, bottom: 340 }]);
    expect(line!.every((point) => point.y <= 340), JSON.stringify(line)).toBe(true);
  });

  it('a note line does not run level along a lane border, also when its note sits across it', () => {
    const task = { x: 100, y: 160, width: 100, height: 80 };
    const [line] = lines([{ box: { x: 600, y: 180, width: 200, height: 40 }, to: task }], [task], [], [{ top: 0, bottom: 200 }, { top: 200, bottom: 400 }]);
    expect(segments(line!).some(([start, end]) => start.y === end.y && Math.abs(start.y - 200) <= 5), JSON.stringify(line)).toBe(false);
  });

  it('two notes on one task whose ways in run 5 px apart: the second line joins the first one\'s', () => {
    // the notes end 5 px apart, so the runs 15 px under them lie 5 px apart too; a shape left of the first note blocks the way level with it
    const notes = [{ box: { x: 640, y: 80, width: 300, height: 65 }, to: row[1]! }, { box: { x: 960, y: 80, width: 300, height: 70 }, to: row[1]! }];
    const [first, second] = lines(notes, [...row, { x: 560, y: 100, width: 60, height: 30 }], rowFlows);
    const levels = (pts: Point[]): number[] => segments(pts).filter(([start, end]) => start.y === end.y).map(([start]) => start.y);
    expect(sharedRun(second!, first!, 1, 6), JSON.stringify([first, second])).toBe(0);
    expect(levels(second!), JSON.stringify([first, second])).toEqual(levels(first!));
  });

  it('a data association whose way beside its task is blocked does not run up inside a flow', () => {
    // a flow climbs 30 px left of the task, where the spare way beside it turns; small shapes block the ways 20 px beside it and into its bottom and left side
    const task = { x: 500, y: 100, width: 100, height: 80 };
    const flow = [{ x: 470, y: 40 }, { x: 470, y: 600 }];
    const blockers = [{ x: 476, y: 250, width: 24, height: 20 }, { x: 560, y: 250, width: 40, height: 40 }, { x: 380, y: 120, width: 40, height: 40 }];
    const [data] = lines([{ box: { x: 300, y: 400, width: 36, height: 50 }, to: task, kind: 'dataObject' }], [task, ...blockers], [flow]);
    expect(sharedRun(data!, flow), JSON.stringify(data)).toBe(0);
  });

  it('the line of a note on a vertical flow does not hook back across the flow just beside its point', () => {
    // a small shape right of the point blocks every way in from the note's side; the way round the flow from the note's middle would cross it 18 px over the point
    const flow = [{ x: 300, y: 100 }, { x: 300, y: 600 }];
    const point = { x: 300, y: 300, width: 0, height: 0 };
    const [line] = lines([{ box: { x: 400, y: 267, width: 100, height: 30 }, to: point, flow }], [{ x: 304, y: 296, width: 24, height: 8 }], [flow]);
    expect(line!.at(-1), JSON.stringify(line)).toEqual({ x: 300, y: 300 });
    const crossings = segments(line!).filter(([start, end]) => start.y === end.y && Math.min(start.x, end.x) < 300 && Math.max(start.x, end.x) > 300);
    expect(crossings.every(([start]) => Math.abs(start.y - 300) >= 20), JSON.stringify(line)).toBe(true);
  });

  it('the line of a note on a vertical flow does not jog a few px into its point', () => {
    // a line 4 px over the way level with the point keeps the line off it; the run 15 px under the note lies 3 px under the point
    const flow = [{ x: 300, y: 100 }, { x: 300, y: 600 }];
    const point = { x: 300, y: 300, width: 0, height: 0 };
    const [line] = lines([{ box: { x: 400, y: 258, width: 100, height: 30 }, to: point, flow }], [], [flow, [{ x: 330, y: 296 }, { x: 380, y: 296 }]]);
    expect(line!.at(-1), JSON.stringify(line)).toEqual({ x: 300, y: 300 });
    expect(segments(line!).every(([start, end]) => Math.abs(end.x - start.x) + Math.abs(end.y - start.y) >= 10), JSON.stringify(line)).toBe(true);
  });

  it('a note line turning beside its data object keeps off the border of the note beside it, in the middle of the gap', () => {
    // N1 sits 20 px right of the data object; a line into the object's top and a data object 10 px left of it close the other ways
    const data = { x: 420, y: 350, width: 36, height: 50 };
    const beside = { x: 476, y: 355, width: 300, height: 40 };
    const [, line] = lines([{ box: beside, to: data }, { box: { x: 458, y: 280, width: 300, height: 54 }, to: data }], [data, { x: 374, y: 350, width: 36, height: 50 }], [[{ x: 446, y: 290 }, { x: 446, y: 350 }]]);
    expect(line!.at(-1)!.x, JSON.stringify(line)).toBe(rightOf(data));
    const along = segments(line!).filter(([start, end]) => start.x === end.x && Math.abs(start.x - beside.x) <= 5 && Math.max(start.y, end.y) > beside.y);
    expect(along, JSON.stringify(line)).toEqual([]);
  });

  it('a note line whose two ends lie in one lane crosses two flows rather than go round through the next lane', () => {
    const task = { x: 100, y: 210, width: 100, height: 80 };
    const flows = [400, 600].map((x) => [{ x, y: 100 }, { x, y: 295 }]);
    const [line] = lines([{ box: { x: 800, y: 230, width: 100, height: 40 }, to: task }], [task], flows, [{ top: 0, bottom: 300 }, { top: 300, bottom: 600 }]);
    expect(line!.every((point) => point.y <= 300), JSON.stringify(line)).toBe(true);
  });

  it('a note line whose way under the task another line took runs a step over it rather than cross flows or leave its lane', () => {
    // a flow runs where the way under the task goes, 10 px over the lane's bottom; four flows come down to 2 px over the step
    const task = { x: 100, y: 190, width: 100, height: 80 };
    const under = [{ x: 50, y: 290 }, { x: 950, y: 290 }];
    const flows = [under, ...[300, 400, 500, 600].map((x) => [{ x, y: 100 }, { x, y: 278 }])];
    const [line] = lines([{ box: { x: 800, y: 200, width: 100, height: 40 }, to: task }], [task], flows, [{ top: 0, bottom: 300 }, { top: 300, bottom: 600 }]);
    expect(line!.every((point) => point.y <= 300), JSON.stringify(line)).toBe(true);
    expect(flows.some((flow) => polylinesCross(line!, flow)), JSON.stringify(line)).toBe(false);
  });

  it('a note line has no bend in a straight leg, which would hide the line it crosses there', () => {
    // a line crosses the way level with the note 20 px right of the task, where the way turning beside it bends
    const task = { x: 100, y: 260, width: 100, height: 80 };
    const [line] = lines([{ box: { x: 500, y: 285, width: 100, height: 30 }, to: task }], [task], [[{ x: 220, y: 250 }, { x: 220, y: 350 }]]);
    const straight = line!.slice(1, -1).filter((point, index) => (line![index]!.x === point.x && point.x === line![index + 2]!.x) || (line![index]!.y === point.y && point.y === line![index + 2]!.y));
    expect(straight, JSON.stringify(line)).toEqual([]);
  });

  it('a note line runs square rather than slanted to save a few px', () => {
    const event = { x: 716, y: 427, width: 36, height: 36 };
    const [line] = lines([{ box: { x: 924, y: 357, width: 300, height: 54 }, to: event }], [event]);
    expect(segments(line!).every(([start, end]) => start.x === end.x || start.y === end.y), JSON.stringify(line)).toBe(true);
  });
});
