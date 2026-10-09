/**
 * The Camunda 7 validation profile (src/platform/): platform detection, one
 * synthetic model per rule with the exact findings it must produce, the
 * `validate` command (--platform, --strict, JSON), and mutations reporting only
 * the findings a change introduced.
 *
 * Every model in CASES also states what the engines do with it. Each one was
 * deployed to Camunda 7.24, CIB seven 2.2 and Operaton 2.1.5 (identical
 * verdicts on all three) when the profile was written; to re-check against
 * live engines, set BPMN_C7_ENGINES to their REST roots, comma-separated, e.g.
 *   BPMN_C7_ENGINES=http://localhost:8080/engine-rest npx vitest run test/c7-profile.test.ts
 * The engine block then asserts that the profile reports a deploy-severity
 * finding exactly for the models the engine refuses (each deployment is
 * deleted again).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { checkFile, mutateDoc } from '../src/pipeline.js';
import { detectPlatform } from '../src/platform/detect.js';
import { runProfile, type ProfileFinding } from '../src/platform/profile.js';
import { validateDoc } from '../src/validate.js';

const ROOT = join(import.meta.dirname, '..');
const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
const MODELER = 'xmlns:modeler="http://camunda.org/schema/modeler/1.0"';
const ZEEBE = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"';
const C7 = `${CAMUNDA} ${MODELER} modeler:executionPlatform="Camunda Platform"`;

interface XmlOpts {
  ns?: string;
  roots?: string;
  /** process attributes; default a valid TTL */
  attrs?: string;
  executable?: boolean;
  /** content of bpmn:process before the flow elements (extension elements) */
  head?: string;
  /** content of bpmn:definitions before the process */
  defsHead?: string;
}

