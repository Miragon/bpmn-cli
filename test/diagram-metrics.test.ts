/**
 * Tests of src/diagram/metrics.ts (layout problems with ids).
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
import { EXTRA_KEYS, HARNESS_KEYS, KEYS, WEIGHTS, diffProblems, layoutProblems, layoutProblemsOfXml, metricsDelta, problemKey, scoreOf, type LayoutProblem, type MetricKey } from '../src/diagram/metrics.js';
import { parseXml } from '../src/model.js';
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
  return layoutProblemsOfXml(xml);
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
    const m = layoutProblems(definitions);
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

describe('KEYS and WEIGHTS', () => {
  it('equal the regression harness, plus the structural kinds only the library measures', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'tools', 'layout-regress.mjs'), 'utf8');
    const keys = /const KEYS = (\[[^\]]*\]);/.exec(src)?.[1];
    const weights = /const WEIGHTS = \{([^}]*)\};/.exec(src)?.[1];
    expect(JSON.parse((keys ?? '').replaceAll("'", '"'))).toEqual([...HARNESS_KEYS]);
    expect(KEYS.filter((k) => !HARNESS_KEYS.includes(k))).toEqual([...EXTRA_KEYS]);
    const pairs = Object.fromEntries((weights ?? '').split(',').map((kv) => kv.split(':').map((s) => s.trim())).map(([k, v]) => [k, Number(v)]));
    expect(pairs).toEqual(Object.fromEntries(HARNESS_KEYS.map((k) => [k, WEIGHTS[k]])));
    for (const k of EXTRA_KEYS) expect(WEIGHTS[k]).toBe(WEIGHTS.overlaps);
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
