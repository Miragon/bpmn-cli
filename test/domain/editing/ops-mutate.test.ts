import { describe, expect, it } from 'vitest';
import { Doc } from '../../../src/domain/document/Doc.js';
import { isBpmnError } from '../../../src/domain/document/utils/errors.js';
import { is, many, type El } from '../../../src/domain/document/utils/moddle.js';
import { listExtensions } from '../../../src/index.js';
import { ExtensionElements } from '../../../src/domain/editing/extensions/ExtensionElements.js';
import { ElementOrder } from '../../../src/domain/editing/elements/ElementOrder.js';
import { IdRename } from '../../../src/domain/editing/ids/IdRename.js';
import { ChangeSet } from '../../../src/domain/document/ChangeSet.js';
import { definitionsXml, docFromXml, linearDoc } from '../../helpers/helpers.js';
import { ElementRemoval } from '../../../src/domain/editing/elements/ElementRemoval.js';
import { ElementTypeChange } from '../../../src/domain/editing/elements/ElementTypeChange.js';
import { ElementMove } from '../../../src/domain/editing/elements/ElementMove.js';
import { Properties } from '../../../src/domain/editing/properties/Properties.js';
import { ElementProperties } from '../../../src/domain/views/ElementProperties.js';
import { SET_KEYS } from '../../../src/domain/editing/properties/SetKeyCatalog.js';
import { EditSession } from '../../../src/domain/document/EditSession.js';
import { typeRequest } from '../../../src/domain/document/utils/requests.js';

/* ------------------------------------------------------------------ */
/* fixtures                                                             */
/* ------------------------------------------------------------------ */

const CAMUNDA = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE = 'http://camunda.org/schema/zeebe/1.0';

/** Two pools, lanes, gateway, boundary event, sub-process, call activity, data object, annotation. */
const FULL = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="${CAMUNDA}" xmlns:zeebe="${ZEEBE}" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="P_Shop" name="Shop" processRef="Process_1" />
    <bpmn:participant id="P_Customer" name="Customer" processRef="Process_2" />
    <bpmn:messageFlow id="MF1" sourceRef="Task_Send" targetRef="P_Customer" />
    <bpmn:messageFlow id="MF2" sourceRef="P_Customer" targetRef="Task_B" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Sales" name="Sales">
        <bpmn:flowNodeRef>Start</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_A</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Timer_A</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gw</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Ops" name="Ops">
        <bpmn:flowNodeRef>Task_B</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Send</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Remind</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Sub</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Call</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start" name="Started"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task_A" />
    <bpmn:userTask id="Task_A" name="Do A" camunda:assignee="alice">
      <bpmn:extensionElements><zeebe:taskDefinition type="a" /></bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:dataOutputAssociation id="DOA1"><bpmn:targetRef>DOR_Order</bpmn:targetRef></bpmn:dataOutputAssociation>
    </bpmn:userTask>
    <bpmn:boundaryEvent id="Timer_A" attachedToRef="Task_A"><bpmn:outgoing>F_T</bpmn:outgoing>
      <bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_T" sourceRef="Timer_A" targetRef="Task_Remind" />
    <bpmn:task id="Task_Remind" name="Remind"><bpmn:incoming>F_T</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="F2" sourceRef="Task_A" targetRef="Gw" />
    <bpmn:exclusiveGateway id="Gw" name="Ok?" default="F_no"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F_yes</bpmn:outgoing><bpmn:outgoing>F_no</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="F_yes" name="yes" sourceRef="Gw" targetRef="Task_B"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${ok}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_no" name="no" sourceRef="Gw" targetRef="Task_Send" />
    <bpmn:serviceTask id="Task_B" name="B"><bpmn:incoming>F_yes</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing>
      <bpmn:property id="Prop_B" name="__targetRef_placeholder" />
      <bpmn:dataInputAssociation id="DIA1"><bpmn:sourceRef>DOR_Order</bpmn:sourceRef><bpmn:targetRef>Prop_B</bpmn:targetRef></bpmn:dataInputAssociation>
    </bpmn:serviceTask>
    <bpmn:sequenceFlow id="F3" sourceRef="Task_B" targetRef="Sub" />
    <bpmn:sendTask id="Task_Send" name="Send"><bpmn:incoming>F_no</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing></bpmn:sendTask>
    <bpmn:sequenceFlow id="F4" sourceRef="Task_Send" targetRef="Sub" />
    <bpmn:subProcess id="Sub" name="Sub"><bpmn:incoming>F3</bpmn:incoming><bpmn:incoming>F4</bpmn:incoming><bpmn:outgoing>F5</bpmn:outgoing>
      <bpmn:startEvent id="SubStart"><bpmn:outgoing>SF1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:sequenceFlow id="SF1" sourceRef="SubStart" targetRef="SubTask" />
      <bpmn:task id="SubTask" name="Inner"><bpmn:incoming>SF1</bpmn:incoming><bpmn:outgoing>SF2</bpmn:outgoing></bpmn:task>
      <bpmn:sequenceFlow id="SF2" sourceRef="SubTask" targetRef="SubEnd" />
      <bpmn:endEvent id="SubEnd"><bpmn:incoming>SF2</bpmn:incoming></bpmn:endEvent>
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F5" sourceRef="Sub" targetRef="Call" />
    <bpmn:callActivity id="Call" name="Call customer" calledElement="Process_2"><bpmn:incoming>F5</bpmn:incoming><bpmn:outgoing>F6</bpmn:outgoing></bpmn:callActivity>
    <bpmn:sequenceFlow id="F6" sourceRef="Call" targetRef="End" />
    <bpmn:endEvent id="End" name="Done"><bpmn:incoming>F6</bpmn:incoming></bpmn:endEvent>
    <bpmn:dataObjectReference id="DOR_Order" name="Order" dataObjectRef="DO_Order" />
    <bpmn:dataObject id="DO_Order" />
    <bpmn:textAnnotation id="Note_1"><bpmn:text>hello</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="Assoc_1" sourceRef="Task_A" targetRef="Note_1" />
  </bpmn:process>
  <bpmn:process id="Process_2" isExecutable="false">
    <bpmn:startEvent id="C_Start"><bpmn:outgoing>CF1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="CF1" sourceRef="C_Start" targetRef="C_Task" />
    <bpmn:task id="C_Task" name="Customer task"><bpmn:incoming>CF1</bpmn:incoming></bpmn:task>
  </bpmn:process>
  <bpmn:message id="Message_Order" name="OrderReceived" />
