/**
 * Camunda 8 after the step 3 verifier round (each finding with a test that
 * failed before the fix):
 *
 *  - FEEL is parsed (src/platform/feel.ts): the 762 expressions of
 *    fixtures/c8/feel-verdicts.json were deployed to Camunda 8.9.22 as flow
 *    conditions; the check agrees with the engine on every one (`&`, `|`,
 *    `<>`, `>>`, `%`, if without else, AND, `:=` ... are refused; ranges,
 *    unary tests, contexts, function names with spaces, keywords glued to a
 *    name ... pass). The messages name the FEEL spelling.
 *  - Deploy rules the profile missed and false deploy findings: MODELS with
 *    the engine's verdict (FEEL in a script, an ad-hoc completion condition,
 *    a signal / published message name and the zeebe:adHoc expressions,
 *    PT1.5H, ids that are no NCName, IDREFs that name no id, the child order
 *    of the BPMN schema, an empty link name; white-space values, an empty
 *    priority and a lower-case date-time pass).
 *  - In a batch the message (error, signal, escalation) an op creates or
 *    finds has an alias (`refAs`), and a zeebe:subscription /
 *    zeebe:correlationKey given to the element that waits for a message
 *    goes to that message.
 *  - `bpmn kinds --help` lists every section the guide points to.
 *
 * With BPMN_C8_ENGINE=<REST v2 root> the verdicts are deployed again (the
 * accepted expressions in a few files, each refused one and each model on
 * its own; every accepted deployment is deleted).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { guideText, KINDS_SECTION_NAMES, kindsSections } from '../src/guide.js';
import { runOps } from '../src/ops/index.js';
import { mutateDoc } from '../src/pipeline.js';
import { feelProblem, validCycle, validDateTime, validDuration } from '../src/platform/c8.js';
import { runProfile } from '../src/platform/profile.js';

const ROOT = join(import.meta.dirname, '..');
const C8 = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.9.0"';
const DI = 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"';

function xml(body: string, o: { roots?: string; after?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${DI} ${C8} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${o.roots ?? ''}  <bpmn:process id="P_Test" isExecutable="true">
${body}
  </bpmn:process>
${o.after ?? ''}</bpmn:definitions>`;
}
const ext = (inner: string): string => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const TD = (type = 'work'): string => `<zeebe:taskDefinition type="${type}" />`;
/** start -> X -> end */
const chain = (x: string): string => `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${x}
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />`;
/** start -> end, the end event with `end` inside */
const toEnd = (end: string, start = ''): string => `    <bpmn:startEvent id="Start">${start}</bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" />
    <bpmn:endEvent id="End">${end}</bpmn:endEvent>`;
const ST = (inner = ext(TD())): string => `<bpmn:serviceTask id="X">${inner}</bpmn:serviceTask>`;
const UT = (inner: string): string => `<bpmn:userTask id="X">${ext(`<zeebe:userTask />${inner}`)}</bpmn:userTask>`;
const MSG = (id: string, name: string, key: string | null = '=orderId'): string => `  <bpmn:message id="${id}" name="${name}">${key === null ? '' : ext(`<zeebe:subscription correlationKey="${key}" />`)}</bpmn:message>\n`;
const SIGNAL = (name: string): string => `  <bpmn:signal id="Sig" name="${name}" />\n`;
const TIMER = (kind: string, v: string): string => `<bpmn:timerEventDefinition id="TD1"><bpmn:${kind} xsi:type="bpmn:tFormalExpression">${v}</bpmn:${kind}></bpmn:timerEventDefinition>`;
const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** start -> exclusive gateway -> one end per condition and a default flow */
function gateway(conditions: string[]): string {
  let body = `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
    <bpmn:exclusiveGateway id="G" default="SD" />
    <bpmn:sequenceFlow id="SD" sourceRef="G" targetRef="EndD" />
    <bpmn:endEvent id="EndD" />
`;
  conditions.forEach((c, i) => {
    body += `    <bpmn:sequenceFlow id="S${i}" sourceRef="G" targetRef="End${i}"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${escape(c)}</bpmn:conditionExpression></bpmn:sequenceFlow>\n    <bpmn:endEvent id="End${i}" />\n`;
  });
  return body;
}
/** a service task X between start and end, with the child elements in this order */
const ordered = (inner: string): string => `    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="X">${inner}</bpmn:serviceTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />`;
const LINKS = (name: string): string => `    <bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:intermediateThrowEvent id="X"><bpmn:linkEventDefinition id="L1" name="${name}" /></bpmn:intermediateThrowEvent>
    <bpmn:intermediateCatchEvent id="C"><bpmn:linkEventDefinition id="L2" name="${name}" /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="FC" sourceRef="C" targetRef="End" />
    <bpmn:endEvent id="End" />`;