function xml(body: string, o: XmlOpts = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${o.ns ?? C7} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${o.defsHead ?? ''}${o.roots ?? ''}
  <bpmn:process id="P_Test" isExecutable="${o.executable ?? true}" ${o.attrs ?? 'camunda:historyTimeToLive="180"'}>
${o.head ?? ''}${body}
  </bpmn:process>
</bpmn:definitions>`;
}

/** start -> x (id X) -> end */
function chain(x: string, extra = ''): string {
  return `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${x}
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />
${extra}`;
}

/** start -> end whose content is `end` (inner XML of the end event) */
function toEnd(end: string, start = ''): string {
  return `    <bpmn:startEvent id="Start">${start}</bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" />
    <bpmn:endEvent id="End">${end}</bpmn:endEvent>`;
}

const ext = (inner: string): string => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const ST = (attrs = '', inner = ''): string => `<bpmn:serviceTask id="X" camunda:expression="\${true}" ${attrs}>${inner}</bpmn:serviceTask>`;
const IO = '<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>';
const OUT_IO = '<camunda:inputOutput><camunda:outputParameter name="o">1</camunda:outputParameter></camunda:inputOutput>';
const TIMER = '<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
const MESSAGES = '  <bpmn:message id="M1" name="M1" />\n  <bpmn:message id="M1b" name="M1" />\n  <bpmn:message id="M2" name="M2" />\n';
const MI_COLLECTION = '<bpmn:multiInstanceLoopCharacteristics camunda:collection="${items}" camunda:elementVariable="item" />';
const boundary = (host: string, def: string, inner = ''): string =>
  chain(host, `    <bpmn:boundaryEvent id="B" attachedToRef="X">${inner}${def}</bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="End2" />
    <bpmn:endEvent id="End2" />`);
function eventGateway(targets: string[], roots = MESSAGES): string {
  let body = `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
    <bpmn:eventBasedGateway id="G" />
`;
  targets.forEach((t, i) => {
    body += `    <bpmn:sequenceFlow id="G${i}" sourceRef="G" targetRef="T${i}" />
    ${t.replace('{id}', `T${i}`)}
    <bpmn:sequenceFlow id="E${i}" sourceRef="T${i}" targetRef="End${i}" />
    <bpmn:endEvent id="End${i}" />
`;
  });
  return xml(body, { roots });
}
const TIMER_CATCH = `<bpmn:intermediateCatchEvent id="{id}">${TIMER}</bpmn:intermediateCatchEvent>`;
const msgCatch = (ref: string): string => `<bpmn:intermediateCatchEvent id="{id}"><bpmn:messageEventDefinition messageRef="${ref}" /></bpmn:intermediateCatchEvent>`;
function exclusive(conditions: Array<string | null>, def?: string): string {
  let body = `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
    <bpmn:exclusiveGateway id="G"${def ? ` default="${def}"` : ''} />
`;
  conditions.forEach((c, i) => {
    const cond = c ? `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${c}</bpmn:conditionExpression>` : '';
    body += `    <bpmn:sequenceFlow id="S${i}" sourceRef="G" targetRef="End${i}">${cond}</bpmn:sequenceFlow>\n    <bpmn:endEvent id="End${i}" />\n`;
  });
  return xml(body);
}

interface Case {
  name: string;
  xml: string;
  /** the profile codes the model must produce (sorted multiset) */
  codes: string[];
  /** what Camunda 7.24 / CIB seven 2.2 / Operaton 2.1.5 do with it */
  engine: 'reject' | 'accept';
  /** a structural error validateDoc reports for the same problem: `validate` shows it instead of the profile codes */
  structural?: string;
}

const CASES: Case[] = [
  // history time to live
  { name: 'executable process without TTL', xml: xml(chain(ST()), { attrs: '' }), codes: ['W_C7_DEPLOY_HISTORY_TTL'], engine: 'reject' },
  { name: 'TTL that is not a number of days', xml: xml(chain(ST()), { attrs: 'camunda:historyTimeToLive="PT5H"' }), codes: ['W_C7_DEPLOY_HISTORY_TTL'], engine: 'reject' },
  { name: 'TTL as P30D and as 0', xml: xml(chain(ST()), { attrs: 'camunda:historyTimeToLive="P30D"' }), codes: [], engine: 'accept' },
  { name: 'non-executable process without TTL and with defects', xml: xml(chain('<bpmn:serviceTask id="X" camunda:asignee="x" />'), { attrs: '', executable: false }), codes: [], engine: 'accept' },
  // implementations
  { name: 'service task without implementation', xml: xml(chain('<bpmn:serviceTask id="X" />')), codes: ['W_C7_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'send task without implementation', xml: xml(chain('<bpmn:sendTask id="X" />')), codes: ['W_C7_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'business rule task without decisionRef or implementation', xml: xml(chain('<bpmn:businessRuleTask id="X" />')), codes: ['W_C7_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'topic without type=external', xml: xml(chain('<bpmn:serviceTask id="X" camunda:topic="t" />')), codes: ['W_C7_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'empty expression counts as none', xml: xml(chain('<bpmn:serviceTask id="X" camunda:expression="" />')), codes: ['W_C7_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'camunda:type other than external', xml: xml(chain('<bpmn:serviceTask id="X" camunda:type="foo" camunda:topic="t" />')), codes: ['W_C7_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'external task without topic', xml: xml(chain('<bpmn:serviceTask id="X" camunda:type="external" />')), codes: ['W_C7_DEPLOY_EXTERNAL_TOPIC'], engine: 'reject' },
  { name: 'external message end event without topic', xml: xml(toEnd('<bpmn:messageEventDefinition camunda:type="external" />')), codes: ['W_C7_DEPLOY_EXTERNAL_TOPIC'], engine: 'reject' },
  { name: 'class with resultVariable', xml: xml(chain('<bpmn:serviceTask id="X" camunda:class="org.example.Bean" camunda:resultVariable="r" />')), codes: ['W_C7_DEPLOY_RESULT_VARIABLE'], engine: 'reject' },
  { name: 'connector, decisionRef and external are implementations', xml: xml(chain('<bpmn:serviceTask id="X">' + ext('<camunda:connector><camunda:connectorId>http-connector</camunda:connectorId></camunda:connector>') + '</bpmn:serviceTask>', '    <bpmn:businessRuleTask id="R" camunda:decisionRef="d" camunda:mapDecisionResult="singleEntry" />\n    <bpmn:sendTask id="Snd" camunda:type="External" camunda:topic="t" />')), codes: [], engine: 'accept' },
  { name: 'message throw and end without implementation', xml: xml(chain('<bpmn:intermediateThrowEvent id="X"><bpmn:messageEventDefinition /></bpmn:intermediateThrowEvent>')), codes: ['W_C7_MESSAGE_NO_IMPLEMENTATION'], engine: 'accept' },
  // call activities and bindings
  { name: 'call activity without calledElement', xml: xml(chain('<bpmn:callActivity id="X" />')), codes: ['W_C7_DEPLOY_CALLED_ELEMENT'], engine: 'reject' },
  { name: 'call activity with calledElement and caseRef', xml: xml(chain('<bpmn:callActivity id="X" calledElement="Other" camunda:caseRef="c" />')), codes: ['W_C7_DEPLOY_CALLED_ELEMENT'], engine: 'reject' },
  { name: 'calledElementBinding=version without version', xml: xml(chain('<bpmn:callActivity id="X" calledElement="Other" camunda:calledElementBinding="version" />')), codes: ['W_C7_DEPLOY_BINDING_VERSION'], engine: 'reject' },
  { name: 'decisionRefBinding=versionTag without tag', xml: xml(chain('<bpmn:businessRuleTask id="X" camunda:decisionRef="d" camunda:decisionRefBinding="versionTag" />')), codes: ['W_C7_DEPLOY_BINDING_VERSION'], engine: 'reject' },
  { name: 'unknown binding values deploy', xml: xml(chain('<bpmn:callActivity id="X" calledElement="Other" camunda:calledElementBinding="foo" />', '    <bpmn:businessRuleTask id="R" camunda:decisionRef="d" camunda:decisionRefBinding="foo" />')), codes: ['W_C7_BAD_VALUE', 'W_C7_BAD_VALUE'], engine: 'accept' },
  { name: 'mapDecisionResult not one of the four', xml: xml(chain('<bpmn:businessRuleTask id="X" camunda:decisionRef="d" camunda:mapDecisionResult="foo" />')), codes: ['W_C7_DEPLOY_BAD_VALUE'], engine: 'reject' },
  { name: 'jobPriority that is not a number', xml: xml(chain(ST('camunda:asyncBefore="true" camunda:jobPriority="high"'))), codes: ['W_C7_DEPLOY_BAD_VALUE'], engine: 'reject' },
  // forms
  { name: 'formRef without formRefBinding', xml: xml(chain('<bpmn:userTask id="X" camunda:formRef="f" />')), codes: ['W_C7_DEPLOY_FORM'], engine: 'reject' },
  { name: 'formKey and formRef together', xml: xml(chain('<bpmn:userTask id="X" camunda:formKey="k" camunda:formRef="f" camunda:formRefBinding="latest" />')), codes: ['W_C7_DEPLOY_FORM'], engine: 'reject' },
  // multi-instance
  { name: 'multi-instance without cardinality or collection', xml: xml(chain('<bpmn:userTask id="X"><bpmn:multiInstanceLoopCharacteristics /></bpmn:userTask>')), codes: ['W_C7_DEPLOY_MULTI_INSTANCE'], engine: 'reject' },
  {
    name: 'multi-instance collection on the task instead of the loop',
    xml: xml(chain('<bpmn:userTask id="X" camunda:collection="${items}" camunda:elementVariable="item"><bpmn:multiInstanceLoopCharacteristics /></bpmn:userTask>')),
    codes: ['W_C7_DEPLOY_MULTI_INSTANCE', 'W_C7_MISPLACED_ATTRIBUTE', 'W_C7_MISPLACED_ATTRIBUTE'],
    engine: 'reject',
  },
  { name: 'elementVariable without collection', xml: xml(chain('<bpmn:userTask id="X"><bpmn:multiInstanceLoopCharacteristics camunda:elementVariable="item" /></bpmn:userTask>')), codes: ['W_C7_DEPLOY_MULTI_INSTANCE'], engine: 'reject' },
  { name: 'multi-instance with collection on the loop', xml: xml(chain(`<bpmn:userTask id="X">${MI_COLLECTION}</bpmn:userTask>`)), codes: [], engine: 'accept' },
  // duplicated and misplaced extension elements
  { name: 'two camunda:inputOutput', xml: xml(chain(ST('', ext(IO + IO)))), codes: ['W_C7_DEPLOY_DUPLICATE_EXTENSION'], engine: 'reject' },
  { name: 'two camunda:formData', xml: xml(chain('<bpmn:userTask id="X">' + ext('<camunda:formData><camunda:formField id="a" type="string" /></camunda:formData><camunda:formData><camunda:formField id="b" type="string" /></camunda:formData>') + '</bpmn:userTask>')), codes: ['W_C7_DEPLOY_DUPLICATE_EXTENSION'], engine: 'reject' },
  { name: 'two retry cycles on an async task', xml: xml(chain(ST('camunda:asyncBefore="true"', ext('<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle><camunda:failedJobRetryTimeCycle>R5/PT1M</camunda:failedJobRetryTimeCycle>')))), codes: ['W_C7_DEPLOY_DUPLICATE_EXTENSION'], engine: 'reject' },
  { name: 'two retry cycles on a synchronous task', xml: xml(chain(ST('', ext('<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle><camunda:failedJobRetryTimeCycle>R5/PT1M</camunda:failedJobRetryTimeCycle>')))), codes: ['W_C7_DUPLICATE_EXTENSION'], engine: 'accept' },
  { name: 'inputParameter loose in extensionElements', xml: xml(chain(ST('', ext('<camunda:inputParameter name="a">x</camunda:inputParameter>')))), codes: ['W_C7_MISPLACED_EXTENSION'], engine: 'accept' },
  { name: 'taskListener, camunda:in and formData on a service task', xml: xml(chain(ST('', ext('<camunda:taskListener event="create" class="a.B" /><camunda:in variables="all" /><camunda:formData />')))), codes: ['W_C7_MISPLACED_EXTENSION', 'W_C7_MISPLACED_EXTENSION', 'W_C7_MISPLACED_EXTENSION'], engine: 'accept' },
  { name: 'inputOutput on the process', xml: xml(chain(ST()), { head: `    ${ext(IO)}\n` }), codes: ['W_C7_MISPLACED_EXTENSION'], engine: 'accept' },
  { name: 'unknown camunda element type', xml: xml(chain(ST('', ext('<camunda:inputOutputt />')))), codes: ['W_C7_UNKNOWN_ELEMENT'], engine: 'accept' },
  { name: 'unknown element inside a form field', xml: xml(chain('<bpmn:userTask id="X">' + ext('<camunda:formData><camunda:formField id="a" type="enum"><camunda:values id="v" name="V" /></camunda:formField></camunda:formData>') + '</bpmn:userTask>')), codes: ['W_C7_UNKNOWN_ELEMENT'], engine: 'accept' },
  // input/output mapping hosts
  { name: 'inputOutput on a start event', xml: xml(toEnd('', ext(IO))), codes: ['W_C7_DEPLOY_INPUT_OUTPUT'], engine: 'reject' },
  { name: 'inputOutput on a boundary event', xml: xml(boundary('<bpmn:userTask id="X" />', TIMER, ext(IO))), codes: ['W_C7_DEPLOY_INPUT_OUTPUT'], engine: 'reject' },
  { name: 'inputOutput on a gateway', xml: xml(chain(`<bpmn:parallelGateway id="X">${ext(IO)}</bpmn:parallelGateway>`)), codes: ['W_C7_DEPLOY_INPUT_OUTPUT'], engine: 'reject' },
  { name: 'output parameter on an end event', xml: xml(toEnd(ext(OUT_IO))), codes: ['W_C7_DEPLOY_INPUT_OUTPUT'], engine: 'reject' },
  { name: 'output parameter on a multi-instance task', xml: xml(chain(`<bpmn:userTask id="X">${ext(OUT_IO)}${MI_COLLECTION}</bpmn:userTask>`)), codes: ['W_C7_DEPLOY_INPUT_OUTPUT'], engine: 'reject' },
  { name: 'inputOutput where the engines read it', xml: xml(chain(`<bpmn:callActivity id="X" calledElement="Other">${ext(OUT_IO)}</bpmn:callActivity>`) + `\n    <bpmn:intermediateThrowEvent id="T">${ext(OUT_IO)}</bpmn:intermediateThrowEvent>`), codes: [], engine: 'accept' },
  // listeners and other extension content
  { name: 'execution listener without implementation', xml: xml(chain(ST('', ext('<camunda:executionListener event="start" />')))), codes: ['W_C7_DEPLOY_LISTENER'], engine: 'reject' },
  { name: 'execution listener event take on a task', xml: xml(chain(ST('', ext('<camunda:executionListener event="take" class="a.B" />')))), codes: ['W_C7_DEPLOY_LISTENER'], engine: 'reject' },
  { name: 'timeout task listener without timer', xml: xml(chain('<bpmn:userTask id="X">' + ext('<camunda:taskListener event="timeout" id="T" class="a.B" />') + '</bpmn:userTask>')), codes: ['W_C7_DEPLOY_LISTENER'], engine: 'reject' },
  { name: 'camunda:in with source but no target', xml: xml(chain('<bpmn:callActivity id="X" calledElement="Other">' + ext('<camunda:in source="a" />') + '</bpmn:callActivity>')), codes: ['W_C7_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'inputParameter without name', xml: xml(chain(ST('', ext('<camunda:inputOutput><camunda:inputParameter>1</camunda:inputParameter></camunda:inputOutput>')))), codes: ['W_C7_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'form field without type, and with a type the engines do not know', xml: xml(chain('<bpmn:userTask id="X">' + ext('<camunda:formData><camunda:formField id="a" /><camunda:formField id="b" type="String" /><camunda:formField id="c" type="date" /></camunda:formData>') + '</bpmn:userTask>')), codes: ['W_C7_DEPLOY_EXTENSION', 'W_C7_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'connector without connectorId', xml: xml(chain('<bpmn:serviceTask id="X">' + ext('<camunda:connector />') + '</bpmn:serviceTask>')), codes: ['W_C7_DEPLOY_EXTENSION'], engine: 'reject' },
  // event-based gateway, messages, signals, errors, escalations
  { name: 'receive task after an event-based gateway', xml: eventGateway([TIMER_CATCH, '<bpmn:receiveTask id="{id}" messageRef="M1" />']), codes: ['W_C7_DEPLOY_EVENT_GATEWAY'], engine: 'reject' },
  { name: 'user task after an event-based gateway', xml: eventGateway([TIMER_CATCH, '<bpmn:userTask id="{id}" />']), codes: ['W_C7_DEPLOY_EVENT_GATEWAY'], engine: 'reject' },
  { name: 'link catch event after an event-based gateway', xml: eventGateway([TIMER_CATCH, '<bpmn:intermediateCatchEvent id="{id}"><bpmn:linkEventDefinition name="L" /></bpmn:intermediateCatchEvent>']), codes: ['W_C7_DEPLOY_EVENT_GATEWAY'], engine: 'reject' },
  { name: 'two gateway branches wait for the same message name', xml: eventGateway([msgCatch('M1'), msgCatch('M1b')]), codes: ['W_C7_DEPLOY_EVENT_GATEWAY'], engine: 'reject' },
  { name: 'event-based gateway with timer and message branches', xml: eventGateway([TIMER_CATCH, msgCatch('M1')]), codes: [], engine: 'accept' },
  { name: 'message catch event without message', xml: xml(chain('<bpmn:intermediateCatchEvent id="X"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>')), codes: ['W_C7_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'message without name', xml: xml(chain('<bpmn:intermediateCatchEvent id="X"><bpmn:messageEventDefinition messageRef="MN" /></bpmn:intermediateCatchEvent>'), { roots: '  <bpmn:message id="MN" />\n' }), codes: ['W_C7_DEPLOY_MESSAGE'], engine: 'reject' },
  {
    name: 'two message start events with one message name',
    xml: xml(
      `    <bpmn:startEvent id="S1"><bpmn:messageEventDefinition messageRef="M1" /></bpmn:startEvent>
    <bpmn:startEvent id="S2"><bpmn:messageEventDefinition messageRef="M1b" /></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="End" />
    <bpmn:sequenceFlow id="F2" sourceRef="S2" targetRef="End" />
    <bpmn:endEvent id="End" />`,
      { roots: MESSAGES },
    ),
    codes: ['W_C7_DEPLOY_MESSAGE'],
    engine: 'reject',
  },
  { name: 'receive task without message', xml: xml(chain('<bpmn:receiveTask id="X" />')), codes: [], engine: 'accept' },
  { name: 'signal catch event without signal', xml: xml(chain('<bpmn:intermediateCatchEvent id="X"><bpmn:signalEventDefinition /></bpmn:intermediateCatchEvent>')), codes: ['W_C7_DEPLOY_SIGNAL'], engine: 'reject' },
  { name: 'two root signals with one name', xml: xml(chain('<bpmn:intermediateThrowEvent id="X"><bpmn:signalEventDefinition signalRef="Sig1" /></bpmn:intermediateThrowEvent>'), { roots: '  <bpmn:signal id="Sig1" name="S" />\n  <bpmn:signal id="Sig2" name="S" />\n' }), codes: ['W_C7_DEPLOY_SIGNAL'], engine: 'reject' },
  { name: 'error end event whose error has no errorCode', xml: xml(toEnd('<bpmn:errorEventDefinition errorRef="Err" />'), { roots: '  <bpmn:error id="Err" name="Err" />\n' }), codes: ['W_C7_DEPLOY_ERROR'], engine: 'reject' },
  { name: 'error boundary event without errorCode catches everything', xml: xml(boundary('<bpmn:userTask id="X" />', '<bpmn:errorEventDefinition errorRef="Err" />'), { roots: '  <bpmn:error id="Err" name="Err" />\n' }), codes: [], engine: 'accept' },
  { name: 'escalation end event without escalationCode', xml: xml(toEnd('<bpmn:escalationEventDefinition escalationRef="Esc" />'), { roots: '  <bpmn:escalation id="Esc" name="Esc" />\n' }), codes: ['W_C7_DEPLOY_ESCALATION'], engine: 'reject' },
  { name: 'escalation boundary event on a service task', xml: xml(boundary(ST(), '<bpmn:escalationEventDefinition escalationRef="Esc" />'), { roots: '  <bpmn:escalation id="Esc" name="Esc" escalationCode="E" />\n' }), codes: ['W_C7_DEPLOY_ESCALATION'], engine: 'reject' },
  {
    name: 'boundary event on a compensation handler',
    xml: xml(
      chain(ST(), `    <bpmn:boundaryEvent id="BC" attachedToRef="X"><bpmn:compensateEventDefinition /></bpmn:boundaryEvent>
    <bpmn:serviceTask id="H" isForCompensation="true" camunda:expression="\${true}" />
    <bpmn:boundaryEvent id="BT" attachedToRef="H">${TIMER}</bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F3" sourceRef="BT" targetRef="End2" />
    <bpmn:endEvent id="End2" />
    <bpmn:association id="A1" associationDirection="One" sourceRef="BC" targetRef="H" />`),
    ),
    codes: ['W_C7_DEPLOY_BOUNDARY_HOST'],
    engine: 'reject',
    structural: 'E_INVALID_HOST',
  },
  { name: 'timer without value', xml: xml(chain('<bpmn:intermediateCatchEvent id="X"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>')), codes: ['W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'script task without script', xml: xml(chain('<bpmn:scriptTask id="X" scriptFormat="groovy" />')), codes: ['W_C7_DEPLOY_SCRIPT'], engine: 'reject' },
  // exclusive gateways
  { name: 'flow without condition next to the default flow', xml: exclusive(['${a}', null, null], 'S2'), codes: ['W_C7_DEPLOY_EXCLUSIVE_GATEWAY'], engine: 'reject' },
  { name: 'two flows without condition', xml: exclusive(['${a}', null, null]), codes: ['W_C7_DEPLOY_EXCLUSIVE_GATEWAY', 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY'], engine: 'reject' },
  { name: 'single outgoing flow with a condition', xml: exclusive(['${a}']), codes: ['W_C7_DEPLOY_EXCLUSIVE_GATEWAY'], engine: 'reject' },
  { name: 'conditional default flow', xml: exclusive(['${a}', '${b}'], 'S1'), codes: ['W_C7_DEPLOY_EXCLUSIVE_GATEWAY'], engine: 'reject' },
  { name: 'one flow without condition and no default', xml: exclusive(['${a}', null]), codes: ['W_C7_EXCLUSIVE_GATEWAY_DEFAULT'], engine: 'accept' },
  { name: 'conditions plus a default flow', xml: exclusive(['${a}', null], 'S1'), codes: [], engine: 'accept' },
  // file level, attributes, foreign content
  { name: 'extensionElements under bpmn:definitions', xml: xml(chain(ST()), { defsHead: `  ${ext('<camunda:properties><camunda:property name="a" value="b" /></camunda:properties>')}\n` }), codes: ['W_C7_DEPLOY_DEFINITIONS_EXTENSION'], engine: 'reject' },
  { name: 'camunda:assignee on a service task', xml: xml(chain(ST('camunda:assignee="demo"'))), codes: ['W_C7_MISPLACED_ATTRIBUTE'], engine: 'accept' },
  { name: 'typo camunda:asignee on a user task', xml: xml(chain('<bpmn:userTask id="X" camunda:asignee="demo" />')), codes: ['W_C7_UNKNOWN_ATTRIBUTE'], engine: 'accept' },
  { name: 'errorCodeVariable on the event instead of its definition', xml: xml(boundary(ST(), '<bpmn:errorEventDefinition errorRef="Err" />').replace('<bpmn:boundaryEvent id="B"', '<bpmn:boundaryEvent id="B" camunda:errorCodeVariable="code"'), { roots: '  <bpmn:error id="Err" name="Err" errorCode="E" />\n' }), codes: ['W_C7_MISPLACED_ATTRIBUTE'], engine: 'accept' },
  { name: 'asyncBefore that is not true/false', xml: xml(chain(ST('camunda:asyncBefore="yes"'))), codes: ['W_C7_BAD_VALUE'], engine: 'accept' },
  { name: 'zeebe content in a Camunda 7 file', xml: xml(chain(ST('zeebe:retries="3"', ext('<zeebe:taskDefinition type="x" />'))), { ns: `${C7} ${ZEEBE}` }), codes: ['W_C7_FOREIGN_CONTENT', 'W_C7_FOREIGN_CONTENT'], engine: 'accept' },
  { name: 'camunda:errorEventDefinition with a dangling errorRef', xml: xml(chain('<bpmn:serviceTask id="X" camunda:type="external" camunda:topic="t">' + ext('<camunda:errorEventDefinition id="CE" errorRef="Error_Gone" expression="${true}" />') + '</bpmn:serviceTask>')), codes: ['W_C7_DANGLING_REF'], engine: 'accept' },
  {
    name: 'Camunda Modeler style content the engines accept',
    xml: xml(
      chain(
        '<bpmn:serviceTask id="X" camunda:type="external" camunda:topic="charge" camunda:taskPriority="5" camunda:asyncBefore="true" camunda:jobPriority="${prio}">' +
          ext(
            '<camunda:inputOutput><camunda:inputParameter name="l"><camunda:list><camunda:value>a</camunda:value></camunda:list></camunda:inputParameter><camunda:inputParameter name="m"><camunda:map><camunda:entry key="k">v</camunda:entry></camunda:map></camunda:inputParameter><camunda:inputParameter name="s"><camunda:script scriptFormat="groovy">1</camunda:script></camunda:inputParameter><camunda:outputParameter name="o">${x}</camunda:outputParameter></camunda:inputOutput>' +
              '<camunda:executionListener event="start"><camunda:script scriptFormat="groovy">1</camunda:script></camunda:executionListener><camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle><camunda:properties><camunda:property name="p" value="1" /></camunda:properties>' +
              '<camunda:errorEventDefinition id="CE" errorRef="Err" expression="${true}" />',
          ) +
          '</bpmn:serviceTask>',
        `    <bpmn:userTask id="U" camunda:assignee="demo" camunda:candidateGroups="g" camunda:formRef="f" camunda:formRefBinding="latest" camunda:priority="\${p}">${ext('<camunda:taskListener event="create" expression="${true}"><camunda:field name="f" stringValue="v" /></camunda:taskListener>')}${MI_COLLECTION}</bpmn:userTask>
    <bpmn:callActivity id="C" calledElement="Other" camunda:calledElementBinding="latest">${ext('<camunda:in variables="all" /><camunda:out source="a" target="b" /><camunda:in businessKey="${k}" />')}</bpmn:callActivity>
    <bpmn:businessRuleTask id="R" camunda:decisionRef="d" camunda:resultVariable="r" camunda:mapDecisionResult="singleResult" />
    <bpmn:scriptTask id="Sc" scriptFormat="groovy" camunda:resultVariable="r"><bpmn:script>1</bpmn:script></bpmn:scriptTask>`,
      ),
      {
        attrs: 'camunda:historyTimeToLive="180" camunda:versionTag="1.0" camunda:candidateStarterGroups="g" camunda:isStartableInTasklist="true"',
        head: `    ${ext('<camunda:executionListener event="end" expression="${true}" /><camunda:potentialStarter><bpmn:resourceAssignmentExpression><bpmn:formalExpression>group(a)</bpmn:formalExpression></bpmn:resourceAssignmentExpression></camunda:potentialStarter>')}\n`,
        roots: '  <bpmn:error id="Err" name="Err" errorCode="E" camunda:errorMessage="m" />\n',
      },
    ),
    codes: [],
    engine: 'accept',
  },
];

function profileCodes(doc: Doc): string[] {
  return validateDoc(doc, { platform: 'auto' })
    .warnings.filter((w) => w.code.startsWith('W_C7_'))
    .map((w) => w.code)
    .sort();
}

describe('Camunda 7 profile: one model per rule', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    // standalone on a fresh document: the rules must not rely on validateDoc having repaired incoming/outgoing
    const findings = runProfile(await Doc.fromXml(c.xml)).findings;
    expect(findings.map((f) => f.code).sort()).toEqual([...c.codes].sort());
    // validate reports a problem once: a structural error replaces the profile finding that repeats it
    expect(profileCodes(await Doc.fromXml(c.xml))).toEqual(c.structural ? [] : [...c.codes].sort());
    if (c.structural) expect(validateDoc(await Doc.fromXml(c.xml), { platform: 'auto' }).errors.map((e) => e.code)).toContain(c.structural);
    // deploy-severity findings exactly where the engines refuse the file
    expect(findings.some((f) => f.severity === 'deploy')).toBe(c.engine === 'reject');
    expect(findings.every((f) => f.code.startsWith('W_C7_DEPLOY_') === (f.severity === 'deploy'))).toBe(true);
    // every finding says how to fix it with a command line
    for (const f of findings) expect(f.hint, `${f.code}: ${f.hint}`).toMatch(/`bpmn (set|add|remove|move|ext (add|remove|list)) <file> /);
  });

  it('names the element and the fix (did you mean, nested keys)', async () => {
    const typo = await Doc.fromXml(xml(chain('<bpmn:userTask id="X" camunda:asignee="demo" />')));
    const [f] = runProfile(typo).findings;
    expect(f).toMatchObject({ code: 'W_C7_UNKNOWN_ATTRIBUTE', element: 'X', severity: 'runtime' });
    expect(f!.message).toContain('did you mean camunda:assignee?');
    expect(f!.hint).toContain('`bpmn set <file> X camunda:asignee= camunda:assignee=demo`');
    const mi = await Doc.fromXml(xml(chain('<bpmn:userTask id="X" camunda:collection="${items}"><bpmn:multiInstanceLoopCharacteristics /></bpmn:userTask>')));
    const deploy = runProfile(mi).findings.find((x) => x.code === 'W_C7_DEPLOY_MULTI_INSTANCE')!;
    expect(deploy.hint).toContain("`bpmn set <file> X camunda:collection= 'loop.camunda:collection=${items}'`");
    const ttl = await Doc.fromXml(xml(chain(ST()), { attrs: '' }));
    expect(runProfile(ttl).findings[0]!.hint).toContain('`bpmn set <file> P_Test camunda:historyTimeToLive=180`');
    const event = await Doc.fromXml(xml(toEnd('<bpmn:messageEventDefinition id="MED" />')));
    expect(runProfile(event).findings[0]).toMatchObject({ code: 'W_C7_MESSAGE_NO_IMPLEMENTATION', element: 'End' });
    expect(runProfile(event).findings[0]!.hint).toContain('definition.camunda:type=external');
  });

  it('replaces the lint warning about an event-gateway target with the engine finding', async () => {
    const doc = await Doc.fromXml(eventGateway([TIMER_CATCH, '<bpmn:userTask id="{id}" />']));
    expect(validateDoc(doc).warnings.map((w) => w.code)).toContain('W_EVENT_GATEWAY_TARGET');
    const codes = validateDoc(doc, { platform: 'auto' }).warnings.map((w) => w.code);
    expect(codes).toContain('W_C7_DEPLOY_EVENT_GATEWAY');
    expect(codes).not.toContain('W_EVENT_GATEWAY_TARGET');
  });

  it('runs only on request: validateDoc without a platform and other platforms report nothing', async () => {
    const doc = await Doc.fromXml(xml(chain('<bpmn:serviceTask id="X" />'), { attrs: '' }));
    expect(validateDoc(doc).warnings.some((w) => w.code.startsWith('W_C7_'))).toBe(false);
    expect(validateDoc(doc).platform).toBeUndefined();
    expect(validateDoc(doc, { platform: 'none' }).warnings.some((w) => w.code.startsWith('W_C7_'))).toBe(false);
    expect(validateDoc(doc, { platform: 'c8' }).platform).toMatchObject({ platform: 'c8', source: 'option' });
    const plain = await Doc.fromXml(xml(chain('<bpmn:serviceTask id="X" />'), { ns: '', attrs: '' }));
    expect(validateDoc(plain, { platform: 'auto' }).platform).toMatchObject({ platform: 'none', counts: { deploy: 0, runtime: 0, practice: 0 } });
    expect(validateDoc(plain, { platform: 'c7' }).warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['W_C7_DEPLOY_IMPLEMENTATION']));
  });
});