</bpmn:definitions>`;

const fullDoc = (): Promise<Doc> => docFromXml(FULL);

function ids(els: El[] | undefined): string[] {
  return (els ?? []).map((element) => element.get<string>('id'));
}

function flowElementIds(scope: El): string[] {
  return ids(many(scope, 'flowElements'));
}

/** Serialises and re-parses: the XML must import without any warning. */
async function expectRoundTrip(doc: Doc): Promise<Doc> {
  const xml = await doc.toXml();
  const again = await Doc.fromXml(xml);
  expect(again.importWarnings.map((warning) => warning.message)).toEqual([]);
  return again;
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (isBpmnError(err)) return err.code;
    throw err;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* set                                                                  */
/* ------------------------------------------------------------------ */

describe('set: generic keys', () => {
  it('sets name and documentation, and unsets with empty values', async () => {
    const doc = await linearDoc();
    const cs = new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { name: 'Check invoice', doc: 'Look at it carefully' } });
    const task = doc.require('Task_A');
    expect(task.get('name')).toBe('Check invoice');
    expect(many(task, 'documentation')[0]!.get('text')).toBe('Look at it carefully');
    expect(cs.changed.map((change) => change.detail)).toEqual(['name=Check invoice', 'doc=Look at it carefully']);
    expect(cs.changed[0]!.kind).toBe('userTask');
    const xml = await doc.toXml();
    expect(xml).toContain('<bpmn:documentation>Look at it carefully</bpmn:documentation>');
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { name: '' }, unset: ['documentation'] });
    expect(task.get('name')).toBeUndefined();
    expect(many(task, 'documentation')).toHaveLength(0);
    await expectRoundTrip(doc);
  });

  it('sets typed moddle attributes with descriptor validation (boolean, integer, enum, reference)', async () => {
    const doc = await fullDoc();
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Process_1', values: { isExecutable: 'false' } });
    expect(doc.require('Process_1').get('isExecutable')).toBe(false);
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { completionQuantity: '2', isForCompensation: 'yes' } });
    expect(doc.require('Task_A').get('completionQuantity')).toBe(2);
    expect(doc.require('Task_A').get('isForCompensation')).toBe(true);
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Gw', values: { gatewayDirection: 'diverging' } });
    expect(doc.require('Gw').get('gatewayDirection')).toBe('Diverging');
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Call', values: { calledElement: 'Other' } });
    expect(doc.require('Call').get('calledElement')).toBe('Other');
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'MF1', values: { messageRef: 'Message_Order' } });
    expect(doc.require('MF1').get<El>('messageRef').get('id')).toBe('Message_Order');
    const xml = await doc.toXml();
    expect(xml).toContain('gatewayDirection="Diverging"');
    expect(xml).toContain('isExecutable="false"');
    expect(xml).toContain('messageRef="Message_Order"');
    await expectRoundTrip(doc);
  });

  it('rejects invalid enum / boolean / integer values', async () => {
    const doc = await fullDoc();
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Gw', values: { gatewayDirection: 'sideways' } }))).toBe('E_INVALID_VALUE');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Process_1', values: { isExecutable: 'maybe' } }))).toBe('E_INVALID_VALUE');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { completionQuantity: 'two' } }))).toBe('E_INVALID_VALUE');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'MF1', values: { messageRef: 'Nope' } }))).toBe('E_NOT_FOUND');
    expect(Object.keys(new ElementProperties(doc).read(doc.require('Gw')))).not.toContain('gatewayDirection');
  });

  it('sets vendor attributes and declares the namespace automatically', async () => {
    const doc = await linearDoc();
    expect(doc.definitions.$attrs['xmlns:camunda']).toBeUndefined();
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { 'camunda:assignee': 'bob', 'zeebe:modelerTemplate': 'tpl' } });
    expect(doc.require('Task_A').$attrs['camunda:assignee']).toBe('bob');
    expect(doc.definitions.$attrs['xmlns:camunda']).toBe(CAMUNDA);
    expect(doc.definitions.$attrs['xmlns:zeebe']).toBe(ZEEBE);
    const xml = await doc.toXml();
    expect(xml).toContain('camunda:assignee="bob"');
    expect(xml).toContain(`xmlns:camunda="${CAMUNDA}"`);
    const again = await expectRoundTrip(doc);
    expect(again.require('Task_A').$attrs['camunda:assignee']).toBe('bob');
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { 'camunda:assignee': '' } });
    expect(doc.require('Task_A').$attrs['camunda:assignee']).toBeUndefined();
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { 'acme:thing': '1' } }))).toBe('E_UNKNOWN_NAMESPACE');
  });

  it('rejects unknown keys listing the settable keys', async () => {
    const doc = await fullDoc();
    let caught: unknown;
    try {
      new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { colour: 'red' } });
    } catch (err) {
      caught = err;
    }
    expect(isBpmnError(caught) && caught.code).toBe('E_UNKNOWN_KEY');
    const candidates = isBpmnError(caught) ? (caught.details.candidates as string[]) : [];
    expect(candidates).toEqual(expect.arrayContaining(['name', 'doc', 'id', 'loop', 'lane', 'isForCompensation', 'completionQuantity']));
    expect(candidates).not.toContain('condition');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { condition: 'x' } }))).toBe('E_UNKNOWN_KEY');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { attachedToRef: 'Task_B' } }))).toBe('E_UNKNOWN_KEY');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: {} }))).toBe('E_USAGE');
    expect(SET_KEYS.some((setKey) => setKey.key === 'loop' && setKey.appliesTo === 'activity')).toBe(true);
  });
});

describe('set: flow keys', () => {
  it('sets condition (clearing default), language, default and redirects source/target', async () => {
    const doc = await fullDoc();
    const gw = doc.require('Gw');
    expect(gw.get<El>('default').get('id')).toBe('F_no');
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'F_no', values: { condition: '${!ok}', language: 'juel' } });
    const fNo = doc.require('F_no');
    expect(fNo.get<El>('conditionExpression').get('body')).toBe('${!ok}');
    expect(fNo.get<El>('conditionExpression').get('language')).toBe('juel');
    expect(gw.get('default')).toBeUndefined();

    new Properties(new EditSession(doc)).set({ op: 'set', id: 'F_yes', values: { default: 'true' } });
    expect(gw.get<El>('default').get('id')).toBe('F_yes');
    expect(doc.require('F_yes').get('conditionExpression')).toBeUndefined();
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'F_yes', values: { default: 'false' } });
    expect(gw.get('default')).toBeUndefined();
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Gw', values: { default: 'F_no' } });
    expect(gw.get<El>('default').get('id')).toBe('F_no');
    expect(fNo.get('conditionExpression')).toBeUndefined();
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Gw', values: { default: 'F1' } }))).toBe('E_NOT_OUTGOING');

    new Properties(new EditSession(doc)).set({ op: 'set', id: 'F_T', values: { target: 'Task_Send' } });
    const ft = doc.require('F_T');
    expect(ft.get<El>('targetRef').get('id')).toBe('Task_Send');
    expect(ids(doc.incoming(doc.require('Task_Remind')))).toEqual([]);
    expect(ids(doc.incoming(doc.require('Task_Send')))).toEqual(['F_no', 'F_T']);
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'F_T', values: { target: 'SubTask' } }))).toBe('E_CROSS_SCOPE');
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'F_no', values: { condition: '' } });
    expect(fNo.get('conditionExpression')).toBeUndefined();
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'F_no', values: { language: 'juel' } }))).toBe('E_NO_CONDITION');
    await expectRoundTrip(doc);
  });
});

describe('set: loop keys', () => {
  it('creates multi-instance / standard loop characteristics with expressions', async () => {
    const doc = await linearDoc();
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { loop: 'sequential', cardinality: '3', completion: '${done}' } });
    const task = doc.require('Task_A');
    const loop = task.get<El>('loopCharacteristics');
    expect(loop.$type).toBe('bpmn:MultiInstanceLoopCharacteristics');
    expect(loop.get('isSequential')).toBe(true);
    expect(loop.get<El>('loopCardinality').$type).toBe('bpmn:FormalExpression');
    expect(loop.get<El>('loopCardinality').get('body')).toBe('3');
    expect(loop.get<El>('completionCondition').get('body')).toBe('${done}');
    expect(loop.$parent).toBe(task);
    let xml = await doc.toXml();
    expect(xml).toContain('<bpmn:multiInstanceLoopCharacteristics isSequential="true">');
    expect(xml).toContain('xsi:type="bpmn:tFormalExpression">3</bpmn:loopCardinality>');
    await expectRoundTrip(doc);

    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { loop: 'parallel' } });
    expect(task.get<El>('loopCharacteristics')).toBe(loop);
    expect(loop.get('isSequential')).toBe(false);
    expect(new ElementProperties(doc).read(task)).toMatchObject({ loop: 'parallel', cardinality: '3', completion: '${done}' });

    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { loop: 'standard' } });
    expect(task.get<El>('loopCharacteristics').$type).toBe('bpmn:StandardLoopCharacteristics');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { cardinality: '2' } }))).toBe('E_INVALID_VALUE');
    xml = await doc.toXml();
    expect(xml).toContain('<bpmn:standardLoopCharacteristics />');

    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { loop: 'none' } });
    expect(task.get('loopCharacteristics')).toBeUndefined();
    const cs = new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { cardinality: '5' } });
    expect(task.get<El>('loopCharacteristics').get('isSequential')).toBe(false);
    expect(cs.notes[0]).toMatch(/parallel multi-instance/);
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { loop: 'weird' } }))).toBe('E_INVALID_VALUE');
    await expectRoundTrip(doc);
  });
});

describe('set: sub-process expansion', () => {
  it('records expansion requests per document', async () => {
    const doc = await fullDoc();
    expect(new ElementProperties(doc).read(doc.require('Sub'))['expanded']).toBe(true);
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Sub', values: { expanded: 'false' } });
    expect(doc.layoutRequests.expansion()).toEqual({ expand: [], collapse: ['Sub'] });
    expect(new ElementProperties(doc).read(doc.require('Sub'))['expanded']).toBe(false);
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Sub', values: { expanded: 'true' } });
    expect(doc.layoutRequests.expansion()).toEqual({ expand: ['Sub'], collapse: [] });
    expect(doc.layoutRequests.requested('Sub')).toBe(true);
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { expanded: 'false' } }))).toBe('E_UNKNOWN_KEY');
    const other = await linearDoc();
    expect(other.layoutRequests.expansion()).toEqual({ expand: [], collapse: [] });
  });
});

describe('set: event keys', () => {
  it('sets nonInterrupting directly on boundary events', async () => {
    const doc = await fullDoc();
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Timer_A', values: { nonInterrupting: 'true' } });
    expect(doc.require('Timer_A').get('cancelActivity')).toBe(false);
    expect(new ElementProperties(doc).read(doc.require('Timer_A'))).toMatchObject({ trigger: 'timer', timer: 'PT1H', nonInterrupting: true });
    const xml = await doc.toXml();
    expect(xml).toContain('cancelActivity="false"');
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Timer_A', values: { nonInterrupting: 'false' } });
    expect((await doc.toXml()).includes('cancelActivity')).toBe(false);
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Timer_A', values: { trigger: 'bogus' } }))).toBe('E_INVALID_VALUE');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Timer_A', values: { timer: 'PT1M', message: 'x' } }))).toBe('E_INVALID_VALUE');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'End', values: { trigger: 'timer' } }))).toBe('E_INVALID_TRIGGER');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { timer: 'PT1M' } }))).toBe('E_UNKNOWN_KEY');
  });

  it('changes triggers through applyTrigger (timer value, message, trigger=none)', async () => {
    const doc = await fullDoc();
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Timer_A', values: { timer: 'PT2D' } });
    expect(new ElementProperties(doc).read(doc.require('Timer_A'))).toMatchObject({ trigger: 'timer', timer: 'PT2D' });
    const cs = new Properties(new EditSession(doc)).set({ op: 'set', id: 'Timer_A', values: { message: 'Reminder' } });
    expect(new ElementProperties(doc).read(doc.require('Timer_A'))).toMatchObject({ trigger: 'message', message: 'Reminder' });
    expect(cs.changed[0]!.kind).toBe('boundaryEvent:message');
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Start', values: { trigger: 'none' } });
    expect(new ElementProperties(doc).read(doc.require('Start'))['trigger']).toBe('none');
    await expectRoundTrip(doc);
  });
});

describe('set: id rename', () => {
  it('renames an id and every reference, including calledElement strings', async () => {
    const doc = await fullDoc();
    const cs = new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { id: 'Activity_DoA' } });
    expect(cs.changed[0]).toMatchObject({ id: 'Activity_DoA', kind: 'userTask', detail: 'renamed from Task_A' });
    expect(doc.get('Task_A')).toBeUndefined();
    expect(doc.ids.has('Task_A')).toBe(false);
    expect(doc.ids.has('Activity_DoA')).toBe(true);
    const task = doc.require('Activity_DoA');
    expect(doc.require('F1').get<El>('targetRef')).toBe(task);
    expect(doc.require('Timer_A').get<El>('attachedToRef')).toBe(task);
    expect(ids(doc.require('Lane_Sales').get<El[]>('flowNodeRef'))).toContain('Activity_DoA');
    const xml = await doc.toXml();
    expect(xml).toContain('targetRef="Activity_DoA"');
    expect(xml).toContain('attachedToRef="Activity_DoA"');
    expect(xml).toContain('<bpmn:flowNodeRef>Activity_DoA</bpmn:flowNodeRef>');
    expect(xml).not.toContain('Task_A');

    new IdRename(new EditSession(doc)).rename(doc.require('Process_2'), 'Process_Customer');
    expect(doc.require('Call').get('calledElement')).toBe('Process_Customer');
    expect(doc.require('P_Customer').get<El>('processRef').get('id')).toBe('Process_Customer');

    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'End', values: { id: 'Start' } }))).toBe('E_DUPLICATE_ID');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'End', values: { id: '1bad id' } }))).toBe('E_INVALID_ID');
    expect(doc.require('End').get('id')).toBe('End');
    await expectRoundTrip(doc);
  });
});

describe('set: readProperties', () => {
  it('round-trips what set wrote', async () => {
    const doc = await fullDoc();
    new Properties(new EditSession(doc)).set({
      op: 'set',
      id: 'Task_A',
      values: { name: 'Do it', doc: 'docs', 'camunda:assignee': 'bob', isForCompensation: 'true', loop: 'sequential', cardinality: '2' },
    });
    const props = new ElementProperties(doc).read(doc.require('Task_A'));
    expect(props).toMatchObject({
      id: 'Task_A',
      name: 'Do it',
      doc: 'docs',
      'camunda:assignee': 'bob',
      isForCompensation: true,
      loop: 'sequential',
      cardinality: '2',
      lane: 'Lane_Sales',
    });
    expect(Object.keys(props)).not.toContain('xmlns:camunda');
    expect(new ElementProperties(doc).read(doc.require('F_yes'))).toEqual({ id: 'F_yes', name: 'yes', condition: '${ok}', source: 'Gw', target: 'Task_B' });
    expect(new ElementProperties(doc).read(doc.require('F_no'))).toMatchObject({ default: true });
    expect(new ElementProperties(doc).read(doc.require('Gw'))).toMatchObject({ default: 'F_no', lane: 'Lane_Sales' });
    expect(new ElementProperties(doc).read(doc.require('Call'))).toMatchObject({ calledElement: 'Process_2' });
    expect(new ElementProperties(doc).read(doc.require('Timer_A'))).toMatchObject({ trigger: 'timer', timer: 'PT1H' });
    expect(new ElementProperties(doc).read(doc.require('Process_1'))).toMatchObject({ isExecutable: true });
    expect(new ElementProperties(doc).read(doc.require('Note_1'))).toMatchObject({ text: 'hello' });
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Note_1', values: { text: 'changed' } });
    expect(doc.require('Note_1').get('text')).toBe('changed');
    // every read key is accepted by set again (round trip)
    const again = new ElementProperties(doc).read(doc.require('Task_A'));
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(again)) if (key !== 'id' && key !== 'lane') values[key] = String(value);
    expect(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values })).not.toThrow();
    expect(new ElementProperties(doc).read(doc.require('Task_A'))).toEqual(again);
  });
});

/* ------------------------------------------------------------------ */
/* remove                                                               */
/* ------------------------------------------------------------------ */

describe('remove', () => {
  it('removes a node with bridging and cascades boundary events, associations, lane refs and data associations', async () => {
    const doc = await fullDoc();
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Task_A'] });
    expect(doc.get('Task_A')).toBeUndefined();
    expect(doc.ids.has('Task_A')).toBe(false);
    const f1 = doc.require('F1');
    expect(f1.get<El>('targetRef').get('id')).toBe('Gw');
    expect(ids(doc.incoming(doc.require('Gw')))).toEqual(['F1']);
    expect(doc.get('F2')).toBeUndefined();
    expect(doc.get('Timer_A')).toBeUndefined();
    expect(doc.get('F_T')).toBeUndefined();
    expect(ids(doc.incoming(doc.require('Task_Remind')))).toEqual([]);
    expect(doc.get('Assoc_1')).toBeUndefined();
    expect(doc.get('Note_1')).toBeDefined();
    expect(doc.get('DOA1')).toBeUndefined();
    expect(doc.get('DOR_Order')).toBeDefined();
    expect(ids(doc.require('Lane_Sales').get<El[]>('flowNodeRef'))).toEqual(['Start', 'Gw']);
    expect(cs.removed.map((change) => change.id).sort()).toEqual(['Assoc_1', 'DOA1', 'F2', 'F_T', 'Task_A', 'Timer_A'].sort());
    expect(cs.removed.find((change) => change.id === 'Task_A')).toMatchObject({ kind: 'userTask', name: 'Do A' });
    expect(cs.removed.find((change) => change.id === 'Assoc_1')?.kind).toBe('association');
    expect(cs.removed.find((change) => change.id === 'DOA1')?.kind).toBe('dataAssociation');
    expect(cs.notes).toContain('bridged: Start -> Gw');
    expect(flowElementIds(doc.require('Process_1'))).not.toContain('Task_A');
    const xml = await doc.toXml();
    expect(xml).not.toContain('Task_A');
    await expectRoundTrip(doc);
  });

  it('removes a node without bridging', async () => {
    const doc = await linearDoc();
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Task_A'], bridge: false });
    expect(doc.get('F1')).toBeUndefined();
    expect(doc.get('F2')).toBeUndefined();
    expect(ids(doc.outgoing(doc.require('Start')))).toEqual([]);
    expect(ids(doc.incoming(doc.require('End')))).toEqual([]);
    expect(cs.removed.map((change) => change.id).sort()).toEqual(['F1', 'F2', 'Task_A']);
    expect(cs.notes).toEqual([]);
    await expectRoundTrip(doc);
  });

  it('removes a sub-process with its children (ids released) and a gateway default', async () => {
    const doc = await fullDoc();
    // Sub has two incoming flows: a plain remove would bridge them (a merge, see test/domain/editing/remove-join.test.ts)
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Sub'], bridge: false });
    for (const id of ['Sub', 'SubStart', 'SubTask', 'SubEnd', 'SF1', 'SF2', 'F3', 'F4', 'F5']) {
      expect(doc.get(id), id).toBeUndefined();
      expect(doc.ids.has(id), id).toBe(false);
    }
    expect(cs.removed.map((change) => change.id)).toEqual(expect.arrayContaining(['Sub', 'SubStart', 'SubTask', 'SubEnd', 'SF1', 'SF2', 'F3', 'F4', 'F5']));
    expect(cs.removed.find((change) => change.id === 'Sub')?.kind).toBe('subProcess');
    expect(ids(doc.outgoing(doc.require('Task_B')))).toEqual([]);
    expect(ids(doc.incoming(doc.require('Call')))).toEqual([]);
    expect(ids(doc.require('Lane_Ops').get<El[]>('flowNodeRef'))).not.toContain('Sub');
    // a new id follows the conventions, not the file's Task_* ids
    expect(new EditSession(doc).allocator.allocate(typeRequest('bpmn:Task', { name: 'Sub' })).id).toBe('task_sub');
    // a gateway default is cleared when the default flow goes
    new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['F_no'] });
    expect(doc.require('Gw').get('default')).toBeUndefined();
    await expectRoundTrip(doc);
  });

  it('removes lanes (members unassigned, empty lane set dropped)', async () => {
    const doc = await fullDoc();
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Lane_Sales'] });
    expect(doc.get('Lane_Sales')).toBeUndefined();
    expect(doc.get('Start')).toBeDefined();
    expect(ids(doc.lanesOf(doc.require('Start')))).toEqual([]);
    expect(ids(many(doc.require('LaneSet_1'), 'lanes'))).toEqual(['Lane_Ops']);
    expect(cs.removed).toEqual([{ id: 'Lane_Sales', kind: 'lane', name: 'Sales' }]);
    new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Lane_Ops'] });
    expect(doc.get('LaneSet_1')).toBeUndefined();
    expect(many(doc.require('Process_1'), 'laneSets')).toHaveLength(0);
    expect((await doc.toXml()).includes('laneSet')).toBe(false);
    await expectRoundTrip(doc);
  });

  it('removes a participant with its process and message flows; the collaboration goes with the last one', async () => {
    const doc = await fullDoc();
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['P_Customer'] });
    for (const id of ['P_Customer', 'Process_2', 'C_Start', 'C_Task', 'CF1', 'MF1', 'MF2']) expect(doc.get(id), id).toBeUndefined();
    expect(doc.get('Collab')).toBeDefined();
    expect(ids(doc.participants())).toEqual(['P_Shop']);
    expect(doc.messageFlows()).toHaveLength(0);
    expect(cs.removed.find((change) => change.id === 'P_Customer')?.kind).toBe('participant');
    expect(cs.removed.find((change) => change.id === 'MF1')?.kind).toBe('messageFlow');
    expect(cs.removed.find((change) => change.id === 'Process_2')?.kind).toBe('process');
    expect(cs.warnings.map((warning) => warning.code)).toContain('W_DANGLING_CALLED_ELEMENT');
    await expectRoundTrip(doc);

    const cs2 = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['P_Shop'] });
    expect(doc.collaboration()).toBeUndefined();
    expect(doc.get('Process_1')).toBeUndefined();
    expect(doc.processes()).toHaveLength(0);
    expect(cs2.notes.some((note) => /collaboration Collab removed/.test(note))).toBe(true);
    await expectRoundTrip(doc);
  });

  it('removes a data object reference with its backing object, data associations and placeholder property', async () => {
    const doc = await fullDoc();
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['DOR_Order'] });
    expect(doc.get('DOR_Order')).toBeUndefined();
    expect(doc.get('DO_Order')).toBeUndefined();
    expect(doc.get('DOA1')).toBeUndefined();
    expect(doc.get('DIA1')).toBeUndefined();
    expect(doc.get('Prop_B')).toBeUndefined();
    expect(many(doc.require('Task_B'), 'properties')).toHaveLength(0);
    expect(many(doc.require('Task_B'), 'dataInputAssociations')).toHaveLength(0);
    expect(many(doc.require('Task_A'), 'dataOutputAssociations')).toHaveLength(0);
    expect(cs.removed.map((change) => change.id).sort()).toEqual(['DIA1', 'DOA1', 'DOR_Order', 'DO_Order'].sort());
    expect(cs.removed.find((change) => change.id === 'DOR_Order')?.kind).toBe('dataObject');
    const xml = await doc.toXml();
    expect(xml).not.toContain('__targetRef_placeholder');
    await expectRoundTrip(doc);
  });

  it('removes a text annotation with its association, and flows / message flows on their own', async () => {
    const doc = await fullDoc();
    new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Note_1'] });
    expect(doc.get('Note_1')).toBeUndefined();
    expect(doc.get('Assoc_1')).toBeUndefined();
    expect(many(doc.require('Process_1'), 'artifacts')).toHaveLength(0);
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['F_yes', 'MF2'] });
    expect(ids(doc.outgoing(doc.require('Gw')))).toEqual(['F_no']);
    expect(ids(doc.incoming(doc.require('Task_B')))).toEqual([]);
    expect(ids(doc.messageFlows())).toEqual(['MF1']);
    expect(cs.removed.map((change) => change.kind)).toEqual(['sequenceFlow', 'messageFlow']);
    await expectRoundTrip(doc);
  });

  it('removes a root message and clears references to it', async () => {
    const doc = await docFromXml(
      definitionsXml(
        `<bpmn:startEvent id="Start"><bpmn:messageEventDefinition messageRef="Message_1" /></bpmn:startEvent>`,
        { extraRoots: '<bpmn:message id="Message_1" name="Msg" />' },
      ),
    );
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Message_1'] });
    expect(doc.get('Message_1')).toBeUndefined();
    expect(doc.require('Start').get<El[]>('eventDefinitions')[0]!.get('messageRef')).toBeUndefined();
    expect(cs.removed[0]).toEqual({ id: 'Message_1', kind: 'message', name: 'Msg' });
    expect(cs.changed.find((change) => change.id === 'Start')?.detail).toMatch(/messageRef cleared/);
    await expectRoundTrip(doc);
  });

  it('handles ifExists, unknown ids and ids already removed by a cascade', async () => {
    const doc = await fullDoc();
    expect(errorCode(() => new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Nope'] }))).toBe('E_NOT_FOUND');
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Nope', 'Sub', 'SubTask'], ifExists: true });
    expect(cs.notes).toEqual(expect.arrayContaining([expect.stringMatching(/Nope does not exist/), expect.stringMatching(/SubTask was already removed/)]));
    expect(doc.get('Sub')).toBeUndefined();
    expect(errorCode(() => new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Definitions_1'] }))).toBe('E_INVALID_REMOVE');
    expect(errorCode(() => new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: [] }))).toBe('E_USAGE');
  });

  it('cascadeRemove works on a boundary event and on a whole process', async () => {
    const doc = await fullDoc();
    const cs = new ChangeSet();
    new ElementRemoval(new EditSession(doc)).cascade(doc.require('Timer_A'), cs);
    expect(doc.get('Timer_A')).toBeUndefined();
    expect(doc.get('F_T')).toBeUndefined();
    expect(doc.get('Task_Remind')).toBeDefined();
    expect(doc.boundaryEventsOf(doc.require('Task_A'))).toHaveLength(0);
    new ElementRemoval(new EditSession(doc)).cascade(doc.require('Process_2'), cs);
    expect(doc.get('Process_2')).toBeUndefined();
    expect(doc.get('C_Task')).toBeUndefined();
    // message flows end at the participant (now a black box), so they survive
    expect(ids(doc.messageFlows())).toEqual(['MF1', 'MF2']);
    expect(doc.require('P_Customer').get('processRef')).toBeUndefined();
    expect(cs.warnings.map((warning) => warning.code)).toContain('W_BLACK_BOX');
    expect(cs.removed.find((change) => change.id === 'Process_2')?.kind).toBe('process');
    await expectRoundTrip(doc);
  });
});

/* ------------------------------------------------------------------ */
/* retype                                                               */
/* ------------------------------------------------------------------ */

describe('retype', () => {
  it('task -> serviceTask keeps id, flows, boundary events, lane, extensions, vendor attrs and data associations', async () => {
    const doc = await fullDoc();
    const old = doc.require('Task_A');
    const cs = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Task_A', kind: 'service' });
    const task = doc.require('Task_A');
    expect(task).not.toBe(old);
    expect(task.$type).toBe('bpmn:ServiceTask');
    expect(task.get('name')).toBe('Do A');
    expect(task.$attrs['camunda:assignee']).toBe('alice');
    expect(task.get<El>('extensionElements').$parent).toBe(task);
    expect(listExtensions(task)[0]?.type).toBe('zeebe:taskDefinition');
    expect(ids(doc.incoming(task))).toEqual(['F1']);
    expect(ids(doc.outgoing(task))).toEqual(['F2']);
    expect(doc.require('F1').get<El>('targetRef')).toBe(task);
    expect(doc.require('F2').get<El>('sourceRef')).toBe(task);
    expect(doc.require('Timer_A').get<El>('attachedToRef')).toBe(task);
    expect(doc.boundaryEventsOf(task).map((boundary) => boundary.get('id'))).toEqual(['Timer_A']);
    expect(doc.require('Lane_Sales').get<El[]>('flowNodeRef')).toContain(task);
    expect(doc.require('Assoc_1').get<El>('sourceRef')).toBe(task);
    expect(many(task, 'dataOutputAssociations')[0]!.get('id')).toBe('DOA1');
    expect(many(task, 'dataOutputAssociations')[0]!.$parent).toBe(task);
    expect(task.$parent).toBe(doc.require('Process_1'));
    const order = flowElementIds(doc.require('Process_1'));
    expect(order.indexOf('Task_A')).toBe(order.indexOf('F1') + 1);
    expect(cs.changed).toEqual([{ id: 'Task_A', kind: 'serviceTask', name: 'Do A', detail: 'retyped from userTask to serviceTask' }]);
    // camunda:assignee is kept but has no effect on a serviceTask (see test/domain/editing/c7-semantic.test.ts)
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_PROPERTY_INAPPLICABLE']);
    const xml = await doc.toXml();
    expect(xml).toContain('<bpmn:serviceTask id="Task_A" name="Do A" camunda:assignee="alice">');
    expect(xml).not.toContain('bpmn:userTask');
    await expectRoundTrip(doc);
  });

  it('retypes across the activity family (task -> subProcess -> callActivity) and drops unknown properties with a warning', async () => {
    const doc = await fullDoc();
    new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Call', kind: 'subProcess' });
    expect(doc.require('Call').$type).toBe('bpmn:SubProcess');
    new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Sub', kind: 'task' });
    const cs = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Sub', kind: 'callActivity' });
    expect(cs.warnings).toEqual([]);
    expect(doc.require('Sub').$type).toBe('bpmn:CallActivity');
    for (const id of ['SubStart', 'SubTask', 'SubEnd', 'SF1', 'SF2']) expect(doc.get(id), id).toBeUndefined();
    expect(ids(doc.incoming(doc.require('Sub')))).toEqual(['F3', 'F4']);
    const cs2 = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Sub', kind: 'task' });
    expect(cs2.warnings).toEqual([]);
    new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Sub', kind: 'callActivity' });
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Sub', values: { calledElement: 'X' } });
    expect(doc.require('Sub').get('calledElement')).toBe('X');
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Call', values: { calledElement: 'X' } }))).toBe('E_UNKNOWN_KEY');
    await expectRoundTrip(doc);
  });

  it('reports dropped children / attributes as W_PROPERTY_DROPPED', async () => {
    const doc = await fullDoc();
    const cs = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Sub', kind: 'userTask' });
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_PROPERTY_DROPPED']);
    expect(cs.removed.map((change) => change.id)).toEqual(expect.arrayContaining(['SubStart', 'SubTask', 'SubEnd', 'SF1', 'SF2']));
    const cs2 = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Call', kind: 'task' });
    expect(cs2.warnings[0]).toMatchObject({ code: 'W_PROPERTY_DROPPED', element: 'Call' });
    expect(cs2.warnings[0]!.message).toMatch(/calledElement/);
    await expectRoundTrip(doc);
  });

  it('gateway -> gateway (default dropped for parallel, kept for inclusive)', async () => {
    const doc = await fullDoc();
    const cs = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Gw', kind: 'parallelGateway' });
    const gw = doc.require('Gw');
    expect(gw.$type).toBe('bpmn:ParallelGateway');
    expect(ids(doc.outgoing(gw))).toEqual(['F_yes', 'F_no']);
    expect(doc.require('F_no').get<El>('sourceRef')).toBe(gw);
    expect(cs.warnings.map((warning) => warning.code)).toEqual(['W_PROPERTY_DROPPED', 'W_CONDITION_DROPPED']);
    expect(cs.warnings[0]!.message).toMatch(/default/);
    expect(cs.warnings[1]!.element).toBe('F_yes');
    expect(doc.require('F_yes').get('conditionExpression')).toBeUndefined();
    expect(doc.require('F_no')).toBeDefined();
    const again = await expectRoundTrip(doc);
    expect(again.require('Gw').$type).toBe('bpmn:ParallelGateway');

    const doc2 = await fullDoc();
    new ElementTypeChange(new EditSession(doc2)).retype({ op: 'retype', id: 'Gw', kind: 'or' });
    expect(doc2.require('Gw').$type).toBe('bpmn:InclusiveGateway');
    expect(doc2.require('Gw').get<El>('default').get('id')).toBe('F_no');
    const noop = new ElementTypeChange(new EditSession(doc2)).retype({ op: 'retype', id: 'Gw', kind: 'inclusiveGateway' });
    expect(noop.isEmpty).toBe(true);
    expect(noop.notes[0]).toMatch(/already/);
  });

  it('subProcess <-> eventSubProcess toggles triggeredByEvent in place', async () => {
    const doc = await docFromXml(definitionsXml(`<bpmn:subProcess id="Sub" name="S"><bpmn:startEvent id="S1" /></bpmn:subProcess>`));
    const sub = doc.require('Sub');
    new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Sub', kind: 'eventSubProcess' });
    expect(doc.require('Sub')).toBe(sub);
    expect(sub.get('triggeredByEvent')).toBe(true);
    expect((await doc.toXml()).includes('triggeredByEvent="true"')).toBe(true);
    new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Sub', kind: 'subProcess' });
    expect(sub.get('triggeredByEvent')).toBeFalsy();
    expect((await doc.toXml()).includes('triggeredByEvent')).toBe(false);
    const connected = await fullDoc();
    expect(errorCode(() => new ElementTypeChange(new EditSession(connected)).retype({ op: 'retype', id: 'Sub', kind: 'eventSubProcess' }))).toBe('E_INVALID_RETYPE');
  });

  it('rejects invalid retypes with helpful errors', async () => {
    const doc = await fullDoc();
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Task_A', kind: 'xor' }))).toBe('E_INVALID_RETYPE');
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Start', kind: 'endEvent' }))).toBe('E_INVALID_RETYPE');
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Timer_A', kind: 'catch' }))).toBe('E_INVALID_RETYPE');
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'F1', kind: 'task' }))).toBe('E_INVALID_RETYPE');
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Task_A', kind: 'choreographyTask' }))).toBe('E_UNKNOWN_KIND');
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Task_A', kind: 'whatever' }))).toBe('E_UNKNOWN_KIND');
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Nope', kind: 'task' }))).toBe('E_NOT_FOUND');
    // trigger not allowed on the new kind without saying which one to use
    const doc2 = await docFromXml(
      definitionsXml(`<bpmn:intermediateCatchEvent id="Ev"><bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1M</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`),
    );
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc2)).retype({ op: 'retype', id: 'Ev', kind: 'intermediateThrowEvent' }))).toBe('E_INVALID_TRIGGER');
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc2)).retype({ op: 'retype', id: 'Ev', kind: 'intermediateThrowEvent:timer' }))).toBe('E_UNKNOWN_KIND');
    expect(doc2.require('Ev').$type).toBe('bpmn:IntermediateCatchEvent');
  });

  it('event -> event of the same position keeps the definitions; same kind and trigger is a no-op', async () => {
    const doc = await docFromXml(
      definitionsXml(`<bpmn:intermediateCatchEvent id="Ev" name="Wait"><bpmn:outgoing>F</bpmn:outgoing><bpmn:messageEventDefinition messageRef="Message_1" /></bpmn:intermediateCatchEvent>
      <bpmn:task id="T"><bpmn:incoming>F</bpmn:incoming></bpmn:task><bpmn:sequenceFlow id="F" sourceRef="Ev" targetRef="T" />`, {
        extraRoots: '<bpmn:message id="Message_1" name="Msg" />',
      }),
    );
    const noop = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Ev', kind: 'intermediateCatchEvent:message' });
    expect(noop.isEmpty).toBe(true);
    const cs = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Ev', kind: 'intermediateThrowEvent' });
    const ev = doc.require('Ev');
    expect(ev.$type).toBe('bpmn:IntermediateThrowEvent');
    expect(ev.get<El[]>('eventDefinitions')[0]!.get<El>('messageRef').get('id')).toBe('Message_1');
    expect(doc.require('F').get<El>('sourceRef')).toBe(ev);
    expect(cs.changed[0]).toMatchObject({ id: 'Ev', kind: 'intermediateThrowEvent:message', detail: 'retyped from intermediateCatchEvent:message to intermediateThrowEvent:message' });
    await expectRoundTrip(doc);
  });

  it('changes an event trigger via applyTrigger', async () => {
    const doc = await fullDoc();
    const cs = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Timer_A', kind: 'boundaryEvent:message', message: 'Reminder' });
    const ev = doc.require('Timer_A');
    expect(ev.$type).toBe('bpmn:BoundaryEvent');
    expect(new ElementProperties(doc).read(ev)).toMatchObject({ trigger: 'message', message: 'Reminder' });
    expect(cs.changed[0]).toMatchObject({ kind: 'boundaryEvent:message', detail: 'retyped from boundaryEvent:timer to boundaryEvent:message' });
    expect(doc.rootElementsOfType('bpmn:Message').some((message) => message.get('name') === 'Reminder')).toBe(true);
    new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Start', kind: 'start:timer', timer: 'R/PT1H' });
    expect(new ElementProperties(doc).read(doc.require('Start'))).toMatchObject({ trigger: 'timer', timer: 'R/PT1H' });
    await expectRoundTrip(doc);
  });
});

/* ------------------------------------------------------------------ */
/* move                                                                 */
/* ------------------------------------------------------------------ */

describe('move', () => {
  it('move --after detaches (bridging) and splices the node behind the anchor', async () => {
    const doc = await fullDoc();
    const cs = new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Task_Remind'], after: 'Task_B' });
    const remind = doc.require('Task_Remind');
    expect(doc.get('F_T')).toBeUndefined(); // 1 in / 0 out: nothing to bridge, flow removed
    expect(ids(doc.incoming(remind))).toEqual(['F3']);
    expect(doc.require('F3').get<El>('targetRef')).toBe(remind);
    expect(doc.outgoing(remind)[0]!.get<El>('targetRef').get('id')).toBe('Sub');
    expect(ids(doc.incoming(doc.require('Sub')))).toEqual(['F4', doc.outgoing(remind)[0]!.get('id')]);
    expect(cs.changed.find((change) => change.id === 'Task_Remind')?.detail).toBe('moved after Task_B');
    expect(cs.removed.map((change) => change.id)).toEqual(['F_T']);
    expect(cs.notes).toContain('inserted between Task_B and Sub');
    const order = flowElementIds(doc.require('Process_1'));
    expect(order.indexOf('Task_Remind')).toBeGreaterThan(order.indexOf('Task_B'));
    await expectRoundTrip(doc);
  });

  it('move --after with several ids chains them and bridges around the gap', async () => {
    const doc = await fullDoc();
    new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Task_B', 'Task_Send'], after: 'Start' });
    const start = doc.require('Start');
    const path: string[] = [];
    let cur: El | undefined = start;
    while (cur && path.length < 10) {
      path.push(cur.get('id'));
      cur = doc.outgoing(cur)[0]?.get<El>('targetRef');
    }
    expect(path.slice(0, 5)).toEqual(['Start', 'Task_B', 'Task_Send', 'Task_A', 'Gw']);
    // both moved nodes had 1 in / 1 out: the gateway branches were bridged straight to Sub
    expect(ids(doc.outgoing(doc.require('Gw')))).toEqual(['F_yes', 'F_no']);
    expect(doc.require('F_yes').get<El>('targetRef').get('id')).toBe('Sub');
    expect(doc.require('F_no').get<El>('targetRef').get('id')).toBe('Sub');
    expect(doc.get('F3')).toBeUndefined();
    expect(doc.get('F4')).toBeUndefined();
    await expectRoundTrip(doc);
  });

  it('move --in relocates nodes into another scope, dropping crossing flows and lane refs but keeping flows between moved nodes', async () => {
    const doc = await fullDoc();
    const sub = doc.require('Sub');
    const cs = new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Task_A', 'Gw'], in: 'Sub' });
    const task = doc.require('Task_A');
    expect(task.$parent).toBe(sub);
    expect(doc.scopeOf(task)).toBe(sub);
    expect(doc.scopeOf(doc.require('Timer_A'))).toBe(sub); // boundary event followed its host
    // flows are declared right after their source (codebase convention), boundary events after that
    expect(flowElementIds(sub)).toEqual(['SubStart', 'SF1', 'SubTask', 'SF2', 'SubEnd', 'Task_A', 'F2', 'Timer_A', 'Gw']);
    expect(flowElementIds(doc.require('Process_1'))).not.toContain('F2');
    expect(doc.require('F2').$parent).toBe(sub);
    for (const id of ['F1', 'F_T', 'F_yes', 'F_no']) expect(doc.get(id), id).toBeUndefined();
    expect(ids(doc.outgoing(doc.require('Start')))).toEqual([]);
    expect(ids(doc.incoming(doc.require('Task_Remind')))).toEqual([]);
    expect(ids(doc.require('Lane_Sales').get<El[]>('flowNodeRef'))).toEqual(['Start']);
    expect(cs.warnings.filter((warning) => warning.code === 'W_FLOW_DROPPED').map((warning) => warning.element).sort()).toEqual(['F1', 'F_T', 'F_no', 'F_yes'].sort());
    expect(cs.removed.map((change) => change.id).sort()).toEqual(['F1', 'F_T', 'F_no', 'F_yes'].sort());
    expect(cs.changed.filter((change) => /moved into Sub/.test(change.detail ?? '')).map((change) => change.id)).toEqual(['Task_A', 'Gw']);
    await expectRoundTrip(doc);
    // moving out again into the other pool
    new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Task_A'], in: 'P_Customer' });
    expect(doc.scopeOf(doc.require('Task_A')).get('id')).toBe('Process_2');
    expect(doc.get('F2')).toBeUndefined();
    expect(errorCode(() => new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Sub'], in: 'Sub' }))).toBe('E_INVALID_PLACEMENT');
    expect(errorCode(() => new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Timer_A'], in: 'Process_1' }))).toBe('E_INVALID_PLACEMENT');
    expect(errorCode(() => new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Gw'] }))).toBe('E_USAGE');
    await expectRoundTrip(doc);
  });

  it('move --before / --flow and lane inheritance across processes', async () => {
    const doc = await fullDoc();
    new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['C_Task'], before: 'End' });
    const cTask = doc.require('C_Task');
    expect(doc.scopeOf(cTask).get('id')).toBe('Process_1');
    expect(doc.get('CF1')).toBeUndefined();
    expect(doc.require('F6').get<El>('targetRef')).toBe(cTask);
    expect(doc.outgoing(cTask)[0]!.get<El>('targetRef').get('id')).toBe('End');
    expect(ids(doc.lanesOf(cTask))).toEqual(['Lane_Ops']);
    new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Task_Remind'], flow: 'F1', flowName: 'first' });
    expect(doc.require('F1').get<El>('targetRef').get('id')).toBe('Task_Remind');
    expect(doc.require('F1').get('name')).toBe('first');
    expect(doc.outgoing(doc.require('Task_Remind'))[0]!.get<El>('targetRef').get('id')).toBe('Task_A');
    await expectRoundTrip(doc);
  });

  it('move --on re-attaches a boundary event (flows in the same scope survive)', async () => {
    const doc = await fullDoc();
    const cs = new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Timer_A'], on: 'Task_B' });
    const ev = doc.require('Timer_A');
    expect(ev.get<El>('attachedToRef').get('id')).toBe('Task_B');
    expect(doc.boundaryEventsOf(doc.require('Task_A'))).toHaveLength(0);
    expect(doc.boundaryEventsOf(doc.require('Task_B')).map((boundary) => boundary.get('id'))).toEqual(['Timer_A']);
    expect(doc.get('F_T')).toBeDefined();
    expect(ids(doc.outgoing(ev))).toEqual(['F_T']);
    const order = flowElementIds(doc.require('Process_1'));
    expect(order.indexOf('Timer_A')).toBe(order.indexOf('Task_B') + 1);
    expect(cs.changed[0]).toMatchObject({ id: 'Timer_A', kind: 'boundaryEvent:timer', detail: 'moved onto Task_B (was Task_A)' });
    expect(errorCode(() => new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Task_A'], on: 'Task_B' }))).toBe('E_INVALID_PLACEMENT');
    // onto an activity in another scope: the outgoing flow crosses and is dropped
    const cs2 = new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Timer_A'], on: 'SubTask' });
    expect(doc.scopeOf(ev).get('id')).toBe('Sub');
    expect(doc.get('F_T')).toBeUndefined();
    expect(cs2.warnings.map((warning) => warning.code)).toEqual(['W_FLOW_DROPPED']);
    await expectRoundTrip(doc);
  });

  it('a chain whose --after anchor or --flow source is one of its later nodes (or inside one) is refused before anything changes', async () => {
    const doc = await fullDoc();
    const xml = await doc.toXml();
    const refusals: Array<[Parameters<ElementMove['move']>[0], string]> = [
      [{ op: 'move', ids: ['Call', 'End'], after: 'End' }, 'End cannot anchor the move of Call, End: it is one of the moved nodes'],
      [{ op: 'move', ids: ['Task_A', 'Gw', 'Task_B'], after: 'Gw' }, 'Gw cannot anchor the move of Task_A, Gw, Task_B: it is one of the moved nodes'],
      [{ op: 'move', ids: ['Task_A', 'Call'], flow: 'F6' }, 'F6 cannot anchor the move of Task_A, Call: its source Call is one of the moved nodes'],
      [{ op: 'move', ids: ['Task_B', 'Sub'], after: 'SubTask' }, 'SubTask cannot anchor the move of Task_B, Sub: it is inside Sub, one of the moved nodes'],
    ];
    for (const [op, message] of refusals) {
      expect(() => new ElementMove(new EditSession(doc)).move(op), JSON.stringify(op)).toThrow(message);
      expect(errorCode(() => new ElementMove(new EditSession(doc)).move(op))).toBe('E_INVALID_PLACEMENT');
    }
    expect(await doc.toXml()).toBe(xml);
  });

  it('a move that leaves its nodes where they are changes nothing and says so; after a gateway it appends as before', async () => {
    const doc = await fullDoc();
    const xml = await doc.toXml();
    const inPlace: Array<[Parameters<ElementMove['move']>[0], string]> = [
      [{ op: 'move', ids: ['Call'], after: 'Sub' }, 'Call is already after Sub'],
      [{ op: 'move', ids: ['Call', 'End'], after: 'Sub' }, 'Call, End are already after Sub, in this order'],
      // Sub has two flows in: Task_B is before it all the same (a splice would fail with E_HAS_PREDECESSOR)
      [{ op: 'move', ids: ['Task_B'], before: 'Sub' }, 'Task_B is already before Sub'],
      [{ op: 'move', ids: ['Task_B'], after: 'Gw', before: 'Sub' }, 'Task_B is already between Gw and Sub'],
    ];
    for (const [op, note] of inPlace) {
      const cs = new ElementMove(new EditSession(doc)).move(op);
      expect([cs.created, cs.changed, cs.removed, cs.warnings, cs.notes], JSON.stringify(op)).toEqual([[], [], [], [], [note]]);
    }
    expect(await doc.toXml()).toBe(xml);
    // a gateway's successor moved after it becomes a new branch (append), as before: F_yes is bridged to Sub
    const cs = new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Task_B'], after: 'Gw' });
    expect(cs.notes).toEqual(['bridged: Gw -> Sub', 'appended after Gw']);
    expect(doc.require('F_yes').get<El>('targetRef').get('id')).toBe('Sub');
    expect(ids(doc.outgoing(doc.require('Task_B')))).toEqual([]);
  });

  it('move --lane assigns lanes (alone and combined with a placement)', async () => {
    const doc = await fullDoc();
    new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Task_B'], lane: 'Lane_Sales' });
    expect(ids(doc.lanesOf(doc.require('Task_B')))).toEqual(['Lane_Sales']);
    new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Task_Send'], after: 'Start', lane: 'Lane_Sales' });
    expect(ids(doc.lanesOf(doc.require('Task_Send')))).toEqual(['Lane_Sales']);
    expect(doc.require('F1').get<El>('targetRef').get('id')).toBe('Task_Send');
    await expectRoundTrip(doc);
  });
});

/* ------------------------------------------------------------------ */
/* order                                                                */
/* ------------------------------------------------------------------ */

describe('order', () => {
  it('rewrites node.outgoing and the declaration order', async () => {
    const doc = await fullDoc();
    const gw = doc.require('Gw');
    const cs = new ElementOrder(new EditSession(doc)).reorder({ op: 'order', id: 'Gw', flows: ['F_no'] });
    expect(ids(gw.get<El[]>('outgoing'))).toEqual(['F_no', 'F_yes']);
    const order = flowElementIds(doc.require('Process_1'));
    expect(order.indexOf('F_no')).toBe(order.indexOf('Gw') + 1);
    expect(order.indexOf('F_yes')).toBe(order.indexOf('Gw') + 2);
    expect(cs.changed[0]).toMatchObject({ id: 'Gw', kind: 'exclusiveGateway', detail: 'outgoing order: F_no, F_yes' });
    const xml = await doc.toXml();
    expect(xml.indexOf('<bpmn:outgoing>F_no</bpmn:outgoing>')).toBeLessThan(xml.indexOf('<bpmn:outgoing>F_yes</bpmn:outgoing>'));
    expect(xml.indexOf('id="F_no"')).toBeLessThan(xml.indexOf('id="F_yes"'));
    const noop = new ElementOrder(new EditSession(doc)).reorder({ op: 'order', id: 'Gw', flows: ['F_no', 'F_yes'] });
    expect(noop.isEmpty).toBe(true);
    await expectRoundTrip(doc);
  });

  it('moves flows declared before the node behind it', async () => {
    const doc = await docFromXml(
      definitionsXml(`<bpmn:sequenceFlow id="Fb" sourceRef="G" targetRef="B" /><bpmn:sequenceFlow id="Fa" sourceRef="G" targetRef="A" />
      <bpmn:exclusiveGateway id="G"><bpmn:outgoing>Fa</bpmn:outgoing><bpmn:outgoing>Fb</bpmn:outgoing></bpmn:exclusiveGateway>
      <bpmn:task id="A"><bpmn:incoming>Fa</bpmn:incoming></bpmn:task><bpmn:task id="B"><bpmn:incoming>Fb</bpmn:incoming></bpmn:task>`),
    );
    new ElementOrder(new EditSession(doc)).reorder({ op: 'order', id: 'G', flows: ['Fb', 'Fa'] });
    expect(flowElementIds(doc.defaultScope())).toEqual(['G', 'Fb', 'Fa', 'A', 'B']);
    expect(ids(doc.require('G').get<El[]>('outgoing'))).toEqual(['Fb', 'Fa']);
    await expectRoundTrip(doc);
  });

  it('rejects flows that are not outgoing flows of the node', async () => {
    const doc = await fullDoc();
    expect(errorCode(() => new ElementOrder(new EditSession(doc)).reorder({ op: 'order', id: 'Gw', flows: ['F1'] }))).toBe('E_NOT_OUTGOING');
    expect(errorCode(() => new ElementOrder(new EditSession(doc)).reorder({ op: 'order', id: 'Gw', flows: ['F_no', 'F_no'] }))).toBe('E_USAGE');
    expect(errorCode(() => new ElementOrder(new EditSession(doc)).reorder({ op: 'order', id: 'Gw', flows: [] }))).toBe('E_USAGE');
    expect(errorCode(() => new ElementOrder(new EditSession(doc)).reorder({ op: 'order', id: 'F1', flows: ['F1'] }))).toBe('E_WRONG_KIND');
  });
});

/* ------------------------------------------------------------------ */
/* ext                                                                  */
/* ------------------------------------------------------------------ */

describe('ext', () => {
  it('adds, lists, replaces and removes typed extension elements', async () => {
    const doc = await linearDoc();
    const cs = new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'send-mail', retries: '3' } });
    const task = doc.require('Task_A');
    expect(doc.definitions.$attrs['xmlns:zeebe']).toBe(ZEEBE);
    expect(listExtensions(task)).toEqual([{ index: 0, type: 'zeebe:taskDefinition', attrs: { type: 'send-mail', retries: '3' } }]);
    expect(cs.changed[0]).toMatchObject({ id: 'Task_A', kind: 'userTask', detail: 'ext added zeebe:taskDefinition' });
    let xml = await doc.toXml();
    expect(xml).toContain('<zeebe:taskDefinition type="send-mail" retries="3" />');
    expect(xml).toContain(`xmlns:zeebe="${ZEEBE}"`);
    await expectRoundTrip(doc);

    new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', type: 'zeebe:formDefinition', attrs: { formKey: 'f' } });
    new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'other' }, replace: true });
    expect(listExtensions(task).map((extension) => [extension.index, extension.type, extension.attrs['type'] ?? extension.attrs['formKey']])).toEqual([
      [0, 'zeebe:formDefinition', 'f'],
      [1, 'zeebe:taskDefinition', 'other'],
    ]);
    new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', type: 'camunda:script', body: 'return 1;', attrs: { scriptFormat: 'js' } });
    expect(listExtensions(task)[2]).toEqual({ index: 2, type: 'camunda:script', attrs: { scriptFormat: 'js' }, body: 'return 1;' });
    xml = await doc.toXml();
    expect(xml).toContain('<camunda:script scriptFormat="js">return 1;</camunda:script>');
    await expectRoundTrip(doc);

    const rm = new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'remove', type: 'zeebe:taskDefinition' });
    expect(rm.changed[0]!.detail).toBe('ext removed zeebe:taskDefinition');
    expect(listExtensions(task).map((extension) => extension.type)).toEqual(['zeebe:formDefinition', 'camunda:script']);
    new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'remove', index: 0 });
    expect(listExtensions(task).map((extension) => extension.type)).toEqual(['camunda:script']);
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'remove', index: 5 }))).toBe('E_NO_EXTENSION');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'remove', type: 'zeebe:nope' }))).toBe('E_NO_EXTENSION');
    new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'remove', type: 'camunda:script' });
    expect(task.get('extensionElements')).toBeUndefined();
    expect(listExtensions(task)).toEqual([]);
    expect((await doc.toXml()).includes('extensionElements')).toBe(false);
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'remove', type: 'camunda:script' }))).toBe('E_NO_EXTENSION');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add' }))).toBe('E_USAGE');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', type: 'acme:x' }))).toBe('E_UNKNOWN_NAMESPACE');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', type: 'bpmn:documentation' }))).toBe('E_INVALID_VALUE');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', type: 'noprefix' }))).toBe('E_INVALID_VALUE');
    await expectRoundTrip(doc);
  });

  it('adds nested elements from an --xml snippet, matching what bpmn-moddle parses', async () => {
    const doc = await linearDoc();
    const snippet = `<zeebe:ioMapping>
        <zeebe:input source="=a &amp; b" target="b" />
        <zeebe:output source="=c" target="d" />
      </zeebe:ioMapping>
      <!-- a comment -->
      <zeebe:taskHeaders><zeebe:header key="k" value="v"/></zeebe:taskHeaders>
      <camunda:inputOutput><camunda:inputParameter name="x"><![CDATA[1 < 2]]></camunda:inputParameter></camunda:inputOutput>`;
    const cs = new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: snippet });
    expect(cs.changed[0]!.detail).toBe('ext added zeebe:ioMapping, zeebe:taskHeaders, camunda:inputOutput');
    const task = doc.require('Task_A');
    expect(listExtensions(task)).toEqual([
      {
        index: 0,
        type: 'zeebe:ioMapping',
        attrs: {},
        children: [
          { type: 'zeebe:input', attrs: { source: '=a & b', target: 'b' } },
          { type: 'zeebe:output', attrs: { source: '=c', target: 'd' } },
        ],
      },
      { index: 1, type: 'zeebe:taskHeaders', attrs: {}, children: [{ type: 'zeebe:header', attrs: { key: 'k', value: 'v' } }] },
      { index: 2, type: 'camunda:inputOutput', attrs: {}, children: [{ type: 'camunda:inputParameter', attrs: { name: 'x' }, body: '1 < 2' }] },
    ]);
    const xml = await doc.toXml();
    expect(xml).toContain('<zeebe:input source="=a &#38; b" target="b" />');
    expect(xml).toContain('<camunda:inputParameter name="x">1 &lt; 2</camunda:inputParameter>');
    const again = await expectRoundTrip(doc);
    // moddle's own parse of the serialised file yields the same structure
    expect(listExtensions(again.require('Task_A'))).toEqual(listExtensions(task));
    // and equals what moddle produces when it parses the wrapped snippet directly
    const wrapped = `<bpmn:extensionElements xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="${ZEEBE}" xmlns:camunda="${CAMUNDA}">${snippet}</bpmn:extensionElements>`;
    const parsed = await doc.moddle.fromXML(wrapped, 'bpmn:ExtensionElements');
    const holder = doc.moddle.create('bpmn:Task', { id: 'Tmp', extensionElements: parsed.rootElement });
    expect(listExtensions(holder)).toEqual(listExtensions(task));

    // replace by type when adding from a snippet
    new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: '<zeebe:taskHeaders><zeebe:header key="k2" value="v2"/></zeebe:taskHeaders>', replace: true });
    expect(listExtensions(task).filter((extension) => extension.type === 'zeebe:taskHeaders')).toHaveLength(1);
    expect(listExtensions(task).find((extension) => extension.type === 'zeebe:taskHeaders')?.children?.[0]?.attrs).toEqual({ key: 'k2', value: 'v2' });
    // inline xmlns declarations are honoured and declared on the definitions
    new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: '<acme:thing xmlns:acme="http://acme.example/ns" a="1"/>' });
    expect(doc.definitions.$attrs['xmlns:acme']).toBe('http://acme.example/ns');
    expect((await doc.toXml()).includes('<acme:thing a="1" />')).toBe(true);
    await expectRoundTrip(doc);
  });

  it('rejects malformed snippets and unknown namespaces', async () => {
    const doc = await linearDoc();
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: '<zeebe:foo>' }))).toBe('E_INVALID_XML');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: '<zeebe:foo></zeebe:bar>' }))).toBe('E_INVALID_XML');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: '<zeebe:foo a=1/>' }))).toBe('E_INVALID_XML');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: 'just text' }))).toBe('E_INVALID_XML');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: '<!-- only a comment -->' }))).toBe('E_INVALID_XML');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: '<foo:bar/>' }))).toBe('E_UNKNOWN_NAMESPACE');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: '<thing xmlns="http://x"/>' }))).toBe('E_INVALID_XML');
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Task_A', action: 'add', xml: '<bpmn:documentation>x</bpmn:documentation>' }))).toBe('E_INVALID_VALUE');
    expect(doc.require('Task_A').get('extensionElements')).toBeUndefined();
    expect(errorCode(() => new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Nope', action: 'add', type: 'zeebe:x' }))).toBe('E_NOT_FOUND');
  });
});

/* ------------------------------------------------------------------ */
/* everything re-parses cleanly after a mixed scenario                  */
/* ------------------------------------------------------------------ */

describe('mixed scenario', () => {
  it('serialises without import warnings after set / retype / move / order / ext / remove', async () => {
    const doc = await fullDoc();
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Task_A', values: { name: 'A2', 'camunda:candidateGroups': 'sales', loop: 'parallel', cardinality: '2', id: 'Activity_A2' } });
    new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Activity_A2', kind: 'serviceTask' });
    new ExtensionElements(new EditSession(doc)).apply({ op: 'ext', id: 'Activity_A2', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'x' }, replace: true });
    new ElementOrder(new EditSession(doc)).reorder({ op: 'order', id: 'Gw', flows: ['F_no', 'F_yes'] });
    new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Task_Remind'], after: 'Gw', condition: '${remind}', flowName: 'remind' });
    new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Call', 'Note_1'] });
    const again = await expectRoundTrip(doc);
    const a2 = again.require('Activity_A2');
    expect(a2.$type).toBe('bpmn:ServiceTask');
    expect(a2.$attrs['camunda:candidateGroups']).toBe('sales');
    expect(listExtensions(a2)).toEqual([{ index: 0, type: 'zeebe:taskDefinition', attrs: { type: 'x' } }]);
    expect(again.require('Timer_A').get<El>('attachedToRef')).toBe(a2);
    expect(ids(again.outgoing(again.require('Gw')))).toEqual(['F_no', 'F_yes', again.outgoing(again.require('Gw'))[2]!.get('id')]);
    expect(again.require('F5').get<El>('targetRef').get('id')).toBe('End');
    expect(again.get('Call')).toBeUndefined();
    expect(again.get('Assoc_1')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* review fixes                                                         */
/* ------------------------------------------------------------------ */

/** Event sub-process with an error start and a message start. */
const EVENT_SUB = definitionsXml(
  `
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="A"><bpmn:incoming>F1</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="A" />
    <bpmn:subProcess id="Errs" triggeredByEvent="true">
      <bpmn:startEvent id="OnErr"><bpmn:errorEventDefinition errorRef="Error_Boom" /></bpmn:startEvent>
      <bpmn:startEvent id="OnMsg"><bpmn:messageEventDefinition messageRef="Message_M" /></bpmn:startEvent>
    </bpmn:subProcess>`,
  { extraRoots: '<bpmn:error id="Error_Boom" name="Boom" errorCode="E1" /><bpmn:message id="Message_M" name="M" />' },
);

/** Two pools; a message flow from a send task into a message start event of the other pool. */
const MESSAGE_FLOW_TO_EVENT = (targetDefinition: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="P1" processRef="Process_1" />
    <bpmn:participant id="P2" processRef="Process_2" />
    <bpmn:messageFlow id="MF" sourceRef="Send" targetRef="Recv" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1"><bpmn:sendTask id="Send" /></bpmn:process>
  <bpmn:process id="Process_2"><bpmn:startEvent id="Recv">${targetDefinition}</bpmn:startEvent></bpmn:process>
  <bpmn:message id="Message_M" name="M" />
</bpmn:definitions>`;

