/**
 * Tests of src/diagram/LayoutAnalysis.ts (layout problems with ids).
 *
 * Every fixture is a hand-built definitions document with BPMNDI: a clean
 * baseline plus one defect per metric kind, checked for the problem ids,
 * counts and the weighted score. The harness kinds of KEYS / WEIGHTS are
 * compared with the regression harness (tools/layout-regress.mjs) so the two
 * cannot drift apart (EXTRA_KEYS are measured by the library only); full
 * equivalence with the harness's analyse() over all scenarios is checked
 * outside the test suite.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTRA_KEYS, HARNESS_KEYS, KEYS, QUALITY_KEYS, WEIGHTS, diffProblems, metricsDelta, problemKey, scoreOf, type LayoutProblem, type MetricKey } from '../src/diagram/utils/problems.js';
import { LayoutAnalysis } from '../src/diagram/LayoutAnalysis.js';
import { ProblemLocator } from '../src/diagram/ProblemLocator.js';
import { parseXml } from '../src/model/utils/moddle.js';
import { definitionsXml } from './helpers.js';

const DI_NS =
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';

type Rect = [x: number, y: number, width: number, height: number];

function bounds([x, y, width, height]: Rect, tag = 'dc:Bounds'): string {
  return `<${tag} x="${x}" y="${y}" width="${width}" height="${height}" />`;
}

function shape(id: string, rect: Rect, opts: { expanded?: boolean; label?: Rect } = {}): string {
  const expanded = opts.expanded === undefined ? '' : ` isExpanded="${opts.expanded}"`;
  const label = opts.label ? `<bpmndi:BPMNLabel>${bounds(opts.label)}</bpmndi:BPMNLabel>` : '';
  return `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${expanded}>${bounds(rect)}${label}</bpmndi:BPMNShape>`;
}

function edge(id: string, points: Array<[number, number]>): string {
  const wps = points.map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`).join('');
  return `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${wps}</bpmndi:BPMNEdge>`;
}

function diagram(planeOf: string, elements: string[]): string {
  return `<bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="${planeOf}">${elements.join('')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`;
}

/** process body + DI of the process plane */
function processXml(body: string, di: string[], extraRoots = ''): string {
  return definitionsXml(body, { nsDecl: DI_NS, extraRoots: `${extraRoots}${diagram('Process_1', di)}` });
}

