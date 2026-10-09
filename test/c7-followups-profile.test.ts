/**
 * Camunda 7 profile follow-ups: deploy rules the engines disagreed with
 * (script-resource and empty conditions, camunda:type="shell"), deploy
 * refusals the profile missed (start events, signal / message subscriptions
 * per scope, link events, timeout task listeners, compensation activityRef,
 * field values), throw-only / catch-only event definition settings, files in
 * Operaton's own namespace, the one platform detector behind the profile and
 * Doc.platform(), and hints that rebuild one repeatable extension element
 * without deleting its siblings.
 *
 * Every model in CASES states what Camunda 7.24, CIB seven 2.2 and Operaton
 * 2.1.5 do with it (deployed when the rules were written). `operaton` is
 * Operaton's verdict where it differs: only Operaton reads the operaton
 * namespace. To re-check against live engines set BPMN_C7_ENGINES to their
 * REST roots, comma-separated (the product name from /telemetry/data tells
 * Operaton apart), e.g.
 *   BPMN_C7_ENGINES=http://localhost:8080/engine-rest npx vitest run test/c7-followups-profile.test.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { platformOf } from '../src/platform/descriptor.js';
import { detectPlatform } from '../src/platform/detect.js';
import { runProfile } from '../src/platform/profile.js';
import { validateDoc } from '../src/validate.js';

const ROOT = join(import.meta.dirname, '..');
const BPMN = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
const OPERATON = 'xmlns:operaton="http://operaton.org/schema/1.0/bpmn"';
const ZEEBE = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"';
const MODELER = 'xmlns:modeler="http://camunda.org/schema/modeler/1.0"';
const C7 = `${CAMUNDA} ${MODELER} modeler:executionPlatform="Camunda Platform"`;

function xml(body: string, o: { ns?: string; roots?: string; attrs?: string; id?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${BPMN} ${o.ns ?? C7} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${o.roots ?? ''}
  <bpmn:process id="${o.id ?? 'P_FollowUp'}" isExecutable="true" ${o.attrs ?? 'camunda:historyTimeToLive="180"'}>
${body}
  </bpmn:process>
</bpmn:definitions>`;
}

/** start -> nodes (each [id, xml]) -> end */
function chain(nodes: Array<[string, string]>, extra = '', start = '<bpmn:startEvent id="Start" />'): string {
  const ids = ['Start', ...nodes.map(([id]) => id), 'End'];
  const flows = ids.slice(1).map((id, i) => `<bpmn:sequenceFlow id="F${i}" sourceRef="${ids[i]}" targetRef="${id}" />`);
  return [start, ...nodes.map(([, x]) => x), '<bpmn:endEvent id="End" />', ...flows, extra].join('\n');
}

const UT = (id = 'T', inner = ''): [string, string] => [id, `<bpmn:userTask id="${id}">${inner}</bpmn:userTask>`];
const ext = (inner: string): string => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const TIMER = '<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
const CYCLE = '<bpmn:timerEventDefinition><bpmn:timeCycle xsi:type="bpmn:tFormalExpression">R/PT1H</bpmn:timeCycle></bpmn:timerEventDefinition>';
const ROOTS = '<bpmn:signal id="Sig" name="Go" /><bpmn:signal id="Sig2" name="Go2" /><bpmn:message id="M" name="Pay" /><bpmn:message id="M2" name="Pay2" /><bpmn:message id="M3" name="Pay" />';
const cond = (inner: string): string => `<bpmn:conditionalEventDefinition>${inner}</bpmn:conditionalEventDefinition>`;
const catchEvent = (id: string, def: string): [string, string] => [id, `<bpmn:intermediateCatchEvent id="${id}">${def}</bpmn:intermediateCatchEvent>`];
const boundary = (id: string, host: string, def: string, attrs = ''): string => `<bpmn:boundaryEvent id="${id}" attachedToRef="${host}" ${attrs}>${def}</bpmn:boundaryEvent><bpmn:sequenceFlow id="F_${id}" sourceRef="${id}" targetRef="End_${id}" /><bpmn:endEvent id="End_${id}" />`;
const eventSub = (id: string, start: string, attrs = 'isInterrupting="false"'): string =>
  `<bpmn:subProcess id="${id}" triggeredByEvent="true"><bpmn:startEvent id="${id}_S" ${attrs}>${start}</bpmn:startEvent><bpmn:sequenceFlow id="${id}_F" sourceRef="${id}_S" targetRef="${id}_E" /><bpmn:endEvent id="${id}_E" /></bpmn:subProcess>`;
const sub = (id: string, inner: string, attrs = ''): [string, string] => [id, `<bpmn:subProcess id="${id}" ${attrs}>${inner}</bpmn:subProcess>`];
const subChain = (p: string, nodes: string[] = [], starts = 1): string => {
  const s = Array.from({ length: starts }, (_, i) => `<bpmn:startEvent id="${p}_S${i}" />`).join('');
  const flows = Array.from({ length: starts }, (_, i) => `<bpmn:sequenceFlow id="${p}_f${i}" sourceRef="${p}_S${i}" targetRef="${p}_E" />`).join('');
  return `${s}${nodes.join('')}<bpmn:endEvent id="${p}_E" />${flows}`;
};
const LINK_T = (id: string, name?: string): [string, string] => [id, `<bpmn:intermediateThrowEvent id="${id}"><bpmn:linkEventDefinition${name === undefined ? '' : ` name="${name}"`} /></bpmn:intermediateThrowEvent>`];
const LINK_C = (id: string, name?: string, to = 'End'): string =>
  `<bpmn:intermediateCatchEvent id="${id}"><bpmn:linkEventDefinition${name === undefined ? '' : ` name="${name}"`} /></bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="F_${id}" sourceRef="${id}" targetRef="${to}" />`;
