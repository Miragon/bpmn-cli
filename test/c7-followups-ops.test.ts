/**
 * Camunda 7 follow-ups, operation level (verifier round after the C7 step).
 * Each block is a regression test that fails on the code before its fix.
 * The engine verdicts quoted below were checked on Camunda 7.24.0, CIB seven
 * 2.2.0 and Operaton 2.1.5 (outside the repository); all models synthetic.
 *
 *  1. `set <flow|event> condition.camunda:resource=` without a new inline
 *     condition left an empty condition (all 3 engines deploy it, every start
 *     fails: "condition script returns null") -> E_INVALID_VALUE, nothing
 *     changes; together with condition= / when= it works.
 *  2. definition.<key> on an event with two event definitions edited the
 *     first one silently -> E_AMBIGUOUS_NESTED; definition[<n>] /
 *     definition[<trigger>] select one (set and ext); show lists all.
 *  3. definition.activityRef outside the throw event's scope (all 3 engines:
 *     "no activity with id ... in scope") -> E_CROSS_SCOPE.
 *  4. a keyed `ext add` replacement dropped the old item's content without a
 *     word -> W_PROPERTY_DROPPED naming it, with the --xml that keeps it.
 *  5. the text tree of `ext list` / `show` flattened multi-line bodies.
 *  6. ops JSON `ext remove` with "type": "loop.0" failed (the CLI form works).
 *  7. E_INVALID_BRIDGE used the C7 event-gateway rule in plain BPMN files;
 *     plain files follow BPMN 2.0 now, and connect / add warn about the same
 *     targets a bridge refuses.
 *  8. two loopCharacteristics on one task: the first was dropped silently on
 *     every write -> lossy import warning, E_IMPORT_LOSSY unless --force.
 *  9. a retype in a C7 file reported W_PROPERTY_INAPPLICABLE and, per item,
 *     W_C7_MISPLACED_* -> a write (mutateDoc) keeps the profile findings only
 *     (withoutProfileDuplicates).
 */
import { describe, expect, it } from 'vitest';
import { parseOps } from '../src/batch.js';
import { Doc } from '../src/document.js';
import { extensionLines, renderDetail, renderExtensionList, renderView } from '../src/format.js';
import { is, many, type El } from '../src/model.js';
import { listAllExtensions } from '../src/ops/ext.js';
import { eventGatewayTargetProblem } from '../src/ops/flows.js';
import { runOps } from '../src/ops/index.js';
import { removeElements } from '../src/ops/remove.js';
import { withoutProfileDuplicates } from '../src/ops/retype.js';
import { readProperties } from '../src/ops/set.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';
import { buildView, elementDetail } from '../src/view.js';
import { definitionsXml } from './helpers.js';

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

async function rejected(p: Promise<unknown>): Promise<{ code?: string; message: string; details: Record<string, unknown> }> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected a rejection');
}

/** Adds the incoming / outgoing entries the XML snippets leave out. */
function withMirrors(doc: Doc): Doc {
  for (const f of doc.byId().values()) {
    if (!is(f, 'bpmn:SequenceFlow')) continue;
    many(f.get<El>('sourceRef'), 'outgoing').push(f);
    many(f.get<El>('targetRef'), 'incoming').push(f);
  }
  return doc;
}

async function load(body: string, opts: { nsDecl?: string; extraRoots?: string } = {}): Promise<Doc> {
  return withMirrors(await Doc.fromXml(definitionsXml(body, opts)));
}

const run = (doc: Doc, ops: Op[]) => runOps(doc, ops);
const codes = (ws: Array<{ code: string }>) => ws.map((w) => w.code);

/* ------------------------------------------------------------------ */
/* 1. removing a condition's script resource                            */
/* ------------------------------------------------------------------ */

const RESOURCE_FLOW = `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="Gateway_Ok" />
    <bpmn:exclusiveGateway id="Gateway_Ok" default="Flow_no" />
    <bpmn:sequenceFlow id="Flow_yes" sourceRef="Gateway_Ok" targetRef="Yes">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="groovy" camunda:resource="deployment://cond.groovy" />
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_no" sourceRef="Gateway_Ok" targetRef="No" />
    <bpmn:userTask id="Yes" />
    <bpmn:userTask id="No" />`;

const RESOURCE_EVENT = `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="Event_Wait" />
    <bpmn:intermediateCatchEvent id="Event_Wait">
      <bpmn:conditionalEventDefinition id="CDef" camunda:variableName="x">
        <bpmn:condition xsi:type="bpmn:tFormalExpression" language="groovy" camunda:resource="deployment://ready.groovy" />
      </bpmn:conditionalEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Event_Wait" targetRef="End" />
    <bpmn:endEvent id="End" />`;

