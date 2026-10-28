/**
 * The space tool of a splice pushes only what follows the new node and what that would run into
 * (src/domain/diagram/layout/incremental/PlacementObstacles.ts pushSet, SpaceTool.ts `push`):
 *  - another row beyond the line keeps its place (a rejection path gets a task, the main path
 *    above it stays)
 *  - a pushed node that would jump over a line takes the line and its end along
 *  - what hangs on a pushed shape's boundary events and content (annotations) moves with it
 *  - a pool grows only as far as its content reaches
 *  - a new flow into a drawn node left of its source pushes the target and what follows it right of
 *    the source (NeighbourPlacer pushBehind), as a single `connect` and in a batch alike; a loop
 *    return stays
 */
import { describe, expect, it } from 'vitest';
import { applyToXml } from '../../../../../src/api.js';
import { Doc } from '../../../../../src/domain/document/Doc.js';
import { mutateDoc } from '../../../../../src/index.js';
import { drawnProcess, edgeDi, sequenceFlow, shapeDi, shapes } from '../../../../helpers/drawing.js';


/** S -> A -> G; "yes": B -> C -> E on the main row, "no": R -> RE on the row below, R under B */
const branches = (): string =>
  drawnProcess(
    `<bpmn:startEvent id="S" /><bpmn:task id="A" name="A" /><bpmn:exclusiveGateway id="G" />
     <bpmn:task id="B" name="B" /><bpmn:task id="C" name="C" /><bpmn:endEvent id="E" />
     <bpmn:task id="R" name="R" /><bpmn:endEvent id="RE" />
     ${sequenceFlow('F1', 'S', 'A')}${sequenceFlow('F2', 'A', 'G')}${sequenceFlow('F3', 'G', 'B')}${sequenceFlow('F4', 'B', 'C')}${sequenceFlow('F5', 'C', 'E')}${sequenceFlow('F6', 'G', 'R')}${sequenceFlow('F7', 'R', 'RE')}`,
    [
      shapeDi('S', 100, 182, 36, 36),
      shapeDi('A', 196, 160, 100, 80),
      shapeDi('G', 356, 175, 50, 50),
      shapeDi('B', 466, 160, 100, 80),
      shapeDi('C', 626, 160, 100, 80),
      shapeDi('E', 786, 182, 36, 36),
      shapeDi('R', 466, 300, 100, 80),
      shapeDi('RE', 626, 322, 36, 36),
      edgeDi('F1', [[136, 200], [196, 200]]),
      edgeDi('F2', [[296, 200], [356, 200]]),
      edgeDi('F3', [[406, 200], [466, 200]]),
      edgeDi('F4', [[566, 200], [626, 200]]),
      edgeDi('F5', [[726, 200], [786, 200]]),
      edgeDi('F6', [[381, 225], [381, 340], [466, 340]]),
      edgeDi('F7', [[566, 340], [626, 340]]),
    ].join(''),
  );

const run = async (xml: string, ops: object[]) => {
  const result = await mutateDoc(await Doc.fromXml(xml), ops, { dryRun: true, layout: 'incremental' });
  return { result, before: shapes(await Doc.fromXml(xml)), after: shapes(await Doc.fromXml(result.xml)) };
};
const at = (map: Map<string, { bounds: { x: number; y: number } }>, id: string): { x: number; y: number } => ({ x: map.get(id)!.bounds.x, y: map.get(id)!.bounds.y });
const shapeLines = (xml: string): string[] => [...xml.matchAll(/bpmnElement="([^"]+)"[^>]*>\s*<dc:Bounds ([^/]+)\/>/g)].map((match) => `${match[1]} ${match[2]}`).sort();