const shell = (fields: string, tag = 'serviceTask', type = 'shell'): [string, string] => ['X', `<bpmn:${tag} id="X" camunda:type="${type}">${ext(fields)}</bpmn:${tag}>`];
const CMD = '<camunda:field name="command"><camunda:string>echo</camunda:string></camunda:field>';
const timeoutListener = (attrs: string): [string, string] => UT('T', ext(`<camunda:taskListener event="timeout" expression="\${true}" ${attrs}>${TIMER}</camunda:taskListener>`));

/** a compensation throw event Th with activityRef `ref`; Host at process level, Inner inside sub-process Sub */
function compensation(ref: string, where: 'process' | 'sub' | 'end' | 'eventSub' = 'process'): string {
  const thr = `<bpmn:intermediateThrowEvent id="Th"><bpmn:compensateEventDefinition activityRef="${ref}" /></bpmn:intermediateThrowEvent>`;
  const subBody =
    where === 'sub'
      ? `<bpmn:startEvent id="SS" /><bpmn:userTask id="Inner" />${thr}<bpmn:endEvent id="SE" /><bpmn:sequenceFlow id="s0" sourceRef="SS" targetRef="Inner" /><bpmn:sequenceFlow id="s1" sourceRef="Inner" targetRef="Th" /><bpmn:sequenceFlow id="s2" sourceRef="Th" targetRef="SE" />`
      : '<bpmn:startEvent id="SS" /><bpmn:userTask id="Inner" /><bpmn:endEvent id="SE" /><bpmn:sequenceFlow id="s0" sourceRef="SS" targetRef="Inner" /><bpmn:sequenceFlow id="s1" sourceRef="Inner" targetRef="SE" />';
  const nodes: Array<[string, string]> = [UT('Host'), sub('Sub', subBody)];
  if (where === 'process') nodes.push(['Th', thr]);
  const end = where === 'end' ? `<bpmn:endEvent id="End"><bpmn:compensateEventDefinition activityRef="${ref}" /></bpmn:endEvent>` : '<bpmn:endEvent id="End" />';
  const body = chain(nodes, where === 'eventSub' ? `<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ESS" isInterrupting="false"><bpmn:messageEventDefinition messageRef="M" /></bpmn:startEvent>${thr}<bpmn:endEvent id="ESE" /><bpmn:sequenceFlow id="e0" sourceRef="ESS" targetRef="Th" /><bpmn:sequenceFlow id="e1" sourceRef="Th" targetRef="ESE" /></bpmn:subProcess>` : '').replace('<bpmn:endEvent id="End" />', end);
  return xml(body, { roots: ROOTS });
}

interface Case {
  name: string;
  xml: string;
  /** the profile codes the model must produce (sorted multiset) */
  codes: string[];
  /** what Camunda 7.24 / CIB seven 2.2 (and Operaton 2.1.5 unless `operaton` says otherwise) do with it */
  engine: 'reject' | 'accept';
  operaton?: 'reject' | 'accept';
}

