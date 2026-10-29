/**
 * A kept association that a node placed in this run or its label touches is routed again, and not
 * along the same straight line (src/domain/diagram/layout/incremental/IncrementalRouting.ts,
 * EdgeRouter.ts `touchesFresh`):
 *  - a diagonal passing 2 px beside a new task leaves it; the annotation and the data object stay
 *  - a line 1.5 px above a new gateway's label leaves it (the gateway is placed in a batch)
 *  - one passing 6 px beside the new task is kept
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../../../../../src/domain/document/Doc.js';
import { pathHits, type Box } from '../../../../../src/domain/diagram/utils/geom.js';
import { mutateDoc } from '../../../../../src/index.js';
import { DI_NS, edgeDi, edges, shapeDi, shapes } from '../../../../helpers/drawing.js';


/** S -> A on a row; the note N's association runs to the data object D along `line` */
const drawing = (note: Box, data: Box, line: Array<[number, number]>): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DI_NS} id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:task id="A" name="A" /><bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" />
<bpmn:dataObjectReference id="D" dataObjectRef="DO" /><bpmn:dataObject id="DO" />
<bpmn:textAnnotation id="N"><bpmn:text>note</bpmn:text></bpmn:textAnnotation><bpmn:association id="AS" sourceRef="N" targetRef="D" /></bpmn:process>
<bpmndi:BPMNDiagram id="DG"><bpmndi:BPMNPlane id="PL" bpmnElement="P">
${shapeDi('S', 100, 100, 36, 36)}${shapeDi('A', 196, 78, 100, 80)}${shapeDi('N', note.x, note.y, note.width, note.height)}${shapeDi('D', data.x, data.y, data.width, data.height)}
${edgeDi('F1', [[136, 118], [196, 118]])}${edgeDi('AS', line)}
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

const run = async (xml: string, ops: object[]) => {
  const result = await mutateDoc(await Doc.fromXml(xml), ops, { dryRun: true, layout: 'incremental' });
  const after = await Doc.fromXml(result.xml);
  return { result, before: shapes(await Doc.fromXml(xml)), after: shapes(after), line: edges(after).get('AS')!.points };
};

describe('a kept association a new node touches is routed again', () => {
  it('a diagonal 2 px beside a new task goes around it; the annotation and the data object stay', async () => {
    const xml = drawing({ x: 517, y: 20, width: 120, height: 30 }, { x: 300, y: 280, width: 36, height: 50 }, [[563, 50], [336, 286]]);
    const { result, before, after, line } = await run(xml, [{ op: 'add', kind: 'task', id: 'T', name: 'T', after: 'A' }]);
    expect(after.get('T')!.bounds).toMatchObject({ x: 356, y: 78 });
    expect(result.layout.rerouted).toContain('AS');
    expect(pathHits(line, after.get('T')!.bounds, -3)).toBe(false);
    for (const id of ['N', 'D']) {
      expect(after.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    }
  });

  it("a line 1.5 px above a new gateway's label leaves it", async () => {
    const xml = drawing({ x: 620, y: 40, width: 100, height: 30 }, { x: 150, y: 30, width: 36, height: 50 }, [[620, 50], [186, 62]]);
    const { result, before, after, line } = await run(xml, [
      { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'Order approved?', after: 'A' },
      { op: 'add', kind: 'task', id: 'Y', name: 'Y', after: 'G' },
      { op: 'add', kind: 'task', id: 'R', name: 'R', after: 'G', flowName: 'no' },
    ]);
    const label = after.get('G')!.label!;
    expect(label.y + label.height).toBeLessThan(after.get('G')!.bounds.y);
    expect(result.layout.rerouted).toContain('AS');
    expect(pathHits(line, label, -3)).toBe(false);
    for (const id of ['N', 'D']) {
      expect(after.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    }
    expect(result.layout.metrics!.added).toEqual([]);
  });

  it('one 6 px beside the new task is kept', async () => {
    const points: Array<[number, number]> = [[571, 50], [336, 287]];
    const xml = drawing({ x: 526, y: 20, width: 120, height: 30 }, { x: 300, y: 280, width: 36, height: 50 }, points);
    const { result, line } = await run(xml, [{ op: 'add', kind: 'task', id: 'T', name: 'T', after: 'A' }]);
    expect(result.layout.rerouted).not.toContain('AS');
    expect(line.map((point) => [point.x, point.y])).toEqual(points);
  });
});