/** A collapsed sub-process with its own BPMNDiagram (as bpmn-js writes it). */
const COLLAPSED_WITH_DI = definitionsXml(
  `
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Sub" />
    <bpmn:subProcess id="Sub"><bpmn:incoming>F1</bpmn:incoming><bpmn:startEvent id="SS" /></bpmn:subProcess>`,
  {
    nsDecl: 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
    extraRoots: `
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="0" y="0" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_di" bpmnElement="Sub" isExpanded="false"><dc:Bounds x="100" y="0" width="100" height="80" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="BPMNDiagram_Sub">
    <bpmndi:BPMNPlane id="BPMNPlane_Sub" bpmnElement="Sub">
      <bpmndi:BPMNShape id="SS_di" bpmnElement="SS"><dc:Bounds x="0" y="0" width="36" height="36" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>`,
  },
);

describe('set: non-interrupting rules match add/retype', () => {
  it('refuses nonInterrupting=true where add refuses it (error starts, untyped starts, starts outside an event sub-process)', async () => {
    const doc = await docFromXml(EVENT_SUB);
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'OnErr', values: { nonInterrupting: 'true' } }))).toBe('E_INVALID_TRIGGER');
    expect(doc.require('OnErr').get('isInterrupting')).not.toBe(false);
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'Start', values: { nonInterrupting: 'true' } }))).toBe('E_INVALID_TRIGGER');
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'OnMsg', values: { nonInterrupting: 'true' } });
    expect(doc.require('OnMsg').get('isInterrupting')).toBe(false);
    // an explicit flag together with an interrupting-only trigger is still an error
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'OnMsg', values: { trigger: 'error', error: 'Boom', nonInterrupting: 'true' } }))).toBe('E_INVALID_TRIGGER');
    await expectRoundTrip(doc);
  });

  it('a trigger change to an interrupting-only trigger clears the flag with W_PROPERTY_DROPPED instead of failing', async () => {
    const doc = await docFromXml(EVENT_SUB);
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'OnMsg', values: { nonInterrupting: 'true' } });
    const cs = new Properties(new EditSession(doc)).set({ op: 'set', id: 'OnMsg', values: { trigger: 'error', error: 'Boom' } });
    expect(doc.require('OnMsg').get('isInterrupting')).not.toBe(false);
    expect((await doc.toXml()).includes('isInterrupting')).toBe(false);
    expect(new ElementProperties(doc).read(doc.require('OnMsg'))).toMatchObject({ trigger: 'error', error: 'Boom' });
    expect(new ElementProperties(doc).read(doc.require('OnMsg'))['nonInterrupting']).toBeUndefined();
    expect(cs.warnings).toEqual([expect.objectContaining({ code: 'W_PROPERTY_DROPPED', element: 'OnMsg' })]);
    expect(cs.warnings[0]!.message).toMatch(/nonInterrupting/);

    const full = await fullDoc();
    new Properties(new EditSession(full)).set({ op: 'set', id: 'Timer_A', values: { nonInterrupting: 'true' } });
    const cs2 = new Properties(new EditSession(full)).set({ op: 'set', id: 'Timer_A', values: { trigger: 'error', error: 'Fail' } });
    expect(full.require('Timer_A').get('cancelActivity')).not.toBe(false);
    expect((await full.toXml()).includes('cancelActivity')).toBe(false);
    expect(cs2.warnings.map((warning) => warning.code)).toEqual(['W_PROPERTY_DROPPED']);
    expect(cs2.changed[0]).toMatchObject({ id: 'Timer_A', kind: 'boundaryEvent:error' });
    // a trigger that allows non-interrupting keeps the flag silently
    new Properties(new EditSession(full)).set({ op: 'set', id: 'Timer_A', values: { trigger: 'message', message: 'Late' } });
    new Properties(new EditSession(full)).set({ op: 'set', id: 'Timer_A', values: { nonInterrupting: 'true' } });
    const cs3 = new Properties(new EditSession(full)).set({ op: 'set', id: 'Timer_A', values: { timer: 'PT2H' } });
    expect(full.require('Timer_A').get('cancelActivity')).toBe(false);
    expect(cs3.warnings).toEqual([]);
    await expectRoundTrip(full);
  });
});