describe('a splice pushes only what follows the new node', () => {
  it('a task after the last task of the row below moves its end event, not the main row above', async () => {
    const { result, before, after } = await run(branches(), [{ op: 'add', kind: 'task', id: 'N', name: 'N', after: 'R' }]);
    expect(at(after, 'N')).toEqual({ x: 626, y: 300 });
    expect(at(after, 'RE').x).toBe(786);
    for (const id of ['S', 'A', 'G', 'B', 'C', 'E', 'R']) expect(at(after, id), id).toEqual(at(before, id));
    expect(result.layout.moved).toEqual(['RE']);
    expect(result.layout.metrics!.added).toEqual([]);
  });

  it('a task on the main row moves what follows it there; the row below stays', async () => {
    const { result, before, after } = await run(branches(), [{ op: 'add', kind: 'task', id: 'N', name: 'N', after: 'B' }]);
    expect(at(after, 'C').x).toBeGreaterThan(at(before, 'C').x);
    expect(at(after, 'E').x - at(after, 'C').x).toBe(at(before, 'E').x - at(before, 'C').x);
    for (const id of ['R', 'RE']) expect(at(after, id), id).toEqual(at(before, id));
    expect(result.layout.metrics!.added).toEqual([]);
  });

  it('a node pushed over a line takes the line and its end along instead of crossing it', async () => {
    // Q (row below) goes up right of the end event B to T on the main row; B moves past that line
    const xml = drawnProcess(
      `<bpmn:startEvent id="S" /><bpmn:task id="A" name="A" /><bpmn:endEvent id="B" />
       <bpmn:startEvent id="S2" /><bpmn:task id="Q" name="Q" /><bpmn:task id="T" name="T" /><bpmn:endEvent id="TE" />
       ${sequenceFlow('F1', 'S', 'A')}${sequenceFlow('F2', 'A', 'B')}${sequenceFlow('F3', 'S2', 'Q')}${sequenceFlow('F4', 'Q', 'T')}${sequenceFlow('F5', 'T', 'TE')}`,
      [
        shapeDi('S', 100, 182, 36, 36),
        shapeDi('A', 196, 160, 100, 80),
        shapeDi('B', 356, 182, 36, 36),
        shapeDi('S2', 100, 322, 36, 36),
        shapeDi('Q', 196, 300, 100, 80),
        shapeDi('T', 900, 160, 100, 80),
        shapeDi('TE', 1060, 182, 36, 36),
        edgeDi('F1', [[136, 200], [196, 200]]),
        edgeDi('F2', [[296, 200], [356, 200]]),
        edgeDi('F3', [[136, 340], [196, 340]]),
        edgeDi('F4', [[296, 340], [476, 340], [476, 120], [950, 120], [950, 160]]),
        edgeDi('F5', [[1000, 200], [1060, 200]]),
      ].join(''),
    );
    const { result, before, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'N', after: 'A' }]);
    const dx = at(after, 'B').x - at(before, 'B').x;
    expect(dx).toBeGreaterThan(120);
    expect(at(after, 'T').x).toBe(at(before, 'T').x + dx);
    for (const id of ['S2', 'Q']) expect(at(after, id), id).toEqual(at(before, id));
    expect(result.layout.metrics!.added.map((problem) => problem.kind)).not.toContain('crossings');
  });
});