describe('platform detection', () => {
  const detect = async (ns: string, body = chain(ST()), attrs = ''): Promise<ReturnType<typeof detectPlatform>> => detectPlatform(await Doc.fromXml(xml(body, { ns, attrs })));

  it('modeler:executionPlatform decides first', async () => {
    expect(await detect(C7)).toMatchObject({ platform: 'c7', source: 'executionPlatform' });
    expect(await detect(`${ZEEBE} ${MODELER} modeler:executionPlatform="Camunda Cloud"`, chain('<bpmn:task id="X" />'))).toMatchObject({ platform: 'c8', source: 'executionPlatform' });
    // a Camunda 8 file with camunda content is still Camunda 8
    expect(await detect(`${CAMUNDA} ${MODELER} modeler:executionPlatform="Camunda Cloud"`)).toMatchObject({ platform: 'c8' });
  });

  it('else the vendor namespace the content uses (CIB seven, Operaton included), else a declared one', async () => {
    expect(await detect(CAMUNDA)).toMatchObject({ platform: 'c7', source: 'namespace-use' });
    expect(await detect(`${CAMUNDA} ${ZEEBE}`, chain('<bpmn:serviceTask id="X" zeebe:a="1" />'))).toMatchObject({ platform: 'c8', source: 'namespace-use' });
    expect(await detect('xmlns:operaton="http://operaton.org/schema/1.0/bpmn"', chain('<bpmn:serviceTask id="X" operaton:expression="${true}" />'))).toMatchObject({ platform: 'c7', source: 'namespace-use' });
    expect(await detect(CAMUNDA, chain('<bpmn:task id="X" />'))).toMatchObject({ platform: 'c7', source: 'namespace-declaration' });
    expect(await detect(`${CAMUNDA} ${ZEEBE}`, chain('<bpmn:task id="X" />'))).toMatchObject({ platform: 'none' });
    expect(await detect('', chain('<bpmn:task id="X" />'))).toMatchObject({ platform: 'none', source: 'none' });
  });

  it('new --target camunda7 is a Camunda 7 file whose only finding is the missing start event', async () => {
    const doc = Doc.create({ target: 'camunda7', processName: 'Order' });
    expect(detectPlatform(doc)).toMatchObject({ platform: 'c7', source: 'executionPlatform' });
    // the engines refuse an empty process ("process must define a startEvent element")
    expect(runProfile(doc).findings.map((f) => f.code)).toEqual(['W_C7_DEPLOY_START_EVENT']);
  });
});

