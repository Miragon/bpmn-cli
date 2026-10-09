/**
 * Regression tests for the Camunda 7 audit (semantic layer; synthetic fixtures only):
 *  1. `new --target camunda7` writes camunda:historyTimeToLive and the platform version;
 *     new processes in a C7 file get the TTL too
 *  2. renaming an id re-points id references inside vendor extensions
 *     (camunda:errorEventDefinition@errorRef)
 *  3. nested elements without ids are addressed with prefixed set keys
 *     (definition. / loop. / condition.), a C7 attribute that belongs on a nested
 *     element is refused on the parent (E_WRONG_HOST), conditions keep / report
 *     camunda:resource and the language, loop changes report dropped vendor
 *     content, retype warns about camunda content the new kind cannot use
 *  4. show / find display vendor attribute values, process / flow / nested ones
 *  5. receiveTask / sendTask take message=<name> (set, add --message)
 *  + the shared descriptor lookup (src/platform/descriptor.ts)
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { renderDetail, renderView } from '../src/format.js';
import { runOps } from '../src/ops/index.js';
import { readProperties } from '../src/ops/set.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';
import { allowedOn, allowedParents, attrAppliesTo, camundaAttr, camundaAttrsFor, containersOf, idReferenceAttrs, isCamundaType, platformOf, typeIs } from '../src/platform/descriptor.js';
import { buildView, elementDetail, findElements } from '../src/view.js';
import { definitionsXml, flowBetween } from './helpers.js';

const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';

function caught(fn: () => unknown): { code?: string; message: string; details: Record<string, unknown> } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected an error');
}

function codes(cs: { warnings: Array<{ code: string }> }): string[] {
  return cs.warnings.map((w) => w.code);
}

/** The C7 model of the audit (b02): external task, error boundary, message throw, conditional catch, user task. */
async function c7Doc(): Promise<Doc> {
  const doc = Doc.create({ target: 'camunda7', processId: 'verify_nested', processName: 'Verify nested' });
  runOps(doc, [
    { op: 'add', kind: 'startEvent', name: 'Start', id: 'Event_Start' },
    { op: 'add', kind: 'serviceTask', name: 'Charge card', id: 'Activity_Charge', after: 'Event_Start', set: { 'camunda:type': 'external', 'camunda:topic': 'verify-charge' } },
    { op: 'add', kind: 'boundaryEvent:error', name: 'Card declined', id: 'Event_Declined', on: 'Activity_Charge', error: 'Card declined', errorCode: 'CARD_DECLINED' },
    { op: 'add', kind: 'endEvent', name: 'Declined', id: 'Event_EndDeclined', after: 'Event_Declined' },
    { op: 'add', kind: 'intermediateThrowEvent:message', name: 'Notify', id: 'Event_Notify', after: 'Activity_Charge', message: 'Notify' },
    { op: 'add', kind: 'intermediateCatchEvent:conditional', name: 'Ready', id: 'Event_Ready', after: 'Event_Notify', when: '${y > 5}' },
    { op: 'add', kind: 'userTask', name: 'Review item', id: 'Activity_Review', after: 'Event_Ready' },
    { op: 'add', kind: 'endEvent', name: 'Done', id: 'Event_Done', after: 'Activity_Review' },
  ] as Op[]);
  // through XML, like a file on disk
  return Doc.fromXml(await doc.toXml());
}

function set(doc: Doc, id: string, values: Record<string, string>) {
  return runOps(doc, [{ op: 'set', id, values }]);
}

/* ------------------------------------------------------------------ */
/* 1. new --target camunda7                                              */
/* ------------------------------------------------------------------ */