describe('a pushed shape drags the artifacts of what hangs on it', () => {
  it('an annotation on the boundary event of a pushed task moves with the task', async () => {
    // S -> A -> B -> E; the timer BT on B leads to BE, the annotation AN under B explains BT
    const xml = drawnProcess(
      `<bpmn:startEvent id="S" /><bpmn:task id="A" name="A" /><bpmn:task id="B" name="B" /><bpmn:endEvent id="E" />
       <bpmn:boundaryEvent id="BT" attachedToRef="B"><bpmn:timerEventDefinition /></bpmn:boundaryEvent><bpmn:endEvent id="BE" />
       <bpmn:textAnnotation id="AN"><bpmn:text>deadline</bpmn:text></bpmn:textAnnotation><bpmn:association id="AS" sourceRef="BT" targetRef="AN" />
       ${sequenceFlow('F1', 'S', 'A')}${sequenceFlow('F2', 'A', 'B')}${sequenceFlow('F3', 'B', 'E')}${sequenceFlow('F4', 'BT', 'BE')}`,
      [
        shapeDi('S', 100, 182, 36, 36),
        shapeDi('A', 196, 160, 100, 80),
        shapeDi('B', 356, 160, 100, 80),
        shapeDi('E', 516, 182, 36, 36),
        shapeDi('BT', 388, 222, 36, 36),
        shapeDi('BE', 516, 322, 36, 36),
        shapeDi('AN', 356, 300, 100, 30),
        edgeDi('F1', [[136, 200], [196, 200]]),
        edgeDi('F2', [[296, 200], [356, 200]]),
        edgeDi('F3', [[456, 200], [516, 200]]),
        edgeDi('F4', [[406, 258], [406, 340], [516, 340]]),
        edgeDi('AS', [[400, 258], [400, 300]]),
      ].join(''),
    );
    const { result, before, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'N', after: 'A' }]);
    const dx = at(after, 'B').x - at(before, 'B').x;
    expect(dx).toBeGreaterThan(0);
    for (const id of ['BT', 'BE', 'AN']) expect(at(after, id), id).toEqual({ x: at(before, id).x + dx, y: at(before, id).y });
    expect(result.layout.metrics!.added).toEqual([]);
  });

  it('an annotation on a task inside a pushed sub-process moves with the sub-process', async () => {
    // S -> A -> SP -> E; the expanded sub-process SP holds SS -> T -> SE, the annotation AN under SP explains T
    const xml = drawnProcess(
      `<bpmn:startEvent id="S" /><bpmn:task id="A" name="A" /><bpmn:endEvent id="E" />
       <bpmn:subProcess id="SP" name="SP"><bpmn:startEvent id="SS" /><bpmn:task id="T" name="T" /><bpmn:endEvent id="SE" />${sequenceFlow('G1', 'SS', 'T')}${sequenceFlow('G2', 'T', 'SE')}</bpmn:subProcess>
       <bpmn:textAnnotation id="AN"><bpmn:text>check twice</bpmn:text></bpmn:textAnnotation><bpmn:association id="AS" sourceRef="T" targetRef="AN" />
       ${sequenceFlow('F1', 'S', 'A')}${sequenceFlow('F2', 'A', 'SP')}${sequenceFlow('F3', 'SP', 'E')}`,
      [
        shapeDi('S', 100, 182, 36, 36),
        shapeDi('A', 196, 160, 100, 80),
        shapeDi('SP', 356, 100, 350, 200, ' isExpanded="true"'),
        shapeDi('SS', 386, 182, 36, 36),
        shapeDi('T', 482, 160, 100, 80),
        shapeDi('SE', 642, 182, 36, 36),
        shapeDi('E', 766, 182, 36, 36),
        shapeDi('AN', 482, 340, 100, 30),
        edgeDi('G1', [[422, 200], [482, 200]]),
        edgeDi('G2', [[582, 200], [642, 200]]),
        edgeDi('F1', [[136, 200], [196, 200]]),
        edgeDi('F2', [[296, 200], [356, 200]]),
        edgeDi('F3', [[706, 200], [766, 200]]),
        edgeDi('AS', [[532, 240], [532, 340]]),
      ].join(''),
    );
    const { result, before, after } = await run(xml, [{ op: 'add', kind: 'task', id: 'N', name: 'N', after: 'A' }]);
    const dx = at(after, 'SP').x - at(before, 'SP').x;
    expect(dx).toBeGreaterThan(0);
    for (const id of ['T', 'E', 'AN']) expect(at(after, id), id).toEqual({ x: at(before, id).x + dx, y: at(before, id).y });
    expect(result.layout.metrics!.added).toEqual([]);
  });
});

