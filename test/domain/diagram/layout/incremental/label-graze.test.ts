/**
 * Once the labels are settled, a kept association that a node placed in this run or its label
 * touches is routed again, and the new labels its line still runs over step aside
 * (src/domain/diagram/layout/incremental/IncrementalRouting.ts `routeGrazed`): the last node's
 * label is placed after the routing, and a crossing repair route may run over one.
 *  - a single `add exclusiveGateway` whose label lands 1.4 px below a kept diagonal association:
 *    the association leaves it, as when the gateway is placed in a batch
 *  - a repair route of a data association runs over the label of a new end event (public
 *    scenario): the label steps aside
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyToXml } from '../../../../../src/api.js';
import { Doc } from '../../../../../src/domain/document/Doc.js';
import { pathHits } from '../../../../../src/domain/diagram/utils/geom.js';
import { mutateDoc } from '../../../../../src/index.js';
import { DI_NS, edges, shapes } from '../../../../helpers/drawing.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

/** S -> A on a row; the note N's association runs diagonally to the data object D above A */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DI_NS} id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:task id="A" name="A" /><bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" />
<bpmn:dataObjectReference id="D" dataObjectRef="DO" /><bpmn:dataObject id="DO" />
<bpmn:textAnnotation id="N"><bpmn:text>note</bpmn:text></bpmn:textAnnotation><bpmn:association id="AS" sourceRef="N" targetRef="D" /></bpmn:process>
<bpmndi:BPMNDiagram id="DG"><bpmndi:BPMNPlane id="PL" bpmnElement="P">
<bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="A_di" bpmnElement="A"><dc:Bounds x="196" y="78" width="100" height="80" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="N_di" bpmnElement="N"><dc:Bounds x="620" y="40" width="100" height="30" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="D_di" bpmnElement="D"><dc:Bounds x="150" y="30" width="36" height="50" /></bpmndi:BPMNShape>
<bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="136" y="118" /><di:waypoint x="196" y="118" /></bpmndi:BPMNEdge>
<bpmndi:BPMNEdge id="AS_di" bpmnElement="AS"><di:waypoint x="620" y="50" /><di:waypoint x="186" y="62" /></bpmndi:BPMNEdge>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

describe('a kept association a new label touches is routed again once the labels are settled', () => {
  it("a single gateway's label below a diagonal association: the association leaves it", async () => {
    const result = await mutateDoc(await Doc.fromXml(XML), [{ op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'Order approved?', after: 'A' }], { dryRun: true, layout: 'incremental' });
    const after = await Doc.fromXml(result.xml);
    const before = shapes(await Doc.fromXml(XML));
    const gateway = shapes(after).get('G')!;
    expect(result.layout.rerouted).toContain('AS');
    expect(pathHits(edges(after).get('AS')!.points, gateway.label!, -3)).toBe(false);
    for (const id of ['N', 'D']) expect(shapes(after).get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    expect(result.layout.metrics!.added).toEqual([]);
  });

  it('a repair route over the label of a new end event: the label steps aside (public scenario)', async () => {
    let xml = readFileSync(join(ROOT, 'tools', 'scenarios', 'artifacts__04b-data-crossscope.bpmn'), 'utf8');
    xml = (await applyToXml(xml, [{ op: 'remove', ids: ['Activity_Collect'] }], { force: true })).xml;
    xml = (await applyToXml(xml, [{ op: 'add', kind: 'userTask', id: 'Activity_BenchE1', name: 'Bench inserted task', after: 'Activity_Inform' }], { force: true })).xml;
    const applied = await applyToXml(
      xml,
      [
        { op: 'add', kind: 'boundaryEvent:timer', id: 'Event_BenchE4', name: 'Bench timeout', on: 'Activity_Score', timer: 'PT1H' },
        { op: 'add', kind: 'endEvent', id: 'Event_BenchE4End', name: 'Bench timed out', after: 'Event_BenchE4' },
      ],
      { force: true },
    );
    const after = await Doc.fromXml(applied.xml);
    expect(applied.result.layout?.rerouted).toContain('DataInputAssociation_1');
    expect(pathHits(edges(after).get('DataInputAssociation_1')!.points, shapes(after).get('Event_BenchE4End')!.label!, -1)).toBe(false);
    expect(applied.result.layout?.metrics?.added.filter((problem) => problem.kind === 'labelOnLine')).toEqual([]);
  });
});