describe('set: default flow side effects are reported', () => {
  it('default=true drops the condition with W_CONDITION_DROPPED and reports the previous default flow', async () => {
    const doc = await fullDoc();
    const cs = new Properties(new EditSession(doc)).set({ op: 'set', id: 'F_yes', values: { default: 'true' } });
    expect(doc.require('Gw').get<El>('default').get('id')).toBe('F_yes');
    expect(doc.require('F_yes').get('conditionExpression')).toBeUndefined();
    expect(cs.warnings).toEqual([expect.objectContaining({ code: 'W_CONDITION_DROPPED', element: 'F_yes' })]);
    expect(cs.warnings[0]!.message).toContain('${ok}');
    expect(cs.changed).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'F_no', detail: 'no longer the default flow of Gw' }), expect.objectContaining({ id: 'F_yes', detail: 'default=true' })]),
    );
    // the node-side key reports the same
    const cs2 = new Properties(new EditSession(doc)).set({ op: 'set', id: 'Gw', values: { default: 'F_no' } });
    expect(cs2.changed).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'F_yes', detail: 'no longer the default flow of Gw' })]));
    expect(cs2.warnings).toEqual([]);
    await expectRoundTrip(doc);
  });

  it('refuses default=true together with a condition (a default flow has no condition)', async () => {
    const doc = await fullDoc();
    expect(errorCode(() => new Properties(new EditSession(doc)).set({ op: 'set', id: 'F_no', values: { default: 'true', condition: '${x}' } }))).toBe('E_INVALID_VALUE');
    expect(doc.require('F_no').get('conditionExpression')).toBeUndefined();
    // default=false / an empty condition may accompany each other
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'F_no', values: { default: 'true', condition: '' } });
    expect(doc.require('Gw').get<El>('default').get('id')).toBe('F_no');
  });
});