const ADHOC = (inner: string, zeebe = ''): string => chain(`<bpmn:adHocSubProcess id="X">${zeebe ? ext(zeebe) : ''}<bpmn:task id="A1" />${inner}</bpmn:adHocSubProcess>`);
const W = '   ';

/** The deploy-severity codes of the Camunda 8 profile, sorted. */
async function deployCodes(text: string): Promise<string[]> {
  return runProfile(await Doc.fromXml(text))
    .findings.filter((f) => f.severity === 'deploy')
    .map((f) => f.code)
    .sort();
}

function caught(fn: () => unknown): { code?: string; message: string; hint?: string } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: { hint?: string } };
    return { code: e.code, message: e.message, hint: e.details?.hint };
  }
  throw new Error('expected an error');
}

/* ------------------------------------------------------------------ */
/* FEEL                                                                 */
/* ------------------------------------------------------------------ */

/** [expression after the =, Camunda 8.9.22 deploys it as a flow condition] */
const FEEL_VERDICTS = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'c8', 'feel-verdicts.json'), 'utf8')) as Array<[string, boolean]>;

describe('FEEL syntax: the check agrees with Camunda 8.9.22', () => {
  it(`on all ${FEEL_VERDICTS.length} engine-checked expressions`, () => {
    const wrong = FEEL_VERDICTS.filter(([e, ok]) => (feelProblem(e) === undefined) !== ok).map(([e, ok]) => `${ok ? 'flagged' : 'missed'}: ${JSON.stringify(e)} ${feelProblem(e) ?? ''}`);
    expect(wrong).toEqual([]);
    expect(FEEL_VERDICTS.filter(([, ok]) => !ok).length).toBeGreaterThan(250);
  });

  it('names what the slip means in FEEL', () => {
    expect(feelProblem(' x & y')).toBe('& (FEEL: and)');
    expect(feelProblem(' x | y')).toBe('| (FEEL: or)');
    expect(feelProblem(' x <> 1')).toBe('<> (FEEL: != for "not equal")');
    expect(feelProblem(' x >> 1')).toBe('>> (FEEL has no shift operators)');
    expect(feelProblem(' x % 2 = 0')).toBe('% (FEEL has no modulo operator: modulo(a, b))');
    expect(feelProblem(' if x then true')).toBe('if ... then without else: FEEL needs if c then a else b');
    expect(feelProblem(' for x in xs')).toBe('for ... in ... needs return: for x in xs return x');
    expect(feelProblem(' x AND y')).toBe('AND (FEEL keywords are lower case: and)');
    expect(feelProblem(' x := 1')).toBe(':= (FEEL has no assignment; = compares)');
    expect(feelProblem(' a ? b : c')).toBe('?: (FEEL: if ... then ... else ...)');
    expect(feelProblem(' a && b')).toBe('&& (FEEL: and)');
    expect(feelProblem(' (a')).toBe('an unclosed (');
    expect(feelProblem(' a +')).toBe('an incomplete expression: it ends after +');
  });
});

/* ------------------------------------------------------------------ */
/* models with the engine's verdict                                     */
/* ------------------------------------------------------------------ */