describe('mutations report only the findings they introduce', () => {
  const base = (body: string): string => xml(body);

  it('a new service task without implementation is reported once, and resolved when fixed', async () => {
    const doc = await Doc.fromXml(base(toEnd('')));
    const added = await mutateDoc(doc, [{ op: 'add', kind: 'serviceTask', name: 'Charge', after: 'Start' }], { dryRun: true, layout: false });
    expect(added.validation.warnings.map((w) => w.code)).toContain('W_C7_DEPLOY_IMPLEMENTATION');
    expect(added.validation.platform).toMatchObject({ platform: 'c7', counts: { deploy: 1 }, resolved: [] });
    expect(added.validation.platform!.added!.map((f) => f.code)).toEqual(['W_C7_DEPLOY_IMPLEMENTATION']);
    const next = await mutateDoc(doc, [{ op: 'set', id: 'Activity_Charge', values: { name: 'Charge card' } }], { dryRun: true, layout: false });
    expect(next.validation.warnings.map((w) => w.code)).not.toContain('W_C7_DEPLOY_IMPLEMENTATION');
    expect(next.validation.platform).toMatchObject({ counts: { deploy: 1 }, added: [], resolved: [] });
    const fixed = await mutateDoc(doc, [{ op: 'set', id: 'Activity_Charge', values: { 'camunda:type': 'external', 'camunda:topic': 'charge' } }], { dryRun: true, layout: false });
    expect(fixed.validation.platform!.resolved!.map((f) => f.code)).toEqual(['W_C7_DEPLOY_IMPLEMENTATION']);
    expect(fixed.validation.platform!.counts.deploy).toBe(0);
  });

  it('a pre-existing finding is not repeated, also when its element is renamed', async () => {
    const doc = await Doc.fromXml(base(chain('<bpmn:userTask id="X" camunda:asignee="demo" />')));
    const r = await mutateDoc(doc, [{ op: 'set', id: 'X', values: { id: 'Activity_Review' } }], { dryRun: true, layout: false });
    expect(r.validation.warnings.some((w) => w.code.startsWith('W_C7_'))).toBe(false);
    expect(r.validation.platform).toMatchObject({ counts: { runtime: 1 }, added: [], resolved: [] });
  });

  it('retyping a user task to a service task reports the missing implementation and the stale attributes', async () => {
    const doc = await Doc.fromXml(base(chain('<bpmn:userTask id="X" camunda:assignee="demo" camunda:candidateGroups="g" />')));
    const r = await mutateDoc(doc, [{ op: 'retype', id: 'X', kind: 'serviceTask' }], { dryRun: true, layout: false });
    const codes = r.validation.platform!.added!.map((f) => f.code).sort();
    expect(codes).toEqual(['W_C7_DEPLOY_IMPLEMENTATION', 'W_C7_MISPLACED_ATTRIBUTE', 'W_C7_MISPLACED_ATTRIBUTE']);
  });

  it('connecting an event-based gateway to a task reports what the engines will refuse (instead of the lint warning)', async () => {
    const doc = await Doc.fromXml(eventGateway([TIMER_CATCH, msgCatch('M1')]).replace('</bpmn:process>', '<bpmn:userTask id="U" /></bpmn:process>'));
    const r = await mutateDoc(doc, [{ op: 'connect', source: 'G', target: 'U' }], { dryRun: true, layout: false });
    const codes = r.validation.warnings.map((w) => w.code);
    expect(codes).toContain('W_C7_DEPLOY_EVENT_GATEWAY');
    expect(codes).not.toContain('W_EVENT_GATEWAY_TARGET');
  });

  it('platform none switches the profile off for a mutation', async () => {
    const doc = await Doc.fromXml(base(toEnd('')));
    const r = await mutateDoc(doc, [{ op: 'add', kind: 'serviceTask', name: 'Charge', after: 'Start' }], { dryRun: true, layout: false, platform: 'none' });
    expect(r.validation.warnings.some((w) => w.code.startsWith('W_C7_'))).toBe(false);
    expect(r.validation.platform).toMatchObject({ platform: 'none' });
  });
});