describe('C7 target: history time to live and platform version', () => {
  it('new --target camunda7 sets camunda:historyTimeToLive="180" and modeler:executionPlatformVersion', async () => {
    const doc = Doc.create({ target: 'camunda7', processName: 'Order' });
    const xml = await doc.toXml();
    expect(xml).toMatch(/<bpmn:process id="Process_Order"[^>]*camunda:historyTimeToLive="180"/);
    expect(xml).toContain('modeler:executionPlatform="Camunda Platform"');
    expect(xml).toContain('modeler:executionPlatformVersion="7.24.0"');
    expect(platformOf(doc.definitions)).toBe('camunda7');
  });

  it('other targets get no TTL', async () => {
    expect(await Doc.create({ target: 'camunda8' }).toXml()).not.toContain('historyTimeToLive');
    expect(await Doc.create({}).toXml()).not.toContain('historyTimeToLive');
    expect(platformOf(Doc.create({ target: 'camunda8' }).definitions)).toBe('camunda8');
    expect(platformOf(Doc.create({}).definitions)).toBeUndefined();
  });

  it('a process created later in a C7 file (participant) gets the TTL too, in other files not', async () => {
    const doc = Doc.create({ target: 'camunda7', processId: 'P1' });
    const cs = runOps(doc, [
      { op: 'add', kind: 'participant', name: 'Shop' },
      { op: 'add', kind: 'participant', name: 'Customer' },
    ]);
    const created = cs.created.filter((c) => c.kind === 'process').map((c) => c.id);
    expect(created).toHaveLength(1);
    const proc = doc.require(created[0]!);
    expect(proc.$attrs['camunda:historyTimeToLive']).toBe('180');
    const plain = Doc.create({ processId: 'P1' });
    runOps(plain, [
      { op: 'add', kind: 'participant', name: 'Shop' },
      { op: 'add', kind: 'participant', name: 'Customer' },
    ]);
    expect(await plain.toXml()).not.toContain('historyTimeToLive');
  });

  it('a loaded C7 file (modeler:executionPlatform) is recognised; an explicit TTL is never overwritten', async () => {
    const xml = definitionsXml('<bpmn:startEvent id="S" />', { nsDecl: `${CAMUNDA} xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Platform"` });
    const doc = await Doc.fromXml(xml);
    expect(platformOf(doc.definitions)).toBe('camunda7');
    const cs = runOps(doc, [{ op: 'add', kind: 'participant', name: 'Other' }, { op: 'add', kind: 'participant', name: 'Third' }]);
    const p = doc.require(cs.created.find((c) => c.kind === 'process')!.id);
    expect(p.$attrs['camunda:historyTimeToLive']).toBe('180');
    expect(doc.require('Process_1').$attrs['camunda:historyTimeToLive']).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 2. rename re-points vendor id references                              */
/* ------------------------------------------------------------------ */

const ERROR_MAPPING = definitionsXml(
  `
    <bpmn:startEvent id="Event_Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="Activity_Call" camunda:type="external" camunda:topic="verify-errmap">
      <bpmn:extensionElements>
        <camunda:errorEventDefinition id="CEED_1" errorRef="Error_BizErr" expression="\${true}" />
        <camunda:errorEventDefinition id="CEED_2" errorRef="Error_Other" expression="\${false}" />
      </bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:boundaryEvent id="Event_BizErr" attachedToRef="Activity_Call"><bpmn:outgoing>F3</bpmn:outgoing><bpmn:errorEventDefinition errorRef="Error_BizErr" /></bpmn:boundaryEvent>
    <bpmn:endEvent id="Event_Ok"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="Event_Failed"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Event_Start" targetRef="Activity_Call" />
    <bpmn:sequenceFlow id="F2" sourceRef="Activity_Call" targetRef="Event_Ok" />
    <bpmn:sequenceFlow id="F3" sourceRef="Event_BizErr" targetRef="Event_Failed" />`,
  {
    nsDecl: CAMUNDA,
    extraRoots: '<bpmn:error id="Error_BizErr" name="BizErr" errorCode="E1" /><bpmn:error id="Error_Other" name="Other" errorCode="E2" />',
  },
);

describe('renaming an id re-points vendor id references', () => {
  it('set <errorId> id=<new> updates camunda:errorEventDefinition errorRef (and only the matching one)', async () => {
    const doc = await Doc.fromXml(ERROR_MAPPING);
    set(doc, 'Error_BizErr', { id: 'Error_Renamed' });
    const xml = await doc.toXml();
    expect(xml).toContain('<camunda:errorEventDefinition id="CEED_1" errorRef="Error_Renamed"');
    expect(xml).toContain('<camunda:errorEventDefinition id="CEED_2" errorRef="Error_Other"');
    expect(xml).toContain('<bpmn:errorEventDefinition errorRef="Error_Renamed"');
    expect(xml).not.toContain('Error_BizErr');
  });

  it('a non-error element never rewrites an errorRef that happens to carry its old id', async () => {
    const doc = await Doc.fromXml(ERROR_MAPPING.replace('id="Event_Ok"', 'id="Error_Fake"').replace('targetRef="Event_Ok"', 'targetRef="Error_Fake"').replace('errorRef="Error_Other"', 'errorRef="Error_Fake"'));
    set(doc, 'Error_Fake', { id: 'Event_Ok2' });
    expect(await doc.toXml()).toContain('<camunda:errorEventDefinition id="CEED_2" errorRef="Error_Fake"');
  });

  it('the descriptor names the id-valued vendor attributes', () => {
    expect(idReferenceAttrs()).toContainEqual({ element: 'camunda:errorEventDefinition', attr: 'errorRef', target: 'bpmn:Error' });
  });
});

/* ------------------------------------------------------------------ */
/* 3. nested elements: prefixed keys, wrong host, conditions, loops       */
/* ------------------------------------------------------------------ */

describe('set: prefixed keys address nested elements', () => {
  it('definition.<attr> writes onto the event definition (error, message throw, conditional)', async () => {
    const doc = await c7Doc();
    set(doc, 'Event_Declined', { 'definition.camunda:errorCodeVariable': 'errCode', 'definition.camunda:errorMessageVariable': 'errMsg' });
    set(doc, 'Event_Notify', { 'definition.camunda:type': 'external', 'definition.camunda:topic': 'verify-notify' });
    set(doc, 'Event_Ready', { 'definition.camunda:variableName': 'y', 'definition.camunda:variableEvents': 'create, update' });
    const xml = await doc.toXml();
    expect(xml).toMatch(/<bpmn:errorEventDefinition [^>]*camunda:errorCodeVariable="errCode" camunda:errorMessageVariable="errMsg"/);
    expect(xml).toMatch(/<bpmn:messageEventDefinition [^>]*camunda:type="external" camunda:topic="verify-notify"/);
    expect(xml).toMatch(/<bpmn:conditionalEventDefinition camunda:variableName="y" camunda:variableEvents="create, update"/);
    expect(xml).not.toMatch(/<bpmn:(boundaryEvent|intermediateThrowEvent|intermediateCatchEvent)[^>]*camunda:/);
    // show prints them with the same keys
    expect(readProperties(doc, doc.require('Event_Declined'))).toMatchObject({ 'definition.camunda:errorCodeVariable': 'errCode' });
  });

  it('loop.<attr> writes onto the multi-instance loop (created when missing, with a note)', async () => {
    const doc = await c7Doc();
    const cs = set(doc, 'Activity_Review', { 'loop.camunda:collection': '${items}', 'loop.camunda:elementVariable': 'item' });
    expect(cs.notes.join('\n')).toMatch(/created a parallel multi-instance loop/);
    set(doc, 'Activity_Review', { 'loop.camunda:asyncBefore': 'true' });
    const xml = await doc.toXml();
    expect(xml).toMatch(/<bpmn:multiInstanceLoopCharacteristics camunda:collection="\$\{items\}" camunda:elementVariable="item" camunda:asyncBefore="true" \/>/);
    expect(xml).not.toMatch(/<bpmn:userTask[^>]*camunda:collection/);
    expect(readProperties(doc, doc.require('Activity_Review'))).toMatchObject({ loop: 'parallel', 'loop.camunda:collection': '${items}' });
  });

  it('loop.<attr> on a standard loop is refused; an empty value on a missing nested element is a no-op', async () => {
    const doc = await c7Doc();
    set(doc, 'Activity_Review', { loop: 'standard' });
    expect(caught(() => set(doc, 'Activity_Review', { 'loop.camunda:collection': '${items}' })).code).toBe('E_WRONG_HOST');
    const fresh = await c7Doc();
    const cs = set(fresh, 'Activity_Review', { 'loop.camunda:collection': '' });
    expect(fresh.require('Activity_Review').get('loopCharacteristics')).toBeUndefined();
    expect(cs.warnings).toEqual([]);
  });

  it('BPMN attributes of the nested element work too (loop.isSequential, loop.loopMaximum)', async () => {
    const doc = await c7Doc();
    set(doc, 'Activity_Review', { loop: 'standard', 'loop.loopMaximum': '5', 'loop.testBefore': 'true' });
    expect(await doc.toXml()).toMatch(/<bpmn:standardLoopCharacteristics testBefore="true" loopMaximum="5" \/>/);
  });

  it('condition.<attr> writes onto the condition expression; a resource condition needs no body', async () => {
    const doc = await c7Doc();
    runOps(doc, [
      { op: 'add', kind: 'exclusiveGateway', name: 'Ok?', id: 'Gateway_Ok', after: 'Activity_Review' },
      { op: 'add', kind: 'endEvent', id: 'Event_Yes', after: 'Gateway_Ok', flowId: 'Flow_yes' },
    ]);
    set(doc, 'Flow_yes', { 'condition.camunda:resource': 'deployment://cond.groovy', language: 'groovy' });
    const xml = await doc.toXml();
    expect(xml).toMatch(/<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="groovy" camunda:resource="deployment:\/\/cond.groovy" \/>/);
    expect(readProperties(doc, doc.require('Flow_yes'))).toMatchObject({ language: 'groovy', 'condition.camunda:resource': 'deployment://cond.groovy' });
  });

  it('unknown prefixes and missing definitions are reported', async () => {
    const doc = await c7Doc();
    expect(caught(() => set(doc, 'Activity_Review', { 'foo.camunda:x': '1' })).code).toBe('E_UNKNOWN_KEY');
    expect(caught(() => set(doc, 'Activity_Review', { 'definition.camunda:topic': 'x' })).code).toBe('E_UNKNOWN_KEY');
    expect(caught(() => set(doc, 'Event_Start', { 'definition.camunda:topic': 'x' })).code).toBe('E_NO_NESTED_ELEMENT');
    // a known attribute the nested element cannot carry
    const wrong = caught(() => set(doc, 'Event_Declined', { 'definition.camunda:collection': 'x' }));
    expect(wrong.code).toBe('E_WRONG_HOST');
  });
});

describe('set: a C7 attribute that belongs on a nested element is refused on its parent (E_WRONG_HOST)', () => {
  it.each([
    ['Event_Declined', 'camunda:errorCodeVariable', 'definition.camunda:errorCodeVariable=errCode'],
    ['Event_Notify', 'camunda:topic', 'definition.camunda:topic=errCode'],
    ['Event_Ready', 'camunda:variableName', 'definition.camunda:variableName=errCode'],
    ['Activity_Review', 'camunda:collection', 'loop.camunda:collection=errCode'],
    ['Activity_Review', 'camunda:elementVariable', 'loop.camunda:elementVariable=errCode'],
  ])('%s %s', async (id, key, hint) => {
    const doc = await c7Doc();
    const err = caught(() => set(doc, id, { [key]: 'errCode' }));
    expect(err.code).toBe('E_WRONG_HOST');
    expect(String(err.details['hint'])).toContain(hint);
  });

  it('on a flow: camunda:resource belongs to the condition', async () => {
    const doc = await c7Doc();
    const err = caught(() => set(doc, flowBetween(doc, 'Event_Start', 'Activity_Charge'), { 'camunda:resource': 'deployment://x.groovy' }));
    expect(err.code).toBe('E_WRONG_HOST');
    expect(String(err.details['hint'])).toContain('condition.camunda:resource=deployment://x.groovy');
  });

  it('attributes that fit the element itself, other vendors and removals still work', async () => {
    const doc = await c7Doc();
    set(doc, 'Activity_Review', { 'camunda:asyncBefore': 'true', 'camunda:assignee': 'demo', 'zeebe:collection': 'x' });
    expect(doc.require('Activity_Review').$attrs['camunda:asyncBefore']).toBe('true');
    const legacy = await Doc.fromXml(definitionsXml('<bpmn:userTask id="T" camunda:collection="${items}" />', { nsDecl: CAMUNDA }));
    set(legacy, 'T', { 'camunda:collection': '' });
    expect(legacy.require('T').$attrs['camunda:collection']).toBeUndefined();
  });
});

const RESOURCE_CONDITION = definitionsXml(
  `
    <bpmn:startEvent id="S"><bpmn:outgoing>F0</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="G" default="Flow_no"><bpmn:incoming>F0</bpmn:incoming><bpmn:outgoing>Flow_yes</bpmn:outgoing><bpmn:outgoing>Flow_no</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="Yes"><bpmn:incoming>Flow_yes</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="No"><bpmn:incoming>Flow_no</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F0" sourceRef="S" targetRef="G" />
    <bpmn:sequenceFlow id="Flow_yes" sourceRef="G" targetRef="Yes"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" id="Cond_1" language="groovy" camunda:resource="deployment://cond.groovy" /></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_no" sourceRef="G" targetRef="No" />
    <bpmn:sequenceFlow id="Flow_script" sourceRef="G" targetRef="No"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="groovy">x &gt; 5</bpmn:conditionExpression></bpmn:sequenceFlow>`,
  { nsDecl: CAMUNDA },
);

describe('set <flow> condition= keeps / reports camunda:resource and the language', () => {
  it('an inline condition replacing a script resource drops the resource and its language, with W_PROPERTY_DROPPED', async () => {
    const doc = await Doc.fromXml(RESOURCE_CONDITION);
    const cs = set(doc, 'Flow_yes', { condition: '${ok}' });
    const xml = await doc.toXml();
    expect(xml).toMatch(/<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" id="Cond_1">\$\{ok\}<\/bpmn:conditionExpression>/);
    const w = cs.warnings.filter((x) => x.code === 'W_PROPERTY_DROPPED');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain('camunda:resource');
    expect(w[0]!.message).toContain('language groovy');
  });

  it('a new script body keeps the script language; an explicit language wins', async () => {
    const doc = await Doc.fromXml(RESOURCE_CONDITION);
    const cs = set(doc, 'Flow_script', { condition: 'x > 7' });
    expect(cs.warnings).toEqual([]);
    expect(await doc.toXml()).toContain('language="groovy">x &gt; 7</bpmn:conditionExpression>');
    const cs2 = set(doc, 'Flow_yes', { condition: 'ok == true', language: 'groovy' });
    expect(codes(cs2)).toEqual(['W_PROPERTY_DROPPED']);
    expect(cs2.warnings[0]!.message).not.toContain('language');
    expect(await doc.toXml()).toContain('language="groovy">ok == true</bpmn:conditionExpression>');
  });

  it('a JUEL body does not inherit a script language', async () => {
    const doc = await Doc.fromXml(RESOURCE_CONDITION);
    const cs = set(doc, 'Flow_script', { condition: '${x > 7}' });
    expect(codes(cs)).toEqual(['W_PROPERTY_DROPPED']);
    expect(cs.warnings[0]!.message).toContain('language groovy');
    expect(await doc.toXml()).toMatch(/<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\$\{x &gt; 7\}<\/bpmn:conditionExpression>/);
  });

  it('language= on a resource condition is allowed (it has no body)', async () => {
    const doc = await Doc.fromXml(RESOURCE_CONDITION);
    set(doc, 'Flow_yes', { language: 'javascript' });
    expect(await doc.toXml()).toMatch(/id="Cond_1" language="javascript" camunda:resource="deployment:\/\/cond.groovy"/);
  });

  it('show and the overview list a resource condition', async () => {
    const doc = await Doc.fromXml(RESOURCE_CONDITION);
    expect(readProperties(doc, doc.require('Flow_yes'))).toMatchObject({ language: 'groovy', 'condition.camunda:resource': 'deployment://cond.groovy' });
    const text = renderView(buildView(doc));
    expect(text).toContain('Yes (Flow_yes if resource deployment://cond.groovy [language=groovy])');
  });
});

const MI_VENDOR = definitionsXml(
  `
    <bpmn:userTask id="Activity_ReviewItem">
      <bpmn:multiInstanceLoopCharacteristics id="MI_Review" camunda:collection="\${items}" camunda:elementVariable="item" camunda:asyncBefore="true">
        <bpmn:extensionElements><camunda:failedJobRetryTimeCycle>R3/PT5M</camunda:failedJobRetryTimeCycle></bpmn:extensionElements>
      </bpmn:multiInstanceLoopCharacteristics>
    </bpmn:userTask>`,
  { nsDecl: CAMUNDA },
);

describe('loop changes report dropped multi-instance vendor content', () => {
  it.each(['none', 'standard'])('loop=%s', async (mode) => {
    const doc = await Doc.fromXml(MI_VENDOR);
    const cs = set(doc, 'Activity_ReviewItem', { loop: mode });
    const w = cs.warnings.find((x) => x.code === 'W_PROPERTY_DROPPED');
    expect(w?.message).toContain('camunda:collection');
    expect(w?.message).toContain('camunda:elementVariable');
    expect(w?.message).toContain('camunda:asyncBefore');
    expect(w?.message).toContain('camunda:failedJobRetryTimeCycle');
    expect(w?.message).toContain('MI_Review');
  });

  it('parallel <-> sequential keeps the loop and its vendor content', async () => {
    const doc = await Doc.fromXml(MI_VENDOR);
    const cs = set(doc, 'Activity_ReviewItem', { loop: 'sequential' });
    expect(cs.warnings).toEqual([]);
    expect(await doc.toXml()).toMatch(/id="MI_Review" isSequential="true" camunda:collection/);
  });
});

const RETYPE = definitionsXml(
  `
    <bpmn:userTask id="Activity_Review" camunda:assignee="demo" camunda:candidateGroups="sales" camunda:formKey="embedded:x" camunda:asyncBefore="true">
      <bpmn:extensionElements><camunda:taskListener event="create" class="a.B" /><camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements>
    </bpmn:userTask>
    <bpmn:serviceTask id="Activity_Compute" camunda:type="external" camunda:topic="compute" />
    <bpmn:task id="Activity_Plain" camunda:asyncAfter="true" />`,
  { nsDecl: CAMUNDA },
);

describe('retype warns about camunda content the new kind cannot use (W_PROPERTY_INAPPLICABLE)', () => {
  it('userTask -> serviceTask names assignee, candidateGroups, formKey and the task listener, and keeps them', async () => {
    const doc = await Doc.fromXml(RETYPE);
    const cs = runOps(doc, [{ op: 'retype', id: 'Activity_Review', kind: 'serviceTask' }]);
    const w = cs.warnings.filter((x) => x.code === 'W_PROPERTY_INAPPLICABLE');
    expect(w).toHaveLength(1);
    for (const name of ['camunda:assignee', 'camunda:candidateGroups', 'camunda:formKey', 'camunda:taskListener']) expect(w[0]!.message).toContain(name);
    expect(w[0]!.message).not.toContain('camunda:asyncBefore');
    expect(w[0]!.message).not.toContain('camunda:inputOutput');
    const xml = await doc.toXml();
    expect(xml).toMatch(/<bpmn:serviceTask id="Activity_Review" camunda:assignee="demo"/);
    expect(xml).toContain('<camunda:taskListener');
  });

  it('serviceTask -> userTask names type and topic; task -> userTask warns about nothing', async () => {
    const doc = await Doc.fromXml(RETYPE);
    const cs = runOps(doc, [{ op: 'retype', id: 'Activity_Compute', kind: 'userTask' }]);
    expect(cs.warnings.find((x) => x.code === 'W_PROPERTY_INAPPLICABLE')?.message).toMatch(/camunda:type, camunda:topic/);
    const cs2 = runOps(doc, [{ op: 'retype', id: 'Activity_Plain', kind: 'userTask' }]);
    expect(codes(cs2)).not.toContain('W_PROPERTY_INAPPLICABLE');
  });
});

/* ------------------------------------------------------------------ */
/* 4. show / find                                                        */
/* ------------------------------------------------------------------ */

const SHOW = definitionsXml(
  `
    <bpmn:extensionElements><camunda:executionListener event="start" class="a.Start" /></bpmn:extensionElements>
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Review" name="Review" camunda:assignee="demo" camunda:candidateGroups="sales, back office">
      <bpmn:extensionElements><camunda:taskListener event="create" class="a.A" /><camunda:taskListener event="assignment" class="a.B" /><camunda:taskListener event="complete" class="a.C" /></bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:multiInstanceLoopCharacteristics id="MI_Review" camunda:collection="\${items}" camunda:elementVariable="item" />
    </bpmn:userTask>
    <bpmn:serviceTask id="Charge" camunda:type="external" camunda:topic="charge-card"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:boundaryEvent id="Declined" attachedToRef="Charge"><bpmn:outgoing>F4</bpmn:outgoing><bpmn:errorEventDefinition id="ErrDef_1" errorRef="Error_1" camunda:errorCodeVariable="errCode" /></bpmn:boundaryEvent>
    <bpmn:endEvent id="E"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>F4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Review" />
    <bpmn:sequenceFlow id="F2" sourceRef="Review" targetRef="Charge"><bpmn:extensionElements><camunda:executionListener event="take" class="a.Take" /></bpmn:extensionElements></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F3" sourceRef="Charge" targetRef="E" />
    <bpmn:sequenceFlow id="F4" sourceRef="Declined" targetRef="E2" />`,
  { nsDecl: CAMUNDA, extraRoots: '<bpmn:error id="Error_1" name="Declined" errorCode="DECLINED" />' },
);

describe('show: vendor attribute values, process / flow / nested vendor content', () => {
  async function viewOf(xml: string) {
    const doc = await Doc.fromXml(xml.replace('<bpmn:process id="Process_1" isExecutable="true">', '<bpmn:process id="Process_1" isExecutable="true" camunda:historyTimeToLive="180" camunda:candidateStarterGroups="sales">'));
    return { doc, view: buildView(doc) };
  }

  it('the overview prints values, nested keys, counts and process / flow content', async () => {
    const { view } = await viewOf(SHOW);
    const text = renderView(view);
    expect(text).toContain('process Process_1 executable [camunda:historyTimeToLive=180, camunda:candidateStarterGroups=sales, ext: camunda:executionListener]');
    expect(text).toContain('userTask Review "Review" [loop=parallel, camunda:assignee=demo, camunda:candidateGroups="sales, back office", loop.camunda:collection=${items}, loop.camunda:elementVariable=item, ext: camunda:taskListener x3] -> Charge (F2 [ext: camunda:executionListener])');
    expect(text).toContain('serviceTask Charge [camunda:type=external, camunda:topic=charge-card] -> E (F3)');
    expect(text).toContain('boundaryEvent:error Declined [error Declined (DECLINED), definition.camunda:errorCodeVariable=errCode] -> E2 (F4)');
  });

  it('--json carries the values', async () => {
    const { view } = await viewOf(SHOW);
    const p = view.processes[0]!;
    expect(p.attrs).toEqual({ 'camunda:historyTimeToLive': '180', 'camunda:candidateStarterGroups': 'sales' });
    expect(p.extensionElements).toEqual(['camunda:executionListener']);
    expect(p.extensions).toEqual(['camunda:executionListener', 'camunda:historyTimeToLive', 'camunda:candidateStarterGroups']);
    const review = p.nodes[1]!;
    expect(review.attrs).toEqual({ 'camunda:assignee': 'demo', 'camunda:candidateGroups': 'sales, back office', 'loop.camunda:collection': '${items}', 'loop.camunda:elementVariable': 'item' });
    expect(review.extensionElements).toEqual(['camunda:taskListener', 'camunda:taskListener', 'camunda:taskListener']);
    expect(review.outgoing[0]).toMatchObject({ id: 'F2', extensionElements: ['camunda:executionListener'] });
  });

  it('show <id> lists the nested element with its id, attributes and extensions under the set keys', async () => {
    const { doc } = await viewOf(SHOW);
    const d = elementDetail(doc, doc.require('Declined'));
    expect(d.properties['definition.camunda:errorCodeVariable']).toBe('errCode');
    expect(d.nested?.definition).toMatchObject({ id: 'ErrDef_1', type: 'bpmn:ErrorEventDefinition', attrs: { 'camunda:errorCodeVariable': 'errCode' } });
    const text = renderDetail(d);
    expect(text).toContain('definition.id: ErrDef_1');
    expect(text).toContain('definition.camunda:errorCodeVariable: errCode');
    const r = elementDetail(doc, doc.require('Review'));
    expect(renderDetail(r)).toContain('loop.id: MI_Review');
    expect(r.properties['loop.camunda:collection']).toBe('${items}');
  });

  it('show <processId> lists the process attributes', async () => {
    const { doc } = await viewOf(SHOW);
    const text = renderDetail(elementDetail(doc, doc.require('Process_1')));
    expect(text).toContain('camunda:historyTimeToLive: 180');
  });
});

describe('find matches vendor attribute values and nested ids', () => {
  it('finds by topic, assignee, candidate group, listener class and nested ids', async () => {
    const doc = await Doc.fromXml(SHOW);
    expect(findElements(doc, 'charge-card').map((h) => h.id)).toEqual(['Charge']);
    expect(findElements(doc, 'charge-card')[0]).toMatchObject({ match: 'camunda:topic=charge-card' });
    expect(findElements(doc, 'demo').map((h) => h.id)).toEqual(['Review']);
    expect(findElements(doc, 'back office').map((h) => h.id)).toEqual(['Review']);
    expect(findElements(doc, 'a.Take').map((h) => h.id)).toEqual(['F2']);
    expect(findElements(doc, 'errCode').map((h) => h.id)).toEqual(['Declined']);
    expect(findElements(doc, 'ErrDef').map((h) => h.id)).toEqual(['ErrDef_1']);
    expect(findElements(doc, 'MI_').map((h) => h.id)).toEqual(['MI_Review']);
    // a name / id match carries no `match`
    expect(findElements(doc, 'Review')[0]).not.toHaveProperty('match');
  });
});

/* ------------------------------------------------------------------ */
/* 5. receiveTask / sendTask message=<name>                               */
/* ------------------------------------------------------------------ */

describe('receiveTask / sendTask take message=<name>', () => {
  it('set message=<name> creates or finds the root bpmn:Message', async () => {
    const doc = await c7Doc();
    runOps(doc, [{ op: 'add', kind: 'receiveTask', name: 'Wait payment', id: 'Activity_Wait', after: 'Activity_Review' }]);
    const cs = set(doc, 'Activity_Wait', { message: 'PaymentReceived' });
    expect(cs.created).toContainEqual(expect.objectContaining({ id: 'Message_PaymentReceived', kind: 'message' }));
    expect(await doc.toXml()).toContain('<bpmn:receiveTask id="Activity_Wait" name="Wait payment" messageRef="Message_PaymentReceived">');
    expect(readProperties(doc, doc.require('Activity_Wait'))).toMatchObject({ message: 'PaymentReceived' });
    // an existing message by name is reused
    set(doc, 'Activity_Wait', { message: 'Notify' });
    expect(doc.require('Activity_Wait').get('messageRef')?.get('id')).toBe('Message_Notify');
    set(doc, 'Activity_Wait', { message: '' });
    expect(doc.require('Activity_Wait').get('messageRef')).toBeUndefined();
  });

  it('add receiveTask --message and add sendTask with message= work; other kinds still refuse / ignore it', async () => {
    const doc = await c7Doc();
    const cs = runOps(doc, [{ op: 'add', kind: 'receiveTask', name: 'Wait', id: 'Activity_Wait', after: 'Activity_Review', message: 'Paid' }]);
    expect(codes(cs)).not.toContain('W_OPTION_IGNORED');
    expect(cs.created).toContainEqual(expect.objectContaining({ id: 'Message_Paid', kind: 'message' }));
    expect(doc.require('Activity_Wait').get('messageRef')?.get('name')).toBe('Paid');
    runOps(doc, [{ op: 'add', kind: 'sendTask', name: 'Send', id: 'Activity_Send', after: 'Activity_Wait', set: { message: 'Sent' } }]);
    expect(doc.require('Activity_Send').get('messageRef')?.get('name')).toBe('Sent');
    expect(caught(() => set(doc, 'Activity_Review', { message: 'X' })).code).toBe('E_UNKNOWN_KEY');
    const cs2 = runOps(doc, [{ op: 'add', kind: 'userTask', name: 'Other', after: 'Activity_Send', message: 'Y' }]);
    expect(codes(cs2)).toContain('W_OPTION_IGNORED');
  });
});

/* ------------------------------------------------------------------ */
/* the shared descriptor lookup                                          */
/* ------------------------------------------------------------------ */

describe('platform/descriptor', () => {
  it('resolves attribute owners through camunda mixins', () => {
    expect(camundaAttr('camunda:assignee')).toEqual({ name: 'camunda:assignee', type: 'String', owners: ['bpmn:UserTask'] });
    expect(camundaAttr('asyncBefore')?.owners).toEqual(['bpmn:Activity', 'bpmn:Gateway', 'bpmn:Event', 'bpmn:MultiInstanceLoopCharacteristics']);
    expect(camundaAttr('camunda:topic')?.owners).toContain('bpmn:MessageEventDefinition');
    expect(camundaAttr('camunda:resource')?.owners).toEqual(['bpmn:ScriptTask', 'bpmn:FormalExpression']);
    expect(camundaAttr('zeebe:topic')).toBeUndefined();
    expect(camundaAttr('camunda:asignee')).toBeUndefined();
    expect(attrAppliesTo('camunda:assignee', 'bpmn:ServiceTask')).toBe(false);
    expect(attrAppliesTo('camunda:asyncBefore', 'bpmn:UserTask')).toBe(true);
    expect(attrAppliesTo('camunda:nope', 'bpmn:UserTask')).toBeUndefined();
    expect(camundaAttrsFor('bpmn:Process').map((a) => a.name)).toContain('camunda:historyTimeToLive');
    expect(typeIs('bpmn:UserTask', 'bpmn:Activity')).toBe(true);
    expect(typeIs('bpmn:UserTask', 'bpmn:Gateway')).toBe(false);
  });

  it('describes extension element types', () => {
    expect(isCamundaType('camunda:inputOutput')).toBe(true);
    expect(isCamundaType('camunda:InputOutput')).toBe(true);
    expect(isCamundaType('camunda:inputOutpt')).toBe(false);
    expect(isCamundaType('camunda:AsyncCapable')).toBe(false);
    expect(allowedParents('camunda:taskListener')).toEqual(['bpmn:UserTask']);
    expect(allowedParents('camunda:connector')).toEqual(['bpmn:ServiceTask', 'bpmn:BusinessRuleTask', 'bpmn:SendTask', 'bpmn:MessageEventDefinition']);
    expect(allowedParents('camunda:properties')).toEqual(['*']);
    expect(allowedOn('camunda:taskListener', 'bpmn:ServiceTask')).toBe(false);
    expect(allowedOn('camunda:inputOutput', 'bpmn:ServiceTask')).toBe(true);
    expect(containersOf('camunda:inputParameter')).toEqual(['camunda:inputOutput']);
    expect(containersOf('camunda:formField')).toEqual(['camunda:formData']);
    expect(containersOf('camunda:property')).toEqual(['camunda:properties']);
  });
});

/* ------------------------------------------------------------------ */
/* end to end through the pipeline                                       */
/* ------------------------------------------------------------------ */

describe('pipeline: the C7 model writes and re-imports cleanly', () => {
  it('nested keys survive a dry-run write without import warnings', async () => {
    const doc = await c7Doc();
    const r = await mutateDoc(doc, [{ op: 'set', id: 'Activity_Review', values: { 'loop.camunda:collection': '${items}', 'loop.camunda:elementVariable': 'item' } }], { dryRun: true, layout: false });
    expect(r.xml).toContain('camunda:collection="${items}"');
    const again = await Doc.fromXml(r.xml);
    expect(again.importWarnings).toEqual([]);
  });
});

describe('a script resource replaces an inline condition body', () => {
  it('condition.camunda:resource on a flow with an inline body drops the body with W_PROPERTY_DROPPED', async () => {
    const doc = await Doc.fromXml(RESOURCE_CONDITION);
    const cs = set(doc, 'Flow_script', { 'condition.camunda:resource': 'deployment://check.groovy' });
    expect(codes(cs)).toEqual(['W_PROPERTY_DROPPED']);
    expect(cs.warnings[0]!.message).toContain('x > 5');
    expect(await doc.toXml()).toMatch(/<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="groovy" camunda:resource="deployment:\/\/check.groovy" \/>/);
  });

  it('condition= together with condition.camunda:resource= is refused', async () => {
    const doc = await Doc.fromXml(RESOURCE_CONDITION);
    expect(caught(() => set(doc, 'Flow_no', { condition: '${a}', 'condition.camunda:resource': 'deployment://x.groovy' })).code).toBe('E_INVALID_VALUE');
  });

  it('a new resource condition on a default flow clears the default marker', async () => {
    const doc = await Doc.fromXml(RESOURCE_CONDITION);
    const cs = set(doc, 'Flow_no', { 'condition.camunda:resource': 'deployment://x.groovy', language: 'groovy' });
    expect(doc.require('G').get('default')).toBeUndefined();
    expect(cs.changed.map((c) => c.detail)).toContain('no longer the default flow of G');
  });
});

describe('set E_WRONG_HOST: a process attribute on its participant', () => {
  it('camunda:historyTimeToLive on a participant points at the process', async () => {
    const doc = Doc.create({ target: 'camunda7', processId: 'P1' });
    const cs = runOps(doc, [{ op: 'add', kind: 'participant', name: 'Shop' }]);
    const participant = cs.created.find((c) => c.kind === 'participant')!.id;
    const err = caught(() => set(doc, participant, { 'camunda:historyTimeToLive': '30' }));
    expect(err.code).toBe('E_WRONG_HOST');
    expect(String(err.details['hint'])).toContain('bpmn set <file> P1 camunda:historyTimeToLive=30');
  });

  it('an event attribute of another trigger names the trigger it needs', async () => {
    const doc = await c7Doc();
    const err = caught(() => set(doc, 'Event_Done', { 'camunda:errorCodeVariable': 'x' }));
    expect(err.code).toBe('E_WRONG_HOST');
    expect(String(err.details['hint'])).toContain('trigger=error definition.camunda:errorCodeVariable=x');
    // an intermediate throw event can never carry an error definition: nothing to point at, written as before
    set(doc, 'Event_Notify', { 'camunda:errorCodeVariable': 'x' });
    expect(doc.require('Event_Notify').$attrs['camunda:errorCodeVariable']).toBe('x');
  });
});

describe('condition= with condition.camunda:resource= replaces the inline body on purpose', () => {
  it('keeps the expression (id, language), drops the body without a warning', async () => {
    const doc = await Doc.fromXml(RESOURCE_CONDITION);
    const cs = set(doc, 'Flow_script', { condition: '', 'condition.camunda:resource': 'deployment://check.groovy' });
    expect(cs.warnings).toEqual([]);
    expect(await doc.toXml()).toMatch(/<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="groovy" camunda:resource="deployment:\/\/check.groovy" \/>/);
  });
});

describe('when= on a conditional event treats a script condition like a flow condition', () => {
  const CONDITIONAL = definitionsXml(
    `
    <bpmn:intermediateCatchEvent id="Wait"><bpmn:conditionalEventDefinition id="CondDef_1" camunda:variableName="amount"><bpmn:condition xsi:type="bpmn:tFormalExpression" language="groovy" camunda:resource="deployment://wait.groovy" /></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>`,
    { nsDecl: CAMUNDA },
  );

  it('drops camunda:resource and the language with W_PROPERTY_DROPPED, keeps the definition and its attributes', async () => {
    const doc = await Doc.fromXml(CONDITIONAL);
    const cs = set(doc, 'Wait', { when: '${amount > 5}' });
    expect(codes(cs)).toEqual(['W_PROPERTY_DROPPED']);
    expect(cs.warnings[0]!.message).toContain('camunda:resource deployment://wait.groovy and language groovy');
    expect(await doc.toXml()).toMatch(/<bpmn:conditionalEventDefinition id="CondDef_1" camunda:variableName="amount">\s*<bpmn:condition xsi:type="bpmn:tFormalExpression">\$\{amount &gt; 5\}<\/bpmn:condition>/);
  });

  it('condition.camunda:resource addresses the condition of a conditional event', async () => {
    const doc = await c7Doc();
    set(doc, 'Event_Ready', { 'condition.camunda:resource': 'deployment://ready.groovy', 'condition.language': 'groovy' });
    expect(await doc.toXml()).toMatch(/<bpmn:condition xsi:type="bpmn:tFormalExpression" language="groovy" camunda:resource="deployment:\/\/ready.groovy" \/>/);
  });
});

describe('default=true on a script resource condition', () => {
  it('reports the dropped resource condition (W_CONDITION_DROPPED)', async () => {
    const doc = await Doc.fromXml(RESOURCE_CONDITION);
    const cs = set(doc, 'Flow_yes', { default: 'true' });
    expect(cs.warnings.find((w) => w.code === 'W_CONDITION_DROPPED')?.message).toContain('camunda:resource=deployment://cond.groovy');
  });
});