interface Model {
  name: string;
  xml: string;
  /** the deploy-severity codes of the profile, sorted */
  codes: string[];
  engine: 'accept' | 'reject';
}

const BAD = '= (a';
const MODELS: Model[] = [
  // FEEL the engine refuses, in conditions (the verifier's list) and elsewhere
  ...['= x & y', '= x | y', '= x <> 1', '= x >> 1', '= x % 2 = 0', '= if x then true', '= x AND y', '= x := 1'].map((c): Model => ({ name: `condition ${c}`, xml: xml(gateway([c])), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' })),
  { name: 'conditions FEEL accepts: glued keywords, ranges, unary tests, a context', xml: xml(gateway(['= x andy', '= x in [1..5]', '= x in (> 1, < 5)', '= {a: 1}.a = 1', '= string length(x) > 2'])), codes: [], engine: 'accept' },
  { name: 'zeebe:script = if a then 1', xml: xml(chain(`<bpmn:scriptTask id="X">${ext('<zeebe:script expression="= if a then 1" resultVariable="r" />')}</bpmn:scriptTask>`)), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'ad-hoc completion condition in JUEL', xml: xml(ADHOC('<bpmn:completionCondition xsi:type="bpmn:tFormalExpression">${done}</bpmn:completionCondition>')), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'ad-hoc completion condition static true', xml: xml(ADHOC('<bpmn:completionCondition xsi:type="bpmn:tFormalExpression">true</bpmn:completionCondition>')), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'ad-hoc completion condition broken FEEL', xml: xml(ADHOC(`<bpmn:completionCondition xsi:type="bpmn:tFormalExpression">${BAD}</bpmn:completionCondition>`)), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'ad-hoc completion condition FEEL', xml: xml(ADHOC('<bpmn:completionCondition xsi:type="bpmn:tFormalExpression">= a and b</bpmn:completionCondition>')), codes: [], engine: 'accept' },
  { name: 'zeebe:adHoc activeElementsCollection broken FEEL', xml: xml(ADHOC('', `<zeebe:adHoc activeElementsCollection="${BAD}" />`)), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'zeebe:adHoc outputElement broken FEEL', xml: xml(ADHOC('', `<zeebe:adHoc outputCollection="res" outputElement="${BAD}" />`)), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'signal name broken FEEL (throw)', xml: xml(chain('<bpmn:intermediateThrowEvent id="X"><bpmn:signalEventDefinition id="SD" signalRef="Sig" /></bpmn:intermediateThrowEvent>'), { roots: SIGNAL(BAD) }), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'signal name broken FEEL (catch)', xml: xml(chain('<bpmn:intermediateCatchEvent id="X"><bpmn:signalEventDefinition id="SD" signalRef="Sig" /></bpmn:intermediateCatchEvent>'), { roots: SIGNAL(BAD) }), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'published message name broken FEEL', xml: xml(chain(`<bpmn:sendTask id="X" messageRef="M1">${ext(TD())}</bpmn:sendTask>`), { roots: MSG('M1', BAD, null) }), codes: ['W_C8_DEPLOY_EXPRESSION'], engine: 'reject' },
  { name: 'attributes Camunda 8 does not parse at deploy (listener type, header value, error code)', xml: xml(chain(ST(ext(`${TD()}<zeebe:taskHeaders><zeebe:header key="k" value="${BAD}" /></zeebe:taskHeaders><zeebe:executionListeners><zeebe:executionListener eventType="end" type="${BAD}" /></zeebe:executionListeners>`)))), codes: [], engine: 'accept' },
  // timers
  ...['PT1.5H', 'PT1.5M', 'P1DT1.5H'].map((v): Model => ({ name: `duration ${v}`, xml: xml(chain(`<bpmn:intermediateCatchEvent id="X">${TIMER('timeDuration', v)}</bpmn:intermediateCatchEvent>`)), codes: ['W_C8_DEPLOY_TIMER'], engine: 'reject' })),
  { name: 'cycle R/PT1.5H', xml: xml(toEnd('', TIMER('timeCycle', 'R/PT1.5H'))), codes: ['W_C8_DEPLOY_TIMER'], engine: 'reject' },
  ...['PT0.5S', 'PT1,5S', 'PT90M'].map((v): Model => ({ name: `duration ${v}`, xml: xml(chain(`<bpmn:intermediateCatchEvent id="X">${TIMER('timeDuration', v)}</bpmn:intermediateCatchEvent>`)), codes: [], engine: 'accept' })),
  ...['2030-12-31t10:00:00z', '2030-12-31T10:00:00z'].map((v): Model => ({ name: `date ${v}`, xml: xml(chain(`<bpmn:intermediateCatchEvent id="X">${TIMER('timeDate', v)}</bpmn:intermediateCatchEvent>`)), codes: [], engine: 'accept' })),
  // ids and IDREFs
  { name: 'a task id with a colon', xml: xml(chain(ST()).replace(/"X"/g, '"a:b"')), codes: ['W_C8_DEPLOY_SCHEMA'], engine: 'reject' },
  { name: 'a flow id bpmn-moddle cannot read (F:1)', xml: xml(ordered(ext(TD()) + '<bpmn:incoming>F:1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>').replace('<bpmn:outgoing>F1</bpmn:outgoing>', '<bpmn:outgoing>F:1</bpmn:outgoing>').replace('id="F1"', 'id="F:1"')), codes: ['W_C8_DEPLOY_SCHEMA'], engine: 'reject' },
  { name: 'a lane flowNodeRef to a missing id', xml: xml(`    <bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>Nope</bpmn:flowNodeRef><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>X</bpmn:flowNodeRef><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>\n${chain(ST())}`), codes: ['W_C8_DEPLOY_SCHEMA'], engine: 'reject' },
  { name: 'a lane flowNodeRef with white space around the id', xml: xml(`    <bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef> Start </bpmn:flowNodeRef><bpmn:flowNodeRef>X</bpmn:flowNodeRef><bpmn:flowNodeRef>End</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>\n${chain(ST())}`), codes: [], engine: 'accept' },
  { name: 'a task default to a missing flow', xml: xml(chain(ST()).replace('<bpmn:serviceTask id="X">', '<bpmn:serviceTask id="X" default="Nope">')), codes: ['W_C8_DEPLOY_SCHEMA'], engine: 'reject' },
  // the child order of the BPMN schema
  { name: 'order: documentation, extensions, incoming, outgoing', xml: xml(ordered(`<bpmn:documentation>d</bpmn:documentation>${ext(TD())}<bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>`)), codes: [], engine: 'accept' },
  { name: 'order: extensionElements after incoming', xml: xml(ordered(`<bpmn:incoming>F1</bpmn:incoming>${ext(TD())}<bpmn:outgoing>F2</bpmn:outgoing>`)), codes: ['W_C8_DEPLOY_SCHEMA'], engine: 'reject' },
  { name: 'order: documentation after extensionElements', xml: xml(ordered(`${ext(TD())}<bpmn:documentation>d</bpmn:documentation>`)), codes: ['W_C8_DEPLOY_SCHEMA'], engine: 'reject' },
  { name: 'order: a laneSet after the flow elements', xml: xml(`${chain(ST())}\n    <bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>X</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>`), codes: ['W_C8_DEPLOY_SCHEMA'], engine: 'reject' },
  { name: 'order: an annotation after the flow elements, a message after the process', xml: xml(`${chain(ST())}\n    <bpmn:textAnnotation id="TA"><bpmn:text>t</bpmn:text></bpmn:textAnnotation>`, { after: '  <bpmn:message id="M9" name="m9" />\n' }), codes: [], engine: 'accept' },
  { name: 'order: a message after the diagram', xml: xml(chain(ST()), { after: '  <bpmndi:BPMNDiagram id="D1"><bpmndi:BPMNPlane id="PL" bpmnElement="P_Test" /></bpmndi:BPMNDiagram>\n  <bpmn:message id="M9" name="m9" />\n' }), codes: ['W_C8_DEPLOY_SCHEMA'], engine: 'reject' },
  // white space and empty values
  ...[
    ['job type', ST(ext(TD(W)))],
    ['message name', '<bpmn:receiveTask id="X" messageRef="M1" />'],
    ['signal name', '<bpmn:intermediateThrowEvent id="X"><bpmn:signalEventDefinition id="SD" signalRef="Sig" /></bpmn:intermediateThrowEvent>'],
    ['called process id', `<bpmn:callActivity id="X">${ext(`<zeebe:calledElement processId="${W}" />`)}</bpmn:callActivity>`],
    ['decision id and result variable', `<bpmn:businessRuleTask id="X">${ext(`<zeebe:calledDecision decisionId="${W}" resultVariable="${W}" />`)}</bpmn:businessRuleTask>`],
    ['script result variable', `<bpmn:scriptTask id="X">${ext(`<zeebe:script expression="=1" resultVariable="${W}" />`)}</bpmn:scriptTask>`],
    ['listener type', ST(ext(`${TD()}<zeebe:executionListeners><zeebe:executionListener eventType="end" type="${W}" /></zeebe:executionListeners>`))],
    ['linked resource type', ST(ext(`${TD()}<zeebe:linkedResources><zeebe:linkedResource resourceId="r" resourceType="${W}" linkName="l" /></zeebe:linkedResources>`))],
    ['published correlation key', `<bpmn:sendTask id="X" messageRef="M2">${ext(`<zeebe:publishMessage correlationKey="${W}" />`)}</bpmn:sendTask>`],
  ].map(([what, task]): Model => ({ name: `white-space ${what}`, xml: xml(chain(task!), { roots: MSG('M1', W) + MSG('M2', 'm2', null) + SIGNAL(W) }), codes: [], engine: 'accept' })),
  { name: 'white-space error code thrown', xml: xml(toEnd('<bpmn:errorEventDefinition id="ED" errorRef="Err" />'), { roots: `  <bpmn:error id="Err" name="e" errorCode="${W}" />\n` }), codes: [], engine: 'accept' },
  { name: 'white-space escalation code thrown', xml: xml(toEnd('<bpmn:escalationEventDefinition id="ED" escalationRef="Esc" />'), { roots: `  <bpmn:escalation id="Esc" name="e" escalationCode="${W}" />\n` }), codes: [], engine: 'accept' },
  { name: 'white-space subscription correlation key', xml: xml(chain('<bpmn:receiveTask id="X" messageRef="M1" />'), { roots: MSG('M1', 'm1', W) }), codes: ['W_C8_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'white-space input target', xml: xml(chain(ST(ext(`${TD()}<zeebe:ioMapping><zeebe:input source="=a" target="${W}" /></zeebe:ioMapping>`)))), codes: ['W_C8_DEPLOY_EXTENSION'], engine: 'reject' },
  { name: 'empty job type', xml: xml(chain(ST(ext(TD(''))))), codes: ['W_C8_DEPLOY_IMPLEMENTATION'], engine: 'reject' },
  { name: 'empty priority', xml: xml(chain(UT('<zeebe:priorityDefinition priority="" />'))), codes: [], engine: 'accept' },
  { name: 'white-space priority', xml: xml(chain(UT(`<zeebe:priorityDefinition priority="${W}" />`))), codes: ['W_C8_DEPLOY_USER_TASK'], engine: 'reject' },
  { name: 'empty link names', xml: xml(LINKS('')), codes: ['W_C8_DEPLOY_LINK', 'W_C8_DEPLOY_LINK'], engine: 'reject' },
  { name: 'white-space link names', xml: xml(LINKS(W)), codes: [], engine: 'accept' },
];

describe('deploy rules: the profile flags exactly what Camunda 8.9.22 refuses', () => {
  it.each(MODELS.map((m) => [m.name, m] as const))('%s', async (_name, m) => {
    expect(await deployCodes(m.xml)).toEqual(m.codes);
    expect(m.codes.length > 0).toBe(m.engine === 'reject');
  });

  it('timer values', () => {
    for (const v of ['PT1.5H', 'PT1.5M', 'P1DT1.5H', 'PT1,5H']) expect(validDuration(v), v).toBe(false);
    for (const v of ['PT1.5S', 'PT1,5S', 'PT0.5S', 'P1DT1H30M']) expect(validDuration(v), v).toBe(true);
    for (const v of ['2030-12-31t10:00:00z', '2030-12-31t10:00:00Z', '2030-12-31T10:00:00z']) expect(validDateTime(v), v).toBe(true);
    expect(validCycle('R/PT1.5H')).toBe(false);
    expect(validCycle('R/2030-12-31t10:00:00z/PT1H')).toBe(true);
  });

  it('the messages and fixes name the problem', async () => {
    const find = async (text: string): Promise<{ message: string; hint?: string }> => runProfile(await Doc.fromXml(text)).findings.find((f) => f.severity === 'deploy')!;
    const adhoc = await find(xml(ADHOC('<bpmn:completionCondition xsi:type="bpmn:tFormalExpression">${done}</bpmn:completionCondition>')));
    expect(adhoc.message).toBe('The completion condition "${done}" of ad-hoc sub-process X is no FEEL expression; Camunda 8 needs one starting with = and refuses the file');
    expect(adhoc.hint).toBe("`bpmn set <file> X 'completion== done'` (check the FEEL syntax), or remove it: `bpmn set <file> X completion=`.");
    const order = await find(xml(ordered(`<bpmn:incoming>F1</bpmn:incoming>${ext(TD())}<bpmn:outgoing>F2</bpmn:outgoing>`)));
    expect(order.message).toBe('In serviceTask X, <bpmn:extensionElements> comes after <bpmn:incoming>; the BPMN schema puts extensionElements before incoming, and Camunda 8 validates the file against the schema and refuses it');
    const colon = await find(xml(chain(ST()).replace(/"X"/g, '"a:b"')));
    expect(colon.hint).toBe('`bpmn set <file> a:b id=a_b`.');
    const lane = await find(xml(`    <bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>Nope</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>\n${chain(ST())}`));
    expect(lane.message).toBe('Lane L1 has <bpmn:flowNodeRef>Nope</bpmn:flowNodeRef>, but the file has no element with the id Nope; Camunda 8 checks such references against the ids of the file (cvc-id.1) and refuses it');
    const link = await find(xml(LINKS('')));
    expect(link.message).toBe('The link event definition of intermediateThrowEvent:link X has an empty name; Camunda 8 refuses the file');
  });

  it('an edit that removes the element with the issue resolves it', async () => {
    const doc = await Doc.fromXml(xml(`    <bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>Nope</bpmn:flowNodeRef><bpmn:flowNodeRef>X</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>\n${chain(ST())}`));
    const r = await mutateDoc(doc, [{ op: 'remove', ids: ['LS'] }], { force: true });
    expect(r.delta!.resolved.map((w) => w.code)).toContain('W_C8_DEPLOY_SCHEMA');
    expect(runProfile(await Doc.fromXml(r.xml)).findings.filter((f) => f.code === 'W_C8_DEPLOY_SCHEMA')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* refAs and the message of a catching element                          */
/* ------------------------------------------------------------------ */

describe('the message a catching element waits for', () => {
  const blank = (): Doc => Doc.create({ target: 'camunda8', processName: 'Reply' });

  it('refAs names the message an op creates; the subscription goes on it (no misplaced extension, no deploy finding)', async () => {
    const r = await mutateDoc(blank(), [
      { op: 'add', kind: 'startEvent', name: 'Asked', in: 'Process_Reply', as: '$s' },
      { op: 'add', kind: 'intermediateCatchEvent:message', name: 'Antwort erhalten', after: '$s', message: 'Antwort', as: '$m', refAs: '$msg' },
      { op: 'ext', id: '$msg', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '= id' } },
      { op: 'add', kind: 'endEvent', name: 'Done', after: '$m' },
    ]);
    expect(r.aliases).toEqual({ $s: 'Event_Asked', $m: 'Event_AntwortErhalten', $msg: 'Message_Antwort' });
    expect(r.xml).toMatch(/<bpmn:message id="Message_Antwort" name="Antwort">\s*<bpmn:extensionElements>\s*<zeebe:subscription correlationKey="= id" \/>/);
    expect(runProfile(await Doc.fromXml(r.xml)).findings).toEqual([]);
  });

  it('refAs on set, retype and connect (a message flow); E_USAGE when the element references none', async () => {
    const doc = blank();
    runOps(doc, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Reply' },
      { op: 'add', kind: 'receiveTask', name: 'Wait', after: 'Event_Go' },
      { op: 'add', kind: 'intermediateThrowEvent', name: 'Raise', after: 'Activity_Wait' },
      { op: 'add', kind: 'endEvent', name: 'Done', after: 'Event_Raise' },
    ]);
    const r = await mutateDoc(doc, [
      { op: 'set', id: 'Activity_Wait', values: { message: 'Paid' }, refAs: '$paid' },
      { op: 'retype', id: 'Event_Raise', kind: 'intermediateThrowEvent:signal', signal: 'Raised', refAs: '$sig' },
      { op: 'ext', id: '$paid', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '=orderId' } },
    ]);
    expect(r.aliases).toEqual({ $paid: 'Message_Paid', $sig: 'Signal_Raised' });
    const e = caught(() => runOps(blank(), [{ op: 'add', kind: 'userTask', name: 'Review', in: 'Process_Reply', refAs: '$x' }]));
    expect(e.code).toBe('E_USAGE');
    expect(e.message).toBe('refAs $x: userTask Activity_Review references no message, error, signal or escalation');
  });

  it('ext add <element> zeebe:subscription and set <element> zeebe:correlationKey= go to its message, with a note', async () => {
    const doc = await Doc.fromXml(xml(chain('<bpmn:receiveTask id="X" messageRef="M1" />') + '\n    <bpmn:intermediateCatchEvent id="C"><bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:intermediateCatchEvent>', { roots: MSG('M1', 'Paid', null) }));
    const added = runOps(doc, [{ op: 'ext', id: 'X', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '=orderId' } }]);
    expect(added.notes).toEqual(['zeebe:subscription goes to message M1, which X waits for: Camunda 8 reads the correlation key in the message\'s zeebe:subscription (C waits for it too and shares it)']);
    const set = runOps(doc, [{ op: 'set', id: 'C', values: { 'zeebe:correlationKey': '=invoiceId' } }]);
    expect(set.notes).toEqual(['zeebe:correlationKey goes to message M1, which C waits for: Camunda 8 reads the correlation key in the message\'s zeebe:subscription (X waits for it too and shares it)']);
    const findings = runProfile(doc).findings.map((f) => f.code);
    expect(findings).not.toContain('W_C8_MISPLACED_EXTENSION');
    expect(findings).not.toContain('W_C8_DEPLOY_MESSAGE');
    expect(doc.get('M1')!.get<{ get(k: string): Array<Record<string, unknown>> }>('extensionElements').get('values').map((v) => v['correlationKey'])).toEqual(['=invoiceId']);
  });

  it('an element that waits for no message: E_WRONG_HOST with the commands', async () => {
    const doc = await Doc.fromXml(xml(chain('<bpmn:receiveTask id="X" />')));
    const e = caught(() => runOps(doc, [{ op: 'ext', id: 'X', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '=k' } }]));
    expect(e.code).toBe('E_WRONG_HOST');
    expect(e.hint).toBe('Give it one first: `bpmn set <file> X message=<MessageName>` (in an apply batch with "refAs": "$msg" to name the message), then `bpmn ext add <file> X zeebe:subscription correlationKey==<expression>`.');
  });
});

/* ------------------------------------------------------------------ */
/* help and guide                                                       */
/* ------------------------------------------------------------------ */

describe('kinds sections', () => {
  it('`bpmn kinds --help` lists every section, and every section the guide names exists', () => {
    const help = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), 'kinds', '--help'], { encoding: 'utf8', cwd: ROOT }).stdout.replace(/\s+/g, ' ');
    expect(help).toContain(KINDS_SECTION_NAMES);
    expect(KINDS_SECTION_NAMES).toContain('zeebeElements');
    const named = [...guideText().matchAll(/kinds --section ([A-Za-z,]+)/g)].flatMap((m) => m[1]!.split(','));
    expect(named).toContain('zeebeElements');
    for (const s of named) expect(() => kindsSections(s), s).not.toThrow();
  }, 60000);
});

/* ------------------------------------------------------------------ */
/* the live engine                                                      */
/* ------------------------------------------------------------------ */

const ENGINE = (process.env['BPMN_C8_ENGINE'] ?? '').trim().replace(/\/$/, '');

async function deploy(name: string, text: string): Promise<string | undefined> {
  const form = new FormData();
  form.append('resources', new Blob([text], { type: 'application/octet-stream' }), `${name}.bpmn`);
  const res = await fetch(`${ENGINE}/deployments`, { method: 'POST', body: form, headers: { accept: 'application/json' } });
  const json = (await res.json()) as { detail?: string; deployments?: Array<{ processDefinition?: { processDefinitionKey?: string } }> };
  if (!res.ok) return json.detail ?? String(res.status);
  for (const d of json.deployments ?? []) {
    const key = d.processDefinition?.processDefinitionKey;
    if (key) await fetch(`${ENGINE}/resources/${key}/deletion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  }
  return undefined;
}

describe.skipIf(!ENGINE)('live engine: the verdicts hold', () => {
  it('the accepted FEEL expressions deploy (in files of 100 conditions), each refused one is refused', async () => {
    const accepted = FEEL_VERDICTS.filter(([, ok]) => ok).map(([e]) => `= ${e}`);
    for (let i = 0; i < accepted.length; i += 100) {
      const error = await deploy(`P_bpmn_cli_feel_ok_${i}`, xml(gateway(accepted.slice(i, i + 100))).replace('id="P_Test"', `id="P_bpmn_cli_feel_ok_${i}"`));
      expect(error, error).toBeUndefined();
    }
    const wrong: string[] = [];
    for (const [e] of FEEL_VERDICTS.filter(([, ok]) => !ok)) {
      if ((await deploy('P_bpmn_cli_feel_bad', xml(gateway([`= ${e}`])).replace('id="P_Test"', 'id="P_bpmn_cli_feel_bad"'))) === undefined) wrong.push(e);
    }
    expect(wrong).toEqual([]);
  }, 600000);

  it.each(MODELS.map((m, i) => [m.name, m, i] as const))('%s', async (_name, m, i) => {
    const pid = `P_bpmn_cli_c8_fix_${i}`;
    const error = await deploy(pid, m.xml.replace(/"P_Test"/g, `"${pid}"`));
    expect(error === undefined, error).toBe(m.engine === 'accept');
  });

  it('the batch with refAs deploys', async () => {
    const r = await mutateDoc(Doc.create({ target: 'camunda8', processName: 'Reply' }), [
      { op: 'add', kind: 'startEvent', name: 'Asked', in: 'Process_Reply', as: '$s' },
      { op: 'add', kind: 'intermediateCatchEvent:message', name: 'Antwort erhalten', after: '$s', message: 'Antwort', as: '$m', refAs: '$msg' },
      { op: 'ext', id: '$msg', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '= id' } },
      { op: 'add', kind: 'receiveTask', name: 'Wait for confirmation', after: '$m', message: 'Confirmation', as: '$r' },
      { op: 'ext', id: '$r', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '= id' } },
      { op: 'add', kind: 'endEvent', name: 'Done', after: '$r' },
    ]);
    const error = await deploy('P_bpmn_cli_refas', r.xml.replace(/Process_Reply/g, 'P_bpmn_cli_refas'));
    expect(error, error).toBeUndefined();
  });
});
