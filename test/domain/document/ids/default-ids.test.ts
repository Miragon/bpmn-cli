/**
 * New ids follow the declared id conventions, else element-id-naming's defaults, whatever the
 * file's existing ids look like; types the rule does not check take bpmn-cli's own prefix.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../../../../src/api.js';
import { IdConventionsReader } from '../../../../src/adapters/out/bpmnlint/IdConventionsReader.js';
import { DEFAULT_ID_CONVENTIONS, type IdConventions } from '../../../../src/domain/document/ids/IdConventions.js';
import { bpmnlintEngine } from '../../../../src/node.js';
import { definitionsXml } from '../../../helpers/helpers.js';

const ids = (xml: string): string[] => [...xml.matchAll(/<bpmn:\w+[^>]*?\sid="([^"]+)"/g)].map((match) => match[1]!);

const MODELER_FILE = definitionsXml(`
    <bpmn:startEvent id="StartEvent_1" name="Received"><bpmn:outgoing>Flow_0a1b2c3</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Activity_CheckOrder" name="Check order"><bpmn:incoming>Flow_0a1b2c3</bpmn:incoming></bpmn:userTask>
    <bpmn:sequenceFlow id="Flow_0a1b2c3" sourceRef="StartEvent_1" targetRef="Activity_CheckOrder" />`);

const withCase = (bodyCase: IdConventions['case']): IdConventions => ({ ...DEFAULT_ID_CONVENTIONS, case: bodyCase });

describe('new ids without a .bpmnlintrc', () => {
  it('follow the defaults, not the ids the file already has', async () => {
    const { xml } = await applyToXml(MODELER_FILE, [{ op: 'add', kind: 'userTask', name: 'Ship order', after: 'Activity_CheckOrder' }], { layout: false });
    expect(ids(xml)).toEqual(expect.arrayContaining(['Activity_CheckOrder', 'userTask_shipOrder', 'flow_checkOrderToShipOrder']));
  });

  it('give a pool, a lane, a message and a data object the default prefixes, the backing data object its own', async () => {
    const { xml } = await applyToXml(MODELER_FILE, [
      { op: 'add', kind: 'participant', name: 'Customer' },
      { op: 'add', kind: 'lane', name: 'Clerk', in: 'participant_customer' },
      { op: 'add', kind: 'dataObject', name: 'Invoice', in: 'Process_1' },
      { op: 'add', kind: 'intermediateCatchEvent:message', name: 'Paid', message: 'Payment received', after: 'Activity_CheckOrder' },
    ], { layout: false });
    expect(ids(xml)).toEqual(expect.arrayContaining(['participant_customer', 'lane_clerk', 'dataObject_invoice', 'dataObjectItem_invoice', 'message_paymentReceived', 'event_paid']));
  });

  it('name a process after its name alone; an unnamed one Process_1', async () => {
    expect(ids((await newXml({ processName: 'Order to cash' })).xml)).toEqual(expect.arrayContaining(['definitions_orderToCash', 'orderToCash']));
    expect(ids((await newXml()).xml)).toEqual(expect.arrayContaining(['Definitions_1', 'Process_1']));
  });

  it("give a new pool's process the pool's name, with a suffix where the name is taken", async () => {
    const { xml: named } = await newXml({ processName: 'Order handling' });
    const { xml } = await applyToXml(named, [
      { op: 'add', kind: 'participant', name: 'Shop' },
      { op: 'add', kind: 'participant', name: 'Order handling' },
      { op: 'add', kind: 'participant', name: 'Billing' },
    ], { layout: false });
    expect(ids(xml)).toEqual(expect.arrayContaining(['participant_shop', 'orderHandling', 'participant_orderHandling', 'orderHandling2', 'participant_billing', 'billing']));
  });
});

describe('declared conventions', () => {
  it('beat the defaults; types they leave out take bpmn-cli prefixes shaped like the declared ones', async () => {
    const conventions: IdConventions = { prefixes: { 'bpmn:UserTask': 'Activity_', 'bpmn:SequenceFlow': 'Flow_' }, case: 'PascalCase' };
    const { xml } = await applyToXml(MODELER_FILE, [
      { op: 'add', kind: 'userTask', name: 'Ship order', after: 'Activity_CheckOrder' },
      { op: 'add', kind: 'intermediateCatchEvent:message', name: 'Paid', message: 'Payment received', after: 'Activity_ShipOrder' },
    ], { layout: false, conventions });
    expect(ids(xml)).toEqual(expect.arrayContaining(['Activity_ShipOrder', 'Flow_CheckOrderToShipOrder', 'Message_PaymentReceived', 'IntermediateCatchEvent_Paid']));
  });

  it('a declared bpmn:Process prefix wins over the bare name', async () => {
    const conventions: IdConventions = { prefixes: { ...DEFAULT_ID_CONVENTIONS.prefixes, 'bpmn:Process': 'process_' }, case: 'camelCase' };
    expect(ids((await newXml({ processName: 'Order to cash', conventions })).xml)).toContain('process_orderToCash');
  });

  it('kebab-case writes kebab bodies, flows and suffixes', async () => {
    const { xml } = await applyToXml(MODELER_FILE, [
      { op: 'add', kind: 'serviceTask', name: 'Claim membership', after: 'Activity_CheckOrder' },
      { op: 'add', kind: 'serviceTask', name: 'Claim membership', after: 'serviceTask_claim-membership' },
    ], { layout: false, conventions: withCase('kebab-case') });
    expect(ids(xml)).toEqual(expect.arrayContaining(['serviceTask_claim-membership', 'serviceTask_claim-membership-2', 'flow_claim-membership-to-claim-membership-2']));
  });
});

describe('flow ids', () => {
  const LINE = definitionsXml(`
    <bpmn:task id="task_a" name="A"><bpmn:outgoing>Flow_AToB</bpmn:outgoing><bpmn:outgoing>flow_aToC</bpmn:outgoing></bpmn:task>
    <bpmn:task id="task_b" name="B"><bpmn:incoming>Flow_AToB</bpmn:incoming></bpmn:task>
    <bpmn:task id="task_c" name="C"><bpmn:incoming>flow_aToC</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_AToB" sourceRef="task_a" targetRef="task_b" />
    <bpmn:sequenceFlow id="flow_aToC" sourceRef="task_a" targetRef="task_c" />`);

  it('only a flow in the current form follows its ends; an older one keeps its id', async () => {
    const { xml } = await applyToXml(LINE, [
      { op: 'set', id: 'Flow_AToB', values: { target: 'task_c' } },
      { op: 'set', id: 'flow_aToC', values: { target: 'task_b' } },
    ], { layout: false });
    expect(ids(xml)).toEqual(expect.arrayContaining(['Flow_AToB', 'flow_aToB']));
    expect(ids(xml)).not.toContain('flow_aToC');
  });
});

describe('DEFAULT_ID_CONVENTIONS', () => {
  it("are element-id-naming's defaults as the plugin resolves them", () => {
    const { conventions } = new IdConventionsReader(bpmnlintEngine().plugin.naming).read({ severity: 'warn', config: {} });
    expect(conventions).toEqual(DEFAULT_ID_CONVENTIONS);
  });
});
