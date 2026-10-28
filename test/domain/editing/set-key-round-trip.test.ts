import { describe, expect, it } from 'vitest';
import { definitionsXml, docFromXml } from '../../helpers/helpers.js';
import { Properties } from '../../../src/domain/editing/properties/Properties.js';
import { ElementProperties } from '../../../src/domain/views/ElementProperties.js';
import { SET_KEYS } from '../../../src/domain/editing/properties/SetKeyCatalog.js';
import { EditSession } from '../../../src/domain/document/EditSession.js';

const PROCESS = definitionsXml(`
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_A"><bpmn:flowNodeRef>Task</bpmn:flowNodeRef><bpmn:flowNodeRef>Start</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Lane_B"><bpmn:flowNodeRef>Gateway</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start"><bpmn:outgoing>Flow_Start</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_Start" sourceRef="Start" targetRef="Task" />
    <bpmn:task id="Task"><bpmn:incoming>Flow_Start</bpmn:incoming><bpmn:outgoing>Flow_Gateway</bpmn:outgoing></bpmn:task>
    <bpmn:sequenceFlow id="Flow_Gateway" sourceRef="Task" targetRef="Gateway" />
    <bpmn:exclusiveGateway id="Gateway"><bpmn:incoming>Flow_Gateway</bpmn:incoming><bpmn:outgoing>Flow_Yes</bpmn:outgoing><bpmn:outgoing>Flow_No</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="Flow_Yes" sourceRef="Gateway" targetRef="Send" />
    <bpmn:sequenceFlow id="Flow_No" sourceRef="Gateway" targetRef="Rule" />
    <bpmn:sendTask id="Send"><bpmn:incoming>Flow_Yes</bpmn:incoming></bpmn:sendTask>
    <bpmn:businessRuleTask id="Rule"><bpmn:incoming>Flow_No</bpmn:incoming></bpmn:businessRuleTask>
    <bpmn:subProcess id="Sub" />
    <bpmn:adHocSubProcess id="AdHoc" />
    <bpmn:endEvent id="End" />`);

const SPECIAL_KEY_CASES: Array<{ key: string; elementId: string; value: string; readBack: Record<string, unknown> }> = [
  { key: 'id', elementId: 'Task', value: 'Task_Renamed', readBack: { id: 'Task_Renamed' } },
  { key: 'name', elementId: 'Task', value: 'Check order', readBack: { name: 'Check order' } },
  { key: 'doc', elementId: 'Task', value: 'Checks the order', readBack: { doc: 'Checks the order' } },
  { key: 'condition', elementId: 'Flow_Yes', value: '${ok}', readBack: { condition: '${ok}' } },
  { key: 'default', elementId: 'Flow_No', value: 'true', readBack: { default: true } },
  { key: 'default', elementId: 'Gateway', value: 'Flow_No', readBack: { default: 'Flow_No' } },
  { key: 'source', elementId: 'Flow_Gateway', value: 'Start', readBack: { source: 'Start' } },
  { key: 'target', elementId: 'Flow_Gateway', value: 'End', readBack: { target: 'End' } },
  { key: 'trigger', elementId: 'End', value: 'terminate', readBack: { trigger: 'terminate' } },
  { key: 'timer', elementId: 'Start', value: 'PT5M', readBack: { trigger: 'timer', timer: 'PT5M' } },
  { key: 'message', elementId: 'Start', value: 'Order received', readBack: { trigger: 'message', message: 'Order received' } },
  { key: 'loop', elementId: 'Task', value: 'sequential', readBack: { loop: 'sequential' } },
  { key: 'cardinality', elementId: 'Task', value: '3', readBack: { loop: 'parallel', cardinality: '3' } },
  { key: 'completion', elementId: 'Task', value: '${done}', readBack: { completion: '${done}' } },
  { key: 'completion', elementId: 'AdHoc', value: '${allDone}', readBack: { completion: '${allDone}' } },
  { key: 'expanded', elementId: 'Sub', value: 'false', readBack: { expanded: false } },
  { key: 'message', elementId: 'Send', value: 'Invoice', readBack: { message: 'Invoice' } },
  { key: 'calledDecision', elementId: 'Rule', value: 'Decision_Price', readBack: { calledDecision: 'Decision_Price' } },
  { key: 'lane', elementId: 'Gateway', value: 'Lane_A', readBack: { lane: 'Lane_A' } },
];

describe('set keys round trip', () => {
  it.each(SPECIAL_KEY_CASES)('set $key=$value on $elementId reads back', async ({ key, elementId, value, readBack }) => {
    const doc = await docFromXml(PROCESS);
    new Properties(new EditSession(doc)).set({ op: 'set', id: elementId, values: { [key]: value } });
    const shownId = key === 'id' ? value : elementId;
    expect(new ElementProperties(doc).read(doc.require(shownId))).toMatchObject(readBack);
  });

  it('covers every key that set writes itself', () => {
    const writtenKeys = new Set(SET_KEYS.filter((definition) => definition.write).map((definition) => definition.key));
    const testedKeys = new Set(SPECIAL_KEY_CASES.map((testCase) => testCase.key));
    expect([...writtenKeys].filter((key) => !testedKeys.has(key))).toEqual([]);
  });
});
