/**
 * The Camunda 8 validation profile (src/platform/c8.ts): one synthetic model
 * per rule with the exact findings it must produce and what Camunda 8.9 does
 * with it, the zeebe descriptor lookup, the FEEL and timer value checks, and
 * the `validate` output for Camunda 8 files.
 *
 * Every model in CASES states the engine's verdict. Each one was deployed to
 * Camunda 8.9.22 (REST v2) when the profile was written; to re-check against
 * a live engine, set BPMN_C8_ENGINE to its REST v2 root, e.g.
 *   BPMN_C8_ENGINE=http://localhost:8088/v2 npx vitest run test/c8-profile.test.ts
 * The engine block then asserts that the profile reports a deploy-severity
 * finding exactly for the models the engine refuses (each deployment is
 * deleted again), and runs the runtime rules: it starts the processes and
 * checks that they misbehave the way the runtime findings say.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { mutateDoc } from '../src/pipeline.js';
import { feelProblem, validCycle, validDateTime, validDuration } from '../src/platform/c8.js';
import { runProfile } from '../src/platform/profile.js';
import { zeebeAllowedOn, zeebeAttr, zeebeContainersOf, zeebeNestedOnly, zeebeType } from '../src/platform/zeebe.js';
import { validateDoc } from '../src/validate.js';

const ROOT = join(import.meta.dirname, '..');
const ZEEBE = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"';
const MODELER = 'xmlns:modeler="http://camunda.org/schema/modeler/1.0"';
const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
const C8 = `${ZEEBE} ${MODELER} modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.9.0"`;

interface XmlOpts {
  ns?: string;
  roots?: string;
  executable?: boolean;
  /** content of bpmn:process before the flow elements (extension elements) */
  head?: string;
  /** after the process (another process, a collaboration) */
  after?: string;
  pid?: string;
}