const task = (id: string, extra = ''): string => `<bpmn:task id="${id}" name="${id}">${extra}</bpmn:task>`;
const flow = (id: string, source: string, target: string): string => `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;

const LINEAR_BODY = `
  <bpmn:startEvent id="Start" />
  <bpmn:task id="Task_A" name="Do A" />
  <bpmn:endEvent id="End" />
  ${flow('F1', 'Start', 'Task_A')}
  ${flow('F2', 'Task_A', 'End')}`;

const LINEAR_DI = {
  Start: shape('Start', [150, 122, 36, 36]),
  Task_A: shape('Task_A', [240, 100, 100, 80]),
  End: shape('End', [400, 122, 36, 36]),
  F1: edge('F1', [
    [186, 140],
    [240, 140],
  ]),
  F2: edge('F2', [
    [340, 140],
    [400, 140],
  ]),
};

async function measure(xml: string) {
  return LayoutAnalysis.ofXml(xml);
}

const only = (problems: LayoutProblem[], kind: MetricKey): LayoutProblem[] => problems.filter((p) => p.kind === kind);

function nonZero(counts: Record<MetricKey, number>): Partial<Record<MetricKey, number>> {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

describe('layoutProblems', () => {
  it('reports nothing for a clean diagram', async () => {
    const m = await measure(processXml(LINEAR_BODY, Object.values(LINEAR_DI)));
    expect(m.problems).toEqual([]);
    expect(m.score).toBe(0);
    expect(Object.keys(m.counts)).toEqual([...KEYS]);
  });

  it('finds overlapping shapes, but not a boundary event on its host', async () => {
    const body = `${task('Task_A')}${task('Task_B')}<bpmn:boundaryEvent id="Timer" attachedToRef="Task_A"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>`;
    const di = [shape('Task_A', [100, 100, 100, 80]), shape('Task_B', [180, 100, 100, 80]), shape('Timer', [110, 162, 36, 36])];
    const m = await measure(processXml(body, di));
    expect(m.problems).toEqual([{ kind: 'overlaps', ids: ['Task_A', 'Task_B'] }]);
    expect(m.score).toBe(WEIGHTS.overlaps);
  });

  it('a group is no leaf: it never overlaps its members, lies on a line or has a label on it; its own label still clashes', async () => {
    const body = `${LINEAR_BODY}<bpmn:task id="Task_B" name="Task_B" /><bpmn:group id="Group_1" categoryValueRef="CV_1" />`;
    const di = [
      ...Object.values(LINEAR_DI),
      shape('Task_B', [240, 240, 100, 80]),
      shape('Group_1', [130, 80, 250, 120], { label: [200, 250, 90, 20] }),
    ];
    const m = await measure(processXml(body, di, '<bpmn:category id="Cat_1"><bpmn:categoryValue id="CV_1" value="Group" /></bpmn:category>'));
    expect(m.problems).toEqual([{ kind: 'labelClash', ids: ['Group_1', 'Task_B'], detail: 'label on shape' }]);
    expect(m.score).toBe(WEIGHTS.labelClash);
  });

  it('finds crossing flows', async () => {
    const body = `${task('A')}${task('B')}${task('C')}${task('D')}${flow('F1', 'A', 'B')}${flow('F2', 'C', 'D')}`;
    const di = [
      shape('A', [100, 100, 100, 80]),
      shape('D', [400, 100, 100, 80]),
      shape('C', [100, 300, 100, 80]),
      shape('B', [400, 300, 100, 80]),
      edge('F1', [
        [200, 140],
        [300, 140],
        [300, 340],
        [400, 340],
      ]),
      edge('F2', [
        [150, 300],
        [150, 220],
        [450, 220],
        [450, 180],
      ]),
    ];
    const m = await measure(processXml(body, di));
    expect(m.problems).toEqual([{ kind: 'crossings', ids: ['F1', 'F2'] }]);
    expect(m.score).toBe(WEIGHTS.crossings);
  });

  it('finds a flow running through a shape it does not connect (once per pair)', async () => {
    const body = `${task('A')}${task('B')}${task('C')}${flow('F1', 'A', 'C')}`;
    const di = [
      shape('A', [100, 100, 100, 80]),
      shape('B', [250, 100, 100, 80]),
      shape('C', [400, 100, 100, 80]),
      edge('F1', [
        [200, 140],
        [300, 140],
        [300, 150],
        [400, 150],
      ]),
    ];
    const m = await measure(processXml(body, di));
    expect(m.problems).toEqual([{ kind: 'through', ids: ['F1', 'B'] }]);
    expect(m.counts.through).toBe(1);
  });

  it('finds diagonal flows (one problem per flow)', async () => {
    const di = {
      ...LINEAR_DI,
      F2: edge('F2', [
        [340, 140],
        [370, 150],
        [400, 160],
      ]),
    };
    const m = await measure(processXml(LINEAR_BODY, Object.values(di)));
    expect(only(m.problems, 'diagonal')).toEqual([{ kind: 'diagonal', ids: ['F2'] }]);
    expect(m.counts.diagonal).toBe(1);
  });

  it('lists elements without DI in model order, ignoring processes that are not laid out', async () => {
    const second = `<bpmn:process id="Process_2"><bpmn:task id="Other" /></bpmn:process>`;
    const { End: _end, F2: _f2, ...rest } = LINEAR_DI;
    const m = await measure(processXml(LINEAR_BODY, Object.values(rest), second));
    expect(m.problems).toEqual([
      { kind: 'missing', ids: ['End'] },
      { kind: 'missing', ids: ['F2'] },
    ]);
    expect(m.score).toBe(2 * WEIGHTS.missing);
  });

  it('finds labels on shapes and text crossed by a line', async () => {
    const di = { ...LINEAR_DI, Start: shape('Start', [150, 122, 36, 36], { label: [200, 130, 50, 14] }) };
    const body = LINEAR_BODY.replace('<bpmn:startEvent id="Start" />', '<bpmn:startEvent id="Start" name="Go" />');
    const m = await measure(processXml(body, Object.values(di)));
    expect(only(m.problems, 'labelClash')).toEqual([{ kind: 'labelClash', ids: ['Start', 'Task_A'], detail: 'label on shape' }]);
    expect(only(m.problems, 'labelOnLine')).toEqual([{ kind: 'labelOnLine', ids: ['Start', 'F1'] }]);
  });

  describe('pools and lanes', () => {
    const collab = `<bpmn:collaboration id="Collab_1"><bpmn:participant id="Pool" processRef="Process_1" /></bpmn:collaboration>`;
    const body = `
      <bpmn:laneSet id="LaneSet_1">
        <bpmn:lane id="Lane_1"><bpmn:flowNodeRef>Task_A</bpmn:flowNodeRef></bpmn:lane>
        <bpmn:lane id="Lane_2"><bpmn:flowNodeRef>Task_B</bpmn:flowNodeRef></bpmn:lane>
      </bpmn:laneSet>
      ${task('Task_A')}${task('Task_B')}${task('Task_C')}${flow('F1', 'Task_B', 'Task_B2')}<bpmn:task id="Task_B2" />`;
    const lanedXml = (lane2: Rect, taskA: Rect, f1: Array<[number, number]>): string =>
      definitionsXml(body.replace('<bpmn:flowNodeRef>Task_B</bpmn:flowNodeRef>', '<bpmn:flowNodeRef>Task_B</bpmn:flowNodeRef><bpmn:flowNodeRef>Task_B2</bpmn:flowNodeRef>'), {
        nsDecl: DI_NS,
        extraRoots:
          collab +
          diagram('Collab_1', [
            shape('Pool', [100, 50, 700, 250]),
            shape('Lane_1', [130, 50, 670, 125]),
            shape('Lane_2', lane2),
            shape('Task_A', taskA),
            shape('Task_B', [200, 200, 100, 80]),
            shape('Task_B2', [400, 200, 100, 80]),
            shape('Task_C', [550, 70, 100, 80]),
            edge('F1', f1),
          ]),
      });
    const straight: Array<[number, number]> = [
      [300, 240],
      [400, 240],
    ];

    it('is clean when everything sits in its lane and pool', async () => {
      const m = await measure(lanedXml([130, 175, 670, 125], [200, 80, 100, 80], straight));
      expect(m.problems).toEqual([]);
    });

    it('finds a node outside its lane (its centre in the other lane: also an intrusion there)', async () => {
      const m = await measure(lanedXml([130, 175, 670, 125], [600, 190, 100, 80], straight));
      expect(m.problems).toEqual([
        { kind: 'frameIntrusion', ids: ['Task_A', 'Lane_2'] },
        { kind: 'outsideLane', ids: ['Task_A', 'Lane_1'] },
      ]);
      expect(m.score).toBe(WEIGHTS.outsideLane + WEIGHTS.frameIntrusion);
    });

    it('finds a node outside its pool and a flow leaving its lane and pool', async () => {
      const detour: Array<[number, number]> = [
        [300, 240],
        [350, 240],
        [350, 320],
        [450, 320],
        [450, 280],
      ];
      const m = await measure(lanedXml([130, 175, 670, 125], [200, 310, 100, 80], detour));
      expect(nonZero(m.counts)).toEqual({ outsideLane: 1, outsidePool: 1, edgeLeavesLane: 1, edgeOutside: 1 });
      expect(only(m.problems, 'outsidePool')).toEqual([{ kind: 'outsidePool', ids: ['Task_A', 'Pool'] }]);
      expect(only(m.problems, 'edgeLeavesLane')).toEqual([{ kind: 'edgeLeavesLane', ids: ['F1', 'Lane_2'] }]);
      expect(only(m.problems, 'edgeOutside')).toEqual([{ kind: 'edgeOutside', ids: ['F1', 'Pool'] }]);
    });

    it('finds lanes not filling their pool', async () => {
      const m = await measure(lanedXml([130, 175, 670, 110], [200, 80, 100, 80], straight));
      expect(m.problems).toEqual([{ kind: 'laneGap', ids: ['Lane_2', 'Pool'], detail: 'bottom' }]);
    });
  });

  it('finds a node outside its expanded sub-process', async () => {
    const body = `<bpmn:subProcess id="Sub"><bpmn:task id="Inner" /></bpmn:subProcess>`;
    const inside = await measure(processXml(body, [shape('Sub', [100, 100, 350, 200], { expanded: true }), shape('Inner', [150, 150, 100, 80])]));
    expect(inside.problems).toEqual([]);
    const outside = await measure(processXml(body, [shape('Sub', [100, 100, 350, 200], { expanded: true }), shape('Inner', [500, 150, 100, 80])]));
    expect(outside.problems).toEqual([{ kind: 'outsideSub', ids: ['Inner', 'Sub'] }]);
  });

  it('reports import warnings as one failed problem', async () => {
    const xml = processXml(LINEAR_BODY.replace('targetRef="End"', 'targetRef="Nowhere"'), Object.values(LINEAR_DI));
    const m = await measure(xml);
    expect(only(m.problems, 'failed')).toEqual([{ kind: 'failed', ids: [], detail: 'import warnings: 1' }]);
    expect(m.score).toBeGreaterThanOrEqual(WEIGHTS.failed);
  });

  it('works on a parsed definitions element without touching the model', async () => {
    const { definitions } = await parseXml(processXml(LINEAR_BODY, Object.values(LINEAR_DI)));
    const proc = definitions.rootElements[0];
    const m = LayoutAnalysis.of(definitions);
    expect(m.score).toBe(0);
    expect(Object.hasOwn(proc, 'laneSets')).toBe(false);
    expect(Object.hasOwn(proc, 'artifacts')).toBe(false);
  });

  it('scores counts with the weights', async () => {
    const { End: _end, ...rest } = LINEAR_DI;
    const m = await measure(processXml(LINEAR_BODY, Object.values(rest)));
    expect(m.score).toBe(scoreOf(m.counts));
    expect(m.score).toBe(WEIGHTS.missing);
  });
});

describe('drawing-quality kinds (QUALITY_KEYS)', () => {
  it('backwardFlow: a target left of its source, but not a loop return', async () => {
    const body = `${task('A')}${task('B')}${task('C')}${flow('F1', 'A', 'B')}${flow('F2', 'B', 'C')}${flow('F3', 'C', 'B')}`;
    const di = [
      shape('A', [400, 100, 100, 80]),
      shape('B', [100, 100, 100, 80]),
      shape('C', [250, 250, 100, 80]),
      edge('F1', [
        [400, 140],
        [200, 140],
      ]),
      edge('F2', [
        [150, 180],
        [150, 290],
        [250, 290],
      ]),
      // C -> B runs back to the left too, but B reaches C again: a loop
      edge('F3', [
        [300, 250],
        [300, 160],
        [200, 160],
      ]),
    ];
    const m = await measure(processXml(body, di));
    expect(only(m.problems, 'backwardFlow')).toEqual([{ kind: 'backwardFlow', ids: ['F1', 'A', 'B'] }]);
    expect(m.score).toBe(WEIGHTS.backwardFlow + scoreOf({ ...m.counts, backwardFlow: 0 }));
  });

  it('segmentOverlap: two flows merging on one line before their target, not a fork', async () => {
    const body = `${task('A')}${task('B')}${task('J')}${task('X')}${task('Y')}${flow('F1', 'A', 'J')}${flow('F2', 'B', 'J')}${flow('F3', 'J', 'X')}${flow('F4', 'J', 'Y')}`;
    const di = [
      shape('A', [100, 100, 100, 80]),
      shape('B', [100, 300, 100, 80]),
      shape('J', [400, 100, 100, 80]),
      shape('X', [600, 300, 100, 80]),
      shape('Y', [600, 450, 100, 80]),
      edge('F1', [
        [200, 140],
        [400, 140],
      ]),
      // up from below, then along F1's line into J for 100 px
      edge('F2', [
        [200, 340],
        [300, 340],
        [300, 140],
        [400, 140],
      ]),
      // a fork: F3 and F4 share their first segment, which is fine
      edge('F3', [
        [450, 180],
        [450, 340],
        [600, 340],
      ]),
      edge('F4', [
        [450, 180],
        [450, 490],
        [600, 490],
      ]),
    ];
    const m = await measure(processXml(body, di));
    expect(only(m.problems, 'segmentOverlap')).toEqual([{ kind: 'segmentOverlap', ids: ['F1', 'F2', 'J'], detail: '100px' }]);
  });

  describe('segmentOverlap into a gateway: a join\'s entries share its bottom / top vertex', () => {
    type Line = Array<[number, number]>;
    // A, B, C left of the target J (one above the other), J -> E
    const J: Rect = [300, 115, 50, 50]; // vertices: left 300,140  top 325,115  bottom 325,165
    const scene = (kind: string, j: Rect, lines: { FA: Line; FB: Line; FC: Line; FE?: Line }, extra: { body?: string; di?: string[] } = {}): string =>
      processXml(`${task('A')}${task('B')}${task('C')}<bpmn:${kind} id="J" />${task('E')}${flow('FA', 'A', 'J')}${flow('FB', 'B', 'J')}${flow('FC', 'C', 'J')}${flow('FE', 'J', 'E')}${extra.body ?? ''}`, [
        shape('A', [100, 100, 100, 80]),
        shape('B', [100, 250, 100, 80]),
        shape('C', [100, 400, 100, 80]),
        shape('J', j),
        shape('E', [450, 100, 100, 80]),
        edge('FA', lines.FA),
        edge('FB', lines.FB),
        edge('FC', lines.FC),
        edge('FE', lines.FE ?? [[350, 140], [450, 140]]),
        ...(extra.di ?? []),
      ]);
    const INTO_LEFT: Line = [[200, 140], [300, 140]];
    // B and C rise into the bottom vertex, on one line for 125 px (bpmn-js h:v)
    const RISE_B: Line = [[200, 290], [325, 290], [325, 165]];
    const RISE_C: Line = [[200, 440], [325, 440], [325, 165]];

    for (const kind of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'complexGateway', 'eventBasedGateway']) {
      it(`a shared rise into the bottom vertex of a join is not reported (${kind})`, async () => {
        const m = await measure(scene(kind, J, { FA: INTO_LEFT, FB: RISE_B, FC: RISE_C }));
        expect(m.problems).toEqual([]);
        expect(m.score).toBe(0);
      });
    }

    it('a shared descent into the top vertex is not reported', async () => {
      // J below its entries: A and B come down into the top vertex 325,480 (110 px on one line), C enters the left vertex
      const m = await measure(
        scene('parallelGateway', [300, 480, 50, 50], {
          FA: [[200, 140], [325, 140], [325, 480]],
          FB: [[200, 290], [325, 290], [325, 480]],
          FC: [[200, 440], [250, 440], [250, 505], [300, 505]],
          FE: [[350, 505], [400, 505], [400, 140], [450, 140]],
        }),
      );
      expect(m.problems).toEqual([]);
    });

    it('a hook bundle is not reported: up the column gap, the hook and the rise, back to where the flows part', async () => {
      // B and C share the gap at x 400 (110 px), the hook at y 180 (75 px) and the rise (15 px)
      const m = await measure(
        scene('exclusiveGateway', J, {
          FA: INTO_LEFT,
          FB: [[200, 290], [400, 290], [400, 180], [325, 180], [325, 165]],
          FC: [[200, 440], [400, 440], [400, 180], [325, 180], [325, 165]],
        }),
      );
      expect(only(m.problems, 'segmentOverlap')).toEqual([]);
    });

    it('still reported: a merge onto a line into the left vertex, two flows drawn on top of each other, a task as the target', async () => {
      // B joins A's line 40 px before the left vertex; C rises into the bottom vertex alone
      const left = await measure(scene('exclusiveGateway', J, { FA: INTO_LEFT, FB: [[200, 290], [260, 290], [260, 140], [300, 140]], FC: RISE_C }));
      expect(only(left.problems, 'segmentOverlap')).toEqual([{ kind: 'segmentOverlap', ids: ['FA', 'FB', 'J'], detail: '40px' }]);
      // B and C on one line from start to end: one flow hides the other
      const hidden = await measure(scene('exclusiveGateway', J, { FA: INTO_LEFT, FB: RISE_B, FC: RISE_B }));
      expect(only(hidden.problems, 'segmentOverlap')).toEqual([{ kind: 'segmentOverlap', ids: ['FB', 'FC', 'J'], detail: '250px' }]);
      // the same with a duplicate first waypoint on one or both of them (a zero-length first segment)
      const dup = (line: Line): Line => [line[0]!, ...line];
      for (const [fb, fc] of [[dup(RISE_B), RISE_B], [RISE_B, dup(RISE_B)], [dup(RISE_B), dup(RISE_B)]]) {
        const twin = await measure(scene('exclusiveGateway', J, { FA: INTO_LEFT, FB: fb!, FC: fc! }));
        expect(only(twin.problems, 'segmentOverlap')).toEqual([{ kind: 'segmentOverlap', ids: ['FB', 'FC', 'J'], detail: '250px' }]);
      }
      // the same rise into the bottom of a task: an implicit join, the flows merge before it
      const into = await measure(scene('task', [275, 100, 100, 80], { FA: [[200, 140], [275, 140]], FB: [[200, 290], [325, 290], [325, 180]], FC: [[200, 440], [325, 440], [325, 180]], FE: [[375, 140], [450, 140]] }));
      expect(only(into.problems, 'segmentOverlap')).toEqual([{ kind: 'segmentOverlap', ids: ['FB', 'FC', 'J'], detail: '110px' }]);
    });

    it('a gateway that also splits: entries sharing the bottom vertex with its outgoing drop are inOut', async () => {
      // J -> X drops from the bottom vertex the entries of B and C rise into
      const m = await measure(
        scene('exclusiveGateway', J, { FA: INTO_LEFT, FB: RISE_B, FC: RISE_C }, { body: `${task('X')}${flow('FX', 'J', 'X')}`, di: [shape('X', [450, 300, 100, 80]), edge('FX', [[325, 165], [325, 340], [450, 340]])] }),
      );
      expect(only(m.problems, 'segmentOverlap')).toEqual([]);
      expect(only(m.problems, 'inOut')).toEqual([
        { kind: 'inOut', ids: ['FB', 'FX', 'J'] },
        { kind: 'inOut', ids: ['FC', 'FX', 'J'] },
      ]);
    });

    it('a pair still reported counts only what it shares outside the common tail, and shows its badge there', async () => {
      // B and C form a hook bundle into the bottom vertex (gap at x 400, hook at y 230, rise); C first runs 35 px along the hook's line
      const xml = scene('exclusiveGateway', J, {
        FA: INTO_LEFT,
        FB: [[200, 290], [400, 290], [400, 230], [325, 230], [325, 165]],
        FC: [[200, 440], [230, 440], [230, 230], [360, 230], [360, 300], [400, 300], [400, 230], [325, 230], [325, 165]],
      });
      const m = await measure(xml);
      const found = only(m.problems, 'segmentOverlap');
      expect(found).toEqual([{ kind: 'segmentOverlap', ids: ['FB', 'FC', 'J'], detail: '35px' }]);
      const { definitions } = await parseXml(xml);
      expect(new ProblemLocator(definitions).locate(found).map((p) => p.at)).toEqual([{ plane: 'Process_1', x: 342.5, y: 230 }]);
    });
  });

  describe('labels', () => {
    const collab = `<bpmn:collaboration id="Collab_1"><bpmn:participant id="Pool" processRef="Process_1" /><bpmn:participant id="Partner" />
      <bpmn:messageFlow id="M1" name="Order" sourceRef="Partner" targetRef="Task_A" /></bpmn:collaboration>`;
    const body = `<bpmn:startEvent id="Start" name="Go" />${task('Task_A')}${flow('F1', 'Start', 'Task_A')}`;
    const xml = (startLabel: Rect, msgLabel: Rect): string =>
      definitionsXml(body, {
        nsDecl: DI_NS,
        extraRoots:
          collab +
          diagram('Collab_1', [
            shape('Pool', [100, 200, 500, 200]),
            shape('Partner', [100, 0, 500, 60]),
            shape('Start', [160, 282, 36, 36], { label: startLabel }),
            shape('Task_A', [300, 260, 100, 80]),
            edge('F1', [
              [196, 300],
              [300, 300],
            ]),
            `<bpmndi:BPMNEdge id="M1_di" bpmnElement="M1"><di:waypoint x="350" y="60" /><di:waypoint x="350" y="260" /><bpmndi:BPMNLabel>${bounds(msgLabel)}</bpmndi:BPMNLabel></bpmndi:BPMNEdge>`,
          ]),
      });

    it('labelOutsideFrame: a label reaching out of its pool', async () => {
      const ok = await measure(xml([160, 325, 36, 14], [356, 150, 40, 14]));
      expect(only(ok.problems, 'labelOutsideFrame')).toEqual([]);
      const out = await measure(xml([160, 395, 36, 14], [356, 150, 40, 14]));
      expect(only(out.problems, 'labelOutsideFrame')).toEqual([{ kind: 'labelOutsideFrame', ids: ['Start', 'Pool'] }]);
    });

    it('messageLabelFar: a message flow label far from its line', async () => {
      const ok = await measure(xml([160, 325, 36, 14], [356, 150, 40, 14]));
      expect(only(ok.problems, 'messageLabelFar')).toEqual([]);
      const far = await measure(xml([160, 325, 36, 14], [500, 100, 40, 14]));
      expect(only(far.problems, 'messageLabelFar')).toEqual([{ kind: 'messageLabelFar', ids: ['M1'], detail: '150px' }]);
    });

    describe('labelOnTitle', () => {
      // the title "Handle order" of a 300 px wide sub-process: centred at x 250, y 107..121.4 (diagram/utils/text.ts titleBox)
      const titled = (name: string, expanded: boolean, label: Rect): string =>
        processXml(`<bpmn:subProcess id="Sub"${name ? ` name="${name}"` : ''} /><bpmn:startEvent id="E" name="Order in" />`, [shape('Sub', [100, 100, 300, 200], { expanded }), shape('E', [40, 40, 36, 36], { label })]);

      it('a label on the title of a named expanded sub-process', async () => {
        const m = await measure(titled('Handle order', true, [230, 105, 60, 14]));
        expect(m.problems).toEqual([{ kind: 'labelOnTitle', ids: ['E', 'Sub'] }]);
        expect(m.score).toBe(WEIGHTS.labelOnTitle);
      });

      it('a label below the title, or beside it, is none', async () => {
        expect((await measure(titled('Handle order', true, [230, 125, 60, 14]))).problems).toEqual([]);
        expect((await measure(titled('Handle order', true, [110, 105, 60, 14]))).problems).toEqual([]);
      });

      it('a sub-process without a name has no title', async () => {
        expect((await measure(titled('', true, [230, 105, 60, 14]))).problems).toEqual([]);
      });

      it('a collapsed sub-process is a leaf: a label on it is a labelClash, not on a title', async () => {
        const m = await measure(titled('Handle order', false, [230, 105, 60, 14]));
        expect(m.problems).toEqual([{ kind: 'labelClash', ids: ['E', 'Sub'], detail: 'label on shape' }]);
      });
    });
  });
});

describe('KEYS and WEIGHTS', () => {
  it('equal the regression harness, plus the structural kinds only the library measures', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'tools', 'layout-regress.mjs'), 'utf8');
    const keys = /const KEYS = (\[[^\]]*\]);/.exec(src)?.[1];
    const weights = /const WEIGHTS = \{([^}]*)\};/.exec(src)?.[1];
    expect(JSON.parse((keys ?? '').replaceAll("'", '"'))).toEqual([...HARNESS_KEYS]);
    expect(KEYS.filter((k) => !HARNESS_KEYS.includes(k))).toEqual([...EXTRA_KEYS, ...QUALITY_KEYS]);
    const pairs = Object.fromEntries((weights ?? '').split(',').map((kv) => kv.split(':').map((s) => s.trim())).map(([k, v]) => [k, Number(v)]));
    expect(pairs).toEqual(Object.fromEntries(HARNESS_KEYS.map((k) => [k, WEIGHTS[k]])));
    for (const k of EXTRA_KEYS) expect(WEIGHTS[k]).toBe(WEIGHTS.overlaps);
    // the quality kinds are soft: the bench and the fuzzer count weights >= 6 as hard
    for (const k of QUALITY_KEYS) expect(WEIGHTS[k]).toBeLessThan(6);
  });
});

describe('diffProblems', () => {
  const p = (kind: MetricKey, ids: string[], detail?: string): LayoutProblem => (detail === undefined ? { kind, ids } : { kind, ids, detail });

  it('reports added and resolved problems by kind and ids', () => {
    const before = [p('overlaps', ['A', 'B']), p('missing', ['X'])];
    const after = [p('missing', ['X']), p('through', ['F1', 'C'])];
    expect(diffProblems(before, after)).toEqual({ added: [p('through', ['F1', 'C'])], resolved: [p('overlaps', ['A', 'B'])] });
  });

  it('ignores the order of symmetric pairs and measured details', () => {
    const before = [p('crossings', ['F1', 'F2']), p('parallelRun', ['F3', 'F4'], '30px')];
    const after = [p('crossings', ['F2', 'F1']), p('parallelRun', ['F4', 'F3'], '45px')];
    expect(diffProblems(before, after)).toEqual({ added: [], resolved: [] });
  });

  it('keeps order and categorical details where they matter', () => {
    expect(problemKey(p('through', ['F1', 'A']))).not.toBe(problemKey(p('through', ['A', 'F1'])));
    expect(problemKey(p('laneGap', ['L', 'P'], 'top'))).not.toBe(problemKey(p('laneGap', ['L', 'P'], 'bottom')));
    expect(problemKey(p('labelClash', ['A', 'B'], 'label on shape'))).not.toBe(problemKey(p('labelClash', ['A', 'B'], 'label on label')));
  });

  it('matches duplicates one to one', () => {
    const dup = p('missing', ['X']);
    expect(diffProblems([dup, dup], [dup])).toEqual({ added: [], resolved: [dup] });
  });

  it('builds the layout.metrics block of a mutation', async () => {
    const before = await measure(processXml(LINEAR_BODY, Object.values(LINEAR_DI)));
    const { End: _end, ...rest } = LINEAR_DI;
    const after = await measure(processXml(LINEAR_BODY, Object.values(rest)));
    const delta = metricsDelta(before, after);
    expect(delta.before).toEqual({ counts: before.counts, score: 0 });
    expect(delta.after.score).toBe(WEIGHTS.missing);
    expect(delta.added).toEqual([p('missing', ['End'])]);
    expect(delta.resolved).toEqual([]);
    expect(metricsDelta(undefined, after)).not.toHaveProperty('before');
  });
});
