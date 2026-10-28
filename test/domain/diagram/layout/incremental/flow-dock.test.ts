/**
 * An association docked on a flow, when no straight line reaches the flow, is routed to the middle
 * of every segment and keeps the route crossing the fewest lines, not the route to the segment
 * nearest the annotation (src/domain/diagram/layout/incremental/EdgeRouter.ts `flowDock`):
 *  - a note on a loop under the row: the loop's near segment lies behind two flows going down, the
 *    association docks on another segment of the loop across one line
 *  - the public scenario: 'Max 3 iterations' on the loop of Approved? no longer crosses both new
 *    branches of the added gateway and timer
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyToXml } from '../../../../../src/api.js';
import { Doc } from '../../../../../src/domain/document/Doc.js';
import { crossings } from '../../../../../src/domain/diagram/utils/routing.js';
import type { Point } from '../../../../../src/domain/diagram/utils/geom.js';
import { mutateDoc } from '../../../../../src/index.js';
import { DI_NS, edgeDi, edges, shapeDi } from '../../../../helpers/drawing.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

/** S -> A -> G -> B -> H -> E on a row, the loop L from G back into A below it, B and H branch down to D and C; the note N top right */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DI_NS} id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:task id="A" /><bpmn:exclusiveGateway id="G" /><bpmn:task id="B" /><bpmn:exclusiveGateway id="H" /><bpmn:endEvent id="E" /><bpmn:task id="C" /><bpmn:task id="D" />
<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" /><bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="G" /><bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="B" /><bpmn:sequenceFlow id="F4" sourceRef="B" targetRef="H" />
<bpmn:sequenceFlow id="F5" sourceRef="H" targetRef="E" /><bpmn:sequenceFlow id="F6" sourceRef="H" targetRef="C" /><bpmn:sequenceFlow id="F7" sourceRef="B" targetRef="D" /><bpmn:sequenceFlow id="L" sourceRef="G" targetRef="A" />
<bpmn:textAnnotation id="N"><bpmn:text>note</bpmn:text></bpmn:textAnnotation></bpmn:process>
<bpmndi:BPMNDiagram id="DG"><bpmndi:BPMNPlane id="PL" bpmnElement="P">
${shapeDi('S', 100, 182, 36, 36)}${shapeDi('A', 200, 160, 100, 80)}${shapeDi('G', 350, 175, 50, 50)}${shapeDi('B', 420, 160, 100, 80)}${shapeDi('H', 600, 175, 50, 50)}${shapeDi('E', 700, 182, 36, 36)}
${shapeDi('C', 700, 305, 100, 80)}${shapeDi('D', 550, 440, 100, 80)}${shapeDi('N', 900, 50, 100, 30)}
${edgeDi('F1', [[136, 200], [200, 200]])}${edgeDi('F2', [[300, 200], [350, 200]])}${edgeDi('F3', [[400, 200], [420, 200]])}${edgeDi('F4', [[520, 200], [600, 200]])}${edgeDi('F5', [[650, 200], [700, 200]])}
${edgeDi('F6', [[625, 225], [625, 345], [700, 345]])}${edgeDi('F7', [[470, 240], [470, 480], [550, 480]])}${edgeDi('L', [[375, 225], [375, 300], [250, 300], [250, 240]])}
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

const onLine = (point: Point, line: readonly Point[]): boolean =>
  line.some((start, index) => {
    const end = line[index + 1];
    return !!end && Math.min(start.x, end.x) <= point.x && point.x <= Math.max(start.x, end.x) && Math.min(start.y, end.y) <= point.y && point.y <= Math.max(start.y, end.y);
  });

describe('an association docks on the segment of a flow its route crosses the fewest lines to', () => {
  it('a note on a loop behind two branches docks across one line, on the loop', async () => {
    const result = await mutateDoc(await Doc.fromXml(XML), [{ op: 'connect', source: 'N', target: 'L', id: 'AS' }], { dryRun: true, layout: 'incremental' });
    const drawn = edges(await Doc.fromXml(result.xml));
    const line = drawn.get('AS')!.points;
    const others = [...drawn.values()].filter((edge) => edge.id !== 'AS').map((edge) => edge.points);
    // the loop's segment nearest the note lies behind F6 and F7
    expect(crossings(line, others)).toBeLessThanOrEqual(1);
    expect(onLine(line[line.length - 1]!, drawn.get('L')!.points)).toBe(true);
  });

  it("'Max 3 iterations' on the loop crosses at most one of the new branches (public scenario)", async () => {
    const xml = readFileSync(join(ROOT, 'tools', 'scenarios', 'artifacts__16-annotations-events-loop.bpmn'), 'utf8');
    const ops = [
      { op: 'add', kind: 'userTask', id: 'Activity_BenchE8', name: 'Bench approval', flow: 'Flow_4' },
      { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_BenchE8', name: 'Bench approved?', after: 'Activity_BenchE8', before: 'Activity_Publish' },
      { op: 'add', kind: 'sendTask', id: 'Activity_BenchE8No', name: 'Bench rejection', after: 'Gateway_BenchE8', flowName: 'no' },
      { op: 'add', kind: 'endEvent', id: 'Event_BenchE8NoEnd', name: 'Bench rejected', after: 'Activity_BenchE8No' },
      { op: 'add', kind: 'boundaryEvent:timer', id: 'Event_BenchE9Timer', name: 'Bench 3 days', on: 'Activity_BenchE8', timer: 'P3D', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', id: 'Activity_BenchE9Remind', name: 'Bench reminder', after: 'Event_BenchE9Timer' },
      { op: 'add', kind: 'endEvent', id: 'Event_BenchE9Reminded', name: 'Bench reminded', after: 'Activity_BenchE9Remind' },
    ];
    const applied = await applyToXml(xml, ops, { force: true });
    expect(applied.result.layout?.mode).toBe('incremental');
    const crossed = (applied.result.layout?.metrics?.added ?? []).filter((problem) => problem.kind === 'crossings' && problem.ids.includes('Association_3'));
    expect(crossed.length).toBeLessThanOrEqual(1);
  });
});