describe('1. removing the script resource of a condition never leaves an empty condition', () => {
  it('a flow: condition.camunda:resource= alone is refused (E_INVALID_VALUE) and nothing changes', async () => {
    const doc = await load(RESOURCE_FLOW, { nsDecl: CAMUNDA });
    const before = await doc.toXml();
    const err = caught(() => run(doc, [{ op: 'set', id: 'Flow_yes', values: { 'condition.camunda:resource': '' } }]));
    expect(err.code).toBe('E_INVALID_VALUE');
    expect(err.message).toMatch(/deployment:\/\/cond\.groovy would leave the condition empty/);
    expect(String(err.details['hint'])).toContain("condition.camunda:resource= 'condition=${...}'");
    expect(String(err.details['hint'])).toContain('condition=`');
    expect(await doc.toXml()).toBe(before);
    // --unset is the same request
    expect(caught(() => run(doc, [{ op: 'set', id: 'Flow_yes', unset: ['condition.camunda:resource'] }])).code).toBe('E_INVALID_VALUE');
  });

  it('a flow: together with condition=<expr> the resource becomes an inline condition (engines: x=5 -> Yes, x=0 -> No)', async () => {
    const doc = await load(RESOURCE_FLOW, { nsDecl: CAMUNDA });
    const cs = run(doc, [{ op: 'set', id: 'Flow_yes', values: { 'condition.camunda:resource': '', condition: '${x > 1}' } }]);
    const expr = doc.require('Flow_yes').get<El>('conditionExpression');
    expect(expr.get('body')).toBe('${x > 1}');
    expect(expr.$attrs['camunda:resource']).toBeUndefined();
    expect(expr.get('language')).toBeUndefined();
    // the groovy language does not fit a ${...} body: reported, the resource itself is not (it was asked for)
    expect(cs.warnings.map((w) => w.message)).toEqual([expect.stringMatching(/^language groovy of the condition of Flow_yes was dropped/)]);
  });

  it('a flow: together with condition= (empty) the whole condition goes', async () => {
    const doc = await load(RESOURCE_FLOW, { nsDecl: CAMUNDA });
    run(doc, [{ op: 'set', id: 'Flow_yes', values: { 'condition.camunda:resource': '', condition: '' } }]);
    expect(doc.require('Flow_yes').get('conditionExpression')).toBeUndefined();
  });

  it('a flow with an inline body keeps working: removing a stray resource is fine', async () => {
    const doc = await load(RESOURCE_FLOW.replace('camunda:resource="deployment://cond.groovy" />', 'camunda:resource="deployment://cond.groovy">x &gt; 1</bpmn:conditionExpression>'), { nsDecl: CAMUNDA });
    run(doc, [{ op: 'set', id: 'Flow_yes', values: { 'condition.camunda:resource': '' } }]);
    expect(doc.require('Flow_yes').get<El>('conditionExpression').get('body')).toBe('x > 1');
  });

  it('a conditional event: refused alone; with when= the inline condition replaces it without a redundant drop warning', async () => {
    const doc = await load(RESOURCE_EVENT, { nsDecl: CAMUNDA });
    const err = caught(() => run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'condition.camunda:resource': '' } }]));
    expect(err.code).toBe('E_INVALID_VALUE');
    expect(String(err.details['hint'])).toContain("condition.camunda:resource= 'when=${...}'");
    const cs = run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'condition.camunda:resource': '', when: '${x > 1}' } }]);
    const def = doc.require('CDef');
    expect(def.get<El>('condition').get('body')).toBe('${x > 1}');
    expect(def.get<El>('condition').$attrs['camunda:resource']).toBeUndefined();
    expect(def.$attrs['camunda:variableName']).toBe('x');
    expect(cs.warnings.map((w) => w.message)).toEqual([expect.stringMatching(/^language groovy of the condition of Event_Wait was dropped/)]);
  });

  it('the hint of a resource replacing an inline body names the one command back', async () => {
    const doc = await load(RESOURCE_FLOW.replace(' language="groovy" camunda:resource="deployment://cond.groovy" />', '>${ok}</bpmn:conditionExpression>'), { nsDecl: CAMUNDA });
    const cs = run(doc, [{ op: 'set', id: 'Flow_yes', values: { 'condition.camunda:resource': 'deployment://c.groovy', 'condition.language': 'groovy' } }]);
    expect(cs.warnings[0]!.hint).toContain("`bpmn set <file> Flow_yes condition.camunda:resource= 'condition=<expression>'`");
  });
});

/* ------------------------------------------------------------------ */
/* 2. events with several event definitions                             */
/* ------------------------------------------------------------------ */

const MULTI = `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="Event_Wait" />
    <bpmn:intermediateCatchEvent id="Event_Wait">
      <bpmn:messageEventDefinition id="MDef" messageRef="Message_MM" />
      <bpmn:timerEventDefinition id="TDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Event_Wait" targetRef="End" />
    <bpmn:endEvent id="End" />`;
const MULTI_ROOTS = '  <bpmn:message id="Message_MM" name="MM" />';

