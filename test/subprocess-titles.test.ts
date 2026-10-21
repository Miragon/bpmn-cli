/**
 * Labels and the titles of expanded sub-processes (issue: in event
 * sub-processes labels sometimes overlap elements; the maintainer's drawing
 * had a compensation event's label on the sub-process's name).
 *
 *  - Full engine: every label of a sub-process's content stays off its title
 *    (text.ts titleBox, where bpmn-js draws the name) and inside the frame,
 *    in both op orders of the maintainer's case, for a gateway in the first
 *    row (its label above, the frame grows at the top), under a title of
 *    four lines, for labels wider than the events (left, right, below) and
 *    for an event a loop runs under (the channel keeps below its label) and
 *    for data objects and stores below the last row; a data object on the
 *    end event after a join (the event's label above it beside the title,
 *    not stepped below past the data object) and two data objects of one
 *    task (their labels side by side, the frame holds both).
 *  - Incremental layout on a kept drawing: a node spliced into an event
 *    sub-process, a gateway in its first row, a rename that gives the title
 *    more lines (compact keeps the room), `label --side above` (room is made
 *    below the title). A rename makes room only for the lines the title
 *    gained and only for what is drawn in the frame (a message flow's label
 *    above it is not): a second rename with as many lines moves nothing. A
 *    new end event in the title row keeps its label inside the frame; a
 *    rename that only widens the title onto a label moves the label to a
 *    free spot inside the sub-process, never out of it.
 *  - Making room in a sub-process (`space`, a splice) moves its centred
 *    title by half the added width: a label it brings onto the title is
 *    placed again, one that was on it before stays.
 *  - The metric labelOnTitle: a label on a title, also one put there by
 *    hand-edited DI, located for the render's badge.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, metricsXml, newXml } from '../src/api.js';
import { layoutProblems, locateProblems } from '../src/diagram/metrics.js';
import { renderSvg } from '../src/render/index.js';
import { titleBox } from '../src/diagram/text.js';
import { parseXml } from '../src/model/moddle.js';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Drawn {
  bounds?: Box;
  label?: Box;
  points?: Array<{ x: number; y: number }>;
}

const num = (m: RegExpExecArray): Box => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) });

/** Shapes (bounds, label) and edges (waypoints, label) of a document, by element id. */
function drawn(xml: string): Map<string, Drawn> {
  const out = new Map<string, Drawn>();
  const bounds = /<dc:Bounds x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/;
  for (const m of xml.matchAll(/<bpmndi:(BPMNShape|BPMNEdge)\b[^>]*bpmnElement="([^"]+)"[^>]*>([\s\S]*?)<\/bpmndi:\1>/g)) {
    const body = m[3]!;
    const label = /<bpmndi:BPMNLabel[\s\S]*?<\/bpmndi:BPMNLabel>/.exec(body);
    const rest = label ? body.replace(label[0], '') : body;
    const lb = label ? bounds.exec(label[0]) : null;
    const sb = bounds.exec(rest);
    const points = [...rest.matchAll(/<di:waypoint x="([-\d.]+)" y="([-\d.]+)"/g)].map((p) => ({ x: Number(p[1]), y: Number(p[2]) }));
    out.set(m[2]!, { ...(sb ? { bounds: num(sb) } : {}), ...(lb ? { label: num(lb) } : {}), ...(points.length ? { points } : {}) });
  }
  return out;
}

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (inner: Box, outer: Box): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const centreIn = (b: Box, f: Box): boolean => inside({ x: b.x + b.width / 2, y: b.y + b.height / 2, width: 0, height: 0 }, f);
const bottom = (b: Box): number => b.y + b.height;

/** The frame and title of an expanded sub-process, and the labels of what is drawn inside it. */
function frameOf(xml: string, subId: string, name: string): { frame: Box; title: Box; labels: Array<[string, Box]>; shapes: Array<[string, Box]> } {
  const d = drawn(xml);
  const frame = d.get(subId)!.bounds!;
  const title = titleBox(frame, name)!;
  const shapes: Array<[string, Box]> = [];
  const labels: Array<[string, Box]> = [];
  for (const [id, x] of d) {
    if (id === subId) continue;
    const at = x.bounds ?? (x.points ? { x: x.points[0]!.x, y: x.points[0]!.y, width: 0, height: 0 } : undefined);
    if (!at || !centreIn(at, frame)) continue;
    if (x.bounds) shapes.push([id, x.bounds]);
    if (x.label) labels.push([id, x.label]);
  }
  return { frame, title, labels, shapes };
}

/** Every label inside the sub-process is off its title and inside its frame. */
function expectLabelsClear(xml: string, subId: string, name: string): void {
  const { frame, title, labels } = frameOf(xml, subId, name);
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.filter(([, l]) => overlap(l, title)).map(([id]) => id)).toEqual([]);
  expect(labels.filter(([, l]) => !inside(l, frame)).map(([id]) => id)).toEqual([]);
}

const MAIN = [
  { op: 'add', kind: 'startEvent', name: 'Kündigung eingegangen', in: 'Process_Kuendigung', as: '$s' },
  { op: 'add', kind: 'userTask', name: 'Kündigung prüfen', after: '$s', as: '$t' },
  { op: 'add', kind: 'endEvent', name: 'Kündigung bestätigt', after: '$t' },
  { op: 'add', kind: 'eventSubProcess', name: 'Kündigung zurückgezogen', in: 'Process_Kuendigung', as: '$esp' },
  { op: 'add', kind: 'startEvent:message', name: 'Chef zieht zurück', in: '$esp', as: '$ms', message: 'Rueckzug' },
];
const THROW = { op: 'add', kind: 'intermediateThrowEvent:compensate', name: 'Beendigung rückabwickeln' };
const END = { op: 'add', kind: 'endEvent', name: 'Prozess abgebrochen' };
const ESP = 'Activity_KuendigungZurueckgezogen';
const ESP_NAME = 'Kündigung zurückgezogen';

