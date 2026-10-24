/**
 * src/diagram/PlaneCheckpoint.ts: the undo of a trial move, shared by the
 * incremental layout and the format ops.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model/Doc.js';
import { readPlanes } from '../src/diagram/plane.js';
import { PlaneCheckpoint } from '../src/diagram/PlaneCheckpoint.js';
import { BPMN_NS } from './helpers.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="${BPMN_NS}" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="D" targetNamespace="x">
  <bpmn:process id="P">
    <bpmn:startEvent id="S"><bpmn:outgoing>F</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T"><bpmn:incoming>F</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="F" sourceRef="S" targetRef="T" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Dia"><bpmndi:BPMNPlane id="Plane" bpmnElement="P">
    <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T_di" bpmnElement="T"><dc:Bounds x="200" y="78" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F_di" bpmnElement="F"><di:waypoint x="136" y="118" /><di:waypoint x="200" y="118" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const planeOf = async () => readPlanes((await Doc.fromXml(XML)).definitions)[0]!;

describe('PlaneCheckpoint', () => {
  it('drops a label that was added after the checkpoint', async () => {
    const plane = await planeOf();
    const start = plane.shapes.get('S')!;
    const checkpoint = new PlaneCheckpoint(plane);
    start.label = { x: 90, y: 140, width: 50, height: 14 };
    checkpoint.restore();
    expect(start.label).toBeUndefined();
  });

  it('restores bounds and waypoints changed in place, also a second time', async () => {
    const plane = await planeOf();
    const task = plane.shapes.get('T')!;
    const flow = plane.edges.get('F')!;
    const checkpoint = new PlaneCheckpoint(plane);
    task.bounds.x += 50;
    flow.points[1]!.x += 50;
    checkpoint.restore();
    task.bounds.x += 70;
    checkpoint.restore();
    expect(task.bounds).toEqual({ x: 200, y: 78, width: 100, height: 80 });
    expect(flow.points[1]).toEqual({ x: 200, y: 118 });
    expect(checkpoint.boundsOf(task)).toEqual({ x: 200, y: 78, width: 100, height: 80 });
  });
});