describe('set / retype: message flows must still fit the event afterwards', () => {
  it('refuses a trigger the message flow endpoint cannot serve (E_INVALID_TRIGGER, flow listed)', async () => {
    const doc = await docFromXml(MESSAGE_FLOW_TO_EVENT('<bpmn:messageEventDefinition messageRef="Message_M" />'));
    let caught: unknown;
    try {
      new Properties(new EditSession(doc)).set({ op: 'set', id: 'Recv', values: { trigger: 'timer', timer: 'PT1H' } });
    } catch (err) {
      caught = err;
    }
    expect(isBpmnError(caught) && caught.code).toBe('E_INVALID_TRIGGER');
    expect(isBpmnError(caught) && caught.details['related']).toEqual(['MF']);
    expect(isBpmnError(caught) && caught.details['hint']).toMatch(/bpmn remove <file> MF/);

    const doc2 = await docFromXml(MESSAGE_FLOW_TO_EVENT('<bpmn:messageEventDefinition messageRef="Message_M" />'));
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc2)).retype({ op: 'retype', id: 'Recv', kind: 'startEvent:timer', timer: 'PT1H' }))).toBe('E_INVALID_TRIGGER');
    // staying a message event (or untyped) is fine
    const doc3 = await docFromXml(MESSAGE_FLOW_TO_EVENT('<bpmn:messageEventDefinition messageRef="Message_M" />'));
    expect(new ElementTypeChange(new EditSession(doc3)).retype({ op: 'retype', id: 'Recv', kind: 'startEvent:message', message: 'Other' }).warnings).toEqual([]);
    expect(new Properties(new EditSession(doc3)).set({ op: 'set', id: 'Recv', values: { trigger: 'none' } }).warnings).toEqual([]);
    await expectRoundTrip(doc3);
  });

  it('does not blame a conflict that already existed in the file', async () => {
    const doc = await docFromXml(MESSAGE_FLOW_TO_EVENT('<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>'));
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Recv', values: { timer: 'PT2H' } });
    expect(new ElementProperties(doc).read(doc.require('Recv'))).toMatchObject({ trigger: 'timer', timer: 'PT2H' });
  });
});

