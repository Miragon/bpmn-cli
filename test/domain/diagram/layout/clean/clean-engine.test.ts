/**
 * Regression tests for the clean full-layout engine (src/domain/diagram/layout/clean/*): lane
 * bands that follow the content, message flows that avoid shapes and pick
 * the pool order, notes on boundary events, event sub-processes in their own
 * lane and collapsible, and text annotations owned by the collaboration.
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
      if (is(pe, 'bpmndi:BPMNShape')) shapes.set(el.get<string>('id'), { el, box: boxOf(pe.get<El>('bounds')), expanded: pe.get<boolean | undefined>('isExpanded') === true, ...(label ? { label: boxOf(label) } : {}) });
      else edges.set(el.get<string>('id'), { el, points: many(pe, 'waypoint').map((waypoint) => ({ x: waypoint.get<number>('x'), y: waypoint.get<number>('y') })), ...(label ? { label: boxOf(label) } : {}) });
    }
  });
  const byId = new Map<string, El>();
  const visit = (el: El): void => {
    const id = el.get<string | undefined>('id');
    if (id) byId.set(id, el);
    for (const key of ['rootElements', 'flowElements', 'artifacts', 'participants', 'messageFlows', 'laneSets', 'lanes']) {
      for (const child of (el.get<El[] | undefined>(key) ?? []) as El[]) visit(child);
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

/** Leaf lanes with their flow nodes (boundary events excluded: they sit on the host's border). */
function leafLanes(drawing: Drawn): Array<{ id: string; nodes: string[] }> {
  const out: Array<{ id: string; nodes: string[] }> = [];
  const visit = (lane: El): void => {
    const child = lane.get<El | undefined>('childLaneSet');
    if (child && many(child, 'lanes').length) return many(child, 'lanes').forEach(visit);
    const nodes = (lane.get<El[] | undefined>('flowNodeRef') ?? []).filter((node) => !is(node, 'bpmn:BoundaryEvent')).map((node) => node.get<string>('id'));
    out.push({ id: lane.get<string>('id'), nodes });
  };
  for (const el of drawing.byId.values()) if (is(el, 'bpmn:LaneSet') && !is(el.$parent as El, 'bpmn:Lane')) many(el, 'lanes').forEach(visit);
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
    if (segments(edge.points).some(([segmentStart, segmentEnd]) => cuts(segmentStart, segmentEnd, shape.box))) bad.push(id);
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
    for (let index = 1; index < lanes.length; index++) expect(lanes[index]!.y).toBe(lanes[index - 1]!.y + lanes[index - 1]!.height);
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
    for (const id of ids) expect(cutShapes(drawing, id), id).toEqual([]);
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
    for (const id of messageFlowIds(drawing)) expect(drawing.edges.get(id)!.points.length, id).toBeLessThanOrEqual(4);
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
    for (const [segmentStart, segmentEnd] of segments(route!.points)) expect(segmentStart.x === segmentEnd.x || segmentStart.y === segmentEnd.y).toBe(true);
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
    for (const id of ['F3', 'F4', 'F5', 'F6']) expect(cutShapes(drawing, id), id).toEqual([]);
  });
});

describe('event sub-processes', () => {
  it('an event sub-process is drawn in its own lane, not in the last one', async () => {
    const drawing = await drawn(scenario('lanes__eventsub-own-lane.bpmn'));
    expect(inside(drawing.shapes.get('Activity_OnCancel')!.box, drawing.shapes.get('Lane_Sales')!.box)).toBe(true);
    expect(outsideLane(drawing)).toEqual([]);
    expect(leafOverlaps(drawing)).toEqual([]);
    for (const id of ['Flow_4', 'Flow_5', 'Flow_6', 'Flow_7', 'Flow_8', 'Flow_9']) expect(cutShapes(drawing, id), id).toEqual([]);
    // no flow runs through the event sub-process frame either
    const frame = drawing.shapes.get('Activity_OnCancel')!.box;
    for (const id of ['Flow_4', 'Flow_5']) expect(segments(drawing.edges.get(id)!.points).some(([segmentStart, segmentEnd]) => cuts(segmentStart, segmentEnd, frame)), id).toBe(false);
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
    for (const id of ['TextAnnotation_Sla', 'TextAnnotation_Portal', 'TextAnnotation_Pdf', 'TextAnnotation_Loose']) expect(drawing.shapes.has(id), id).toBe(true);
    for (const id of ['Association_Sla', 'Association_Portal', 'Association_Pdf']) expect(drawing.edges.get(id)?.points.length, id).toBe(2);
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
