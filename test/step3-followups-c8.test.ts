/**
 * Step 3 follow-ups, validation: values Camunda 8.9 refuses that the
 * profile let pass, and a duplicate id.
 *
 *  - A timer date that is no real instant (2030-02-30, 25:00, an offset over
 *    18 hours), a cron field out of its range (hour 25, month 13, a step of
 *    0, a reversed range, `?` outside the day fields) and an attribute the
 *    BPMN schema types xsd:boolean with another value (cancelActivity=
 *    "maybe", isExpanded="TRUE") are W_C8_DEPLOY_TIMER / W_C8_DEPLOY_SCHEMA;
 *    the Quartz day forms (L, W, #), names, 0 / 7 for Sunday, a leap day,
 *    white space around a boolean and 1 / 0 pass.
 *  - A duplicate element id (bpmn-moddle keeps the first element and drops
 *    the later one with an import warning) is E_DUPLICATE_ID in validate.
 *
 * With BPMN_C8_ENGINE=<REST v2 root> each model is deployed (the accepted
 * ones in one file each and deleted again).
 */
import { describe, expect, it } from 'vitest';
import { validateXml } from '../src/api.js';
import { Doc } from '../src/document.js';
import { cronProblem, dateTimeRangeProblem, validCycle, validDateTime } from '../src/platform/c8.js';
import { runProfile } from '../src/platform/profile.js';

const C8 = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.9.0"';
const DI = 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"';