async function drawnNew(ops: unknown[]): Promise<string> {
  const r = await applyToXml((await newXml({ processName: 'Kuendigung' })).xml, ops);
  expect(r.result.layout.mode).toBe('full');
  return r.xml;
}

describe('full engine: labels stay off the title of an expanded sub-process and inside it', () => {
  it("the maintainer's event sub-process, the throw event added in the chain", async () => {
    const xml = await drawnNew([...MAIN, { ...THROW, after: '$ms', as: '$c' }, { ...END, after: '$c' }]);
    expectLabelsClear(xml, ESP, ESP_NAME);
    expect((await metricsXml(xml)).score).toBe(0);
  });

  it('the same with the throw event spliced in later, in one batch and as a command of its own', async () => {
    const batch = await drawnNew([...MAIN, { ...END, after: '$ms' }, { ...THROW, after: '$ms' }]);
    expectLabelsClear(batch, ESP, ESP_NAME);
    expect((await metricsXml(batch)).score).toBe(0);
    // the throw event between the start and the end, its label below it as the convention says
    const d = drawn(batch);
    const ev = d.get('Event_BeendigungRueckabwickeln')!;
    expect(ev.label!.y).toBeGreaterThanOrEqual(bottom(ev.bounds!));
    const later = await applyToXml(await drawnNew([...MAIN, { ...END, after: '$ms' }]), [{ ...THROW, after: 'Event_ChefZiehtZurueck' }]);
    expect(later.result.layout.mode).toBe('full');
    expect(later.xml).toBe(batch);
  });

  it('a gateway in the first row: its label above it, below the title (the frame grows at the top)', async () => {
    const r = await applyToXml((await newXml({ processName: 'Bestellung' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Bestellung eingegangen', in: 'Process_Bestellung', as: '$s' },
      { op: 'add', kind: 'endEvent', name: 'Bestellung erledigt', after: '$s' },
      { op: 'add', kind: 'eventSubProcess', name: 'Stornierung durch den Kunden', in: 'Process_Bestellung', as: '$esp' },
      { op: 'add', kind: 'startEvent:message', name: 'Storno angefragt', in: '$esp', as: '$ms', message: 'Storno' },
      {
        op: 'split',
        after: '$ms',
        kind: 'exclusiveGateway',
        name: 'Storno möglich?',
        branches: [
          { flowName: 'ja', nodes: [{ kind: 'endEvent', name: 'Storniert' }] },
          { flowName: 'nein', default: true, nodes: [{ kind: 'endEvent', name: 'Abgelehnt' }] },
        ],
      },
    ]);
    const sub = 'Activity_StornierungDurchDenKunden';
    expectLabelsClear(r.xml, sub, 'Stornierung durch den Kunden');
    const { frame, title } = frameOf(r.xml, sub, 'Stornierung durch den Kunden');
    const gw = drawn(r.xml).get('Gateway_StornoMoeglich')!;
    expect(bottom(gw.label!)).toBeLessThanOrEqual(gw.bounds!.y);
    expect(gw.label!.y).toBeGreaterThanOrEqual(bottom(title));
    // more than the 45 px the top padding has without a label above the first row
    expect(gw.bounds!.y - frame.y).toBeGreaterThan(45);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('a title of four lines pushes the content down', async () => {
    const name = 'Rücknahme der Kündigung durch den Mitarbeiter innerhalb der gesetzlichen Widerrufsfrist von zwei Wochen';
    const r = await applyToXml((await newXml({ processName: 'Kuendigung' })).xml, [
      ...MAIN.slice(0, 3),
      { op: 'add', kind: 'eventSubProcess', name, in: 'Process_Kuendigung', as: '$esp' },
      { op: 'add', kind: 'startEvent:message', name: 'Rücknahme eingegangen', in: '$esp', as: '$ms', message: 'Ruecknahme' },
      { op: 'add', kind: 'endEvent', name: 'Kündigung storniert', after: '$ms' },
    ]);
    const sub = /<bpmn:subProcess id="([^"]+)"/.exec(r.xml)![1]!;
    const { title, shapes, labels } = frameOf(r.xml, sub, name);
    expect(title.height).toBeGreaterThanOrEqual(3 * 14.4);
    for (const [, b] of [...shapes, ...labels]) expect(b.y).toBeGreaterThanOrEqual(bottom(title));
    expectLabelsClear(r.xml, sub, name);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('labels wider than their events stay inside the frame on the left, the right and below', async () => {
    const r = await applyToXml((await newXml({ processName: 'Kuendigung' })).xml, [
      ...MAIN.slice(0, 3),
      { op: 'add', kind: 'eventSubProcess', name: 'Rücknahme', in: 'Process_Kuendigung', as: '$esp' },
      { op: 'add', kind: 'startEvent:message', name: 'Kündigungsrücknahmeerklärung eingegangen', in: '$esp', as: '$ms', message: 'Ruecknahme' },
      { op: 'add', kind: 'intermediateThrowEvent:escalation', name: 'Personalabteilungsleitung informieren', after: '$ms', as: '$x', escalation: 'Info' },
      { op: 'add', kind: 'endEvent', name: 'Arbeitsvertragsfortsetzung', after: '$x' },
    ]);
    expectLabelsClear(r.xml, 'Activity_Ruecknahme', 'Rücknahme');
    // the labels below their events, as the convention says (none moved onto the title row)
    const d = drawn(r.xml);
    for (const id of ['Event_Kuendigungsruecknahmeerklaerung', 'Event_PersonalabteilungsleitungInformieren', 'Event_Arbeitsvertragsfortsetzung']) {
      expect(d.get(id)!.label!.y).toBeGreaterThanOrEqual(bottom(d.get(id)!.bounds!));
    }
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('a loop under an event keeps below its label: the label stays at its spot below the event, inside the frame', async () => {
    // the reminder loop "no" runs back from Paid? to Send invoice under the timer, whose label takes three lines
    const r = await applyToXml((await newXml({ processName: 'Rechnung' })).xml, [
      { op: 'add', kind: 'startEvent', in: 'Process_Rechnung', as: '$s' },
      { op: 'add', kind: 'subProcess', name: 'Wait for the payment', after: '$s', as: '$sp' },
      { op: 'add', kind: 'endEvent', name: 'Done', after: '$sp' },
      { op: 'add', kind: 'startEvent', name: 'Started', in: '$sp', as: '$a' },
      { op: 'add', kind: 'task', name: 'Send invoice', after: '$a', as: '$t' },
      { op: 'add', kind: 'intermediateCatchEvent:timer', name: 'Two weeks have passed since sending', timer: 'P14D', after: '$t', as: '$w' },
      { op: 'add', kind: 'exclusiveGateway', name: 'Paid?', after: '$w', as: '$g' },
      { op: 'add', kind: 'endEvent', name: 'Paid', after: '$g', flowName: 'yes' },
      { op: 'connect', source: '$g', target: '$t', name: 'no' },
    ]);
    expect(r.result.layout.mode).toBe('full');
    const sub = 'Activity_WaitForThePayment';
    expectLabelsClear(r.xml, sub, 'Wait for the payment');
    const d = drawn(r.xml);
    const timer = d.get('Event_TwoWeeksHavePassedSinceSending')!;
    expect(timer.label!.y).toBeGreaterThanOrEqual(bottom(timer.bounds!));
    const loop = [...d.values()].find((x) => x.points && x.label && x.points.length > 3)!;
    expect(Math.max(...loop.points!.map((p) => p.y))).toBeGreaterThan(bottom(timer.label!));
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('data objects and stores with names of several lines below the last row: the frame holds their labels', async () => {
    const r = await applyToXml((await newXml({ processName: 'Application' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Application received', in: 'Process_Application', as: '$s' },
      { op: 'add', kind: 'subProcess', name: 'Score', after: '$s', as: '$sp' },
      { op: 'add', kind: 'startEvent', in: '$sp', as: '$a' },
      { op: 'add', kind: 'task', name: 'Score applicant', after: '$a', as: '$t' },
      { op: 'add', kind: 'endEvent', after: '$t' },
      { op: 'add', kind: 'dataObject', name: "The applicant's complete score sheet with every detail", in: '$sp', to: '$t' },
      { op: 'add', kind: 'endEvent', name: 'Application scored', after: '$sp' },
      { op: 'add', kind: 'eventSubProcess', name: 'Handle cancel', in: 'Process_Application', as: '$esp' },
      { op: 'add', kind: 'startEvent:message', name: 'Cancelled', in: '$esp', as: '$ms', message: 'Cancel' },
      { op: 'add', kind: 'task', name: 'Log cancel', after: '$ms', as: '$log' },
      { op: 'add', kind: 'endEvent', name: 'Logged', after: '$log' },
      { op: 'add', kind: 'dataStore', name: 'Cancellation audit store', in: '$esp', to: '$log' },
    ]);
    expect(r.result.layout.mode).toBe('full');
    expectLabelsClear(r.xml, 'Activity_Score', 'Score');
    expectLabelsClear(r.xml, 'Activity_HandleCancel', 'Handle cancel');
    const d = drawn(r.xml);
    for (const [kind, sub] of [
      ['dataObjectReference', 'Activity_Score'],
      ['dataStoreReference', 'Activity_HandleCancel'],
    ] as const) {
      const id = new RegExp(`<bpmn:${kind} id="([^"]+)"`).exec(r.xml)![1]!;
      expect(d.get(id)?.label, id).toBeDefined();
      expect(inside(d.get(id)!.label!, d.get(sub)!.bounds!), id).toBe(true);
    }
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('a data object on the end event after a join: the event label goes above it beside the title, the data label stays below its object', async () => {
    // the split makes the sub-process tall enough for a spot far below the data object inside it: that one must not win over the near one
    // above the event, beside the narrow title (it took the data label's spot and pushed it out of the frame)
    const r = await applyToXml((await newXml({ processName: 'M' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_M', id: 'S0' },
      { op: 'add', kind: 'subProcess', name: 'Dunning', after: 'S0', id: 'SP' },
      { op: 'add', kind: 'endEvent', name: 'End', after: 'SP', id: 'E0' },
      { op: 'add', kind: 'startEvent', name: 'Payment overdue', in: 'SP', id: 'ES' },
      {
        op: 'split',
        after: 'ES',
        kind: 'exclusiveGateway',
        id: 'EG',
        joinId: 'EJ',
        name: 'Credit ok?',
        branches: [
          { nodes: [{ kind: 'task', name: 'Remind', id: 'A' }], default: true },
          { nodes: [{ kind: 'task', name: 'Block', id: 'B' }], condition: '${x}' },
        ],
      },
      { op: 'add', kind: 'endEvent', name: 'Cancellation by the customer received', after: 'EJ', id: 'EE' },
      { op: 'add', kind: 'dataObject', name: 'Delivery note with the signature of the recipient', in: 'SP', id: 'D1' },
      { op: 'connect', source: 'D1', target: 'EE' },
    ]);
    expect(r.result.layout.mode).toBe('full');
    expectLabelsClear(r.xml, 'SP', 'Dunning');
    const d = drawn(r.xml);
    const ee = d.get('EE')!;
    const data = d.get('D1')!;
    expect(bottom(ee.label!)).toBeLessThanOrEqual(ee.bounds!.y);
    expect(data.label!.y).toBeGreaterThanOrEqual(bottom(data.bounds!));
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('a data object and a data store of one task with long names: the frame holds both labels side by side', async () => {
    const r = await applyToXml((await newXml({ processName: 'M' })).xml, [
      { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
      { op: 'add', kind: 'subProcess', id: 'SP', name: 'Handle', after: 'S' },
      { op: 'add', kind: 'endEvent', id: 'E', name: 'End', after: 'SP' },
      { op: 'add', kind: 'startEvent', id: 'S2', in: 'SP' },
      { op: 'add', kind: 'task', id: 'T', name: 'Write', after: 'S2' },
      { op: 'add', kind: 'endEvent', id: 'E2', after: 'T' },
      { op: 'add', kind: 'dataObjectReference', id: 'D', name: 'The very long name of the customer order document with all attachments', in: 'SP' },
      { op: 'connect', source: 'T', target: 'D' },
      { op: 'add', kind: 'dataStoreReference', id: 'DS', name: 'Customer relationship management database of the company', in: 'SP' },
      { op: 'connect', source: 'T', target: 'DS' },
    ]);
    expect(r.result.layout.mode).toBe('full');
    expectLabelsClear(r.xml, 'SP', 'Handle');
    const d = drawn(r.xml);
    const [doc, store] = [d.get('D')!, d.get('DS')!];
    expect(overlap(doc.label!, store.label!)).toBe(false);
    // the store's label beside the document's, below the store (the frame grew to the right for it)
    expect(store.label!.y).toBe(doc.label!.y);
    expect(store.label!.x).toBeGreaterThan(doc.label!.x + doc.label!.width);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('a transaction and a plain sub-process alike', async () => {
    const r = await applyToXml((await newXml({ processName: 'Kuendigung' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Kündigung eingegangen', in: 'Process_Kuendigung', as: '$s' },
      { op: 'add', kind: 'transaction', name: 'Kündigung rückabwickeln', after: '$s', as: '$tx' },
      { op: 'add', kind: 'startEvent', name: 'Rückabwicklung gestartet', in: '$tx', as: '$a' },
      { op: 'add', kind: 'intermediateThrowEvent:compensate', name: 'Beendigung rückabwickeln', after: '$a', as: '$b' },
      { op: 'add', kind: 'endEvent:cancel', name: 'Transaktion abgebrochen', after: '$b' },
      { op: 'add', kind: 'endEvent', name: 'Kündigung erledigt', after: '$tx' },
      { op: 'add', kind: 'subProcess', name: 'Prozess aufräumen', after: '$tx', as: '$sp' },
      { op: 'add', kind: 'startEvent', name: 'Aufräumen gestartet', in: '$sp', as: '$c' },
      { op: 'add', kind: 'intermediateThrowEvent:signal', name: 'Personalakte aktualisieren', after: '$c', as: '$d', signal: 'Akte' },
      { op: 'add', kind: 'endEvent', name: 'Aufräumen beendet', after: '$d' },
    ]);
    expectLabelsClear(r.xml, 'Activity_KuendigungRueckabwickeln', 'Kündigung rückabwickeln');
    expectLabelsClear(r.xml, 'Activity_ProzessAufraeumen', 'Prozess aufräumen');
    expect((await metricsXml(r.xml)).score).toBe(0);
  });
});

/**
 * A kept drawing (not the engine's): the event sub-process with its start
 * and end event 60 px apart, the labels as wide as bpmn-cli estimates them,
 * the name on one line at the top.
 */
const HAND_MADE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Event_Start" name="Kündigung eingegangen">
      <bpmn:outgoing>Flow_Start</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:endEvent id="Event_End" name="Kündigung bestätigt">
      <bpmn:incoming>Flow_Start</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Start" sourceRef="Event_Start" targetRef="Event_End" />
    <bpmn:subProcess id="Activity_Esp" name="Kündigung zurückgezogen" triggeredByEvent="true">
      <bpmn:startEvent id="Event_Chef" name="Chef zieht zurück">
        <bpmn:outgoing>Flow_Esp</bpmn:outgoing>
        <bpmn:messageEventDefinition id="MessageEventDefinition_1" />
      </bpmn:startEvent>
      <bpmn:endEvent id="Event_Abgebrochen" name="Prozess abgebrochen">
        <bpmn:incoming>Flow_Esp</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_Esp" sourceRef="Event_Chef" targetRef="Event_Abgebrochen" />
    </bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Event_Start_di" bpmnElement="Event_Start">
        <dc:Bounds x="172" y="102" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="146" y="144" width="89" height="28" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_End_di" bpmnElement="Event_End">
        <dc:Bounds x="268" y="102" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="248" y="144" width="75" height="28" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Start_di" bpmnElement="Flow_Start">
        <di:waypoint x="208" y="120" />
        <di:waypoint x="268" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNShape id="Activity_Esp_di" bpmnElement="Activity_Esp" isExpanded="true">
        <dc:Bounds x="140" y="220" width="240" height="140" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Chef_di" bpmnElement="Event_Chef">
        <dc:Bounds x="182" y="272" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="159" y="314" width="82" height="28" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Abgebrochen_di" bpmnElement="Event_Abgebrochen">
        <dc:Bounds x="278" y="272" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="252" y="314" width="89" height="28" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Esp_di" bpmnElement="Flow_Esp">
        <di:waypoint x="218" y="290" />
        <di:waypoint x="278" y="290" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

describe('incremental layout: a kept event sub-process', () => {
  it('a compensation event spliced in between start and end: its label below it, off the title, inside the frame', async () => {
    expect((await metricsXml(HAND_MADE)).score).toBe(0);
    const r = await applyToXml(HAND_MADE, [{ ...THROW, after: 'Event_Chef' }], { layout: 'incremental' });
    expect(r.result.layout.mode).toBe('incremental');
    const id = /<bpmn:intermediateThrowEvent id="([^"]+)"/.exec(r.xml)![1]!;
    const ev = drawn(r.xml).get(id)!;
    expect(ev.label!.y).toBeGreaterThanOrEqual(bottom(ev.bounds!));
    expectLabelsClear(r.xml, 'Activity_Esp', ESP_NAME);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('a gateway spliced into the first row: room is made below the title for its label above it', async () => {
    const r = await applyToXml(
      HAND_MADE,
      [
        { op: 'add', kind: 'exclusiveGateway', name: 'Rücknahme zulässig?', after: 'Event_Chef', as: '$g' },
        { op: 'add', kind: 'endEvent', name: 'Rücknahme abgelehnt', after: '$g', flowName: 'nein' },
      ],
      { layout: 'incremental' },
    );
    expect(r.result.layout.mode).toBe('incremental');
    const gwId = /<bpmn:exclusiveGateway id="([^"]+)"/.exec(r.xml)![1]!;
    const gw = drawn(r.xml).get(gwId)!;
    expect(bottom(gw.label!)).toBeLessThanOrEqual(gw.bounds!.y);
    expectLabelsClear(r.xml, 'Activity_Esp', ESP_NAME);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('a renamed sub-process whose title takes more lines makes room below it, and compact keeps that room', async () => {
    const name = 'Kündigung durch den Mitarbeiter nach Rücksprache mit dem Chef zurückgezogen';
    const r = await applyToXml(HAND_MADE, [{ op: 'set', id: 'Activity_Esp', values: { name } }], { layout: 'incremental' });
    expect(r.result.layout.mode).toBe('incremental');
    expect(r.result.layout.notes?.join(' ')).toMatch(/Activity_Esp made \d+ px of room below its new title/);
    const { title, shapes, labels } = frameOf(r.xml, 'Activity_Esp', name);
    expect(title.height).toBeGreaterThanOrEqual(3 * 14.4);
    for (const [, b] of [...shapes, ...labels]) expect(b.y).toBeGreaterThanOrEqual(bottom(title) + 4);
    expect((await metricsXml(r.xml)).score).toBe(0);
    const compacted = await applyToXml(r.xml, [{ op: 'compact', ids: ['Activity_Esp'] }]);
    const after = frameOf(compacted.xml, 'Activity_Esp', name);
    for (const [, b] of [...after.shapes, ...after.labels]) expect(b.y).toBeGreaterThanOrEqual(bottom(after.title) + 3.5);
  });

  it('`label --side above` makes room below the title instead of putting the label on it', async () => {
    const xml = await drawnNew([...MAIN, { ...END, after: '$ms' }, { ...THROW, after: '$ms' }]);
    const before = drawn(xml);
    const r = await applyToXml(xml, [{ op: 'label', id: 'Event_BeendigungRueckabwickeln', side: 'above' }]);
    expect(r.result.layout.mode).toBe('incremental');
    expect(r.result.layout.format?.[0]?.notes?.join(' ')).toMatch(/^made \d+ px of room above Event_BeendigungRueckabwickeln in its sub-process Activity_KuendigungZurueckgezogen/);
    const d = drawn(r.xml);
    const ev = d.get('Event_BeendigungRueckabwickeln')!;
    expect(bottom(ev.label!)).toBeLessThanOrEqual(ev.bounds!.y);
    expect(d.get(ESP)!.bounds!.height).toBeGreaterThan(before.get(ESP)!.bounds!.height);
    expectLabelsClear(r.xml, ESP, ESP_NAME);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });
});

describe('incremental layout: a new event in the title row of a sub-process', () => {
  it('a branch going up from a new gateway in the first row: the label of its end event stays inside the frame, off the title', async () => {
    const name = 'Cancellation by the customer while the order is processed';
    const init = await applyToXml((await newXml({ processName: 'M' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Order received', in: 'Process_M', id: 'S0' },
      { op: 'add', kind: 'task', name: 'Fill in the inspection report for quality assurance', after: 'S0', id: 'T0' },
      { op: 'add', kind: 'subProcess', name, after: 'T0', id: 'SP' },
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'SP', id: 'S' },
      {
        op: 'split',
        after: 'S',
        kind: 'exclusiveGateway',
        id: 'G1',
        joinId: 'J1',
        name: 'Size over the limit?',
        branches: [
          { nodes: [{ kind: 'userTask', name: 'Send the complaint to the supplier', id: 'B0_0' }], default: true },
          {
            nodes: [
              { kind: 'userTask', name: 'Update the customer data in the size register', id: 'B1_0' },
              { kind: 'userTask', name: 'Update the customer data in the size register', id: 'B1_1' },
            ],
            condition: '${x == 1}',
          },
          { nodes: [], condition: '${x == 2}', flowName: 'over the limit' },
        ],
      },
      { op: 'add', kind: 'boundaryEvent:timer', timer: 'PT1H', name: 'Cancellation by the customer received', on: 'B0_0', id: 'BE' },
      { op: 'add', kind: 'endEvent', name: 'Escalation reported to the division head', after: 'BE', id: 'BEE' },
    ]);
    const gateway = await applyToXml(init.xml, [{ op: 'add', kind: 'exclusiveGateway', name: 'Query needed?', after: 'S', id: 'FG' }], { layout: 'incremental' });
    // every spot of the new end event's label below the title is taken in its middle: not above the sub-process, but shifted along a side
    const r = await applyToXml(gateway.xml, [{ op: 'add', kind: 'endEvent', name: 'Payment not received in time', after: 'FG', id: 'FE', flowName: 'no, try again later' }], {
      layout: 'incremental',
    });
    expect(r.result.layout.mode).toBe('incremental');
    const { frame, title } = frameOf(r.xml, 'SP', name);
    const fe = drawn(r.xml).get('FE')!;
    expect(fe.bounds!.y).toBeLessThan(bottom(title) + 10);
    expect(inside(fe.label!, frame)).toBe(true);
    expect(overlap(fe.label!, title)).toBe(false);
    expect((await metricsXml(r.xml)).problems.filter((p) => p.kind === 'labelOutsideFrame' || p.kind === 'labelOnTitle')).toEqual([]);
  });
});

/**
 * A kept collaboration: the pool Customer above the pool Shop, whose
 * sub-process holds a task that sends a message to Customer; the message
 * flow's label lies in the gap between the pools, above the sub-process and
 * within the width of its title (not content of the sub-process).
 */
const MESSAGE_ABOVE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_Customer" name="Customer" />
    <bpmn:participant id="Participant_Shop" name="Shop" processRef="Process_Shop" />
    <bpmn:messageFlow id="Flow_OrderDetails" name="Order details" sourceRef="Activity_Check" targetRef="Participant_Customer" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Shop" isExecutable="true">
    <bpmn:startEvent id="Event_OrderIn" name="Order in">
      <bpmn:outgoing>Flow_In</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:subProcess id="Activity_Handle" name="Handle order">
      <bpmn:incoming>Flow_In</bpmn:incoming>
      <bpmn:outgoing>Flow_Out</bpmn:outgoing>
      <bpmn:startEvent id="Event_Begin" name="Begin">
        <bpmn:outgoing>Flow_Check</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:task id="Activity_Check" name="Check">
        <bpmn:incoming>Flow_Check</bpmn:incoming>
        <bpmn:outgoing>Flow_Checked</bpmn:outgoing>
      </bpmn:task>
      <bpmn:endEvent id="Event_Checked" name="Checked">
        <bpmn:incoming>Flow_Checked</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_Check" sourceRef="Event_Begin" targetRef="Activity_Check" />
      <bpmn:sequenceFlow id="Flow_Checked" sourceRef="Activity_Check" targetRef="Event_Checked" />
    </bpmn:subProcess>
    <bpmn:endEvent id="Event_Done" name="Done">
      <bpmn:incoming>Flow_Out</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_In" sourceRef="Event_OrderIn" targetRef="Activity_Handle" />
    <bpmn:sequenceFlow id="Flow_Out" sourceRef="Activity_Handle" targetRef="Event_Done" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">
      <bpmndi:BPMNShape id="Participant_Customer_di" bpmnElement="Participant_Customer" isHorizontal="true">
        <dc:Bounds x="40" y="20" width="760" height="60" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Participant_Shop_di" bpmnElement="Participant_Shop" isHorizontal="true">
        <dc:Bounds x="40" y="160" width="760" height="260" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_OrderIn_di" bpmnElement="Event_OrderIn">
        <dc:Bounds x="110" y="242" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="106" y="285" width="44" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Handle_di" bpmnElement="Activity_Handle" isExpanded="true">
        <dc:Bounds x="200" y="190" width="420" height="190" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Begin_di" bpmnElement="Event_Begin">
        <dc:Bounds x="230" y="242" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="234" y="285" width="28" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Check_di" bpmnElement="Activity_Check">
        <dc:Bounds x="360" y="220" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Checked_di" bpmnElement="Event_Checked">
        <dc:Bounds x="530" y="242" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="526" y="285" width="44" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Done_di" bpmnElement="Event_Done">
        <dc:Bounds x="682" y="242" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="687" y="285" width="26" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_In_di" bpmnElement="Flow_In">
        <di:waypoint x="146" y="260" />
        <di:waypoint x="200" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Out_di" bpmnElement="Flow_Out">
        <di:waypoint x="620" y="260" />
        <di:waypoint x="682" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Check_di" bpmnElement="Flow_Check">
        <di:waypoint x="266" y="260" />
        <di:waypoint x="360" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Checked_di" bpmnElement="Flow_Checked">
        <di:waypoint x="460" y="260" />
        <di:waypoint x="530" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_OrderDetails_di" bpmnElement="Flow_OrderDetails">
        <di:waypoint x="410" y="220" />
        <di:waypoint x="410" y="80" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="416" y="110" width="70" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

/** The bounds, labels and waypoints of a document without its names: what a rename may change. */
const geometry = (xml: string): string => JSON.stringify([...drawn(xml)]);

describe('incremental layout: a renamed sub-process makes room only for the lines its title gained', () => {
  /** two lines in the 420 px wide sub-process (one before) */
  const TWO_LINES = 'Handle the order of the customer: check the items, the address, the payment method and the delivery date';
  const rename = async (xml: string, name: string): Promise<{ xml: string; notes: string[] }> => {
    const r = await applyToXml(xml, [{ op: 'set', id: 'Activity_Handle', values: { name } }], { layout: 'incremental' });
    expect(r.result.layout.mode).toBe('incremental');
    return { xml: r.xml, notes: r.result.layout.notes ?? [] };
  };

  it('a message flow label above the sub-process is no content: a rename that keeps one line moves nothing', async () => {
    expect((await metricsXml(MESSAGE_ABOVE)).score).toBe(0);
    const r = await rename(MESSAGE_ABOVE, 'Handle the order');
    expect(r.notes.join(' ')).not.toMatch(/room below its new title/);
    expect(geometry(r.xml)).toBe(geometry(MESSAGE_ABOVE));
  });

  it('renamed twice with the same number of lines: the second rename moves nothing', async () => {
    const first = await rename(MESSAGE_ABOVE, TWO_LINES);
    expect(first.notes.join(' ')).toMatch(/Activity_Handle made \d+ px of room below its new title/);
    const second = await rename(first.xml, TWO_LINES.replace('the delivery date', 'the date of delivery'));
    expect(second.notes.join(' ')).not.toMatch(/room below its new title/);
    expect(geometry(second.xml)).toBe(geometry(first.xml));
  });

  it('a rename that adds a line makes room for the content in the frame only, not for the label above it', async () => {
    const r = await rename(MESSAGE_ABOVE, TWO_LINES);
    const { frame, title } = frameOf(r.xml, 'Activity_Handle', TWO_LINES);
    expect(title.height).toBeCloseTo(2 * 14.4);
    const d = drawn(r.xml);
    for (const id of ['Event_Begin', 'Activity_Check', 'Event_Checked']) {
      for (const b of [d.get(id)!.bounds!, ...(d.get(id)!.label ? [d.get(id)!.label!] : [])]) expect(b.y, id).toBeGreaterThanOrEqual(bottom(title) + 4);
    }
    // the task at y 220 is what reaches up to the new title: room for it (10 px), not for the label at y 110
    const moved = d.get('Activity_Check')!.bounds!.y - 220;
    expect(moved).toBe(Math.ceil(bottom(title) + 4 - 220));
    expect(moved).toBeLessThan(15);
    expect(frame.height - 190).toBe(moved);
    expect(d.get('Flow_OrderDetails')!.label).toEqual({ x: 416, y: 110, width: 70, height: 14 });
    expect(r.notes.join(' ')).toContain(`Activity_Handle made ${moved} px of room below its new title`);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });
});

/**
 * A kept sub-process whose gateway in the first row has its label, moved by
 * hand, up in the title row left of the centred title.
 */
const LABEL_LEFT_OF_TITLE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:subProcess id="Activity_Handle" name="Handle the order">
      <bpmn:startEvent id="Event_Begin" name="Begin">
        <bpmn:outgoing>Flow_Begin</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:exclusiveGateway id="Gateway_Valid" name="Valid?">
        <bpmn:incoming>Flow_Begin</bpmn:incoming>
        <bpmn:outgoing>Flow_Valid</bpmn:outgoing>
      </bpmn:exclusiveGateway>
      <bpmn:task id="Activity_Check" name="Check">
        <bpmn:incoming>Flow_Valid</bpmn:incoming>
        <bpmn:outgoing>Flow_Checked</bpmn:outgoing>
      </bpmn:task>
      <bpmn:endEvent id="Event_Checked" name="Checked">
        <bpmn:incoming>Flow_Checked</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_Begin" sourceRef="Event_Begin" targetRef="Gateway_Valid" />
      <bpmn:sequenceFlow id="Flow_Valid" sourceRef="Gateway_Valid" targetRef="Activity_Check" />
      <bpmn:sequenceFlow id="Flow_Checked" sourceRef="Activity_Check" targetRef="Event_Checked" />
    </bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Activity_Handle_di" bpmnElement="Activity_Handle" isExpanded="true">
        <dc:Bounds x="100" y="80" width="500" height="180" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Begin_di" bpmnElement="Event_Begin">
        <dc:Bounds x="130" y="142" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="134" y="185" width="28" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Valid_di" bpmnElement="Gateway_Valid" isMarkerVisible="true">
        <dc:Bounds x="210" y="135" width="50" height="50" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="218" y="90" width="34" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Check_di" bpmnElement="Activity_Check">
        <dc:Bounds x="320" y="120" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Checked_di" bpmnElement="Event_Checked">
        <dc:Bounds x="492" y="142" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="488" y="185" width="44" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Begin_di" bpmnElement="Flow_Begin">
        <di:waypoint x="166" y="160" />
        <di:waypoint x="210" y="160" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Valid_di" bpmnElement="Flow_Valid">
        <di:waypoint x="260" y="160" />
        <di:waypoint x="320" y="160" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Checked_di" bpmnElement="Flow_Checked">
        <di:waypoint x="420" y="160" />
        <di:waypoint x="492" y="160" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

describe('making room in a sub-process: a label the room brings onto its title steps aside', () => {
  /** the gateway's label is off the title (it was before), above the gateway, inside the frame */
  const expectGatewayLabelClear = (xml: string): void => {
    const d = drawn(xml);
    const frame = d.get('Activity_Handle')!.bounds!;
    // the sub-process grew: its centred title moved by half of it, the gateway and its label by all of it
    expect(frame.width).toBeGreaterThan(500);
    const gw = d.get('Gateway_Valid')!;
    expect(overlap(gw.label!, titleBox(frame, 'Handle the order')!)).toBe(false);
    expect(bottom(gw.label!)).toBeLessThanOrEqual(gw.bounds!.y);
    expect(inside(gw.label!, frame)).toBe(true);
  };

  it('`space --after` widening the sub-process', async () => {
    expect((await metricsXml(LABEL_LEFT_OF_TITLE)).score).toBe(0);
    const r = await applyToXml(LABEL_LEFT_OF_TITLE, [{ op: 'space', after: 'Event_Begin' }]);
    expectGatewayLabelClear(r.xml);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('a task spliced in by the incremental layout: a note names the label', async () => {
    const r = await applyToXml(LABEL_LEFT_OF_TITLE, [{ op: 'add', kind: 'task', name: 'Prepare', after: 'Event_Begin' }], { layout: 'incremental' });
    expect(r.result.layout.mode).toBe('incremental');
    expect(r.result.layout.notes).toContain('label of Gateway_Valid moved off the name of Activity_Handle');
    expectGatewayLabelClear(r.xml);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });

  it('a label on the title before stays where the room puts it (the drawing is kept)', async () => {
    const xml = LABEL_LEFT_OF_TITLE.replace('<dc:Bounds x="218" y="90" width="34" height="14" />', '<dc:Bounds x="290" y="90" width="34" height="14" />');
    expect((await metricsXml(xml)).problems).toEqual([{ kind: 'labelOnTitle', ids: ['Gateway_Valid', 'Activity_Handle'] }]);
    const r = await applyToXml(xml, [{ op: 'space', after: 'Event_Begin' }]);
    const gw = drawn(r.xml).get('Gateway_Valid')!;
    expect(gw.label).toEqual({ x: 290 + gw.bounds!.x - 210, y: 90, width: 34, height: 14 });
    expect((await metricsXml(r.xml)).problems).toEqual([{ kind: 'labelOnTitle', ids: ['Gateway_Valid', 'Activity_Handle'] }]);
  });
});

/**
 * A kept sub-process with a short name whose split gateway in the first row
 * has its label (put there by another tool) in the title row, left of the
 * centred name: a rename that keeps one line but widens the name reaches it.
 * Below the gateway runs the line to the second branch, beside it the flows.
 */
const LABEL_IN_TITLE_ROW = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:subProcess id="Activity_Return" name="Returns">
      <bpmn:startEvent id="Event_Requested">
        <bpmn:outgoing>Flow_Requested</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:exclusiveGateway id="Gateway_Complete" name="Complete?">
        <bpmn:incoming>Flow_Requested</bpmn:incoming>
        <bpmn:outgoing>Flow_Yes</bpmn:outgoing>
        <bpmn:outgoing>Flow_No</bpmn:outgoing>
      </bpmn:exclusiveGateway>
      <bpmn:task id="Activity_Refund" name="Refund">
        <bpmn:incoming>Flow_Yes</bpmn:incoming>
        <bpmn:outgoing>Flow_Refunded</bpmn:outgoing>
      </bpmn:task>
      <bpmn:task id="Activity_Ask" name="Ask for documents">
        <bpmn:incoming>Flow_No</bpmn:incoming>
        <bpmn:outgoing>Flow_Asked</bpmn:outgoing>
      </bpmn:task>
      <bpmn:endEvent id="Event_Refunded">
        <bpmn:incoming>Flow_Refunded</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:endEvent id="Event_Asked">
        <bpmn:incoming>Flow_Asked</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_Requested" sourceRef="Event_Requested" targetRef="Gateway_Complete" />
      <bpmn:sequenceFlow id="Flow_Yes" sourceRef="Gateway_Complete" targetRef="Activity_Refund" />
      <bpmn:sequenceFlow id="Flow_No" sourceRef="Gateway_Complete" targetRef="Activity_Ask" />
      <bpmn:sequenceFlow id="Flow_Refunded" sourceRef="Activity_Refund" targetRef="Event_Refunded" />
      <bpmn:sequenceFlow id="Flow_Asked" sourceRef="Activity_Ask" targetRef="Event_Asked" />
    </bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Activity_Return_di" bpmnElement="Activity_Return" isExpanded="true">
        <dc:Bounds x="80" y="150" width="500" height="280" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Requested_di" bpmnElement="Event_Requested">
        <dc:Bounds x="110" y="187" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Complete_di" bpmnElement="Gateway_Complete" isMarkerVisible="true">
        <dc:Bounds x="200" y="180" width="50" height="50" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="188" y="152" width="75" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Refund_di" bpmnElement="Activity_Refund">
        <dc:Bounds x="330" y="165" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Ask_di" bpmnElement="Activity_Ask">
        <dc:Bounds x="330" y="325" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Refunded_di" bpmnElement="Event_Refunded">
        <dc:Bounds x="500" y="187" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Event_Asked_di" bpmnElement="Event_Asked">
        <dc:Bounds x="500" y="347" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Requested_di" bpmnElement="Flow_Requested">
        <di:waypoint x="146" y="205" />
        <di:waypoint x="200" y="205" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Yes_di" bpmnElement="Flow_Yes">
        <di:waypoint x="250" y="205" />
        <di:waypoint x="330" y="205" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_No_di" bpmnElement="Flow_No">
        <di:waypoint x="225" y="230" />
        <di:waypoint x="225" y="365" />
        <di:waypoint x="330" y="365" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Refunded_di" bpmnElement="Flow_Refunded">
        <di:waypoint x="430" y="205" />
        <di:waypoint x="500" y="205" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Asked_di" bpmnElement="Flow_Asked">
        <di:waypoint x="430" y="365" />
        <di:waypoint x="500" y="365" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

describe('a rename that only widens the title of a sub-process onto a label', () => {
  it('moves the label to a free spot inside the sub-process, never out of it', async () => {
    const name = 'Handle the return of the goods by the customer and inform everyone';
    expect((await metricsXml(LABEL_IN_TITLE_ROW)).score).toBe(0);
    const r = await applyToXml(LABEL_IN_TITLE_ROW, [{ op: 'set', id: 'Activity_Return', values: { name } }], { layout: 'incremental' });
    expect(r.result.layout.mode).toBe('incremental');
    expect(r.result.layout.notes).toContain('label of Gateway_Complete moved off the name of Activity_Return');
    const { frame, title } = frameOf(r.xml, 'Activity_Return', name);
    expect(title.height).toBeCloseTo(14.4);
    const gw = drawn(r.xml).get('Gateway_Complete')!;
    expect(overlap(gw.label!, title)).toBe(false);
    expect(inside(gw.label!, frame)).toBe(true);
    expect((await metricsXml(r.xml)).score).toBe(0);
  });
});

describe('labelOnTitle', () => {
  it('reports a label put on a title by hand-edited DI and locates it on the overlap', async () => {
    const xml = HAND_MADE.replace('<dc:Bounds x="252" y="314" width="89" height="28" />', '<dc:Bounds x="252" y="225" width="89" height="28" />');
    const m = await metricsXml(xml);
    expect(m.problems).toEqual([{ kind: 'labelOnTitle', ids: ['Event_Abgebrochen', 'Activity_Esp'] }]);
    expect(m.score).toBe(2);
    const { definitions } = await parseXml(xml);
    const [p] = locateProblems(definitions, layoutProblems(definitions).problems);
    const title = titleBox({ x: 140, y: 220, width: 240, height: 140 }, ESP_NAME)!;
    expect(p!.at!.plane).toBe('Process_1');
    expect(overlap({ x: p!.at!.x - 0.5, y: p!.at!.y - 0.5, width: 1, height: 1 }, title)).toBe(true);
    expect(overlap({ x: p!.at!.x - 0.5, y: p!.at!.y - 0.5, width: 1, height: 1 }, { x: 252, y: 225, width: 89, height: 28 })).toBe(true);
    const render = await renderSvg(xml, { problems: true });
    expect(render.problems?.map((x) => [x.kind, x.drawn])).toEqual([['labelOnTitle', true]]);
  });
});