describe('retype: trigger details, dropped flags, ignored options, child diagrams', () => {
  it('same kind and trigger with options updates the trigger details instead of rebuilding them', async () => {
    const doc = await fullDoc();
    const cs = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Timer_A', kind: 'boundaryEvent:timer', timerKind: 'cycle' });
    expect(new ElementProperties(doc).read(doc.require('Timer_A'))).toMatchObject({ trigger: 'timer', timer: 'PT1H' });
    expect(await doc.toXml()).toContain('<bpmn:timeCycle');
    expect(cs.changed).toEqual([{ id: 'Timer_A', kind: 'boundaryEvent:timer', detail: 'trigger options updated (timerKind=cycle)' }]);

    const errs = await docFromXml(EVENT_SUB);
    const cs2 = new ElementTypeChange(new EditSession(errs)).retype({ op: 'retype', id: 'OnErr', kind: 'start:error', errorCode: 'E2' });
    const def = errs.require('OnErr').get<El[]>('eventDefinitions')[0]!;
    expect(def.get<El>('errorRef').get('id')).toBe('Error_Boom');
    expect(errs.require('Error_Boom').get('errorCode')).toBe('E2');
    expect(cs2.changed[0]!.detail).toBe('trigger options updated (errorCode=E2)');
    await expectRoundTrip(errs);
  });

  it('clears a non-interrupting flag the new trigger cannot carry, with W_PROPERTY_DROPPED', async () => {
    const doc = await fullDoc();
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'Timer_A', values: { nonInterrupting: 'true' } });
    const kept = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Timer_A', kind: 'boundaryEvent:message', message: 'Late' });
    expect(doc.require('Timer_A').get('cancelActivity')).toBe(false);
    expect(kept.warnings).toEqual([]);
    const cs = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Timer_A', kind: 'boundaryEvent:error', error: 'Boom' });
    expect(doc.require('Timer_A').get('cancelActivity')).not.toBe(false);
    expect((await doc.toXml()).includes('cancelActivity')).toBe(false);
    expect(cs.warnings).toEqual([expect.objectContaining({ code: 'W_PROPERTY_DROPPED', element: 'Timer_A' })]);
    expect(cs.warnings[0]!.message).toMatch(/nonInterrupting .* error boundary events are always interrupting/);
    expect(cs.changed[0]).toMatchObject({ kind: 'boundaryEvent:error', detail: 'retyped from boundaryEvent:message to boundaryEvent:error' });
    // an explicit --non-interrupting with an error trigger is still refused
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Timer_A', kind: 'boundaryEvent:timer', timer: 'PT1H', nonInterrupting: true }))).toBeUndefined();
    expect(errorCode(() => new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Timer_A', kind: 'boundaryEvent:error', error: 'X', nonInterrupting: true }))).toBe('E_INVALID_TRIGGER');
  });

  it('warns W_OPTION_IGNORED for trigger options on a non-event and stays a no-op for the same kind', async () => {
    const doc = await fullDoc();
    const cs = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Task_A', kind: 'serviceTask', timer: 'PT1H' });
    // (W_PROPERTY_INAPPLICABLE for the camunda:assignee the serviceTask keeps is covered in test/domain/editing/c7-semantic.test.ts)
    expect(cs.warnings.filter((warning) => warning.code !== 'W_PROPERTY_INAPPLICABLE')).toEqual([expect.objectContaining({ code: 'W_OPTION_IGNORED', element: 'Task_A' })]);
    expect(cs.warnings[0]!.message).toMatch(/timer/);
    expect(cs.changed[0]!.detail).toBe('retyped from userTask to serviceTask');
    const again = new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Task_A', kind: 'serviceTask', timer: 'PT1H' });
    expect(again.isEmpty).toBe(true);
    expect(again.notes[0]).toMatch(/already/);
    expect(again.warnings.map((warning) => warning.code)).toEqual(['W_OPTION_IGNORED']);
  });

  it('a sub-process that becomes a task loses its child diagram (no BPMNPlane rooted at a task)', async () => {
    const doc = await docFromXml(COLLAPSED_WITH_DI);
    expect(many(doc.definitions, 'diagrams')).toHaveLength(2);
    new ElementTypeChange(new EditSession(doc)).retype({ op: 'retype', id: 'Sub', kind: 'task' });
    const diagrams = many(doc.definitions, 'diagrams');
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0]!.get<El>('plane').get<El>('bpmnElement').get('id')).toBe('Process_1');
    expect(doc.ids.has('BPMNPlane_Sub')).toBe(false);
    expect(doc.ids.has('BPMNDiagram_Sub')).toBe(false);
    const xml = await doc.toXml();
    expect(xml).not.toContain('BPMNPlane_Sub');
    expect(xml).toContain('<bpmn:task id="Sub"');
    await expectRoundTrip(doc);
    // sub-process -> sub-process keeps it
    const doc2 = await docFromXml(COLLAPSED_WITH_DI);
    new ElementRemoval(new EditSession(doc2)).remove({ op: 'remove', ids: ['F1'] });
    new ElementTypeChange(new EditSession(doc2)).retype({ op: 'retype', id: 'Sub', kind: 'eventSubProcess' });
    expect(many(doc2.definitions, 'diagrams')).toHaveLength(2);
    expect(many(doc2.definitions, 'diagrams')[1]!.get<El>('plane').get<El>('bpmnElement')).toBe(doc2.require('Sub'));
  });
});