function xml(body: string, after = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${DI} ${C8} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P_Test" isExecutable="true">
${body}
  </bpmn:process>
${after}</bpmn:definitions>`;
}
const TIMER = (kind: string, v: string, id = 'TD1'): string => `<bpmn:timerEventDefinition id="${id}"><bpmn:${kind} xsi:type="bpmn:tFormalExpression">${v}</bpmn:${kind}></bpmn:timerEventDefinition>`;
/** start -> timer catch X (a date) -> end */
const dateCatch = (v: string): string => `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:intermediateCatchEvent id="X">${TIMER('timeDate', v)}</bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />`;
/** one timer start event per cycle, each to its own end */
const cycleStarts = (cycles: string[]): string =>
  cycles
    .map(
      (c, i) => `    <bpmn:startEvent id="S${i}">${TIMER('timeCycle', c, `TD${i}`)}</bpmn:startEvent>
    <bpmn:sequenceFlow id="F${i}" sourceRef="S${i}" targetRef="E${i}" />
    <bpmn:endEvent id="E${i}" />`,
    )
    .join('\n');
/** start -> service task X with a boundary timer B (cancelActivity as given) -> ends */
const boundary = (cancel: string): string => `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:serviceTask id="X"><bpmn:extensionElements><zeebe:taskDefinition type="work" /></bpmn:extensionElements></bpmn:serviceTask>
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:boundaryEvent id="B" attachedToRef="X" cancelActivity="${cancel}">${TIMER('timeDuration', 'PT1H')}</bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="End2" />
    <bpmn:endEvent id="End2" />`;
/** start -> collapsed sub-process X -> end, its shape with isExpanded as given */
const expanded = (v: string): string =>
  xml(
    `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:subProcess id="X"><bpmn:startEvent id="IS" /><bpmn:sequenceFlow id="IF" sourceRef="IS" targetRef="IE" /><bpmn:endEvent id="IE" /></bpmn:subProcess>
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />`,
    `  <bpmndi:BPMNDiagram id="D1"><bpmndi:BPMNPlane id="PL1" bpmnElement="P_Test"><bpmndi:BPMNShape id="X_di" bpmnElement="X" isExpanded="${v}"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>\n`,
  );
/** an event sub-process with a message start, isInterrupting as given */
const eventSub = (v: string): string => `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:subProcess id="ES" triggeredByEvent="true">
      <bpmn:startEvent id="ESS" isInterrupting="${v}">${TIMER('timeDuration', 'PT1H')}</bpmn:startEvent>
      <bpmn:sequenceFlow id="EF" sourceRef="ESS" targetRef="ESE" />
      <bpmn:endEvent id="ESE" />
    </bpmn:subProcess>`;
/** a Camunda user task X with a static due date */
const dueDate = (v: string): string => `    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    <bpmn:userTask id="X"><bpmn:extensionElements><zeebe:userTask /><zeebe:taskSchedule dueDate="${v}" /></bpmn:extensionElements></bpmn:userTask>
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />`;

interface Model {
  name: string;
  xml: string;
  engine: 'accept' | 'reject';
  codes: string[];
}

const MODELS: Model[] = [
  // timer dates
  { name: 'timeDate 2030-02-30', xml: xml(dateCatch('2030-02-30T10:00:00Z')), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'timeDate 2031-02-29 (no leap year)', xml: xml(dateCatch('2031-02-29T10:00:00Z')), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'timeDate 2030-04-31', xml: xml(dateCatch('2030-04-31T10:00:00+02:00')), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'timeDate hour 25', xml: xml(dateCatch('2030-12-31T25:00:00Z')), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'timeDate minute 60', xml: xml(dateCatch('2030-12-31T10:60:00Z')), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'timeDate month 13', xml: xml(dateCatch('2030-13-01T10:00:00Z')), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'timeDate offset +19:00', xml: xml(dateCatch('2030-12-31T10:00:00+19:00')), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'timeDate 2032-02-29 (leap year), 23:59:59+18:00', xml: xml(dateCatch('2032-02-29T23:59:59+18:00')), engine: 'accept', codes: [] },
  { name: 'cycle R/2030-02-30T10:00:00Z/P1D', xml: xml(cycleStarts(['R/2030-02-30T10:00:00Z/P1D'])), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  // cron
  { name: 'cron hour 25', xml: xml(cycleStarts(['0 0 25 * * ?'])), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'cron second 60', xml: xml(cycleStarts(['60 0 9 * * *'])), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'cron month 13', xml: xml(cycleStarts(['0 0 9 1 13 *'])), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'cron day-of-month 0', xml: xml(cycleStarts(['0 0 9 0 * *'])), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'cron day-of-week 8', xml: xml(cycleStarts(['0 0 9 * * 8'])), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'cron step 0', xml: xml(cycleStarts(['0 */0 * * * *'])), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'cron reversed range', xml: xml(cycleStarts(['0 0 17-9 * * *'])), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'cron ? in the minute field', xml: xml(cycleStarts(['0 ? 9 * * *'])), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  { name: 'cron unknown name', xml: xml(cycleStarts(['0 0 9 * * MOX'])), engine: 'reject', codes: ['W_C8_DEPLOY_TIMER'] },
  {
    name: 'cron forms that deploy',
    xml: xml(cycleStarts(['0 0 9 * * 7', '0 0 9 * * 0', '0 0 9 ? * MON-FRI', '0 0/15 8-17 * JAN-DEC *', '0 0 9 L * ?', '0 0 9 ? * 5#2', '0 0 9 1,15 * *', '0 5/10 * * * *', '0 0 9 29 2 ?', '0 0 9 * * mon', '*/30 * * * * *', '0 0 9 LW * ?', '0 0 9 ? * 5L'])),
    engine: 'accept',
    codes: [],
  },
  // xsd:boolean
  { name: 'cancelActivity="maybe"', xml: xml(boundary('maybe')), engine: 'reject', codes: ['W_C8_DEPLOY_SCHEMA'] },
  { name: 'cancelActivity="TRUE"', xml: xml(boundary('TRUE')), engine: 'reject', codes: ['W_C8_DEPLOY_SCHEMA'] },
  { name: 'cancelActivity=" true "', xml: xml(boundary(' true ')), engine: 'accept', codes: [] },
  { name: 'cancelActivity="1"', xml: xml(boundary('1')), engine: 'accept', codes: [] },
  { name: 'isInterrupting="yes"', xml: xml(eventSub('yes')), engine: 'reject', codes: ['W_C8_DEPLOY_SCHEMA'] },
  { name: 'isExpanded="maybe" on a shape', xml: expanded('maybe'), engine: 'reject', codes: ['W_C8_DEPLOY_SCHEMA'] },
  { name: 'isExpanded="0" on a shape', xml: expanded('0'), engine: 'accept', codes: [] },
  // a due date that is no real instant
  { name: 'dueDate 2030-02-30', xml: xml(dueDate('2030-02-30T10:00:00Z')), engine: 'reject', codes: ['W_C8_DEPLOY_USER_TASK'] },
];

/** The deploy-severity codes of the Camunda 8 profile, sorted and distinct. */
async function deployCodes(text: string): Promise<string[]> {
  return [
    ...new Set(
      runProfile(await Doc.fromXml(text))
        .findings.filter((f) => f.severity === 'deploy')
        .map((f) => f.code),
    ),
  ].sort();
}

describe('timer values and xsd:booleans Camunda 8 refuses', () => {
  it.each(MODELS.map((m) => [m.name, m] as const))('%s', async (_name, m) => {
    expect(await deployCodes(m.xml)).toEqual(m.codes);
  });

  it('says what is out of range', () => {
    expect(dateTimeRangeProblem('2030-02-30T10:00:00Z')).toBe('February 2030 has no day 30');
    expect(dateTimeRangeProblem('2030-12-31T25:00:00Z')).toBe('hour 25 is not in 00-23');
    expect(dateTimeRangeProblem('2032-02-29T10:00:00Z')).toBeUndefined();
    expect(cronProblem('0 0 25 * * ?')).toBe('the hour field "25" is not in 0-23');
    expect(cronProblem('0 0 9 * 13 *')).toBe('the month field "13" is not in 1-12 or JAN-DEC');
    expect(validDateTime('2030-12-31T10:00:00+18:00')).toBe(true);
    expect(validCycle('0 0 9 ? * MON-FRI')).toBe(true);
    expect(validCycle('0 0 25 * * ?')).toBe(false);
  });

  it('validate names the value and the reason', async () => {
    const r = await validateXml(xml(boundary('maybe')));
    const f = r.warnings.find((w) => w.code === 'W_C8_DEPLOY_SCHEMA')!;
    expect(f.element).toBe('B');
    expect(f.message).toContain('cancelActivity="maybe"');
    const t = await validateXml(xml(dateCatch('2030-02-30T10:00:00Z')));
    expect(t.warnings.find((w) => w.code === 'W_C8_DEPLOY_TIMER')!.message).toContain('February 2030 has no day 30');
  });
});

describe('a duplicate id is an error in validate', () => {
  const DUP = xml(`    <bpmn:startEvent id="S" />
    <bpmn:serviceTask id="X"><bpmn:extensionElements><zeebe:taskDefinition type="work" /></bpmn:extensionElements></bpmn:serviceTask>
    <bpmn:endEvent id="X" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="X" />`);

  it('E_DUPLICATE_ID with the element bpmn-moddle could not read', async () => {
    const r = await validateXml(DUP);
    const e = r.errors.find((x) => x.code === 'E_DUPLICATE_ID')!;
    expect(e).toBeDefined();
    expect(e.element).toBe('X');
    expect(e.message).toContain('<bpmn:endEvent> at line 5');
  });

  it('also without a platform (a plain file)', async () => {
    const plain = DUP.replace(/modeler:executionPlatform="[^"]*"/, '').replace(/<zeebe:taskDefinition type="work" \/>/, '');
    const r = await validateXml(plain);
    expect(r.errors.map((x) => x.code)).toContain('E_DUPLICATE_ID');
    expect(r.ok).toBe(false);
  });
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
  it.each(MODELS.map((m, i) => [m.name, m, i] as const))('%s', async (_name, m, i) => {
    const pid = `P_bpmn_cli_c8_followup_${i}`;
    const error = await deploy(pid, m.xml.replace(/"P_Test"/g, `"${pid}"`));
    expect(error === undefined, error).toBe(m.engine === 'accept');
  });

  it('a duplicate id is refused', async () => {
    const error = await deploy(
      'P_bpmn_cli_c8_dup',
      xml(`    <bpmn:startEvent id="S" />
    <bpmn:serviceTask id="X"><bpmn:extensionElements><zeebe:taskDefinition type="work" /></bpmn:extensionElements></bpmn:serviceTask>
    <bpmn:endEvent id="X" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="X" />`).replace(/"P_Test"/g, '"P_bpmn_cli_c8_dup"'),
    );
    expect(error).toMatch(/cvc-id\.2|multiple occurrences/);
  });
});