describe('a pool grows only as far as its content reaches', () => {
  /** the branches model in a pool: the main row in lane Main, the row below in lane Rejection */
  const pooled = (): string => {
    const lane = (id: string, refs: string[]): string => `<bpmn:lane id="${id}">${refs.map((ref) => `<bpmn:flowNodeRef>${ref}</bpmn:flowNodeRef>`).join('')}</bpmn:lane>`;
    const xml = branches()
      .replace('<bpmn:process id="P">', `<bpmn:collaboration id="Collab"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>\n<bpmn:process id="P"><bpmn:laneSet id="LS">${lane('Main', ['S', 'A', 'G', 'B', 'C', 'E'])}${lane('Rejection', ['R', 'RE'])}</bpmn:laneSet>`)
      .replace('bpmnElement="P">', `bpmnElement="Collab">${shapeDi('Pool', 40, 120, 828, 300)}${shapeDi('Main', 70, 120, 798, 140)}${shapeDi('Rejection', 70, 260, 798, 160)}`);
    return xml.replace(/(bpmnElement="(?:Pool|Main|Rejection)")/g, '$1 isHorizontal="true"');
  };

  it('a task on the shorter lane leaves the pool as it is', async () => {
    const { result, before, after } = await run(pooled(), [{ op: 'add', kind: 'task', id: 'N', name: 'N', after: 'R' }]);
    expect(at(after, 'RE').x).toBe(786);
    for (const id of ['Pool', 'Main', 'Rejection']) expect(after.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    expect(result.layout.metrics!.added).toEqual([]);
  });

  it('a task on the row that reaches the border widens the pool and its lanes by the push, keeping the margin', async () => {
    const { result, before, after } = await run(pooled(), [{ op: 'add', kind: 'task', id: 'N', name: 'N', after: 'C' }]);
    const dx = at(after, 'E').x - at(before, 'E').x;
    expect(dx).toBeGreaterThan(0);
    for (const id of ['Pool', 'Main', 'Rejection']) expect(after.get(id)!.bounds.width, id).toBe(before.get(id)!.bounds.width + dx);
    expect(result.layout.metrics!.added).toEqual([]);
  });
});

describe('a new flow into a drawn node left of its source pushes the target', () => {
  it('connect: the target and what follows it move right of the source, the rest stays', async () => {
    const { result, before, after } = await run(branches(), [{ op: 'connect', source: 'C', target: 'R', id: 'Flow_CToR' }]);
    expect(at(after, 'R').x).toBeGreaterThanOrEqual(at(before, 'C').x + 100 + 40);
    expect(at(after, 'RE').x - at(after, 'R').x).toBe(at(before, 'RE').x - at(before, 'R').x);
    for (const id of ['S', 'A', 'G', 'B', 'C', 'E']) expect(at(after, id), id).toEqual(at(before, id));
    expect(result.layout.metrics!.added.map((problem) => problem.kind)).not.toContain('backwardFlow');
  });

  it('connect: a loop return leaves its target where it is', async () => {
    const { before, after } = await run(branches(), [{ op: 'connect', source: 'C', target: 'A', id: 'Flow_CToA' }]);
    for (const id of ['S', 'A', 'G', 'B', 'C', 'E', 'R', 'RE']) expect(at(after, id), id).toEqual(at(before, id));
  });

  it('a batch adding the source and the flow draws what the single commands draw', async () => {
    const ops = [
      { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_D', name: 'D?', after: 'B', before: 'C' },
      { op: 'connect', source: 'Gateway_D', target: 'R', id: 'Flow_DToR', name: 'no' },
    ];
    let single = branches();
    for (const op of ops) single = (await applyToXml(single, [op], { force: true })).xml;
    const batched = (await applyToXml(branches(), ops, { force: true })).xml;
    expect(shapeLines(batched)).toEqual(shapeLines(single));
    const after = shapes(await Doc.fromXml(batched));
    expect(after.get('R')!.bounds.x).toBeGreaterThan(after.get('Gateway_D')!.bounds.x + after.get('Gateway_D')!.bounds.width);
  });
});