function xml(body: string, o: XmlOpts = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${o.ns ?? C8} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${o.roots ?? ''}
  <bpmn:process id="${o.pid ?? 'P_Test'}" isExecutable="${o.executable ?? true}">
${o.head ?? ''}${body}
  </bpmn:process>
${o.after ?? ''}</bpmn:definitions>`;
}

const ext = (inner: string): string => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const TD = (type = 'work', extra = ''): string => `<zeebe:taskDefinition type="${type}"${extra} />`;
/** start -> X -> end */
function chain(x: string, extra = ''): string {
  return `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${x}
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />
${extra}`;
}
function toEnd(end: string, start = ''): string {
  return `    <bpmn:startEvent id="Start">${start}</bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" />
    <bpmn:endEvent id="End">${end}</bpmn:endEvent>`;
}
const ST = (inner = ext(TD()), attrs = ''): string => `<bpmn:serviceTask id="X"${attrs}>${inner}</bpmn:serviceTask>`;
const UT = (inner = ext('<zeebe:userTask />'), attrs = ''): string => `<bpmn:userTask id="X"${attrs}>${inner}</bpmn:userTask>`;
const SUB = (inner: string, attrs = ''): string => `<bpmn:subProcess id="X"${attrs}>${inner}</bpmn:subProcess>`;
const INNER = '<bpmn:startEvent id="IS" /><bpmn:sequenceFlow id="IF" sourceRef="IS" targetRef="IE" /><bpmn:endEvent id="IE" />';
const TIMER = (kind = 'timeDuration', v = 'PT1H'): string => `<bpmn:timerEventDefinition><bpmn:${kind} xsi:type="bpmn:tFormalExpression">${v}</bpmn:${kind}></bpmn:timerEventDefinition>`;
/** a message with a name (null: none) and a zeebe:subscription (null: none, '': without correlationKey) */
const MSG = (id = 'M1', name: string | null = 'M1', key: string | null = '=orderId'): string =>
  `  <bpmn:message id="${id}"${name === null ? '' : ` name="${name}"`}>${key === null ? '' : ext(`<zeebe:subscription${key === '' ? '' : ` correlationKey="${key}"`} />`)}</bpmn:message>\n`;
const MI = (zeebe: string | undefined, attrs = '', inner = ''): string => `<bpmn:multiInstanceLoopCharacteristics${attrs}>${zeebe === undefined ? '' : ext(zeebe)}${inner}</bpmn:multiInstanceLoopCharacteristics>`;
const ZLOOP = (attrs = 'inputCollection="=items" inputElement="item"'): string => `<zeebe:loopCharacteristics ${attrs} />`;
const COND = (c = '= x &gt; 1', id = 'CD1', inner = ''): string => `<bpmn:conditionalEventDefinition${id ? ` id="${id}"` : ''}>${inner}<bpmn:condition xsi:type="bpmn:tFormalExpression">${c}</bpmn:condition></bpmn:conditionalEventDefinition>`;
const boundary = (host: string, def: string, attrs = '', inner = ''): string =>
  chain(host, `    <bpmn:boundaryEvent id="B" attachedToRef="X"${attrs}>${inner}${def}</bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="End2" />
    <bpmn:endEvent id="End2" />`);
const evSub = (start: string, id = 'ESP'): string => `    <bpmn:subProcess id="${id}" triggeredByEvent="true">
      ${start}
      <bpmn:sequenceFlow id="${id}_F" sourceRef="${id}_S" targetRef="${id}_E" />
      <bpmn:endEvent id="${id}_E" />
    </bpmn:subProcess>
`;
/** start -> gateway G -> one end event per condition (null: no condition) */
function gateway(conditions: Array<string | null>, def?: string, kind = 'exclusiveGateway'): string {
  let body = `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
    <bpmn:${kind} id="G"${def ? ` default="${def}"` : ''} />
`;
  conditions.forEach((c, i) => {
    const cond = c !== null ? `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${c}</bpmn:conditionExpression>` : '';
    body += `    <bpmn:sequenceFlow id="S${i}" sourceRef="G" targetRef="End${i}">${cond}</bpmn:sequenceFlow>\n    <bpmn:endEvent id="End${i}" />\n`;
  });
  return body;
}
/** start -> event-based gateway G (with its incoming / outgoing lists) -> targets ({id} and {in} placeholders) */
function eventGateway(targets: string[]): string {
  let body = `    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
    <bpmn:eventBasedGateway id="G"><bpmn:incoming>F1</bpmn:incoming>${targets.map((_, i) => `<bpmn:outgoing>G${i}</bpmn:outgoing>`).join('')}</bpmn:eventBasedGateway>
`;
  targets.forEach((t, i) => {
    body += `    <bpmn:sequenceFlow id="G${i}" sourceRef="G" targetRef="T${i}" />
    ${t.replace('{id}', `T${i}`).replace('{in}', `<bpmn:incoming>G${i}</bpmn:incoming><bpmn:outgoing>E${i}</bpmn:outgoing>`)}
    <bpmn:sequenceFlow id="E${i}" sourceRef="T${i}" targetRef="End${i}" />
    <bpmn:endEvent id="End${i}"><bpmn:incoming>E${i}</bpmn:incoming></bpmn:endEvent>
`;
  });
  return body;
}
const TIMER_CATCH = `<bpmn:intermediateCatchEvent id="{id}">{in}${TIMER()}</bpmn:intermediateCatchEvent>`;
const msgCatch = (ref: string): string => `<bpmn:intermediateCatchEvent id="{id}">{in}<bpmn:messageEventDefinition messageRef="${ref}" /></bpmn:intermediateCatchEvent>`;
const COMPENSATION = (boundaryDef = '<bpmn:compensateEventDefinition id="CB" />', throwDef = '<bpmn:compensateEventDefinition id="CT" />', association = true): string => `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${ST()}
    <bpmn:boundaryEvent id="B" attachedToRef="X">${boundaryDef}</bpmn:boundaryEvent>
    <bpmn:serviceTask id="H" isForCompensation="true">${ext(TD('undo'))}</bpmn:serviceTask>
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="T" />
    <bpmn:intermediateThrowEvent id="T">${throwDef}</bpmn:intermediateThrowEvent>
    <bpmn:sequenceFlow id="F3" sourceRef="T" targetRef="End" />
    <bpmn:endEvent id="End" />
${association ? '    <bpmn:association id="A" associationDirection="One" sourceRef="B" targetRef="H" />' : ''}`;
const LINKS = (throwDef: string, catches: string[]): string => `    <bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:intermediateThrowEvent id="X">${throwDef}</bpmn:intermediateThrowEvent>
${catches.map((c, i) => `    <bpmn:intermediateCatchEvent id="C${i}">${c}</bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="FC${i}" sourceRef="C${i}" targetRef="End" />`).join('\n')}
    <bpmn:endEvent id="End" />`;

interface Case {
  name: string;
  xml: string;
  /** the profile codes the model must produce (sorted multiset) */
  codes: string[];
  /** what Camunda 8.9.22 does with it */
  engine: 'reject' | 'accept';
  /** a structural error validateDoc reports for the same problem: `validate` shows it instead of a profile code */
  structural?: string;
}

const JOB_UT = 'W_C8_JOB_WORKER_USER_TASK';

const CASES: Case[] = [
  // the file
  { name: 'a minimal executable process', xml: xml(chain(ST())), codes: [], engine: 'accept' },
  { name: 'no executable process', xml: xml(chain(ST()), { executable: false }), codes: ['W_C8_DEPLOY_EXECUTABLE'], engine: 'reject' },
  { name: 'a non-executable process next to an executable one is not checked', xml: xml(chain(ST()), { after: '  <bpmn:process id="P_Other" isExecutable="false"><bpmn:serviceTask id="Y" /><bpmn:startEvent id="S1" /><bpmn:startEvent id="S2" /></bpmn:process>\n' }), codes: [], engine: 'accept', structural: 'E_MULTIPLE_ROOTS' },
  // jobs
  { name: 'service task without zeebe:taskDefinition', xml: xml(chain('<bpmn:serviceTask id="X" />')), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'job without type', xml: xml(chain(ST(ext('<zeebe:taskDefinition retries="3" />')))), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'job with an empty type', xml: xml(chain(ST(ext(TD(''))))), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'job type and retries as FEEL', xml: xml(chain(ST(ext(TD('=jobType', ' retries="=3"'))))), codes: [], engine: 'accept' },
  { name: 'two zeebe:taskDefinition', xml: xml(chain(ST(ext(TD() + TD('b'))))), codes: ['W_C8_DEPLOY_DUPLICATE_EXTENSION'], engine: 'reject' },
  { name: 'retries that are no number (incident at run time)', xml: xml(chain(ST(ext(TD('work', ' retries="abc"'))))), codes: ['W_C8_BAD_VALUE'], engine: 'accept' },
  { name: 'send task without job', xml: xml(chain('<bpmn:sendTask id="X" />')), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'send task with job, message ref to a nameless message', xml: xml(chain(`<bpmn:sendTask id="X" messageRef="M1">${ext(TD())}</bpmn:sendTask>`), { roots: MSG('M1', null, null) }), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'message end and throw events need a job', xml: xml(chain('<bpmn:intermediateThrowEvent id="X"><bpmn:messageEventDefinition id="MD1" /></bpmn:intermediateThrowEvent>').replace('<bpmn:endEvent id="End" />', '<bpmn:endEvent id="End"><bpmn:messageEventDefinition id="MD2" /></bpmn:endEvent>')), codes: ['W_C8_DEPLOY_IMPLEMENTATION', 'W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'message end and throw events with a job (no message needed)', xml: xml(chain(`<bpmn:intermediateThrowEvent id="X">${ext(TD())}<bpmn:messageEventDefinition id="MD1" /></bpmn:intermediateThrowEvent>`).replace('<bpmn:endEvent id="End" />', `<bpmn:endEvent id="End">${ext(TD())}<bpmn:messageEventDefinition id="MD2" /></bpmn:endEvent>`)), codes: [], engine: 'accept' },
  { name: 'zeebe:publishMessage on a send task: accepted, not run', xml: xml(chain(`<bpmn:sendTask id="X" messageRef="M1">${ext('<zeebe:publishMessage correlationKey="=orderId" />')}</bpmn:sendTask>`), { roots: MSG() }), codes: ['W_C8_UNSUPPORTED_IMPLEMENTATION'], engine: 'accept' },
  { name: 'zeebe:publishMessage in a message end definition: accepted, sends nothing', xml: xml(toEnd(`<bpmn:messageEventDefinition id="MD" messageRef="M1">${ext('<zeebe:publishMessage correlationKey="=orderId" />')}</bpmn:messageEventDefinition>`), { roots: MSG() }), codes: ['W_C8_UNSUPPORTED_IMPLEMENTATION'], engine: 'accept' },
  { name: 'zeebe:publishMessage on the end event itself is not read', xml: xml(toEnd(`${ext('<zeebe:publishMessage correlationKey="=orderId" />')}<bpmn:messageEventDefinition id="MD" messageRef="M1" />`), { roots: MSG() }), codes: ['W_C8_DEPLOY_IMPLEMENTATION', 'W_C8_MISPLACED_EXTENSION'], engine: 'reject' },
  { name: 'zeebe:publishMessage without correlationKey', xml: xml(chain(`<bpmn:sendTask id="X" messageRef="M1">${ext('<zeebe:publishMessage />')}</bpmn:sendTask>`), { roots: MSG() }), codes: ['W_C8_DEPLOY_MESSAGE', 'W_C8_UNSUPPORTED_IMPLEMENTATION'], engine: 'reject' },
  { name: 'zeebe:publishMessage and a job on one send task', xml: xml(chain(`<bpmn:sendTask id="X" messageRef="M1">${ext('<zeebe:publishMessage correlationKey="=a" />' + TD())}</bpmn:sendTask>`), { roots: MSG() }), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'script task without implementation (a bpmn:script is not read)', xml: xml(chain('<bpmn:scriptTask id="X" scriptFormat="feel"><bpmn:script>= 1</bpmn:script></bpmn:scriptTask>')), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'FEEL script task', xml: xml(chain(`<bpmn:scriptTask id="X">${ext('<zeebe:script expression="=1 + 1" resultVariable="r" />')}</bpmn:scriptTask>`)), codes: [], engine: 'accept' },
  { name: 'zeebe:script without resultVariable', xml: xml(chain(`<bpmn:scriptTask id="X">${ext('<zeebe:script expression="=1 + 1" />')}</bpmn:scriptTask>`)), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'zeebe:script without expression', xml: xml(chain(`<bpmn:scriptTask id="X">${ext('<zeebe:script resultVariable="r" />')}</bpmn:scriptTask>`)), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'zeebe:script with a static expression', xml: xml(chain(`<bpmn:scriptTask id="X">${ext('<zeebe:script expression="1 + 1" resultVariable="r" />')}</bpmn:scriptTask>`)), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'script task with a job', xml: xml(chain(`<bpmn:scriptTask id="X">${ext(TD())}</bpmn:scriptTask>`)), codes: [], engine: 'accept' },
  { name: 'script task with zeebe:script and a job', xml: xml(chain(`<bpmn:scriptTask id="X">${ext(TD() + '<zeebe:script expression="=1" resultVariable="r" />')}</bpmn:scriptTask>`)), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'business rule task without implementation', xml: xml(chain('<bpmn:businessRuleTask id="X" />')), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'called decision', xml: xml(chain(`<bpmn:businessRuleTask id="X">${ext('<zeebe:calledDecision decisionId="d" resultVariable="r" />')}</bpmn:businessRuleTask>`)), codes: [], engine: 'accept' },
  { name: 'called decision without resultVariable', xml: xml(chain(`<bpmn:businessRuleTask id="X">${ext('<zeebe:calledDecision decisionId="d" />')}</bpmn:businessRuleTask>`)), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'called decision without decisionId', xml: xml(chain(`<bpmn:businessRuleTask id="X">${ext('<zeebe:calledDecision decisionId="" resultVariable="r" />')}</bpmn:businessRuleTask>`)), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'called decision and a job', xml: xml(chain(`<bpmn:businessRuleTask id="X">${ext(TD() + '<zeebe:calledDecision decisionId="d" resultVariable="r" />')}</bpmn:businessRuleTask>`)), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'binding type versionTag without versionTag, an unknown binding type', xml: xml(chain(`<bpmn:businessRuleTask id="X">${ext('<zeebe:calledDecision decisionId="d" resultVariable="r" bindingType="versionTag" />')}</bpmn:businessRuleTask>`, `<bpmn:callActivity id="Y">${ext('<zeebe:calledElement processId="c" bindingType="foo" />')}</bpmn:callActivity>`)), codes: ['W_C8_DEPLOY_EXTENSION', 'W_C8_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'unprefixed calledDecision (design-iq) next to zeebe:calledDecision', xml: xml(chain(`<bpmn:businessRuleTask id="X" calledDecision="d">${ext('<zeebe:calledDecision decisionId="d" resultVariable="r" />')}</bpmn:businessRuleTask>`)), codes: ['W_C8_DEPLOY_SCHEMA'], engine: 'reject' },
  // call activities
  { name: 'call activity with only a BPMN calledElement', xml: xml(chain('<bpmn:callActivity id="X" calledElement="Other" />')), codes: ['W_C8_DEPLOY_CALLED_ELEMENT'], engine: 'reject' },
  { name: 'zeebe:calledElement without processId', xml: xml(chain(`<bpmn:callActivity id="X">${ext('<zeebe:calledElement propagateAllChildVariables="false" />')}</bpmn:callActivity>`)), codes: ['W_C8_DEPLOY_CALLED_ELEMENT'], engine: 'reject' },
  { name: 'call activity', xml: xml(chain(`<bpmn:callActivity id="X">${ext('<zeebe:calledElement processId="=child" propagateAllChildVariables="false" />')}</bpmn:callActivity>`)), codes: [], engine: 'accept' },
  { name: 'two zeebe:calledElement', xml: xml(chain(`<bpmn:callActivity id="X">${ext('<zeebe:calledElement processId="a" /><zeebe:calledElement processId="b" />')}</bpmn:callActivity>`)), codes: ['W_C8_DEPLOY_DUPLICATE_EXTENSION'], engine: 'reject' },
  // messages
  { name: 'receive task without message', xml: xml(chain('<bpmn:receiveTask id="X" />')), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'message without zeebe:subscription', xml: xml(chain('<bpmn:receiveTask id="X" messageRef="M1" />'), { roots: MSG('M1', 'M1', null) }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'subscription without correlationKey', xml: xml(chain('<bpmn:receiveTask id="X" messageRef="M1" />'), { roots: MSG('M1', 'M1', '') }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'static correlationKey', xml: xml(chain('<bpmn:receiveTask id="X" messageRef="M1" />'), { roots: MSG('M1', 'M1', 'orderId') }), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'message without name', xml: xml(chain('<bpmn:receiveTask id="X" messageRef="M1" />'), { roots: MSG('M1', null) }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'message catch event and receive task with FEEL message name', xml: xml(chain('<bpmn:receiveTask id="X" messageRef="M1" />'), { roots: MSG('M1', '=msgName') }), codes: [], engine: 'accept' },
  { name: 'message catch event without message', xml: xml(chain('<bpmn:intermediateCatchEvent id="X"><bpmn:messageEventDefinition id="MD" /></bpmn:intermediateCatchEvent>')), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'message start event needs no subscription', xml: xml(toEnd('', '<bpmn:messageEventDefinition id="MD" messageRef="M1" />'), { roots: MSG('M1', 'M1', null) }), codes: [], engine: 'accept' },
  { name: 'message start event with FEEL name', xml: xml(toEnd('', '<bpmn:messageEventDefinition id="MD" messageRef="M1" />'), { roots: MSG('M1', '=n', null) }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'message start in an event sub-process needs a subscription', xml: xml(toEnd('') + evSub('<bpmn:startEvent id="ESP_S"><bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:startEvent>'), { roots: MSG('M1', 'M1', null) }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'two message boundary events with one name', xml: xml(boundary(ST(), '<bpmn:messageEventDefinition id="MD" messageRef="M1" />') + '    <bpmn:boundaryEvent id="B2" attachedToRef="X"><bpmn:messageEventDefinition id="MD2" messageRef="M1" /></bpmn:boundaryEvent>', { roots: MSG() }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'receive task and its boundary event with one message', xml: xml(boundary('<bpmn:receiveTask id="X" messageRef="M1" />', '<bpmn:messageEventDefinition id="MD" messageRef="M1" />'), { roots: MSG() }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'two start events with one message name', xml: xml(toEnd('', '<bpmn:messageEventDefinition id="MD" messageRef="M1" />') + '<bpmn:startEvent id="S2"><bpmn:messageEventDefinition id="MD2" messageRef="M2" /></bpmn:startEvent><bpmn:sequenceFlow id="F9" sourceRef="S2" targetRef="End" />', { roots: MSG('M1', 'same') + MSG('M2', 'same') }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'two event sub-processes with one message', xml: xml(toEnd('') + evSub('<bpmn:startEvent id="ESP_S"><bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:startEvent>') + evSub('<bpmn:startEvent id="ESP2_S"><bpmn:messageEventDefinition id="MD2" messageRef="M1" /></bpmn:startEvent>', 'ESP2'), { roots: MSG() }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'one message in two places of a process, at a boundary and in an event sub-process', xml: xml(chain('<bpmn:receiveTask id="X" messageRef="M1" />', '<bpmn:intermediateCatchEvent id="X2"><bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:intermediateCatchEvent>') + evSub('<bpmn:startEvent id="ESP_S"><bpmn:messageEventDefinition id="MD2" messageRef="M1" /></bpmn:startEvent>'), { roots: MSG() }), codes: [], engine: 'accept' },
  // signals, errors, escalations
  { name: 'signal events without signal or with a nameless one', xml: xml(chain('<bpmn:intermediateThrowEvent id="X"><bpmn:signalEventDefinition id="SD" /></bpmn:intermediateThrowEvent>').replace('<bpmn:endEvent id="End" />', '<bpmn:endEvent id="End"><bpmn:signalEventDefinition id="SD2" signalRef="Sig" /></bpmn:endEvent>'), { roots: '<bpmn:signal id="Sig" />' }), codes: ['W_C8_DEPLOY_SIGNAL', 'W_C8_DEPLOY_SIGNAL'], engine: 'reject' },
  { name: 'signal start event with FEEL name', xml: xml(toEnd('', '<bpmn:signalEventDefinition id="SD" signalRef="Sig" />'), { roots: '<bpmn:signal id="Sig" name="=sig" />' }), codes: ['W_C8_DEPLOY_SIGNAL'], engine: 'reject' },
  { name: 'two signal start events with one name', xml: xml(toEnd('', '<bpmn:signalEventDefinition id="SD" signalRef="Sig" />') + '<bpmn:startEvent id="S2"><bpmn:signalEventDefinition id="SD2" signalRef="Sig2" /></bpmn:startEvent><bpmn:sequenceFlow id="F9" sourceRef="S2" targetRef="End" />', { roots: '<bpmn:signal id="Sig" name="sig" /><bpmn:signal id="Sig2" name="sig" />' }), codes: ['W_C8_DEPLOY_SIGNAL'], engine: 'reject' },
  { name: 'two signals with one name thrown (allowed)', xml: xml(toEnd('<bpmn:signalEventDefinition id="SD" signalRef="Sig" />'), { roots: '<bpmn:signal id="Sig" name="sig" /><bpmn:signal id="Sig2" name="sig" />' }), codes: [], engine: 'accept' },
  { name: 'error end event without error, error without code', xml: xml(toEnd('<bpmn:errorEventDefinition id="ED" />')) , codes: ['W_C8_DEPLOY_ERROR'], engine: 'reject' },
  { name: 'error without code thrown', xml: xml(toEnd('<bpmn:errorEventDefinition id="ED" errorRef="Err" />'), { roots: '<bpmn:error id="Err" name="E" />' }), codes: ['W_C8_DEPLOY_ERROR'], engine: 'reject' },
  { name: 'error code as FEEL when thrown (allowed) and caught (refused)', xml: xml(boundary(ST(), '<bpmn:errorEventDefinition id="ED" errorRef="Err" />').replace('<bpmn:endEvent id="End" />', '<bpmn:endEvent id="End"><bpmn:errorEventDefinition id="ED2" errorRef="Err" /></bpmn:endEvent>'), { roots: '<bpmn:error id="Err" name="E" errorCode="=code" />' }), codes: ['W_C8_DEPLOY_ERROR'], engine: 'reject' },
  { name: 'two error boundary events with one code', xml: xml(boundary(ST(), '<bpmn:errorEventDefinition id="ED" errorRef="Err" />') + '    <bpmn:boundaryEvent id="B2" attachedToRef="X"><bpmn:errorEventDefinition id="ED2" errorRef="Err" /></bpmn:boundaryEvent>', { roots: '<bpmn:error id="Err" name="E" errorCode="C" />' }), codes: ['W_C8_DEPLOY_ERROR'], engine: 'reject' },
  { name: 'two catch-all error boundary events', xml: xml(boundary(ST(), '<bpmn:errorEventDefinition id="ED" />') + '    <bpmn:boundaryEvent id="B2" attachedToRef="X"><bpmn:errorEventDefinition id="ED2" /></bpmn:boundaryEvent>'), codes: ['W_C8_DEPLOY_ERROR'], engine: 'reject' },
  { name: 'two error event sub-processes with one code', xml: xml(toEnd('') + evSub('<bpmn:startEvent id="ESP_S"><bpmn:errorEventDefinition id="ED" errorRef="Err" /></bpmn:startEvent>') + evSub('<bpmn:startEvent id="ESP2_S"><bpmn:errorEventDefinition id="ED2" errorRef="Err" /></bpmn:startEvent>', 'ESP2'), { roots: '<bpmn:error id="Err" name="E" errorCode="C" />' }), codes: ['W_C8_DEPLOY_ERROR'], engine: 'reject' },
  { name: 'non-interrupting error boundary event', xml: xml(boundary(ST(), '<bpmn:errorEventDefinition id="ED" />', ' cancelActivity="false"')), codes: ['W_C8_DEPLOY_ERROR'], engine: 'reject' },
  { name: 'escalation end without escalation, escalation without code', xml: xml(toEnd('<bpmn:escalationEventDefinition id="ESD" />').replace('<bpmn:startEvent id="Start"></bpmn:startEvent>', '<bpmn:startEvent id="Start"></bpmn:startEvent><bpmn:intermediateThrowEvent id="T"><bpmn:escalationEventDefinition id="ESD2" escalationRef="Esc" /></bpmn:intermediateThrowEvent>'), { roots: '<bpmn:escalation id="Esc" name="E" />' }), codes: ['W_C8_DEPLOY_ESCALATION', 'W_C8_DEPLOY_ESCALATION'], engine: 'reject' },
  { name: 'escalation boundary event on a service task', xml: xml(boundary(ST(), '<bpmn:escalationEventDefinition id="ESD" />')), codes: ['W_C8_DEPLOY_ESCALATION'], engine: 'reject' },
  { name: 'escalation boundary event on a sub-process', xml: xml(boundary(SUB(INNER), '<bpmn:escalationEventDefinition id="ESD" />')), codes: [], engine: 'accept' },
  // timers
  { name: 'timer without value', xml: xml(chain('<bpmn:intermediateCatchEvent id="X"><bpmn:timerEventDefinition id="TD1" /></bpmn:intermediateCatchEvent>')), codes: ['W_C8_DEPLOY_TIMER'], engine: 'reject' },
  { name: 'timer duration that is no ISO 8601 duration', xml: xml(chain(`<bpmn:intermediateCatchEvent id="X">${TIMER('timeDuration', '1 hour')}</bpmn:intermediateCatchEvent>`)), codes: ['W_C8_DEPLOY_TIMER'], engine: 'reject' },
  { name: 'timer date without offset', xml: xml(chain(`<bpmn:intermediateCatchEvent id="X">${TIMER('timeDate', '2030-12-31T10:00:00')}</bpmn:intermediateCatchEvent>`)), codes: ['W_C8_DEPLOY_TIMER'], engine: 'reject' },
  { name: 'timer cycle on an intermediate catch event', xml: xml(chain(`<bpmn:intermediateCatchEvent id="X">${TIMER('timeCycle', 'R/PT1H')}</bpmn:intermediateCatchEvent>`)), codes: ['W_C8_DEPLOY_TIMER'], engine: 'reject' },
  { name: 'interrupting timer boundary event with a cycle', xml: xml(boundary(ST(), TIMER('timeCycle', 'R/PT1H'))), codes: ['W_C8_DEPLOY_TIMER'], engine: 'reject' },
  { name: 'non-interrupting timer boundary cycle, start cycles and cron', xml: xml(boundary(ST(), TIMER('timeCycle', 'R3/PT1H'), ' cancelActivity="false"').replace('<bpmn:startEvent id="Start" />', `<bpmn:startEvent id="Start">${TIMER('timeCycle', '0 0 9-17 * * MON-FRI')}</bpmn:startEvent>`) + `<bpmn:startEvent id="S2">${TIMER('timeCycle', 'R/2030-01-01T00:00:00Z/P1D')}</bpmn:startEvent><bpmn:sequenceFlow id="F9" sourceRef="S2" targetRef="End" />`), codes: [], engine: 'accept' },
  { name: 'timer start cycle with five cron fields', xml: xml(toEnd('', TIMER('timeCycle', '0 9 * * MON'))), codes: ['W_C8_DEPLOY_TIMER'], engine: 'reject' },
  { name: 'timer FEEL values', xml: xml(boundary(ST(), TIMER('timeDuration', '=wait'))), codes: [], engine: 'accept' },
  { name: 'interrupting timer cycle starting an event sub-process', xml: xml(toEnd('') + evSub(`<bpmn:startEvent id="ESP_S">${TIMER('timeCycle', 'R/PT1H')}</bpmn:startEvent>`)), codes: ['W_C8_DEPLOY_TIMER'], engine: 'reject' },
  // conditions and gateways
  { name: 'JUEL condition', xml: xml(gateway(['${x &gt; 1}', null], 'S1')), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'FEEL condition with a JUEL slip', xml: xml(gateway(['= x == 1 &amp;&amp; y', null], 'S1')), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'FEEL conditions and a default flow', xml: xml(gateway(['= x &gt; 1 and y != "a"', null], 'S1')), codes: [], engine: 'accept' },
  { name: 'flow without condition next to a conditional one: never taken', xml: xml(gateway(['= x &gt; 1', null])), codes: ['W_C8_EXCLUSIVE_GATEWAY'], engine: 'accept' },
  { name: 'inclusive gateway flow without condition: never taken', xml: xml(gateway(['= true', null], undefined, 'inclusiveGateway')), codes: ['W_C8_EXCLUSIVE_GATEWAY'], engine: 'accept' },
  { name: 'exclusive gateway with one unconditional flow', xml: xml(gateway([null])), codes: [], engine: 'accept' },
  { name: 'condition on a flow out of a parallel gateway: ignored', xml: xml(gateway(['= false', null], undefined, 'parallelGateway')), codes: ['W_C8_CONDITION_IGNORED'], engine: 'accept' },
  { name: 'event-based gateway', xml: xml(eventGateway([TIMER_CATCH, msgCatch('M1')]), { roots: MSG() }), codes: [], engine: 'accept' },
  { name: 'event-based gateway with one branch', xml: xml(eventGateway([TIMER_CATCH]), { roots: MSG() }), codes: ['W_C8_DEPLOY_EVENT_GATEWAY'], engine: 'reject' },
  { name: 'event-based gateway leading to a receive task', xml: xml(eventGateway([TIMER_CATCH, '<bpmn:receiveTask id="{id}" messageRef="M1">{in}</bpmn:receiveTask>']), { roots: MSG() }), codes: ['W_C8_DEPLOY_EVENT_GATEWAY'], engine: 'reject', structural: undefined },
  { name: 'event-based gateway with one message on two branches', xml: xml(eventGateway([msgCatch('M1'), msgCatch('M1'), TIMER_CATCH]), { roots: MSG() }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'complex gateway', xml: xml(gateway(['= x &gt; 1', null], 'S1', 'complexGateway')), codes: [], engine: 'reject', structural: 'E_UNSUPPORTED_KIND' },
  // multi-instance and loops
  { name: 'multi-instance without zeebe:loopCharacteristics', xml: xml(chain(ST(ext(TD()) + MI(undefined, '', '<bpmn:loopCardinality xsi:type="bpmn:tFormalExpression">3</bpmn:loopCardinality>')))), codes: ['W_C8_DEPLOY_MULTI_INSTANCE'], engine: 'reject' },
  { name: 'multi-instance without inputCollection', xml: xml(chain(ST(ext(TD()) + MI(ZLOOP('inputElement="item"'))))), codes: ['W_C8_DEPLOY_MULTI_INSTANCE'], engine: 'reject' },
  { name: 'multi-instance with a static inputCollection', xml: xml(chain(ST(ext(TD()) + MI(ZLOOP('inputCollection="items" inputElement="item"'))))), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'multi-instance outputCollection without outputElement', xml: xml(chain(ST(ext(TD()) + MI(ZLOOP('inputCollection="=items" outputCollection="out"'))))), codes: ['W_C8_DEPLOY_MULTI_INSTANCE'], engine: 'reject' },
  { name: 'multi-instance with a static outputElement', xml: xml(chain(ST(ext(TD()) + MI(ZLOOP('inputCollection="=items" outputCollection="out" outputElement="result"'))))), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'multi-instance with output collection, sequential', xml: xml(chain(ST(ext(TD()) + MI(ZLOOP('inputCollection="=items" inputElement="item" outputCollection="results" outputElement="=result"'), ' isSequential="true"')))), codes: [], engine: 'accept' },
  { name: 'zeebe:loopCharacteristics on the activity instead of its loop', xml: xml(chain(ST(ext(TD() + ZLOOP()) + MI(undefined)))), codes: ['W_C8_DEPLOY_MULTI_INSTANCE', 'W_C8_MISPLACED_EXTENSION'], engine: 'reject' },
  { name: 'JUEL completion condition (incident at run time)', xml: xml(chain(ST(ext(TD()) + MI(ZLOOP(), '', '<bpmn:completionCondition xsi:type="bpmn:tFormalExpression">${done}</bpmn:completionCondition>')))), codes: ['W_C8_EXPRESSION'], engine: 'accept' },
  { name: 'standard loop (runs once)', xml: xml(chain(ST(ext(TD()) + '<bpmn:standardLoopCharacteristics />'))), codes: ['W_C8_STANDARD_LOOP'], engine: 'accept' },
  // user tasks
  { name: 'Camunda user task with assignment, schedule, priority and a linked form', xml: xml(chain(UT(ext('<zeebe:userTask /><zeebe:formDefinition formId="f1" /><zeebe:assignmentDefinition assignee="=reviewer" candidateGroups="sales, finance" /><zeebe:taskSchedule dueDate="2030-01-01T10:00:00Z" followUpDate="=later" /><zeebe:priorityDefinition priority="80" />')))), codes: [], engine: 'accept' },
  { name: 'job worker user task (no zeebe:userTask)', xml: xml(chain('<bpmn:userTask id="X" />')), codes: [JOB_UT], engine: 'accept' },
  { name: 'Camunda user task with an embedded formKey', xml: xml(chain(UT(ext('<zeebe:userTask /><zeebe:formDefinition formKey="camunda-forms:bpmn:F1" />')))), codes: ['W_C8_DEPLOY_USER_TASK'], engine: 'reject' },
  { name: 'Camunda user task with formId and externalReference', xml: xml(chain(UT(ext('<zeebe:userTask /><zeebe:formDefinition formId="a" externalReference="https://x" />')))), codes: ['W_C8_DEPLOY_USER_TASK'], engine: 'reject' },
  { name: 'job worker user task with formKey and formId', xml: xml(chain(UT(ext('<zeebe:formDefinition formKey="a" formId="b" />')))), codes: ['W_C8_DEPLOY_USER_TASK', JOB_UT], engine: 'reject' },
  { name: 'job worker user task with an embedded form', xml: xml(chain(UT(ext('<zeebe:formDefinition formKey="camunda-forms:bpmn:F1" />')))), codes: [JOB_UT], engine: 'accept' },
  { name: 'priority out of range, not a number; due date no date-time', xml: xml(chain(UT(ext('<zeebe:userTask /><zeebe:priorityDefinition priority="200" /><zeebe:taskSchedule dueDate="tomorrow" />')), '<bpmn:userTask id="Y">' + ext('<zeebe:userTask /><zeebe:priorityDefinition priority="abc" />') + '</bpmn:userTask>')), codes: ['W_C8_DEPLOY_USER_TASK', 'W_C8_DEPLOY_USER_TASK', 'W_C8_DEPLOY_USER_TASK'], engine: 'reject' },
  { name: 'task listeners on a job worker user task', xml: xml(chain(UT(ext('<zeebe:taskListeners><zeebe:taskListener eventType="creating" type="l" /></zeebe:taskListeners>')))), codes: ['W_C8_DEPLOY_LISTENER', JOB_UT], engine: 'reject' },
  { name: 'task listeners: every event type, also the older names', xml: xml(chain(UT(ext('<zeebe:userTask /><zeebe:taskListeners><zeebe:taskListener eventType="creating" type="a" /><zeebe:taskListener eventType="complete" type="b" /><zeebe:taskListener eventType="assignment" type="c" /><zeebe:taskListener eventType="canceling" type="d" /></zeebe:taskListeners>')))), codes: [], engine: 'accept' },
  { name: 'task listener with an unknown event type, without type', xml: xml(chain(UT(ext('<zeebe:userTask /><zeebe:taskListeners><zeebe:taskListener eventType="foo" type="l" /><zeebe:taskListener eventType="creating" /></zeebe:taskListeners>')))), codes: ['W_C8_DEPLOY_LISTENER', 'W_C8_DEPLOY_LISTENER'], engine: 'reject' },
  // execution listeners
  { name: 'execution listener without type, with an unknown event type', xml: xml(chain(ST(ext(TD() + '<zeebe:executionListeners><zeebe:executionListener eventType="start" /><zeebe:executionListener eventType="take" type="l" /></zeebe:executionListeners>')))), codes: ['W_C8_DEPLOY_LISTENER', 'W_C8_DEPLOY_LISTENER'], engine: 'reject' },
  { name: 'start listener on a start event and a boundary event', xml: xml(boundary(ST(), TIMER(), '', ext('<zeebe:executionListeners><zeebe:executionListener eventType="start" type="l" /></zeebe:executionListeners>')).replace('<bpmn:startEvent id="Start" />', `<bpmn:startEvent id="Start">${ext('<zeebe:executionListeners><zeebe:executionListener eventType="start" type="l" /></zeebe:executionListeners>')}</bpmn:startEvent>`)), codes: ['W_C8_DEPLOY_LISTENER', 'W_C8_DEPLOY_LISTENER'], engine: 'reject' },
  { name: 'end listener on a gateway', xml: xml(gateway(['= x &gt; 1', null], 'S1').replace('<bpmn:exclusiveGateway id="G" default="S1" />', `<bpmn:exclusiveGateway id="G" default="S1">${ext('<zeebe:executionListeners><zeebe:executionListener eventType="end" type="l" /></zeebe:executionListeners>')}</bpmn:exclusiveGateway>`)), codes: ['W_C8_DEPLOY_LISTENER'], engine: 'reject' },
  { name: 'execution listeners on a sequence flow', xml: xml(chain(ST()).replace('<bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />', `<bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End">${ext('<zeebe:executionListeners><zeebe:executionListener eventType="start" type="l" /></zeebe:executionListeners>')}</bpmn:sequenceFlow>`)), codes: ['W_C8_DEPLOY_LISTENER'], engine: 'reject' },
  { name: 'execution listeners where Camunda 8 runs them', xml: xml(chain(ST(ext(TD() + '<zeebe:executionListeners><zeebe:executionListener eventType="start" type="a" /><zeebe:executionListener eventType="end" type="b" /></zeebe:executionListeners>'))), { head: ext('<zeebe:executionListeners><zeebe:executionListener eventType="start" type="l" /></zeebe:executionListeners>') }), codes: [], engine: 'accept' },
  // io mappings and headers
  { name: 'input mapping without target, output target not a path', xml: xml(chain(ST(ext(TD() + '<zeebe:ioMapping><zeebe:input source="=a" /><zeebe:output source="=a" target="1x" /></zeebe:ioMapping>')))), codes: ['W_C8_DEPLOY_EXTENSION', 'W_C8_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'output mapping without source', xml: xml(chain(ST(ext(TD() + '<zeebe:ioMapping><zeebe:output target="a" /></zeebe:ioMapping>')))), codes: ['W_C8_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'io mappings: static and FEEL sources, a dotted target', xml: xml(chain(ST(ext(TD() + '<zeebe:ioMapping><zeebe:input source="abc" target="a" /><zeebe:input target="b" /><zeebe:output source="=a" target="x.y" /></zeebe:ioMapping>')))), codes: [], engine: 'accept' },
  { name: 'input mapping with a FEEL slip', xml: xml(chain(ST(ext(TD() + '<zeebe:ioMapping><zeebe:input source="= a &amp;&amp; b" target="a" /></zeebe:ioMapping>')))), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'two zeebe:ioMapping', xml: xml(chain(ST(ext(TD() + '<zeebe:ioMapping><zeebe:input source="=a" target="a" /></zeebe:ioMapping><zeebe:ioMapping><zeebe:input source="=b" target="b" /></zeebe:ioMapping>')))), codes: ['W_C8_DEPLOY_DUPLICATE_EXTENSION'], engine: 'reject' },
  { name: 'input mappings on a start, a boundary, a none throw and a none end event: ignored', xml: xml(`    <bpmn:startEvent id="Start">${ext('<zeebe:ioMapping><zeebe:input source="=1" target="a" /><zeebe:output source="=2" target="b" /></zeebe:ioMapping>')}</bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${ST()}
    <bpmn:boundaryEvent id="B" attachedToRef="X">${ext('<zeebe:ioMapping><zeebe:input source="=1" target="c" /></zeebe:ioMapping>')}${TIMER()}</bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="T" />
    <bpmn:intermediateThrowEvent id="T">${ext('<zeebe:ioMapping><zeebe:input source="=1" target="d" /></zeebe:ioMapping>')}</bpmn:intermediateThrowEvent>
    <bpmn:sequenceFlow id="F3" sourceRef="T" targetRef="End" />
    <bpmn:endEvent id="End">${ext('<zeebe:ioMapping><zeebe:input source="=1" target="e" /></zeebe:ioMapping>')}</bpmn:endEvent>
    <bpmn:sequenceFlow id="F4" sourceRef="B" targetRef="End2" /><bpmn:endEvent id="End2" />`), codes: ['W_C8_MISPLACED_EXTENSION', 'W_C8_MISPLACED_EXTENSION', 'W_C8_MISPLACED_EXTENSION', 'W_C8_MISPLACED_EXTENSION'], engine: 'accept' },
  { name: 'io mapping on a gateway: ignored', xml: xml(gateway([null]).replace('<bpmn:exclusiveGateway id="G" />', `<bpmn:exclusiveGateway id="G">${ext('<zeebe:ioMapping><zeebe:output source="=1" target="a" /></zeebe:ioMapping>')}</bpmn:exclusiveGateway>`)), codes: ['W_C8_MISPLACED_EXTENSION'], engine: 'accept' },
  { name: 'task headers: duplicate key (refused), no key or no value (dropped)', xml: xml(chain(ST(ext(TD() + '<zeebe:taskHeaders><zeebe:header key="k" value="v" /><zeebe:header key="k" value="w" /><zeebe:header value="x" /><zeebe:header key="e" /></zeebe:taskHeaders>')))), codes: ['W_C8_BAD_VALUE', 'W_C8_BAD_VALUE', 'W_C8_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'linked resource without resourceType', xml: xml(chain(ST(ext(TD() + '<zeebe:linkedResources><zeebe:linkedResource resourceId="r" linkName="l" /></zeebe:linkedResources>')))), codes: ['W_C8_DEPLOY_EXTENSION'], engine: 'reject' },
  // duplicates of single-instance elements
  { name: 'two zeebe:userTask, zeebe:assignmentDefinition, zeebe:taskSchedule', xml: xml(chain(UT(ext('<zeebe:userTask /><zeebe:userTask /><zeebe:assignmentDefinition assignee="a" /><zeebe:assignmentDefinition candidateGroups="g" /><zeebe:taskSchedule dueDate="=a" /><zeebe:taskSchedule followUpDate="=b" />')))), codes: ['W_C8_DEPLOY_DUPLICATE_EXTENSION', 'W_C8_DEPLOY_DUPLICATE_EXTENSION', 'W_C8_DEPLOY_DUPLICATE_EXTENSION'], engine: 'reject' },
  { name: 'two zeebe:properties, two zeebe:versionTag', xml: xml(chain(ST(ext(TD() + '<zeebe:properties><zeebe:property name="a" value="1" /></zeebe:properties><zeebe:properties><zeebe:property name="b" value="2" /></zeebe:properties>'))), { head: ext('<zeebe:versionTag value="v1" /><zeebe:versionTag value="v2" />') }), codes: ['W_C8_DEPLOY_DUPLICATE_EXTENSION', 'W_C8_DEPLOY_DUPLICATE_EXTENSION'], engine: 'reject' },
  { name: 'two zeebe:subscription on one message', xml: xml(chain('<bpmn:receiveTask id="X" messageRef="M1" />'), { roots: `  <bpmn:message id="M1" name="M1">${ext('<zeebe:subscription correlationKey="=a" /><zeebe:subscription correlationKey="=b" />')}</bpmn:message>\n` }), codes: ['W_C8_DEPLOY_DUPLICATE_EXTENSION'], engine: 'reject' },
  { name: 'two zeebe:jobPriorityDefinition (accepted)', xml: xml(chain(ST(ext(TD() + '<zeebe:jobPriorityDefinition priority="1" /><zeebe:jobPriorityDefinition priority="2" />')))), codes: [], engine: 'accept' },
  // events and scopes
  { name: 'process without start event', xml: xml(chain(ST()).replace('<bpmn:startEvent id="Start" />', '<bpmn:task id="Start" />')), codes: ['W_C8_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'two none start events', xml: xml(toEnd('') + '<bpmn:startEvent id="S2" /><bpmn:sequenceFlow id="F9" sourceRef="S2" targetRef="End" />'), codes: ['W_C8_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'sub-process without start event, with a timer start, with two starts', xml: xml(chain(SUB('<bpmn:task id="A1" />'), `<bpmn:subProcess id="Y">${`<bpmn:startEvent id="YS">${TIMER('timeCycle', 'R/PT1H')}</bpmn:startEvent><bpmn:sequenceFlow id="YF" sourceRef="YS" targetRef="YE" /><bpmn:endEvent id="YE" />`}</bpmn:subProcess><bpmn:subProcess id="Z">${INNER.replace(/I([SFE])/g, 'Z$1')}<bpmn:startEvent id="ZS2" /><bpmn:sequenceFlow id="ZF2" sourceRef="ZS2" targetRef="ZE" /></bpmn:subProcess>`)), codes: ['W_C8_DEPLOY_START_EVENT', 'W_C8_DEPLOY_START_EVENT', 'W_C8_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'event sub-process with a none start event', xml: xml(toEnd('') + evSub('<bpmn:startEvent id="ESP_S" />')), codes: ['W_C8_DEPLOY_EVENT_DEFINITION'], engine: 'reject', structural: 'E_EVENT_SUBPROCESS_PLAIN_START' },
  { name: 'intermediate catch and boundary events without event definition', xml: xml(boundary('<bpmn:serviceTask id="X">' + ext(TD()) + '</bpmn:serviceTask>', '').replace('<bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />', '<bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="C" /><bpmn:intermediateCatchEvent id="C" /><bpmn:sequenceFlow id="F5" sourceRef="C" targetRef="End" />')), codes: ['W_C8_DEPLOY_EVENT_DEFINITION', 'W_C8_DEPLOY_EVENT_DEFINITION'], engine: 'reject', structural: 'E_INVALID_TRIGGER' },
  { name: 'an event with two event definitions', xml: xml(chain(`<bpmn:intermediateCatchEvent id="X">${TIMER()}<bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:intermediateCatchEvent>`), { roots: MSG() }), codes: ['W_C8_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'cancel end event', xml: xml(toEnd('<bpmn:cancelEventDefinition id="CA" />')), codes: ['W_C8_DEPLOY_UNSUPPORTED'], engine: 'reject', structural: 'E_INVALID_TRIGGER' },
  { name: 'transaction', xml: xml(chain(`<bpmn:transaction id="X">${INNER}</bpmn:transaction>`)), codes: ['W_C8_DEPLOY_UNSUPPORTED'], engine: 'reject' },
  { name: 'conditional events (8.9) with definition ids', xml: xml(boundary(ST(), COND('= x &gt; 1', 'CD2')).replace('<bpmn:startEvent id="Start" />', `<bpmn:startEvent id="Start">${COND('= y', 'CD3')}</bpmn:startEvent>`).replace('<bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />', `<bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="C" /><bpmn:intermediateCatchEvent id="C">${COND('= z', 'CD1', ext('<zeebe:conditionalFilter variableNames="z" variableEvents="create, update" />'))}</bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="F5" sourceRef="C" targetRef="End" />`)), codes: [], engine: 'accept' },
  { name: 'conditional event definition without id', xml: xml(chain(`<bpmn:intermediateCatchEvent id="X">${COND('= x', '')}</bpmn:intermediateCatchEvent>`)), codes: ['W_C8_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'conditional event with a static condition, an unknown variable event', xml: xml(chain(`<bpmn:intermediateCatchEvent id="X">${COND('true', 'CD1', ext('<zeebe:conditionalFilter variableEvents="foo" />'))}</bpmn:intermediateCatchEvent>`)), codes: ['W_C8_DEPLOY_EXPRESSION', 'W_C8_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'conditional event definition without condition (schema)', xml: xml(chain('<bpmn:intermediateCatchEvent id="X"><bpmn:conditionalEventDefinition id="CD1" /></bpmn:intermediateCatchEvent>'), { executable: true }), codes: ['W_C8_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'compensation with definition ids', xml: xml(COMPENSATION()), codes: [], engine: 'accept' },
  { name: 'compensation definitions without id', xml: xml(COMPENSATION('<bpmn:compensateEventDefinition />', '<bpmn:compensateEventDefinition />')), codes: ['W_C8_DEPLOY_EVENT_DEFINITION', 'W_C8_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'compensation boundary event without handler', xml: xml(COMPENSATION(undefined, undefined, false)), codes: ['W_C8_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'boundary event on a compensation handler', xml: xml(COMPENSATION() + `<bpmn:boundaryEvent id="B2" attachedToRef="H">${TIMER()}</bpmn:boundaryEvent>`), codes: ['W_C8_DEPLOY_BOUNDARY_HOST'], engine: 'reject', structural: 'E_INVALID_HOST' },
  { name: 'link pair', xml: xml(LINKS('<bpmn:linkEventDefinition id="L1" name="L" />', ['<bpmn:linkEventDefinition id="L2" name="L" />'])), codes: [], engine: 'accept' },
  { name: 'link catch definition without id', xml: xml(LINKS('<bpmn:linkEventDefinition name="L" />', ['<bpmn:linkEventDefinition name="L" />'])), codes: ['W_C8_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'link throw without catch, two catches of one name', xml: xml(LINKS('<bpmn:linkEventDefinition id="L1" name="A" />', ['<bpmn:linkEventDefinition id="L2" name="B" />', '<bpmn:linkEventDefinition id="L3" name="B" />'])), codes: ['W_C8_DEPLOY_LINK', 'W_C8_DEPLOY_LINK'], engine: 'reject' },
  { name: 'link definition without name (schema)', xml: xml(LINKS('<bpmn:linkEventDefinition id="L1" />', ['<bpmn:linkEventDefinition id="L2" name="L" />'])), codes: ['W_C8_DEPLOY_LINK'], engine: 'reject' },
  { name: 'ad-hoc sub-process', xml: xml(chain(`<bpmn:adHocSubProcess id="X">${ext('<zeebe:adHoc activeElementsCollection="=[&quot;A1&quot;]" />')}<bpmn:task id="A1" /><bpmn:serviceTask id="A2">${ext(TD())}</bpmn:serviceTask></bpmn:adHocSubProcess>`)), codes: [], engine: 'accept' },
  { name: 'ad-hoc sub-process with a start event, without activity, with a service task without job', xml: xml(chain('<bpmn:adHocSubProcess id="X"><bpmn:startEvent id="AS" /></bpmn:adHocSubProcess>', '<bpmn:adHocSubProcess id="Y"><bpmn:serviceTask id="A1" /></bpmn:adHocSubProcess>')), codes: ['W_C8_DEPLOY_AD_HOC_SUBPROCESS', 'W_C8_DEPLOY_AD_HOC_SUBPROCESS', 'W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  // vendor content Camunda 8 does not read
  { name: 'Camunda 7 content in a Camunda 8 file', xml: xml(chain(`<bpmn:userTask id="X" camunda:assignee="demo">${ext('<zeebe:userTask /><camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>')}</bpmn:userTask>`), { ns: `${C8} ${CAMUNDA}` }), codes: ['W_C8_FOREIGN_CONTENT', 'W_C8_FOREIGN_CONTENT'], engine: 'accept' },
  { name: 'unknown zeebe element and attributes', xml: xml(chain(ST(ext('<zeebe:taskDefinition type="w" typo="x" /><zeebe:taskDefinitions />'), ' zeebe:foo="x"'))), codes: ['W_C8_UNKNOWN_ATTRIBUTE', 'W_C8_UNKNOWN_ATTRIBUTE', 'W_C8_UNKNOWN_ELEMENT'], engine: 'accept' },
  { name: 'zeebe content on hosts that do not read it', xml: xml(chain(UT(ext('<zeebe:userTask />' + TD())), `<bpmn:serviceTask id="Y">${ext(TD() + '<zeebe:userTask /><zeebe:calledDecision decisionId="d" resultVariable="r" />')}</bpmn:serviceTask>`)), codes: ['W_C8_MISPLACED_EXTENSION', 'W_C8_MISPLACED_EXTENSION', 'W_C8_MISPLACED_EXTENSION'], engine: 'accept' },
  { name: 'a loose zeebe:input outside zeebe:ioMapping', xml: xml(chain(ST(ext(TD() + '<zeebe:input source="=a" target="b" />')))), codes: ['W_C8_MISPLACED_EXTENSION'], engine: 'accept' },
  { name: 'modeler template attributes', xml: xml(chain(ST(ext(TD()), ' zeebe:modelerTemplate="t" zeebe:modelerTemplateVersion="1"'))), codes: [], engine: 'accept' },
  { name: 'extension elements on bpmn:definitions (schema)', xml: xml(chain(ST())).replace('targetNamespace="http://bpmn.io/schema/bpmn">', `targetNamespace="http://bpmn.io/schema/bpmn">${ext('<zeebe:properties><zeebe:property name="a" value="b" /></zeebe:properties>')}`), codes: ['W_C8_DEPLOY_SCHEMA'], engine: 'reject' },
];

const sorted = (a: string[]): string[] => [...a].sort();

describe('Camunda 8 profile: one model per rule', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const doc = await Doc.fromXml(c.xml);
    const report = runProfile(doc);
    expect(report.platform).toBe('c8');
    expect(sorted(report.findings.map((f) => f.code))).toEqual(sorted(c.codes));
    for (const f of report.findings) {
      expect(f.severity === 'deploy').toBe(f.code.startsWith('W_C8_DEPLOY_'));
      expect(f.hint, f.code).toBeTruthy();
    }
    const deploy = report.findings.some((f) => f.severity === 'deploy');
    const structural = c.structural ? validateDoc(doc).errors.map((e) => e.code) : [];
    if (c.structural) expect(structural).toContain(c.structural);
    // a deploy finding (or the structural error that stands for it) exactly where the engine refuses
    expect(deploy || structural.some((s) => s !== 'E_MULTIPLE_ROOTS')).toBe(c.engine === 'reject');
  });

  it('names the fix: commands with the element, the file prefix and the nested slot', async () => {
    const st = runProfile(await Doc.fromXml(xml(chain('<bpmn:serviceTask id="X" />')))).findings[0]!;
    expect(st.hint).toBe('Give it a job type: `bpmn ext add <file> X zeebe:taskDefinition type=<jobType>`.');
    const mi = runProfile(await Doc.fromXml(xml(chain(ST(ext(TD()) + MI(undefined)))))).findings[0]!;
    expect(mi.hint).toContain('`bpmn ext add <file> X loop.zeebe:loopCharacteristics inputCollection==<items> inputElement=<item>`');
    const key = runProfile(await Doc.fromXml(xml(chain('<bpmn:receiveTask id="X" messageRef="M1" />'), { roots: MSG('M1', 'M1', 'orderId') }))).findings[0]!;
    expect(key).toMatchObject({ code: 'W_C8_DEPLOY_EXPRESSION', element: 'X', related: ['M1'] });
    expect(key.hint).toBe('`bpmn ext add <file> M1 zeebe:subscription correlationKey==orderId --replace`.');
    const cond = runProfile(await Doc.fromXml(xml(gateway(['${amount &gt; 100 &amp;&amp; ok}', null], 'S1')))).findings[0]!;
    expect(cond.hint).toContain("`bpmn set <file> S0 'condition== amount > 100 and ok'`");
    // another prefix for the zeebe namespace
    const z = runProfile(await Doc.fromXml(xml(chain('<bpmn:serviceTask id="X" />'), { ns: 'xmlns:z="http://camunda.org/schema/zeebe/1.0"' }))).findings[0]!;
    expect(z.hint).toBe('Give it a job type: `bpmn ext add <file> X z:taskDefinition type=<jobType>`.');
  });

  it('runs on Camunda 8 files only; --platform c8 forces it', async () => {
    const plain = await Doc.fromXml(xml(chain('<bpmn:serviceTask id="X" />'), { ns: '' }));
    expect(runProfile(plain).findings).toEqual([]);
    expect(runProfile(plain, 'c8').findings.map((f) => f.code)).toEqual(['W_C8_DEPLOY_IMPLEMENTATION']);
    const c7 = await Doc.fromXml(xml(chain('<bpmn:serviceTask id="X" />'), { ns: `${CAMUNDA} ${MODELER} modeler:executionPlatform="Camunda Platform"` }));
    expect(runProfile(c7).findings.some((f) => f.code.startsWith('W_C8_'))).toBe(false);
  });
});

describe('the zeebe descriptor, read as data', () => {
  it('knows where zeebe elements belong and what they hold', () => {
    expect(zeebeAllowedOn('zeebe:taskDefinition', 'bpmn:ServiceTask')).toBe(true);
    expect(zeebeAllowedOn('zeebe:taskDefinition', 'bpmn:EndEvent')).toBe(true);
    expect(zeebeAllowedOn('zeebe:taskDefinition', 'bpmn:UserTask')).toBe(false);
    expect(zeebeAllowedOn('zeebe:ioMapping', 'bpmn:ExclusiveGateway')).toBe(false);
    expect(zeebeAllowedOn('zeebe:subscription', 'bpmn:Message')).toBe(true);
    expect(zeebeAllowedOn('zeebe:properties', 'bpmn:Lane')).toBe(true);
    expect(zeebeAllowedOn('zeebe:publishMessage', 'bpmn:SendTask')).toBe(true);
    expect(zeebeAllowedOn('zeebe:input', 'bpmn:ServiceTask')).toBe(false);
    expect(zeebeAllowedOn('zeebe:nope', 'bpmn:ServiceTask')).toBeUndefined();
    expect(zeebeContainersOf('zeebe:header')).toEqual(['zeebe:taskHeaders']);
    expect(zeebeContainersOf('zeebe:input')).toEqual(['zeebe:ioMapping']);
    expect(zeebeNestedOnly('zeebe:executionListener')).toBe(true);
    expect(zeebeNestedOnly('zeebe:taskHeaders')).toBe(false);
    expect(zeebeType('calledDecision')!.attributes.map((a) => a.name)).toEqual(['decisionId', 'resultVariable', 'bindingType', 'versionTag']);
    expect(zeebeType('zeebe:inputOutputParameter')).toBeUndefined();
    expect(zeebeAttr('zeebe:modelerTemplate')!.owners).toContain('bpmn:FlowElement');
    expect(zeebeAttr('zeebe:taskDefinition')).toBeUndefined();
  });
});

describe('values Camunda 8 parses at deploy (engine-checked on 60 timer values and 45 expressions)', () => {
  it('durations', () => {
    for (const v of ['PT1H', 'P1D', 'P1DT2H', 'PT1.5S', '-PT1S', 'P1W', 'p1d', 'PT1H30M', 'P0D', 'PT0S', 'P1Y2M', 'P1Y2M3DT4H', 'PT1H ', 'PT1M30.5S', 'P2W3D']) expect(validDuration(v), v).toBe(true);
    for (const v of ['pt1h', 'PT', 'P', '1h', 'P1.5D']) expect(validDuration(v), v).toBe(false);
  });
  it('dates', () => {
    for (const v of ['2030-12-31T10:00Z', '2030-12-31T10:00:00Z', '2030-12-31T10:00:00.123Z', '2030-12-31T10:00:00+01:00', '2030-12-31T10:00:00+01:00[Europe/Berlin]', '2030-12-31T10:00:00z']) expect(validDateTime(v), v).toBe(true);
    for (const v of ['2030-12-31T10:00:00[Europe/Berlin]', '2030-12-31', '2030-12-31T10:00:00+0100', '2030-12-31T10:00:00', '2030-12-31 10:00:00Z', '2030-12-31T10Z']) expect(validDateTime(v), v).toBe(false);
  });
  it('cycles', () => {
    for (const v of ['R/PT1H', 'R5/PT1H', 'R0/PT1H', 'R-1/PT1H', 'R/2030-01-01T00:00:00Z/P1D', '0 0 12 * * ?', '0 0 12 ? * MON', '0 0 9-17 * * MON-FRI', '0 0/5 * * * *', '@hourly', '@weekly', '@midnight', '@yearly', '@annually', '@monthly', '@daily', 'R/P1D']) expect(validCycle(v), v).toBe(true);
    for (const v of ['R5/PT1H/2030-01-01T00:00:00Z', 'R5/2030-01-01T00:00:00Z/2030-02-01T00:00:00Z', '@reboot', 'r/PT1H', 'R/PT1H/', 'R5/PT', 'PT1H', '* * * * * * *', '0 9 * * MON']) expect(validCycle(v), v).toBe(false);
  });
  it('FEEL slips', () => {
    const ok = ['a != b', 'not(a)', 'a = 1', '"a && b" = s', '-a', 'a - 1', 'a > 1 and b < 2', 'a in [1,2]', 'if a then b else c', 'some x in xs satisfies x > 1', 'a.b.c', 'x[1]', 'count(xs) > 0', 'date("2020-01-01") < today()', 'a instance of number', 'a between 1 and 3', 'a = null', 'a / 2', 'a ** 2', '`a b` > 1', '//comment\n a', 'a /* c */ > 1', '{"k": 1}.k = 1', '@"2020-01-01"', 'function(x) x', 'for x in xs return x'];
    for (const e of ok) expect(feelProblem(e), e).toBeUndefined();
    const bad = ['x == 1', 'a && b', 'a || b', '!a', '${a}', 'x >', '(a', 'a)', '[1,2', '{a: 1', '"abc', 'a and', 'a or', 'a +', "'single'", 'a ? b : c', 'a.', '', ' '];
    for (const e of bad) expect(feelProblem(e), e).toBeDefined();
  });
});

describe('Camunda 8 files the CLI writes', () => {
  it('new --target camunda8 writes the platform and its version, like Camunda Modeler; its only finding is the missing start event', async () => {
    const doc = Doc.create({ target: 'camunda8', processName: 'Order' });
    expect(doc.definitions.$attrs).toMatchObject({ 'modeler:executionPlatform': 'Camunda Cloud', 'modeler:executionPlatformVersion': '8.9.0' });
    expect(runProfile(doc).findings.map((f) => f.code)).toEqual(['W_C8_DEPLOY_START_EVENT']);
  });

  it('a new or retyped user task is a Camunda user task (zeebe:userTask); a plain or Camunda 7 file gets none', async () => {
    const doc = Doc.create({ target: 'camunda8', processName: 'Order' });
    const r = await mutateDoc(
      doc,
      [
        { op: 'add', kind: 'start', name: 'Go' },
        { op: 'add', kind: 'userTask', name: 'Review', after: 'Event_Go' },
        { op: 'add', kind: 'task', name: 'Ship', after: 'Activity_Review' },
        { op: 'retype', id: 'Activity_Ship', kind: 'userTask' },
      ],
      { dryRun: true },
    );
    expect(r.xml).toMatch(/<bpmn:userTask id="Activity_Review" name="Review">\s*<bpmn:extensionElements>\s*<zeebe:userTask \/>/);
    expect(r.xml).toMatch(/<bpmn:userTask id="Activity_Ship" name="Ship">\s*<bpmn:extensionElements>\s*<zeebe:userTask \/>/);
    expect(r.changes.notes.join('\n')).toMatch(/Activity_Review is a Camunda user task \(zeebe:userTask\)/);
    expect(r.validation.warnings.map((w) => w.code)).not.toContain('W_C8_JOB_WORKER_USER_TASK');
    for (const target of [undefined, 'camunda7'] as const) {
      const other = await mutateDoc(Doc.create({ target, processName: 'Order' }), [{ op: 'add', kind: 'userTask', name: 'Review', in: 'Process_Order' }], { dryRun: true });
      expect(other.xml).not.toContain('zeebe:userTask');
    }
  });

  it('new event definitions get an id derived from their event (Camunda 8.9 refuses conditional, compensation and link catch definitions without one)', async () => {
    const doc = Doc.create({ target: 'camunda8', processName: 'Order' });
    const r = await mutateDoc(
      doc,
      [
        { op: 'add', kind: 'start', name: 'Go' },
        { op: 'add', kind: 'intermediateCatchEvent:conditional', name: 'Stock ready', after: 'Event_Go', when: '= stock > 0' },
        { op: 'add', kind: 'end', name: 'Done', after: 'Event_StockReady' },
      ],
      { dryRun: true },
    );
    expect(r.xml).toContain('<bpmn:conditionalEventDefinition id="ConditionalEventDefinition_StockReady">');
    expect(r.validation.platform).toMatchObject({ platform: 'c8', counts: { deploy: 0, runtime: 0, practice: 0 } });
    const plain = await mutateDoc(Doc.create({ processName: 'Order' }), [{ op: 'add', kind: 'start', name: 'Go', timer: 'PT1H' }], { dryRun: true });
    expect(plain.xml).toMatch(/<bpmn:timerEventDefinition>/);
  });
});

describe('bpmn validate on a Camunda 8 file', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-c8-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function cli(...args: string[]): { code: number; out: string; err: string } {
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  }

  it('counts the findings by severity in the platform line; --strict exits 5; --json carries the severity', () => {
    const file = join(dir, 'job.bpmn');
    writeFileSync(file, xml(chain('<bpmn:serviceTask id="X" />', '<bpmn:userTask id="U" />')));
    const text = cli('validate', file, '--strict');
    expect(text.code).toBe(5);
    expect(text.out).toMatch(/^W_C8_DEPLOY_IMPLEMENTATION X: serviceTask X has no zeebe:taskDefinition/m);
    expect(text.out).toMatch(/^platform: c8 \(modeler:executionPlatform "Camunda Cloud"\) - 1 refused at deploy, 0 runtime, 1 practice finding\(s\)$/m);
    const json = JSON.parse(cli('validate', file, '--json').out);
    expect(json.platform).toMatchObject({ platform: 'c8', counts: { deploy: 1, runtime: 0, practice: 1 } });
    expect(json.warnings.find((w: { code: string }) => w.code === 'W_C8_JOB_WORKER_USER_TASK')).toMatchObject({ severity: 'practice', element: 'U' });
    expect(readFileSync(file, 'utf8')).toContain('<bpmn:serviceTask id="X" />');
  }, 30000);
});

/* ------------------------------------------------------------------ */
/* live engine (opt-in)                                                 */
/* ------------------------------------------------------------------ */

const ENGINE = (process.env['BPMN_C8_ENGINE'] ?? '').trim().replace(/\/$/, '');

async function c8(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${ENGINE}${path}`, { method, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { detail: text };
  }
  return { ok: res.ok, status: res.status, json };
}

/** Deploys resources; returns the refusal message, or undefined and the keys to delete. */
async function deploy(resources: Array<{ name: string; text: string }>): Promise<{ error?: string; keys: string[] }> {
  const form = new FormData();
  for (const r of resources) form.append('resources', new Blob([r.text], { type: 'application/octet-stream' }), r.name);
  const res = await fetch(`${ENGINE}/deployments`, { method: 'POST', body: form, headers: { accept: 'application/json' } });
  const json = (await res.json()) as { detail?: string; deployments?: Array<Record<string, Record<string, string>>> };
  if (!res.ok) return { error: json.detail ?? String(res.status), keys: [] };
  const keys = (json.deployments ?? []).map((d) => d['processDefinition']?.['processDefinitionKey'] ?? d['decisionDefinition']?.['decisionDefinitionKey'] ?? d['decisionRequirements']?.['decisionRequirementsKey']).filter((k): k is string => !!k);
  return { keys };
}

async function undeploy(keys: string[]): Promise<void> {
  for (const k of keys) await c8('POST', `/resources/${k}/deletion`, {});
}

describe.skipIf(!ENGINE)('live engine: the deploy rules flag exactly what Camunda 8 refuses', () => {
  it.each(CASES.map((c, i) => [c.name, c, i] as const))('%s', async (_name, c, i) => {
    const pid = `P_bpmn_cli_c8_profile_${i}`;
    const result = await deploy([{ name: `${pid}.bpmn`, text: c.xml.replace(/id="P_Test"/g, `id="${pid}"`) }]);
    await undeploy(result.keys);
    expect(result.error === undefined, result.error).toBe(c.engine === 'accept');
  });
});