const CASES: Case[] = [
  // conditions: a script resource is a condition; an empty one deploys and fails when evaluated (runtime)
  { name: 'conditional event with a camunda:resource script condition', xml: xml(chain([catchEvent('W', cond('<bpmn:condition xsi:type="bpmn:tFormalExpression" language="groovy" camunda:resource="deployment://c.groovy" />'))])), codes: [], engine: 'accept' },
  { name: 'conditional event with an empty condition', xml: xml(chain([catchEvent('W', cond('<bpmn:condition xsi:type="bpmn:tFormalExpression" />'))])), codes: ['W_C7_EMPTY_CONDITION'], engine: 'accept' },
  { name: 'conditional start event with an empty groovy condition', xml: xml(chain([UT()], '', `<bpmn:startEvent id="Start">${cond('<bpmn:condition xsi:type="bpmn:tFormalExpression" language="groovy" />')}</bpmn:startEvent>`)), codes: ['W_C7_EMPTY_CONDITION'], engine: 'accept' },
  { name: 'conditional event without a condition element', xml: xml(chain([catchEvent('W', cond(''))])), codes: ['W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  {
    name: 'sequence flow with an empty condition (not on a default flow)',
    xml: xml(`<bpmn:startEvent id="Start" /><bpmn:userTask id="T" default="F3" /><bpmn:endEvent id="E1" /><bpmn:endEvent id="E2" /><bpmn:endEvent id="E3" />
<bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="T" />
<bpmn:sequenceFlow id="F1" sourceRef="T" targetRef="E1"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" /></bpmn:sequenceFlow>
<bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="E2"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${a}</bpmn:conditionExpression></bpmn:sequenceFlow>
<bpmn:sequenceFlow id="F3" sourceRef="T" targetRef="E3" />`),
    codes: ['W_C7_EMPTY_CONDITION'],
    engine: 'accept',
  },
  // camunda:type
  { name: 'shell task with a command field', xml: xml(chain([shell(CMD)])), codes: [], engine: 'accept' },
  { name: 'SHELL on a send task with a stringValue command and wait=TRUE', xml: xml(chain([shell('<camunda:field name="command" stringValue="echo" /><camunda:field name="wait" stringValue="TRUE" />', 'sendTask', 'SHELL')])), codes: [], engine: 'accept' },
  { name: 'shell message end event', xml: xml(chain([UT()]).replace('<bpmn:endEvent id="End" />', `<bpmn:endEvent id="End"><bpmn:messageEventDefinition camunda:type="shell">${ext(CMD)}</bpmn:messageEventDefinition></bpmn:endEvent>`)), codes: [], engine: 'accept' },
  { name: 'shell task without a command field', xml: xml(chain([shell('')])), codes: ['W_C7_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'shell task with an expression field', xml: xml(chain([shell('<camunda:field name="command" expression="${cmd}" />')])), codes: ['W_C7_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'shell task with wait=maybe', xml: xml(chain([shell(`${CMD}<camunda:field name="wait"><camunda:string>maybe</camunda:string></camunda:field>`)])), codes: ['W_C7_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'mail task', xml: xml(chain([shell('<camunda:field name="to" stringValue="a@b.c" /><camunda:field name="text" stringValue="x" />', 'serviceTask', 'mail')])), codes: ['W_C7_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  // field values where the engines read fields
  { name: 'class with a field without value', xml: xml(chain([['X', `<bpmn:serviceTask id="X" camunda:class="org.example.X">${ext('<camunda:field name="a" />')}</bpmn:serviceTask>`]])), codes: ['W_C7_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'delegateExpression task listener with a field without value', xml: xml(chain([UT('T', ext('<camunda:taskListener event="create" delegateExpression="${l}"><camunda:field name="a" /></camunda:taskListener>'))])), codes: ['W_C7_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'field with stringValue and a camunda:string element', xml: xml(chain([['X', `<bpmn:serviceTask id="X" camunda:class="org.example.X">${ext('<camunda:field name="a" stringValue="x"><camunda:string>y</camunda:string></camunda:field>')}</bpmn:serviceTask>`]])), codes: ['W_C7_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'fields of expression tasks, expression listeners and external tasks are not read', xml: xml(chain([['X', `<bpmn:serviceTask id="X" camunda:expression="\${true}">${ext('<camunda:field name="a" />')}</bpmn:serviceTask>`], UT('T', ext('<camunda:executionListener event="start" expression="${x}"><camunda:field name="a" /></camunda:executionListener>')), ['Y', `<bpmn:serviceTask id="Y" camunda:type="external" camunda:topic="t">${ext('<camunda:field name="a" />')}</bpmn:serviceTask>`]])), codes: [], engine: 'accept' },
  { name: 'field with an expression attribute (read by the engines)', xml: xml(chain([['X', `<bpmn:serviceTask id="X" camunda:class="org.example.X">${ext('<camunda:field name="a" stringValue="" expression="${y}" />')}</bpmn:serviceTask>`]])), codes: [], engine: 'accept' },
  // start events
  { name: 'two none start events', xml: xml(chain([UT()], '<bpmn:startEvent id="S2" /><bpmn:sequenceFlow id="FS2" sourceRef="S2" targetRef="T" />')), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'none and timer start event', xml: xml(chain([UT()], `<bpmn:startEvent id="S2">${CYCLE}</bpmn:startEvent><bpmn:sequenceFlow id="FS2" sourceRef="S2" targetRef="T" />`)), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'two timer start events', xml: xml(chain([UT()], `<bpmn:startEvent id="S2">${CYCLE}</bpmn:startEvent><bpmn:sequenceFlow id="FS2" sourceRef="S2" targetRef="T" />`, `<bpmn:startEvent id="Start">${CYCLE}</bpmn:startEvent>`)), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'none, message and signal start events', xml: xml(chain([UT()], '<bpmn:startEvent id="S2"><bpmn:messageEventDefinition messageRef="M" /></bpmn:startEvent><bpmn:startEvent id="S3"><bpmn:signalEventDefinition signalRef="Sig" /></bpmn:startEvent><bpmn:sequenceFlow id="FS2" sourceRef="S2" targetRef="T" /><bpmn:sequenceFlow id="FS3" sourceRef="S3" targetRef="T" />'), { roots: ROOTS }), codes: [], engine: 'accept' },
  { name: 'sub-process with two start events', xml: xml(chain([sub('Sub', subChain('Sub', [], 2))])), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'transaction with two start events', xml: xml(chain([['Sub', `<bpmn:transaction id="Sub">${subChain('Sub', [], 2)}</bpmn:transaction>`]])), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'event sub-process with two start events', xml: xml(chain([UT()], '<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ES1"><bpmn:messageEventDefinition messageRef="M" /></bpmn:startEvent><bpmn:startEvent id="ES2"><bpmn:messageEventDefinition messageRef="M2" /></bpmn:startEvent><bpmn:endEvent id="ESE" /><bpmn:sequenceFlow id="e1" sourceRef="ES1" targetRef="ESE" /><bpmn:sequenceFlow id="e2" sourceRef="ES2" targetRef="ESE" /></bpmn:subProcess>'), { roots: ROOTS }), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'process with nodes but no start event', xml: xml('<bpmn:userTask id="T" /><bpmn:endEvent id="End" /><bpmn:sequenceFlow id="F" sourceRef="T" targetRef="End" />'), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'process with only an event sub-process', xml: xml(eventSub('ES', '<bpmn:messageEventDefinition messageRef="M" />', ''), { roots: ROOTS }), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'sub-process with a task but no start event', xml: xml(chain([sub('Sub', '<bpmn:userTask id="ST" />')])), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  // subscriptions with one name in one engine scope
  { name: 'two signal start events on one signal', xml: xml(chain([UT()], '<bpmn:startEvent id="S2"><bpmn:signalEventDefinition signalRef="Sig" /></bpmn:startEvent><bpmn:sequenceFlow id="FS2" sourceRef="S2" targetRef="T" />', '<bpmn:startEvent id="Start"><bpmn:signalEventDefinition signalRef="Sig" /></bpmn:startEvent>'), { roots: ROOTS }), codes: ['W_C7_DEPLOY_SIGNAL'], engine: 'reject' },
  { name: 'two signal boundary events on one host', xml: xml(chain([UT()], boundary('B1', 'T', '<bpmn:signalEventDefinition signalRef="Sig" />') + boundary('B2', 'T', '<bpmn:signalEventDefinition signalRef="Sig" />', 'cancelActivity="false"')), { roots: ROOTS }), codes: ['W_C7_DEPLOY_SIGNAL'], engine: 'reject' },
  { name: 'two event sub-processes on one signal', xml: xml(chain([UT()], eventSub('ES1', '<bpmn:signalEventDefinition signalRef="Sig" />') + eventSub('ES2', '<bpmn:signalEventDefinition signalRef="Sig" />')), { roots: ROOTS }), codes: ['W_C7_DEPLOY_SIGNAL'], engine: 'reject' },
  { name: 'boundary event on a sub-process and an event sub-process in it, one signal', xml: xml(chain([sub('Sub', subChain('Sub', [eventSub('ES', '<bpmn:signalEventDefinition signalRef="Sig" />')]))], boundary('B1', 'Sub', '<bpmn:signalEventDefinition signalRef="Sig" />', 'cancelActivity="false"')), { roots: ROOTS }), codes: ['W_C7_DEPLOY_SIGNAL'], engine: 'reject' },
  { name: 'boundary event on a sub-process and an event sub-process in it, one message', xml: xml(chain([sub('Sub', subChain('Sub', [eventSub('ES', '<bpmn:messageEventDefinition messageRef="M" />')]))], boundary('B1', 'Sub', '<bpmn:messageEventDefinition messageRef="M" />', 'cancelActivity="false"')), { roots: ROOTS }), codes: ['W_C7_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'receive task and a boundary event on it, one message name', xml: xml(chain([['T', '<bpmn:receiveTask id="T" messageRef="M" />']], boundary('B1', 'T', '<bpmn:messageEventDefinition messageRef="M3" />')), { roots: ROOTS }), codes: ['W_C7_DEPLOY_MESSAGE'], engine: 'reject' },
  {
    name: 'separate scopes: start and event sub-process, start and boundary, multi-instance receive task and its boundary',
    xml: xml(
      chain(
        [['T', '<bpmn:receiveTask id="T" messageRef="M"><bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality>2</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics></bpmn:receiveTask>'], UT('U')],
        boundary('B1', 'T', '<bpmn:messageEventDefinition messageRef="M" />') + boundary('B2', 'U', '<bpmn:signalEventDefinition signalRef="Sig" />') + eventSub('ES', '<bpmn:signalEventDefinition signalRef="Sig" />'),
        '<bpmn:startEvent id="Start"><bpmn:signalEventDefinition signalRef="Sig" /></bpmn:startEvent>',
      ),
      { roots: ROOTS },
    ),
    codes: [],
    engine: 'accept',
  },
  // links
  { name: 'link throw event without a catch event', xml: xml('<bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="L" />' + LINK_T('L', 'L1')[1]), codes: ['W_C7_DEPLOY_LINK'], engine: 'reject' },
  { name: 'two link catch events with one name', xml: xml(chain([LINK_T('L', 'L1')]).replace('<bpmn:sequenceFlow id="F1" sourceRef="L" targetRef="End" />', '') + LINK_C('C1', 'L1') + LINK_C('C2', 'L1')), codes: ['W_C7_DEPLOY_LINK'], engine: 'reject' },
  {
    name: 'link catch events with one name in two sub-processes',
    xml: xml(
      chain(
        ['1', '2'].map((k): [string, string] => [`Sub${k}`, `<bpmn:subProcess id="Sub${k}"><bpmn:startEvent id="SS${k}" /><bpmn:sequenceFlow id="s${k}" sourceRef="SS${k}" targetRef="LT${k}" />${LINK_T(`LT${k}`, 'L1')[1]}${LINK_C(`C${k}`, 'L1', `SE${k}`)}<bpmn:endEvent id="SE${k}" /></bpmn:subProcess>`]),
      ),
    ),
    codes: ['W_C7_DEPLOY_LINK'],
    engine: 'reject',
  },
  { name: 'link throw event in the process, catch event in a sub-process', xml: xml('<bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="L" />' + LINK_T('L', 'L1')[1] + `<bpmn:subProcess id="Sub">${subChain('Sub', [LINK_C('C1', 'L1', 'Sub_E')])}</bpmn:subProcess>`), codes: ['W_C7_DEPLOY_LINK'], engine: 'reject' },
  { name: 'link catch event without a name', xml: xml(chain([UT()], LINK_C('C1'))), codes: ['W_C7_DEPLOY_LINK'], engine: 'reject' },
  { name: 'link pair, an unconnected throw event, a catch event without throw, empty names', xml: xml(chain([LINK_T('L', 'L1')]).replace('<bpmn:sequenceFlow id="F1" sourceRef="L" targetRef="End" />', '') + LINK_C('C1', 'L1') + LINK_T('Lonely', 'Nowhere')[1] + LINK_C('C2', 'L2') + LINK_C('C3', '')), codes: [], engine: 'accept' },
  // timeout task listeners
  { name: 'timeout task listener without id', xml: xml(chain([timeoutListener('')])), codes: ['W_C7_DEPLOY_LISTENER'], engine: 'reject' },
  { name: 'timeout task listener with an empty id', xml: xml(chain([timeoutListener('id=""')])), codes: [], engine: 'accept' },
  // compensation activityRef
  { name: 'compensation of an activity inside a sub-process from the process', xml: compensation('Inner'), codes: ['W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'compensation end event naming an activity inside a sub-process', xml: compensation('Inner', 'end'), codes: ['W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'compensation of a process activity from inside a sub-process', xml: compensation('Host', 'sub'), codes: ['W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'compensation naming a sequence flow', xml: compensation('F0'), codes: ['W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'compensation of the own scope, of the sub-process, from an event sub-process to its parent', xml: compensation('Host').replace('activityRef="Host"', 'activityRef="Sub"'), codes: [], engine: 'accept' },
  { name: 'compensation from an event sub-process of an activity of its parent scope', xml: compensation('Host', 'eventSub'), codes: [], engine: 'accept' },
  { name: 'compensation inside a sub-process of its own activity', xml: compensation('Inner', 'sub'), codes: [], engine: 'accept' },
  // event definition settings read on one side only (runtime)
  {
    name: 'throw-only and catch-only settings on the wrong side',
    xml: xml(
      chain(
        [catchEvent('W', '<bpmn:messageEventDefinition messageRef="M" camunda:type="external" camunda:topic="t" />'), catchEvent('W2', '<bpmn:signalEventDefinition signalRef="Sig" camunda:async="true" />'), ['Th', '<bpmn:intermediateThrowEvent id="Th"><bpmn:escalationEventDefinition escalationRef="Esc" camunda:escalationCodeVariable="c" /></bpmn:intermediateThrowEvent>']],
        '',
      ).replace('<bpmn:endEvent id="End" />', '<bpmn:endEvent id="End"><bpmn:errorEventDefinition errorRef="Err" camunda:errorCodeVariable="c" /></bpmn:endEvent>'),
      { roots: `${ROOTS}<bpmn:escalation id="Esc" name="Esc" escalationCode="E1" /><bpmn:error id="Err" name="Err" errorCode="E1" />` },
    ),
    codes: ['W_C7_MISPLACED_ATTRIBUTE', 'W_C7_MISPLACED_ATTRIBUTE', 'W_C7_MISPLACED_ATTRIBUTE', 'W_C7_MISPLACED_ATTRIBUTE', 'W_C7_MISPLACED_ATTRIBUTE'],
    engine: 'accept',
  },
  { name: 'field on a message catch event definition', xml: xml(chain([catchEvent('W', `<bpmn:messageEventDefinition messageRef="M">${ext('<camunda:field name="a" stringValue="x" />')}</bpmn:messageEventDefinition>`)]), { roots: ROOTS }), codes: ['W_C7_MISPLACED_EXTENSION'], engine: 'accept' },
  // Operaton's namespace: only Operaton reads it, operaton:* before camunda:*
  { name: 'Operaton-only file', xml: xml(chain([['X', '<bpmn:serviceTask id="X" operaton:type="external" operaton:topic="t" />']]), { ns: OPERATON, attrs: 'operaton:historyTimeToLive="180"' }), codes: [], engine: 'reject', operaton: 'accept' },
  { name: 'Operaton reads operaton:historyTimeToLive before camunda:historyTimeToLive', xml: xml(chain([UT()]), { ns: `${CAMUNDA} ${OPERATON}`, attrs: 'camunda:historyTimeToLive="180" operaton:historyTimeToLive="abc"' }), codes: ['W_C7_DEPLOY_HISTORY_TTL'], engine: 'accept', operaton: 'reject' },
  { name: 'one camunda:inputOutput and one operaton:inputOutput', xml: xml(chain([UT('T', ext('<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput><operaton:inputOutput><operaton:inputParameter name="b">2</operaton:inputParameter></operaton:inputOutput>'))]), { ns: `${CAMUNDA} ${OPERATON}` }), codes: [], engine: 'accept' },
  { name: 'two operaton:inputOutput', xml: xml(chain([UT('T', ext('<operaton:inputOutput><operaton:inputParameter name="a">1</operaton:inputParameter></operaton:inputOutput><operaton:inputOutput><operaton:inputParameter name="b">2</operaton:inputParameter></operaton:inputOutput>'))]), { ns: OPERATON, attrs: 'operaton:historyTimeToLive="180"' }), codes: ['W_C7_DEPLOY_DUPLICATE_EXTENSION'], engine: 'reject' },
];

describe('profile follow-ups: one synthetic model per rule', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const findings = runProfile(await Doc.fromXml(c.xml)).findings;
    expect(findings.map((f) => f.code).sort(), JSON.stringify(findings, null, 1)).toEqual([...c.codes].sort());
    // deploy findings exactly where the engine that reads the file refuses it
    const operatonFile = detectPlatform(await Doc.fromXml(c.xml)).operaton === true;
    expect(findings.some((f) => f.severity === 'deploy')).toBe((operatonFile ? (c.operaton ?? c.engine) : c.engine) === 'reject');
    expect(findings.every((f) => f.code.startsWith('W_C7_DEPLOY_') === (f.severity === 'deploy'))).toBe(true);
    for (const f of findings) expect(f.hint, `${f.code}: ${f.hint}`).toMatch(/`bpmn (set|add|remove|move|ext (add|remove|list)) <file> /);
  });

  it('an empty process (bpmn new) and an empty sub-process need a start event too (engine-checked)', async () => {
    expect(runProfile(Doc.create({ target: 'camunda7' })).findings.map((f) => f.code)).toEqual(['W_C7_DEPLOY_START_EVENT']);
    expect(runProfile(await Doc.fromXml(xml(chain([sub('Sub', '')])))).findings.map((f) => `${f.code} ${f.element}`)).toEqual(['W_C7_DEPLOY_START_EVENT Sub']);
  });

  it('names what to fix', async () => {
    const two = runProfile(await Doc.fromXml(CASES.find((c) => c.name === 'two none start events')!.xml)).findings[0]!;
    expect(two).toMatchObject({ element: 'S2', related: ['Start'] });
    expect(two.message).toContain('second none or timer start event of process P_FollowUp');
    const link = runProfile(await Doc.fromXml(CASES.find((c) => c.name === 'link throw event in the process, catch event in a sub-process')!.xml)).findings[0]!;
    expect(link).toMatchObject({ element: 'L', related: ['C1'] });
    expect(link.hint).toContain('--in P_FollowUp --link L1');
    const comp = runProfile(await Doc.fromXml(compensation('Inner'))).findings[0]!;
    expect(comp).toMatchObject({ element: 'Th', related: ['Inner'] });
    expect(comp.hint).toContain('(in P_FollowUp: Host, Sub)');
    const recv = runProfile(await Doc.fromXml(CASES.find((c) => c.name.startsWith('receive task and a boundary'))!.xml)).findings[0]!;
    expect(recv).toMatchObject({ element: 'B1', related: ['T'] });
    const side = runProfile(await Doc.fromXml(CASES.find((c) => c.name.startsWith('throw-only'))!.xml)).findings.find((f) => f.element === 'W')!;
    expect(side.message).toContain('read it on message throw and end events only');
    expect(side.hint).toContain('`bpmn set <file> W definition.camunda:type=`');
  });

  it('W_NO_START gives way to the engine finding about the same process', async () => {
    const doc = await Doc.fromXml(CASES.find((c) => c.name === 'process with nodes but no start event')!.xml);
    expect(validateDoc(doc).warnings.map((w) => w.code)).toContain('W_NO_START');
    const codes = validateDoc(doc, { platform: 'auto' }).warnings.map((w) => w.code);
    expect(codes).toContain('W_C7_DEPLOY_START_EVENT');
    expect(codes).not.toContain('W_NO_START');
  });
});

describe('one platform detector', () => {
  const cases: Array<[string, string, string, 'camunda7' | 'camunda8' | undefined]> = [
    ['Camunda Platform', C7, chain([UT()]), 'camunda7'],
    ['Operaton namespace only', OPERATON, chain([UT('T')]).replace('<bpmn:userTask id="T">', '<bpmn:userTask id="T" operaton:assignee="demo">'), 'camunda7'],
    ['camunda content with both namespaces declared', `${CAMUNDA} ${ZEEBE}`, chain([UT('T')]).replace('<bpmn:userTask id="T">', '<bpmn:userTask id="T" camunda:assignee="demo">'), 'camunda7'],
    ['executionPlatform Operaton', `${MODELER} modeler:executionPlatform="Operaton"`, chain([UT()]), 'camunda7'],
    ['zeebe content', `${ZEEBE} ${CAMUNDA}`, chain([UT('T', ext('<zeebe:formDefinition formKey="f" />'))]), 'camunda8'],
    ['nothing', '', chain([UT()]), undefined],
  ];
  it.each(cases)('Doc.platform() follows detectPlatform: %s', async (_name, ns, body, expected) => {
    const doc = await Doc.fromXml(xml(body, { ns, attrs: '' }));
    const p = detectPlatform(doc).platform;
    expect(platformOf(doc.definitions)).toBe(expected);
    expect(doc.platform()).toBe(p === 'c7' ? 'camunda7' : p === 'c8' ? 'camunda8' : undefined);
  });

  it('says when the file is read as Operaton reads it, and names both declared namespaces', async () => {
    const op = detectPlatform(await Doc.fromXml(xml(chain([UT()]), { ns: OPERATON, attrs: 'operaton:historyTimeToLive="180"' })));
    expect(op).toMatchObject({ platform: 'c7', source: 'namespace-use', operaton: true });
    expect(op.detail).toBe('1 operaton attribute(s)/element(s); only Operaton reads the operaton namespace, Camunda 7 and CIB seven ignore it');
    const declared = detectPlatform(await Doc.fromXml(xml(chain([UT()]), { ns: `${OPERATON} ${MODELER} modeler:executionPlatform="Camunda Platform"`, attrs: 'operaton:historyTimeToLive="180"' })));
    expect(declared).toMatchObject({ platform: 'c7', source: 'executionPlatform', operaton: true });
    const both = detectPlatform(await Doc.fromXml(xml(chain([UT()]), { ns: `${CAMUNDA} ${ZEEBE}`, attrs: '' })));
    expect(both).toMatchObject({ platform: 'none', detail: 'xmlns:camunda and xmlns:zeebe declared, but no vendor content tells which engine' });
    const camunda = detectPlatform(await Doc.fromXml(xml(chain([UT()]))));
    expect(camunda.operaton).toBeUndefined();
    const json = validateDoc(await Doc.fromXml(xml(chain([UT()]), { ns: OPERATON, attrs: 'operaton:historyTimeToLive="180"' })), { platform: 'auto' }).platform;
    expect(json).toMatchObject({ platform: 'c7', operaton: true, counts: { deploy: 0 } });
  });

  it('hints use the operaton prefix in an Operaton file', async () => {
    const [f] = runProfile(await Doc.fromXml(xml(chain([['X', '<bpmn:serviceTask id="X" />']]), { ns: OPERATON, attrs: 'operaton:historyTimeToLive="180"' }))).findings;
    expect(f).toMatchObject({ code: 'W_C7_DEPLOY_IMPLEMENTATION', element: 'X' });
    expect(f!.hint).toContain('operaton:type=external operaton:topic=<topic>');
  });
});

/* ------------------------------------------------------------------ */
/* hints that rebuild one repeatable extension element                  */
/* ------------------------------------------------------------------ */

/** The `bpmn ...` command lines of a hint, as argv (single quotes like a POSIX shell). */
function commandsOf(hint: string): string[][] {
  return [...hint.matchAll(/`(bpmn [^`]+)`/g)].map((m) => {
    const out: string[] = [];
    const re = /'((?:[^']|'\\'')*)'|(\S+)/g;
    let cur: RegExpExecArray | null;
    let arg = '';
    let last = -1;
    while ((cur = re.exec(m[1]!))) {
      const piece = cur[1] !== undefined ? cur[1].replace(/'\\''/g, "'") : cur[2]!;
      if (cur.index === last) arg += piece;
      else {
        if (last !== -1) out.push(arg);
        arg = piece;
      }
      last = re.lastIndex;
    }
    if (last !== -1) out.push(arg);
    return out.slice(1);
  });
}

describe('validate hints keep the siblings of a repeatable extension type', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-c7-fu-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function cli(...args: string[]): { code: number; out: string; err: string } {
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  }

  /** runs every command of the hint on `file`, filling the placeholders */
  function follow(hint: string, file: string, fill: Record<string, string>): void {
    const cmds = commandsOf(hint);
    expect(cmds.length).toBeGreaterThan(0);
    for (const argv of cmds) {
      expect(argv.join(' ')).not.toContain('--replace');
      const args = argv.map((a) => Object.entries(fill).reduce((s, [k, v]) => s.split(k).join(v), a.replace('<file>', file)));
      const r = cli(...args);
      expect(r.code, `${args.join(' ')}\n${r.out}\n${r.err}`).toBe(0);
    }
  }

  it('W_C7_DANGLING_REF: one error mapping is rebuilt, the other stays', async () => {
    const file = join(dir, 'dangling.bpmn');
    const task = `<bpmn:serviceTask id="X" camunda:type="external" camunda:topic="t">${ext('<camunda:errorEventDefinition id="CEED_1" errorRef="Error_Gone" expression="${true}" /><camunda:errorEventDefinition id="CEED_2" errorRef="Err" expression="${false}" />')}</bpmn:serviceTask>`;
    writeFileSync(file, xml(chain([['X', task]]), { roots: '<bpmn:error id="Err" name="Err" errorCode="E1" />' }));
    const f = runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings.find((x) => x.code === 'W_C7_DANGLING_REF')!;
    expect(f.hint).toContain("`bpmn ext remove <file> X 'camunda:errorEventDefinition[id=CEED_1]'`");
    follow(f.hint!, file, { '<errorId>': 'Err' });
    const after = await Doc.fromXml(readFileSync(file, 'utf8'));
    expect(runProfile(after).findings).toEqual([]);
    const ids = (after.get('X') as unknown as { extensionElements: { values: Array<{ id: string; errorRef: string }> } }).extensionElements.values.map((v) => `${v.id}:${v.errorRef}`);
    expect(ids.sort()).toEqual(['CEED_1:Err', 'CEED_2:Err']);
  }, 60000);

  it('W_C7_DEPLOY_LISTENER: one listener is rebuilt, the others stay; "take" only for take', async () => {
    const file = join(dir, 'listener.bpmn');
    writeFileSync(file, xml(chain([UT('T', ext('<camunda:executionListener event="end" expression="${a}" /><camunda:executionListener event="finish" expression="${b}" />'))])));
    const f = runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings.find((x) => x.code === 'W_C7_DEPLOY_LISTENER')!;
    expect(f.hint).not.toContain('take');
    expect(f.hint).toContain("'camunda:executionListener[event=finish]'");
    follow(f.hint!, file, { '<start|end>': 'start' });
    const after = await Doc.fromXml(readFileSync(file, 'utf8'));
    expect(runProfile(after).findings).toEqual([]);
    const events = (after.get('T') as unknown as { extensionElements: { values: Array<{ event: string; expression: string }> } }).extensionElements.values.map((v) => `${v.event}:${v.expression}`);
    expect(events.sort()).toEqual(['end:${a}', 'start:${b}']);
    const take = runProfile(await Doc.fromXml(xml(chain([UT('T', ext('<camunda:executionListener event="take" expression="${a}" />'))])))).findings[0]!;
    expect(take.hint).toMatch(/^take is only read on sequence flows/);
  }, 60000);

  it('W_C7_DEPLOY_EXTENSION on camunda:in of a signal event definition: the definition. slot', async () => {
    const file = join(dir, 'in.bpmn');
    writeFileSync(file, xml(chain([['Th', `<bpmn:intermediateThrowEvent id="Th"><bpmn:signalEventDefinition signalRef="Sig">${ext('<camunda:in source="a" target="a" /><camunda:in source="b" />')}</bpmn:signalEventDefinition></bpmn:intermediateThrowEvent>`]]), { roots: ROOTS }));
    const f = runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings.find((x) => x.code === 'W_C7_DEPLOY_EXTENSION')!;
    expect(f.hint).toContain("'definition.camunda:in[source=b]'");
    follow(f.hint!.replace(/ \(or with variables=all.*$/, ''), file, { '<var>': 'b' });
    expect(runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings).toEqual([]);
  }, 60000);

  it('a single-instance container is still rebuilt as a whole', async () => {
    const doc = await Doc.fromXml(xml(chain([UT('T', ext('<camunda:inputOutput><camunda:inputParameter name="a" foo="1">1</camunda:inputParameter></camunda:inputOutput>'))])));
    const f = runProfile(doc).findings.find((x) => x.code === 'W_C7_UNKNOWN_ATTRIBUTE')!;
    expect(f.hint).toContain('camunda:inputOutput --replace --xml');
  });
});

/* ------------------------------------------------------------------ */
/* live engines (opt-in)                                                */
/* ------------------------------------------------------------------ */

const ENGINES = (process.env['BPMN_C7_ENGINES'] ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

async function isOperaton(engine: string): Promise<boolean> {
  try {
    const res = await fetch(`${engine}/telemetry/data`);
    const body = (await res.json()) as { product?: { name?: string } };
    return /operaton/i.test(body.product?.name ?? '');
  } catch {
    return false;
  }
}

async function deploy(engine: string, name: string, bpmn: string): Promise<{ ok: boolean; message: string }> {
  const form = new FormData();
  form.append('deployment-name', name);
  form.append('deployment-source', 'bpmn-cli-test');
  form.append('enable-duplicate-filtering', 'false');
  form.append('data', new Blob([bpmn], { type: 'application/octet-stream' }), `${name}.bpmn`);
  const res = await fetch(`${engine}/deployment/create`, { method: 'POST', body: form });
  const body = (await res.json()) as { id?: string; message?: string };
  if (res.ok && body.id) {
    await fetch(`${engine}/deployment/${body.id}?cascade=true`, { method: 'DELETE' });
    return { ok: true, message: '' };
  }
  return { ok: false, message: body.message ?? String(res.status) };
}

describe.skipIf(!ENGINES.length)('live engines: the engines agree with CASES', () => {
  for (const engine of ENGINES) {
    it.each(CASES.map((c, i) => [c.name, c, i] as const))(`${engine}: %s`, async (_name, c, i) => {
      const operaton = await isOperaton(engine);
      const result = await deploy(engine, `bpmn-cli-c7-followups-${i}`, c.xml);
      expect(result.ok, result.message).toBe((operaton ? (c.operaton ?? c.engine) : c.engine) === 'accept');
    }, 30000);
  }
});