describe('2. definition.<key> on an event with several event definitions', () => {
  it('is ambiguous (E_AMBIGUOUS_NESTED) and lists the definitions with their selectors; nothing changes', async () => {
    const doc = await load(MULTI, { nsDecl: CAMUNDA, extraRoots: MULTI_ROOTS });
    const err = caught(() => run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition.camunda:asyncBefore': 'true' } }]));
    expect(err.code).toBe('E_AMBIGUOUS_NESTED');
    expect(err.message).toContain('definition[0] = messageEventDefinition MDef, definition[1] = timerEventDefinition TDef');
    expect(err.details['candidates']).toEqual(['definition[0]', 'definition[1]']);
    expect(String(err.details['hint'])).toContain("'definition[1].camunda:asyncBefore=<value>'");
    expect(String(err.details['hint'])).toContain("'definition[timer].camunda:asyncBefore=<value>'");
    expect(doc.require('MDef').$attrs['camunda:asyncBefore']).toBeUndefined();
    expect(caught(() => run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition.id': 'X' } }])).code).toBe('E_AMBIGUOUS_NESTED');
    expect(doc.has('MDef')).toBe(true);
  });

  it('definition[<n>] and definition[<trigger>] edit the one they name', async () => {
    const doc = await load(MULTI, { nsDecl: CAMUNDA, extraRoots: MULTI_ROOTS });
    run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition[timer].id': 'TDef2', 'definition[0].id': 'MDef2' } }]);
    expect(doc.require('TDef2').$type).toBe('bpmn:TimerEventDefinition');
    expect(doc.require('MDef2').$type).toBe('bpmn:MessageEventDefinition');
    const cs = run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition[message].camunda:topic': 'mail' } }]);
    expect(doc.require('MDef2').$attrs['camunda:topic']).toBe('mail');
    expect(doc.require('TDef2').$attrs['camunda:topic']).toBeUndefined();
    expect(cs.changed[0]!.detail).toBe('definition[message].camunda:topic=mail');
    // a camunda attribute the selected definition cannot carry is still refused (E_WRONG_HOST)
    expect(caught(() => run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition[1].camunda:topic': 'x' } }])).code).toBe('E_WRONG_HOST');
  });

  it('a selector that matches nothing is E_NO_NESTED_ELEMENT, a bad one E_UNKNOWN_KEY (also on loop.)', async () => {
    const doc = await load(MULTI, { nsDecl: CAMUNDA, extraRoots: MULTI_ROOTS });
    expect(caught(() => run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition[2].id': 'X' } }])).code).toBe('E_NO_NESTED_ELEMENT');
    expect(caught(() => run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition[signal].id': 'X' } }])).code).toBe('E_NO_NESTED_ELEMENT');
    expect(caught(() => run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition[foo].id': 'X' } }])).code).toBe('E_UNKNOWN_KEY');
    const task = await load('<bpmn:userTask id="T"><bpmn:multiInstanceLoopCharacteristics /></bpmn:userTask>', { nsDecl: CAMUNDA });
    expect(caught(() => run(task, [{ op: 'set', id: 'T', values: { 'loop[0].camunda:collection': 'x' } }])).code).toBe('E_UNKNOWN_KEY');
  });

  it('a single event definition still answers to definition. (and to its selectors)', async () => {
    const doc = await load(MULTI.replace(/<bpmn:timerEventDefinition[\s\S]*?<\/bpmn:timerEventDefinition>/, ''), { nsDecl: CAMUNDA, extraRoots: MULTI_ROOTS });
    run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition.id': 'M1' } }]);
    run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition[message].id': 'M2' } }]);
    expect(doc.require('M2').$type).toBe('bpmn:MessageEventDefinition');
    expect(readProperties(doc, doc.require('Event_Wait'))['definition.id']).toBe('M2');
  });

  it('show lists every event definition under its selector; the model view names them all', async () => {
    const doc = await load(MULTI, { nsDecl: CAMUNDA, extraRoots: MULTI_ROOTS });
    const props = readProperties(doc, doc.require('Event_Wait'));
    expect(props).toMatchObject({ 'definition[0]': 'messageEventDefinition', 'definition[0].id': 'MDef', 'definition[1]': 'timerEventDefinition', 'definition[1].id': 'TDef' });
    expect(props['definition.id']).toBeUndefined();
    const text = renderDetail(elementDetail(doc, doc.require('Event_Wait')));
    expect(text).toContain('definition[1]: timerEventDefinition');
    expect(text).toContain('definition[1].id: TDef');
    expect(renderView(buildView(doc))).toMatch(/intermediateCatchEvent:message Event_Wait \[message MM, definitions=message\+timer\]/);
  });

  it('setting the trigger of one of them keeps that definition (id, value) and reports the others as dropped', async () => {
    const doc = await load(MULTI, { nsDecl: CAMUNDA, extraRoots: MULTI_ROOTS });
    const cs = run(doc, [{ op: 'set', id: 'Event_Wait', values: { trigger: 'timer' } }]);
    const defs = doc.require('Event_Wait').get<El[]>('eventDefinitions');
    expect(defs.map((d) => d.get('id'))).toEqual(['TDef']);
    expect(defs[0]!.get<El>('timeDuration').get('body')).toBe('PT1H');
    expect(doc.has('MDef')).toBe(false);
    expect(cs.warnings).toEqual([expect.objectContaining({ code: 'W_PROPERTY_DROPPED', message: 'messageEventDefinition MDef of Event_Wait was dropped: trigger=timer keeps only its timerEventDefinition TDef (an event acts on one event definition)' })]);
    // with only one definition left, definition. works again
    run(doc, [{ op: 'set', id: 'Event_Wait', values: { 'definition.id': 'Timer_1' } }]);
    expect(doc.require('Timer_1').$type).toBe('bpmn:TimerEventDefinition');
  });

  it('ext takes the same selector; ext list numbers each definition', async () => {
    const doc = await load(MULTI, { nsDecl: CAMUNDA, extraRoots: MULTI_ROOTS });
    expect(caught(() => run(doc, [{ op: 'ext', id: 'Event_Wait', action: 'add', type: 'definition.camunda:properties' }])).code).toBe('E_AMBIGUOUS_NESTED');
    run(doc, [{ op: 'ext', id: 'Event_Wait', action: 'add', type: 'definition[timer].camunda:property', attrs: { name: 'p', value: 'v' } }]);
    expect(doc.require('TDef').get<El>('extensionElements')).toBeDefined();
    expect(doc.require('MDef').get<El | undefined>('extensionElements')).toBeUndefined();
    expect(renderExtensionList(listAllExtensions(doc.require('Event_Wait')))).toBe('definition[1].0: camunda:properties\n                   camunda:property name="p" value="v"');
    const cs = run(doc, [{ op: 'ext', id: 'Event_Wait', action: 'remove', type: 'definition[1].0' }]);
    expect(cs.changed[0]!.detail).toBe('ext removed definition[1].camunda:properties');
    expect(doc.require('TDef').get<El | undefined>('extensionElements')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 3. activityRef of a compensation throw event                         */
/* ------------------------------------------------------------------ */

const COMPENSATION = `
    <bpmn:startEvent id="Event_Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Event_Start" targetRef="Activity_Host" />
    <bpmn:userTask id="Activity_Host" />
    <bpmn:sequenceFlow id="F2" sourceRef="Activity_Host" targetRef="Activity_Sub" />
    <bpmn:subProcess id="Activity_Sub">
      <bpmn:startEvent id="Sub_Start" />
      <bpmn:sequenceFlow id="S1" sourceRef="Sub_Start" targetRef="Activity_Inner" />
      <bpmn:userTask id="Activity_Inner" />
      <bpmn:sequenceFlow id="S2" sourceRef="Activity_Inner" targetRef="Sub_Throw" />
      <bpmn:intermediateThrowEvent id="Sub_Throw"><bpmn:compensateEventDefinition /></bpmn:intermediateThrowEvent>
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F3" sourceRef="Activity_Sub" targetRef="Event_Send" />
    <bpmn:intermediateThrowEvent id="Event_Send"><bpmn:compensateEventDefinition /></bpmn:intermediateThrowEvent>
    <bpmn:subProcess id="Activity_Esp" triggeredByEvent="true">
      <bpmn:startEvent id="Esp_Start"><bpmn:signalEventDefinition /></bpmn:startEvent>
      <bpmn:sequenceFlow id="E1" sourceRef="Esp_Start" targetRef="Esp_Throw" />
      <bpmn:intermediateThrowEvent id="Esp_Throw"><bpmn:compensateEventDefinition /></bpmn:intermediateThrowEvent>
    </bpmn:subProcess>`;

describe('3. definition.activityRef must name an activity of the throw event’s scope', () => {
  const setRef = (doc: Doc, id: string, ref: string) => run(doc, [{ op: 'set', id, values: { 'definition.activityRef': ref } }]);

  it('an activity inside a sub-process is refused (E_CROSS_SCOPE; all 3 engines: "no activity with id ... in scope")', async () => {
    const doc = await load(COMPENSATION, { nsDecl: CAMUNDA });
    const err = caught(() => setRef(doc, 'Event_Send', 'Activity_Inner'));
    expect(err.code).toBe('E_CROSS_SCOPE');
    expect(err.message).toContain('Activity_Inner is in Activity_Sub, not in the scope of Event_Send (Process_1)');
    expect(err.details['candidates']).toEqual(['Activity_Host', 'Activity_Sub']);
    expect(doc.require('Event_Send').get<El[]>('eventDefinitions')[0]!.get('activityRef')).toBeUndefined();
  });

  it('activities of the same scope pass (engines deploy activityRef=Activity_Sub / Activity_Host)', async () => {
    const doc = await load(COMPENSATION, { nsDecl: CAMUNDA });
    setRef(doc, 'Event_Send', 'Activity_Sub');
    setRef(doc, 'Event_Send', 'Activity_Host');
    setRef(doc, 'Sub_Throw', 'Activity_Inner');
    expect(doc.require('Event_Send').get<El[]>('eventDefinitions')[0]!.get<El>('activityRef').get('id')).toBe('Activity_Host');
  });

  it('a throw inside a sub-process cannot name an outer activity; one in an event sub-process can (engines agree)', async () => {
    const doc = await load(COMPENSATION, { nsDecl: CAMUNDA });
    expect(caught(() => setRef(doc, 'Sub_Throw', 'Activity_Host')).code).toBe('E_CROSS_SCOPE');
    setRef(doc, 'Esp_Throw', 'Activity_Host');
    setRef(doc, 'Esp_Throw', 'Activity_Sub');
    expect(caught(() => setRef(doc, 'Esp_Throw', 'Activity_Inner')).code).toBe('E_CROSS_SCOPE');
  });
});

/* ------------------------------------------------------------------ */
/* 4. keyed replacement in ext add                                      */
/* ------------------------------------------------------------------ */

const FORM = `
    <bpmn:userTask id="Activity_Inner">
      <bpmn:extensionElements>
        <camunda:formData>
          <camunda:formField id="amount" type="long" label="Amount">
            <camunda:properties><camunda:property id="p1" value="v1" /></camunda:properties>
            <camunda:validation><camunda:constraint name="min" config="1" /></camunda:validation>
          </camunda:formField>
        </camunda:formData>
      </bpmn:extensionElements>
    </bpmn:userTask>`;

describe('4. ext add replacing a keyed item names what the old one held', () => {
  it('W_PROPERTY_DROPPED lists the lost attribute and children; its --xml keeps them', async () => {
    const doc = await load(FORM, { nsDecl: CAMUNDA });
    const cs = run(doc, [{ op: 'ext', id: 'Activity_Inner', action: 'add', type: 'camunda:formField', attrs: { id: 'amount', type: 'string' } }]);
    const w = cs.warnings.find((x) => x.code === 'W_PROPERTY_DROPPED')!;
    expect(w.message).toBe(
      'label="Amount", camunda:properties (camunda:property[id=p1]), camunda:validation (camunda:constraint[name=min]) of the replaced camunda:formField[id=amount] in camunda:formData of Activity_Inner were dropped: ext add replaces an item with the same id as a whole',
    );
    const xml = /--xml '(.*)'`\.$/.exec(w.hint!)![1]!;
    expect(xml).toBe(
      '<camunda:formField id="amount" type="string" label="Amount"><camunda:properties><camunda:property id="p1" value="v1" /></camunda:properties><camunda:validation><camunda:constraint name="min" config="1" /></camunda:validation></camunda:formField>',
    );
    expect(w.hint).toContain('`bpmn ext add <file> Activity_Inner camunda:formField --xml');
    // following the hint restores everything, with the new type, and drops nothing
    const again = run(doc, [{ op: 'ext', id: 'Activity_Inner', action: 'add', type: 'camunda:formField', xml }]);
    expect(codes(again.warnings)).toEqual([]);
    expect(renderExtensionList(listAllExtensions(doc.require('Activity_Inner')))).toBe(
      [
        '0: camunda:formData',
        '     camunda:formField id="amount" type="string" label="Amount"',
        '       camunda:properties',
        '         camunda:property id="p1" value="v1"',
        '       camunda:validation',
        '         camunda:constraint name="min" config="1"',
      ].join('\n'),
    );
  });

  it('no warning when nothing is lost, or when --replace asked for the whole item', async () => {
    const doc = await load(FORM, { nsDecl: CAMUNDA });
    const xml = '<camunda:formField id="amount" type="long" label="Amount"><camunda:properties><camunda:property id="p1" value="v1" /></camunda:properties><camunda:validation><camunda:constraint name="min" config="1" /></camunda:validation></camunda:formField>';
    expect(codes(run(doc, [{ op: 'ext', id: 'Activity_Inner', action: 'add', type: 'camunda:formField', xml }]).warnings)).toEqual([]);
    expect(codes(run(doc, [{ op: 'ext', id: 'Activity_Inner', action: 'add', type: 'camunda:formField', attrs: { id: 'amount' }, replace: true }]).warnings)).toEqual([]);
  });

  it('a replaced input parameter value is named too', async () => {
    const doc = await load('<bpmn:serviceTask id="S"><bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="a">${x}</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements></bpmn:serviceTask>', { nsDecl: CAMUNDA });
    const cs = run(doc, [{ op: 'ext', id: 'S', action: 'add', type: 'camunda:inputParameter', attrs: { name: 'a' } }]);
    expect(cs.warnings[0]!.message).toMatch(/^its value "\$\{x\}" of the replaced camunda:inputParameter\[name=a\]/);
  });
});

/* ------------------------------------------------------------------ */
/* 5. multi-line bodies in the text tree                                */
/* ------------------------------------------------------------------ */

describe('5. the text tree shows a multi-line body line by line', () => {
  const SCRIPT = 'def a = 1 < 2 && true\nreturn "x & y"';

  it('ext list / show print the script as a "|" block, JSON keeps the newline', async () => {
    const doc = await load(
      `<bpmn:serviceTask id="S"><bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="script"><camunda:script scriptFormat="groovy">def a = 1 &lt; 2 &amp;&amp; true
return "x &amp; y"</camunda:script></camunda:inputParameter><camunda:inputParameter name="b">1</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements></bpmn:serviceTask>`,
      { nsDecl: CAMUNDA },
    );
    const items = listAllExtensions(doc.require('S'));
    expect(JSON.stringify(items)).toContain(JSON.stringify(SCRIPT));
    expect(renderExtensionList(items)).toBe(
      [
        '0: camunda:inputOutput',
        '     camunda:inputParameter name="script"',
        '       camunda:script scriptFormat="groovy" body:',
        '         | def a = 1 < 2 && true',
        '         | return "x & y"',
        '     camunda:inputParameter name="b" body="1"',
      ].join('\n'),
    );
    expect(renderDetail(elementDetail(doc, doc.require('S')))).toContain('      camunda:script scriptFormat="groovy" body:\n        | def a = 1 < 2 && true\n        | return "x & y"');
  });

  it('keeps indentation and blank lines inside the body, drops the blank lines around it', () => {
    const lines = extensionLines({ type: 'camunda:script', attrs: {}, body: '\n  if (a) {\n\n    b()\n  }\n  ' });
    expect(lines).toEqual(['camunda:script body:', '  |   if (a) {', '  |', '  |     b()', '  |   }']);
    // a one-line body stays inline, quotes escaped, whitespace kept
    expect(extensionLines({ type: 'camunda:value', attrs: {}, body: ' a  "b" ' })).toEqual(['camunda:value body="a  \\"b\\""']);
  });
});

/* ------------------------------------------------------------------ */
/* 6. ops JSON ext remove by index                                      */
/* ------------------------------------------------------------------ */

describe('6. ops JSON ext remove takes the `ext list` index like the CLI', () => {
  const LOOP = `<bpmn:userTask id="Activity_Inner"><bpmn:multiInstanceLoopCharacteristics camunda:collection="\${xs}" camunda:asyncBefore="true"><bpmn:extensionElements><camunda:failedJobRetryTimeCycle>R3/PT5M</camunda:failedJobRetryTimeCycle></bpmn:extensionElements></bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>`;

  it('"type": "loop.0" removes the loop characteristics’ first extension element', async () => {
    const doc = await load(LOOP, { nsDecl: CAMUNDA });
    const ops = parseOps([{ op: 'ext', id: 'Activity_Inner', action: 'remove', type: 'loop.0' }]);
    const r = await mutateDoc(doc, ops, { dryRun: true, layout: false });
    expect(r.changes.changed[0]!.detail).toBe('ext removed loop.camunda:failedJobRetryTimeCycle');
    expect(doc.require('Activity_Inner').get<El>('loopCharacteristics').get('extensionElements')).toBeUndefined();
  });

  it('"type": "0" with "slot", and a disagreeing slot is a usage error', async () => {
    const doc = await load(LOOP, { nsDecl: CAMUNDA });
    expect(caught(() => run(doc, [{ op: 'ext', id: 'Activity_Inner', action: 'remove', type: 'definition.0', slot: 'loop' }])).code).toBe('E_USAGE');
    run(doc, [{ op: 'ext', id: 'Activity_Inner', action: 'remove', type: '0', slot: 'loop' }]);
    expect(doc.require('Activity_Inner').get<El>('loopCharacteristics').get('extensionElements')).toBeUndefined();
  });

  it('notes about a nested element name it (no empty name)', async () => {
    const doc = await load(LOOP, { nsDecl: CAMUNDA });
    const cs = run(doc, [{ op: 'ext', id: 'Activity_Inner', action: 'add', type: 'loop.camunda:failedJobRetryTimeCycle', body: 'R3/PT5M' }]);
    expect(cs.notes).toEqual(['camunda:failedJobRetryTimeCycle of the loop characteristics of Activity_Inner already holds that content; nothing to add']);
  });
});

/* ------------------------------------------------------------------ */
/* 7. event-based gateway rule: engines in C7 files, BPMN 2.0 elsewhere */
/* ------------------------------------------------------------------ */

/** start -> G -> [M (message) -> R (receive task) -> End] and [T (timer) -> End_T]. */
const GATEWAY = `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="Gateway_G" />
    <bpmn:eventBasedGateway id="Gateway_G" />
    <bpmn:sequenceFlow id="F_M" sourceRef="Gateway_G" targetRef="Event_M" />
    <bpmn:intermediateCatchEvent id="Event_M"><bpmn:messageEventDefinition messageRef="Message_M" /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F_R" sourceRef="Event_M" targetRef="Activity_R" />
    <bpmn:receiveTask id="Activity_R" messageRef="Message_R" />
    <bpmn:sequenceFlow id="F_E" sourceRef="Activity_R" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="F_T" sourceRef="Gateway_G" targetRef="Event_T" />
    <bpmn:intermediateCatchEvent id="Event_T"><bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F_T2" sourceRef="Event_T" targetRef="End_T" />
    <bpmn:endEvent id="End_T" />`;
const GW_ROOTS = '  <bpmn:message id="Message_M" name="M" /><bpmn:message id="Message_R" name="R" /><bpmn:message id="Message_X" name="X" />';

describe('7. bridges next to an event-based gateway: the engines’ rule in C7 files, BPMN 2.0 in plain files', () => {
  it('a plain file may bridge the gateway to a receive task (BPMN 2.0 allows it)', async () => {
    const doc = await load(GATEWAY, { extraRoots: GW_ROOTS });
    const cs = removeElements(doc, { op: 'remove', ids: ['Event_M'] });
    expect(cs.notes).toContain('bridged: Gateway_G -> Activity_R');
    const r = await mutateDoc(doc, [], { dryRun: true, layout: false });
    expect(codes(r.validation.warnings)).not.toContain('W_EVENT_GATEWAY_TARGET');
  });

  it('a C7 file refuses the same bridge (the engines reject receive tasks there)', async () => {
    const doc = await load(GATEWAY, { nsDecl: CAMUNDA, extraRoots: GW_ROOTS });
    const err = caught(() => removeElements(doc, { op: 'remove', ids: ['Event_M'] }));
    expect(err.code).toBe('E_INVALID_BRIDGE');
    expect(err.message).toMatch(/to Activity_R, which the engines reject: receiveTask Activity_R is not an intermediate catch event/);
  });

  it('plain files still refuse what BPMN 2.0 forbids (a task, receive tasks mixed with message events), naming BPMN 2.0', async () => {
    const task = await load(GATEWAY.replace('<bpmn:receiveTask id="Activity_R" messageRef="Message_R" />', '<bpmn:userTask id="Activity_R" />'), { extraRoots: GW_ROOTS });
    const err = caught(() => removeElements(task, { op: 'remove', ids: ['Event_M'] }));
    expect(err.code).toBe('E_INVALID_BRIDGE');
    expect(err.message).toMatch(/which BPMN 2\.0 does not allow: userTask Activity_R is neither an intermediate catch event nor a receive task/);
    // a second message branch makes the receive task a mixed configuration
    const mixed = await load(
      `${GATEWAY}
    <bpmn:sequenceFlow id="F_X" sourceRef="Gateway_G" targetRef="Event_X" />
    <bpmn:intermediateCatchEvent id="Event_X"><bpmn:messageEventDefinition messageRef="Message_X" /></bpmn:intermediateCatchEvent>`,
      { extraRoots: GW_ROOTS },
    );
    expect(caught(() => removeElements(mixed, { op: 'remove', ids: ['Event_M'] })).message).toMatch(/Event_X on another branch of Gateway_G is a message catch event; BPMN 2\.0 does not mix receive tasks and message catch events/);
    const g = mixed.require('Gateway_G');
    expect(eventGatewayTargetProblem(mixed, g, mixed.require('Event_T'))).toMatch(/already has the incoming flow F_T/);
  });

  it('connect and add warn about the targets a bridge refuses (plain file: W_EVENT_GATEWAY_TARGET from the op)', async () => {
    const doc = await load(
      `${GATEWAY}
    <bpmn:receiveTask id="Activity_R2" messageRef="Message_X" />`,
      { extraRoots: GW_ROOTS },
    );
    const cs = run(doc, [{ op: 'connect', source: 'Gateway_G', target: 'Activity_R2' }]);
    expect(cs.warnings).toEqual([
      expect.objectContaining({ code: 'W_EVENT_GATEWAY_TARGET', element: 'Gateway_G', message: expect.stringMatching(/now leads to Activity_R2 .*Event_M on another branch of Gateway_G is a message catch event/) }),
    ]);
    const added = run(doc, [{ op: 'add', kind: 'receiveTask', name: 'R3', after: 'Gateway_G', message: 'R3' } as Op]);
    expect(codes(added.warnings)).toContain('W_EVENT_GATEWAY_TARGET');
    // a timer catch event is fine (checked once its trigger is set)
    const timer = run(doc, [{ op: 'add', kind: 'intermediateCatchEvent:timer', name: 'Later', after: 'Gateway_G', timer: 'PT2H' } as Op]);
    expect(codes(timer.warnings)).not.toContain('W_EVENT_GATEWAY_TARGET');
    // move to a place behind the gateway: the same warning
    const loose = await load(`${GATEWAY}<bpmn:receiveTask id="Activity_R4" messageRef="Message_X" />`, { extraRoots: GW_ROOTS });
    expect(codes(run(loose, [{ op: 'move', ids: ['Activity_R4'], after: 'Gateway_G' }]).warnings)).toContain('W_EVENT_GATEWAY_TARGET');
  });

  it('in a C7 file connect leaves the report to the profile (W_C7_DEPLOY_EVENT_GATEWAY), no op warning', async () => {
    const doc = await load(`${GATEWAY}<bpmn:receiveTask id="Activity_R2" messageRef="Message_X" />`, { nsDecl: CAMUNDA, extraRoots: GW_ROOTS });
    const r = await mutateDoc(doc, [{ op: 'connect', source: 'Gateway_G', target: 'Activity_R2' }], { dryRun: true, layout: false });
    expect(codes(r.changes.warnings)).not.toContain('W_EVENT_GATEWAY_TARGET');
    expect(codes(r.validation.warnings)).toContain('W_C7_DEPLOY_EVENT_GATEWAY');
  });
});

/* ------------------------------------------------------------------ */
/* 8. two loopCharacteristics on one task                               */
/* ------------------------------------------------------------------ */

const BOTH = `
    <bpmn:userTask id="Activity_Inner">
      <bpmn:standardLoopCharacteristics id="SL" loopMaximum="3" />
      <bpmn:multiInstanceLoopCharacteristics id="MI" camunda:collection="\${xs}" camunda:elementVariable="x" />
    </bpmn:userTask>`;

describe('8. an element that appears twice where the schema allows one is not dropped silently', () => {
  it('loading reports it (lossy import warning), show prints it', async () => {
    const doc = await Doc.fromXml(definitionsXml(BOTH, { nsDecl: CAMUNDA }));
    const msg = 'duplicate element: <bpmn:userTask id="Activity_Inner"> has more than one loopCharacteristics (the schema allows one); only the last one, multiInstanceLoopCharacteristics MI, can be kept, standardLoopCharacteristics SL would be dropped';
    expect(doc.lossyImportWarnings.map((w) => w.message)).toEqual([msg]);
    expect(renderView(buildView(doc)).split('\n')[0]).toBe(`import: ${msg}`);
  });

  it('a write is refused (E_IMPORT_LOSSY) unless forced; forced, the last one is kept (engines deploy it, the input is refused)', async () => {
    const doc = await Doc.fromXml(definitionsXml(BOTH, { nsDecl: CAMUNDA }));
    const err = await rejected(mutateDoc(doc, [{ op: 'set', id: 'Activity_Inner', values: { name: 'Renamed' } }], { dryRun: true, layout: false }));
    expect(err.code).toBe('E_IMPORT_LOSSY');
    const r = await mutateDoc(doc, [{ op: 'set', id: 'Activity_Inner', values: { name: 'Renamed' } }], { dryRun: true, layout: false, force: true });
    expect(r.xml).toContain('<bpmn:multiInstanceLoopCharacteristics id="MI"');
    expect(r.xml).not.toContain('standardLoopCharacteristics');
  });

  it('other single elements are watched too (two conditionExpressions); valid files raise nothing', async () => {
    const two = await Doc.fromXml(
      definitionsXml(`
    <bpmn:task id="A" /><bpmn:task id="B" />
    <bpmn:sequenceFlow id="F" sourceRef="A" targetRef="B"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${a}</bpmn:conditionExpression><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${b}</bpmn:conditionExpression></bpmn:sequenceFlow>`),
    );
    expect(two.lossyImportWarnings.map((w) => w.message)).toEqual([expect.stringMatching(/^duplicate element: <bpmn:sequenceFlow id="F"> has more than one conditionExpression/)]);
    const fine = await Doc.fromXml(definitionsXml(BOTH.replace(/<bpmn:standardLoopCharacteristics[^>]*\/>/, ''), { nsDecl: CAMUNDA }));
    expect(fine.importWarnings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 9. retype in a C7 file: one report per stale item                    */
/* ------------------------------------------------------------------ */

describe('9. retype in a C7 file: the profile findings replace W_PROPERTY_INAPPLICABLE', () => {
  const XML = definitionsXml(
    `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Activity_Review" />
    <bpmn:userTask id="Activity_Review" camunda:assignee="demo" camunda:candidateGroups="g">
      <bpmn:extensionElements><camunda:taskListener event="create" class="a.B" /></bpmn:extensionElements>
    </bpmn:userTask>
    <bpmn:sequenceFlow id="F2" sourceRef="Activity_Review" targetRef="End" />
    <bpmn:endEvent id="End" />`,
    { nsDecl: CAMUNDA },
  );
  const retype: Op[] = [{ op: 'retype', id: 'Activity_Review', kind: 'serviceTask' }];

  it('drops the summary when the added W_C7_MISPLACED_* findings name every item (mutateDoc reports each item once)', async () => {
    const r = await mutateDoc(withMirrors(await Doc.fromXml(XML)), retype, { dryRun: true, layout: false });
    expect(codes(r.changes.warnings)).toEqual([]);
    expect(codes(r.validation.warnings).filter((c) => c.startsWith('W_C7_MISPLACED'))).toEqual(['W_C7_MISPLACED_ATTRIBUTE', 'W_C7_MISPLACED_ATTRIBUTE', 'W_C7_MISPLACED_EXTENSION']);
    // the op itself still reports the summary; the filter decides
    const cs = runOps(withMirrors(await Doc.fromXml(XML)), retype);
    expect(codes(cs.warnings)).toEqual(['W_PROPERTY_INAPPLICABLE']);
    expect(withoutProfileDuplicates(cs.warnings, r.validation.warnings)).toEqual([]);
    // the hidden list of covered items is not serialised
    expect(JSON.stringify(cs.warnings[0])).not.toContain('attr:');
  });

  it('keeps it without the profile (platform none) or when the profile does not cover an item', async () => {
    const off = await mutateDoc(withMirrors(await Doc.fromXml(XML)), retype, { dryRun: true, layout: false, platform: 'none' });
    expect(codes(off.changes.warnings)).toEqual(['W_PROPERTY_INAPPLICABLE']);
    const r = await mutateDoc(withMirrors(await Doc.fromXml(XML)), retype, { dryRun: true, layout: false });
    const cs = runOps(withMirrors(await Doc.fromXml(XML)), retype);
    const partial = r.validation.warnings.filter((w) => !(w.code === 'W_C7_MISPLACED_EXTENSION'));
    expect(codes(withoutProfileDuplicates(cs.warnings, partial))).toEqual(['W_PROPERTY_INAPPLICABLE']);
  });
});