describe('move: bridging with --in, no id recycling', () => {
  it('move --in bridges around a single node (predecessor -> successor) and only drops what still crosses', async () => {
    const doc = await fullDoc();
    const cs = new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['Call'], in: 'Sub' });
    const call = doc.require('Call');
    expect(call.$parent).toBe(doc.require('Sub'));
    expect(doc.require('F5').get<El>('targetRef').get('id')).toBe('End');
    expect(doc.get('F6')).toBeUndefined();
    expect(ids(doc.incoming(call))).toEqual([]);
    expect(ids(doc.outgoing(call))).toEqual([]);
    expect(cs.notes).toContain('bridged: Sub -> End');
    expect(cs.changed).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'F5', detail: 'Sub -> End (bridged Call)' }), expect.objectContaining({ id: 'Call', detail: 'moved into Sub' })]));
    expect(cs.removed.map((change) => change.id)).toEqual(['F6']);
    expect(cs.warnings).toEqual([]);
    await expectRoundTrip(doc);
  });

  it('move --in bridges around a chain of moved nodes and keeps the flows between them', async () => {
    const doc = await docFromXml(
      definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" />
    <bpmn:task id="A"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:sequenceFlow id="F2" name="then" sourceRef="A" targetRef="B" />
    <bpmn:task id="B"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:sequenceFlow id="F3" name="done" sourceRef="B" targetRef="E"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${x}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:endEvent id="E"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:subProcess id="X"><bpmn:startEvent id="XS" /></bpmn:subProcess>`),
    );
    const cs = new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['A', 'B'], in: 'X' });
    expect(doc.require('F1').get<El>('targetRef').get('id')).toBe('E');
    expect(doc.require('F1').get('name')).toBe('done'); // carried over from the exit flow
    expect(doc.require('F1').get<El>('conditionExpression').get('body')).toBe('${x}');
    expect(doc.get('F3')).toBeUndefined();
    expect(doc.require('F2').$parent).toBe(doc.require('X'));
    expect(flowElementIds(doc.require('X'))).toEqual(['XS', 'A', 'F2', 'B']);
    expect(cs.notes).toContain('bridged: S -> E');
    expect(cs.changed).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'F1', detail: 'S -> E (bridged A, B)' })]));
    expect(cs.warnings).toEqual([]);
    await expectRoundTrip(doc);
  });

  it('does not reuse the id of a flow it just removed for the flow it creates', async () => {
    const doc = await docFromXml(
      definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="S" targetRef="X" />
    <bpmn:task id="X"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_4</bpmn:outgoing></bpmn:task>
    <bpmn:sequenceFlow id="Flow_4" sourceRef="X" targetRef="A" />
    <bpmn:task id="A"><bpmn:incoming>Flow_4</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:task>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="A" targetRef="B" />
    <bpmn:task id="B"><bpmn:incoming>Flow_2</bpmn:incoming><bpmn:outgoing>Flow_3</bpmn:outgoing></bpmn:task>
    <bpmn:sequenceFlow id="Flow_3" sourceRef="B" targetRef="C" />
    <bpmn:task id="C"><bpmn:incoming>Flow_3</bpmn:incoming></bpmn:task>`),
    );
    const cs = new ElementMove(new EditSession(doc)).move({ op: 'move', ids: ['X'], after: 'B' });
    expect(cs.removed.map((change) => change.id)).toEqual(['Flow_4']);
    expect(cs.created.map((change) => change.id)).toEqual(['flow_xToC']);
    expect(doc.get('Flow_4')).toBeUndefined();
    expect(doc.require('flow_xToC').get<El>('sourceRef').get('id')).toBe('X');
    expect(doc.require('flow_xToC').get<El>('targetRef').get('id')).toBe('C');
    expect(doc.require('Flow_1').get<El>('targetRef').get('id')).toBe('A');
    await expectRoundTrip(doc);
  });
});