describe('bpmn validate', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-c7-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function cli(...args: string[]): { code: number; out: string; err: string } {
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  }

  it('reports the platform and the findings; --strict exits 5; --platform overrides', async () => {
    const file = join(dir, 'typo.bpmn');
    writeFileSync(file, xml(chain('<bpmn:userTask id="X" camunda:asignee="demo" />')));
    const text = cli('validate', file, '--strict');
    expect(text.code).toBe(5);
    expect(text.out).toMatch(/W_C7_UNKNOWN_ATTRIBUTE X: .*did you mean camunda:assignee\?/);
    expect(text.out).toMatch(/^platform: c7 \(modeler:executionPlatform "Camunda Platform"\) - 0 refused at deploy, 1 runtime, 0 practice finding\(s\)$/m);
    const json = JSON.parse(cli('validate', file, '--json').out);
    expect(json.platform).toMatchObject({ platform: 'c7', source: 'executionPlatform', counts: { deploy: 0, runtime: 1, practice: 0 } });
    expect(json.warnings.find((w: ProfileFinding) => w.code === 'W_C7_UNKNOWN_ATTRIBUTE')).toMatchObject({ severity: 'runtime', element: 'X' });
    expect(cli('validate', file, '--strict', '--platform', 'none').code).toBe(0);
    const bad = cli('validate', file, '--platform', 'c9');
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/expected auto, c7, c8, none/);
  }, 30000);

  it('checkFile runs the profile (library)', async () => {
    const file = join(dir, 'ttl.bpmn');
    writeFileSync(file, xml(chain(ST()), { attrs: '' }));
    const r = await checkFile(file);
    expect(r.validation.warnings.map((w) => w.code)).toContain('W_C7_DEPLOY_HISTORY_TTL');
    expect((await checkFile(file, { platform: 'none' })).validation.warnings.map((w) => w.code)).not.toContain('W_C7_DEPLOY_HISTORY_TTL');
  });
});