describe('remove / move: bridging policy', () => {
  it('a condition is not carried onto the predecessor\'s default flow (W_CONDITION_DROPPED, flow stays default)', async () => {
    const doc = await fullDoc();
    new Properties(new EditSession(doc)).set({ op: 'set', id: 'F4', values: { condition: '${c}' } });
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['Task_Send'] });
    const fNo = doc.require('F_no');
    expect(fNo.get<El>('targetRef').get('id')).toBe('Sub');
    expect(fNo.get('conditionExpression')).toBeUndefined();
    expect(doc.require('Gw').get<El>('default')).toBe(fNo);
    expect(cs.warnings).toEqual([expect.objectContaining({ code: 'W_CONDITION_DROPPED', element: 'F4', related: ['F_no'] })]);
    expect(cs.notes).toContain('bridged: Gw -> Sub');
    await expectRoundTrip(doc);
    // the same through move
    const doc2 = await fullDoc();
    new Properties(new EditSession(doc2)).set({ op: 'set', id: 'F4', values: { condition: '${m}' } });
    const cs2 = new ElementMove(new EditSession(doc2)).move({ op: 'move', ids: ['Task_Send'], after: 'Start' });
    expect(doc2.require('F_no').get('conditionExpression')).toBeUndefined();
    expect(doc2.require('Gw').get<El>('default').get('id')).toBe('F_no');
    expect(cs2.warnings.map((warning) => warning.code)).toEqual(['W_CONDITION_DROPPED']);
  });

  it('bridges into a self-loop only where connect allows one (activities), never on a gateway', async () => {
    // S -> Gw -> B -> Gw: removing B would make the gateway loop to itself, which connect refuses
    const viaGateway = definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Gw" />
    <bpmn:exclusiveGateway id="Gw"><bpmn:incoming>F1</bpmn:incoming><bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="F2" sourceRef="Gw" targetRef="B" />
    <bpmn:task id="B"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="Gw" />`);
    const doc = await docFromXml(viaGateway);
    const cs = new ElementRemoval(new EditSession(doc)).remove({ op: 'remove', ids: ['B'] });
    expect(doc.get('F2')).toBeUndefined();
    expect(doc.get('F3')).toBeUndefined();
    expect(ids(doc.outgoing(doc.require('Gw')))).toEqual([]);
    expect(ids(doc.incoming(doc.require('Gw')))).toEqual(['F1']);
    expect(cs.removed.map((change) => change.id).sort()).toEqual(['B', 'F2', 'F3']);
    expect(cs.notes).toEqual(['not bridged: Gw is both predecessor and successor of B and cannot loop back to itself']);
    await expectRoundTrip(doc);

    const doc2 = await docFromXml(viaGateway);
    new ElementMove(new EditSession(doc2)).move({ op: 'move', ids: ['B'], after: 'S' });
    expect(doc2.outgoing(doc2.require('Gw')).some((flow) => flow.get<El>('targetRef').get('id') === 'Gw')).toBe(false);
    expect(doc2.require('F1').get<El>('targetRef').get('id')).toBe('B');
    await expectRoundTrip(doc2);

    // S -> A -> B -> A: an activity may loop to itself, so the bridge is made
    const viaTask = definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" />
    <bpmn:task id="A"><bpmn:incoming>F1</bpmn:incoming><bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="B" />
    <bpmn:task id="B"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="A" />`);
    const doc3 = await docFromXml(viaTask);
    const cs3 = new ElementRemoval(new EditSession(doc3)).remove({ op: 'remove', ids: ['B'] });
    expect(doc3.require('F2').get<El>('targetRef').get('id')).toBe('A');
    expect(cs3.notes).toContain('bridged: A -> A');
    await expectRoundTrip(doc3);
  });
});