/* ------------------------------------------------------------------ */
/* live engines (opt-in)                                                */
/* ------------------------------------------------------------------ */

const ENGINES = (process.env['BPMN_C7_ENGINES'] ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

async function deploy(engine: string, name: string, bpmn: string): Promise<{ ok: boolean; message: string }> {
  const form = new FormData();
  form.append('deployment-name', name);
  form.append('deployment-source', 'bpmn-cli-test');
  form.append('data', new Blob([bpmn], { type: 'application/octet-stream' }), `${name}.bpmn`);
  const res = await fetch(`${engine}/deployment/create`, { method: 'POST', body: form });
  const body = (await res.json()) as { id?: string; message?: string };
  if (res.ok && body.id) {
    await fetch(`${engine}/deployment/${body.id}?cascade=true`, { method: 'DELETE' });
    return { ok: true, message: '' };
  }
  return { ok: false, message: body.message ?? String(res.status) };
}

describe.skipIf(!ENGINES.length)('live engines: the deploy rules flag exactly what the engines refuse', () => {
  for (const engine of ENGINES) {
    it.each(CASES.map((c, i) => [c.name, c, i] as const))(`${engine}: %s`, async (_name, c, i) => {
      const result = await deploy(engine, `bpmn-cli-c7-profile-${i}`, c.xml);
      expect(result.ok, result.message).toBe(c.engine === 'accept');
      const deployFindings = runProfile(await Doc.fromXml(c.xml)).findings.filter((f) => f.severity === 'deploy');
      expect(deployFindings.length > 0).toBe(!result.ok);
    });
  }
});
