/**
 * Camunda 8 in the operations (step 3): zeebe settings in `set` (refused on
 * the element itself with the `ext add` that writes them), `ext add` (the
 * multi-instance loop a zeebe:loopCharacteristics needs, placement by the
 * Zeebe descriptor, single elements), `retype` (zeebe content the new kind
 * cannot use, zeebe:userTask for a new user task), the view (what a node
 * does), one report per problem on writes, the ops example, and the hints of
 * the Camunda 8 profile run through the real CLI until a refused model has
 * no deploy finding left (the results were deployed to Camunda 8.9 when the
 * profile was written; with BPMN_C8_ENGINE they are deployed again).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opsExample } from '../../../src/domain/commands/utils/op-fields.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import { renderView, runOps, mutateDoc, loadProfiles, runProfile, buildView, elementDetail } from '../../../src/index.js';

// the engine rules load on demand; runProfile / validateDoc(doc, { platform }) need them loaded (the pipeline loads them itself)
await loadProfiles();

const ROOT = join(import.meta.dirname, '..', '..', '..');
const C8 = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud"';

function xml(body: string, options: { ns?: string; roots?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${options.ns ?? C8} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${options.roots ?? ''}
  <bpmn:process id="P" isExecutable="true">
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${body}
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`;
}
const ext = (inner: string): string => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;

function caught(fn: () => unknown): { code?: string; message: string; hint?: string } {
  try {
    fn();
  } catch (err) {
    const thrown = err as { code?: string; message: string; details?: { hint?: string } };
    return { code: thrown.code, message: thrown.message, hint: thrown.details?.hint };
  }
  throw new Error('expected an error');
}

describe('set: zeebe settings are extension elements', () => {
  it('refuses a zeebe attribute Camunda 8 reads on an extension element, the hint is the ext add', async () => {
    const doc = await Doc.fromXml(xml(`<bpmn:userTask id="X">${ext('<zeebe:userTask />')}</bpmn:userTask>`));
    const element = caught(() => runOps(doc, [{ op: 'set', id: 'X', values: { 'zeebe:assignee': 'demo' } }]));
    expect(element.code).toBe('E_WRONG_HOST');
    expect(element.message).toBe('zeebe:assignee is not an attribute of userTask X: Camunda 8 reads assignee on the zeebe:assignmentDefinition extension element');
    expect(element.hint).toBe('Use `bpmn ext add <file> X zeebe:assignmentDefinition assignee=demo`.');
    const st = await Doc.fromXml(xml('<bpmn:serviceTask id="X" />'));
    expect(caught(() => runOps(st, [{ op: 'set', id: 'X', values: { 'zeebe:type': 'charge' } }])).hint).toBe('Use `bpmn ext add <file> X zeebe:taskDefinition type=charge`.');
    expect(caught(() => runOps(st, [{ op: 'set', id: 'X', values: { 'zeebe:inputCollection': '=items' } }])).hint).toBe("Use `bpmn ext add <file> X loop.zeebe:loopCharacteristics 'inputCollection==items'` (creates a parallel multi-instance loop when there is none).");
    expect(caught(() => runOps(st, [{ op: 'set', id: 'X', values: { 'loop.zeebe:inputCollection': '=items' } }])).hint).toBe('Use `bpmn ext add <file> X loop.zeebe:loopCharacteristics inputCollection=<value>`.');
    // zeebe:correlationKey on an element that waits for no message: give it one first (with one, set writes the message's subscription)
    const recv = await Doc.fromXml(xml('<bpmn:receiveTask id="X" />'));
    expect(caught(() => runOps(recv, [{ op: 'set', id: 'X', values: { 'zeebe:correlationKey': '=orderId' } }])).hint).toBe("Use `bpmn set <file> X message=<MessageName>` first (the correlation key belongs to the message the element waits for), then `bpmn set <file> X 'zeebe:correlationKey==orderId'`.");
    const timer = await Doc.fromXml(xml(`<bpmn:intermediateCatchEvent id="X">${'<bpmn:timerEventDefinition id="T"><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>'}</bpmn:intermediateCatchEvent>`));
    expect(caught(() => runOps(timer, [{ op: 'set', id: 'X', values: { 'zeebe:correlationKey': '=orderId' } }])).hint).toBe("Use `bpmn ext add <file> <messageId> zeebe:subscription 'correlationKey==orderId'` on a bpmn:Message (intermediateCatchEvent:timer X waits for no message).");
    // the attributes the descriptor puts on BPMN elements, unknown names and other vendors pass
    runOps(st, [{ op: 'set', id: 'X', values: { 'zeebe:modelerTemplate': 'io.example.charge', 'zeebe:typo': 'x' } }]);
    expect(st.require('X').$attrs).toMatchObject({ 'zeebe:modelerTemplate': 'io.example.charge', 'zeebe:typo': 'x' });
    expect(runProfile(st).findings.map((finding) => finding.code)).toEqual(['W_C8_UNKNOWN_ATTRIBUTE', 'W_C8_DEPLOY_IMPLEMENTATION']);
  });
});

describe('ext add: Zeebe structure', () => {
  it('loop.zeebe:loopCharacteristics creates the parallel multi-instance loop it configures (CLI type and ops JSON)', async () => {
    const doc = await Doc.fromXml(xml(`<bpmn:serviceTask id="X">${ext('<zeebe:taskDefinition type="w" />')}</bpmn:serviceTask>`));
    const outcome = await mutateDoc(doc, [{ op: 'ext', id: 'X', action: 'add', type: 'loop.zeebe:loopCharacteristics', attrs: { inputCollection: '=items', inputElement: 'item' } }], { layout: false, dryRun: true });
    expect(outcome.changes.notes.join('\n')).toMatch(/X: created a parallel multi-instance loop for loop.zeebe:loopCharacteristics/);
    expect(outcome.xml).toMatch(/<bpmn:multiInstanceLoopCharacteristics>\s*<bpmn:extensionElements>\s*<zeebe:loopCharacteristics inputCollection="=items" inputElement="item" \/>/);
    expect(outcome.validation.platform).toMatchObject({ counts: { deploy: 0, runtime: 0, practice: 0 } });
    const other = await Doc.fromXml(xml(`<bpmn:serviceTask id="X">${ext('<zeebe:taskDefinition type="w" />')}</bpmn:serviceTask>`));
    runOps(other, [{ op: 'ext', id: 'X', action: 'add', slot: 'loop', type: 'zeebe:loopCharacteristics', attrs: { inputCollection: '=items' } }]);
    expect(other.require('X').get<{ $type: string }>('loopCharacteristics').$type).toBe('bpmn:MultiInstanceLoopCharacteristics');
    // other types under loop. still need the loop first; the hint names the Camunda 8 way in a Camunda 8 file
    const none = await Doc.fromXml(xml('<bpmn:serviceTask id="X" />'));
    expect(caught(() => runOps(none, [{ op: 'ext', id: 'X', action: 'add', type: 'loop.zeebe:properties' }])).hint).toMatch(/bpmn ext add <file> X loop.zeebe:loopCharacteristics inputCollection==<items>/);
  });

  it('a zeebe element where Camunda 8 does not read it: W_MISPLACED_EXTENSION, replaced by the profile finding on a write', async () => {
    const plain = await Doc.fromXml(xml('<bpmn:userTask id="X" />', { ns: 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"' }));
    const cs = runOps(plain, [{ op: 'ext', id: 'X', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'x' } }]);
    expect(cs.warnings.map((warning) => [warning.code, warning.message])).toEqual([['W_MISPLACED_EXTENSION', 'zeebe:taskDefinition on X (bpmn:UserTask) is not read by Camunda 8: it belongs on serviceTask, businessRuleTask, scriptTask, sendTask, endEvent, ...']]);
    const doc = await Doc.fromXml(xml(`<bpmn:userTask id="X">${ext('<zeebe:userTask />')}</bpmn:userTask>`));
    const outcome = await mutateDoc(doc, [{ op: 'ext', id: 'X', action: 'add', type: 'zeebe:taskDefinition', attrs: { type: 'x' } }], { layout: false, dryRun: true });
    expect(outcome.changes.warnings).toEqual([]);
    expect(outcome.validation.warnings.filter((warning) => warning.code.startsWith('W_C8_')).map((warning) => warning.code)).toEqual(['W_C8_MISPLACED_EXTENSION']);
  });

  it('a second zeebe:adHoc / conditionalFilter / publishMessage is merged (Camunda 8.9 refuses two)', async () => {
    const doc = await Doc.fromXml(xml(`<bpmn:adHocSubProcess id="X">${ext('<zeebe:adHoc activeElementsCollection="=[]" />')}<bpmn:task id="A1" /></bpmn:adHocSubProcess>`));
    const cs = runOps(doc, [{ op: 'ext', id: 'X', action: 'add', type: 'zeebe:adHoc', attrs: { outputCollection: 'out', outputElement: '=x' } }]);
    expect(cs.changed[0]!.detail).toBe('ext merged zeebe:adHoc (outputCollection="out", outputElement="=x")');
  });
});

describe('retype in a Camunda 8 file', () => {
  it('a task retyped to a user task gets zeebe:userTask; stale zeebe content is reported item by item', async () => {
    const doc = await Doc.fromXml(xml(`<bpmn:serviceTask id="X">${ext('<zeebe:taskDefinition type="w" />')}</bpmn:serviceTask>`));
    const outcome = await mutateDoc(doc, [{ op: 'retype', id: 'X', kind: 'userTask' }], { layout: false, dryRun: true });
    expect(outcome.xml).toMatch(/<bpmn:userTask id="X">\s*<bpmn:extensionElements>\s*<zeebe:taskDefinition type="w" \/>\s*<zeebe:userTask \/>/);
    expect(outcome.changes.notes).toContain('X is a Camunda user task now (zeebe:userTask added, like Camunda Modeler)');
    expect(outcome.changes.warnings.map((warning) => warning.code)).toEqual([]);
    expect(outcome.validation.platform!.added!.map((finding) => [finding.code, finding.element])).toEqual([['W_C8_MISPLACED_EXTENSION', 'X']]);
    const back = await Doc.fromXml(xml(`<bpmn:userTask id="X">${ext('<zeebe:userTask /><zeebe:assignmentDefinition assignee="demo" />')}</bpmn:userTask>`));
    const ops = runOps(back, [{ op: 'retype', id: 'X', kind: 'serviceTask' }]);
    expect(ops.warnings.find((warning) => warning.code === 'W_PROPERTY_INAPPLICABLE')).toMatchObject({
      message: 'zeebe:userTask, zeebe:assignmentDefinition of X have no effect on a serviceTask (kept as they are)',
      hint: 'The Zeebe (Camunda 8) descriptor does not allow them on a serviceTask; remove with `bpmn ext remove <file> X zeebe:userTask` and `bpmn ext remove <file> X zeebe:assignmentDefinition`, or retype back.',
    });
  });
});

describe('show: what a Camunda 8 node does', () => {
  it('prints the job type, called process, script, form, assignment, collection and correlation key', async () => {
    const doc = await Doc.fromXml(
      xml(
        `<bpmn:serviceTask id="X">${ext('<zeebe:taskDefinition type="charge" />')}<bpmn:multiInstanceLoopCharacteristics>${ext('<zeebe:loopCharacteristics inputCollection="=items" inputElement="item" />')}</bpmn:multiInstanceLoopCharacteristics></bpmn:serviceTask>
    <bpmn:userTask id="U">${ext('<zeebe:userTask /><zeebe:formDefinition formId="review" /><zeebe:assignmentDefinition assignee="=reviewer" candidateGroups="sales" />')}</bpmn:userTask>
    <bpmn:callActivity id="C">${ext('<zeebe:calledElement processId="child" />')}</bpmn:callActivity>
    <bpmn:scriptTask id="S">${ext('<zeebe:script expression="=a + 1" resultVariable="b" />')}</bpmn:scriptTask>
    <bpmn:receiveTask id="R" messageRef="M1" />`,
        { roots: `<bpmn:message id="M1" name="Paid">${ext('<zeebe:subscription correlationKey="=orderId" />')}</bpmn:message>` },
      ),
    );
    const view = buildView(doc);
    const text = renderView(view);
    expect(text).toContain('serviceTask X [loop=parallel, job=charge, inputCollection==items, inputElement=item, ext: zeebe:taskDefinition]');
    expect(text).toContain('userTask U [form=review, assignee==reviewer, candidateGroups=sales, ext: zeebe:userTask, zeebe:formDefinition, zeebe:assignmentDefinition]');
    expect(text).toContain('callActivity C [calledElement=child, ext: zeebe:calledElement]');
    expect(text).toContain('scriptTask S [script==a + 1 -> b, ext: zeebe:script]');
    expect(text).toContain('root: message M1 "Paid" [correlationKey==orderId]');
    expect(view.rootElements).toEqual([{ id: 'M1', kind: 'message', name: 'Paid', correlationKey: '=orderId' }]);
    expect(elementDetail(doc, doc.require('X')).properties).toMatchObject({ job: 'charge', inputCollection: '=items' });
  });
});

describe('the ops example', () => {
  it('is a valid Camunda 8 model on the file it describes', async () => {
    const doc = Doc.create({ target: 'camunda8', processName: 'Order handling' });
    const outcome = await mutateDoc(
      doc,
      [
        { op: 'add', kind: 'start', name: 'Order received' },
        { op: 'add', kind: 'userTask', name: 'Check invoice', after: 'Event_OrderReceived' },
        { op: 'add', kind: 'end', name: 'Invoice handled', after: 'Activity_CheckInvoice' },
        ...opsExample().ops,
      ],
      { dryRun: true },
    );
    expect(outcome.validation.platform).toMatchObject({ platform: 'c8', counts: { deploy: 0, runtime: 0, practice: 0 } });
  });
});

/* ------------------------------------------------------------------ */
/* the profile's hints, run through the CLI                              */
/* ------------------------------------------------------------------ */

const FILL: Record<string, string> = {
  '<jobType>': 'job-type',
  '<expression>': 'x',
  '<FEEL expression>': 'x',
  '<variable>': 'result',
  '<processId>': 'child',
  '<decisionId>': 'decision',
  '<MessageName>': 'Msg',
  '<items>': 'items',
  '<item>': 'item',
  '<versionTag>': 'v1',
  '<formId>': 'form',
  '<CODE>': 'CODE',
};

/** Splits a hint's command line like a shell (single and double quotes). */
function shellSplit(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | undefined;
  let quoted = false;
  for (let charIndex = 0; charIndex < line.length; charIndex++) {
    const ch = line[charIndex]!;
    if (quote) {
      if (ch === quote) quote = undefined;
      else cur += ch;
    } else if (ch === "'" && line.startsWith("\\''", charIndex + 1)) {
      // '\'' inside a single-quoted argument: a literal quote
      cur += "'";
      charIndex += 3;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = true;
    } else if (/\s/.test(ch)) {
      if (cur || quoted) out.push(cur);
      cur = '';
      quoted = false;
    } else cur += ch;
  }
  if (cur || quoted) out.push(cur);
  return out;
}

const REFUSED: Array<[string, string]> = [
  ['service task, send task and message end without job', xml('<bpmn:serviceTask id="X" />').replace('<bpmn:endEvent id="End" />', '<bpmn:endEvent id="End"><bpmn:messageEventDefinition id="MD" /></bpmn:endEvent>')],
  ['JUEL condition and a static correlation key', xml('<bpmn:receiveTask id="X" messageRef="M1" />', { roots: `<bpmn:message id="M1" name="Paid">${ext('<zeebe:subscription correlationKey="orderId" />')}</bpmn:message>` }).replace('<bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />', `<bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="G" /><bpmn:exclusiveGateway id="G" default="F4" /><bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="End"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${ok &amp;&amp; amount == 'big'}</bpmn:conditionExpression></bpmn:sequenceFlow><bpmn:sequenceFlow id="F4" sourceRef="G" targetRef="End" />`)],
  ['multi-instance without zeebe loop, call activity without zeebe:calledElement', xml(`<bpmn:callActivity id="X" calledElement="Child"><bpmn:multiInstanceLoopCharacteristics /></bpmn:callActivity>`)],
  ['message catch without subscription, timer PT2D', xml('<bpmn:intermediateCatchEvent id="X"><bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:intermediateCatchEvent>', { roots: '<bpmn:message id="M1" name="Paid" />' }).replace('<bpmn:endEvent id="End" />', '<bpmn:endEvent id="End" /><bpmn:boundaryEvent id="B" attachedToRef="T" cancelActivity="false"><bpmn:timerEventDefinition id="TD"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT2D</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent><bpmn:task id="T" />')],
  ['business rule task with an unprefixed calledDecision', xml('<bpmn:businessRuleTask id="X" calledDecision="risk" />')],
];

describe('the hints of the Camunda 8 profile, run through the CLI', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-c8-hints-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const cli = (...args: string[]): { code: number; out: string; err: string } => {
    const spawned = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
    return { code: spawned.status ?? -1, out: spawned.stdout, err: spawned.stderr };
  };

  it.each(REFUSED.map(([name, model], caseIndex) => [name, model, caseIndex] as const))('%s: following the first command of every deploy hint leaves no deploy finding', async (_name, model, caseIndex) => {
    const file = join(dir, `m${caseIndex}.bpmn`);
    writeFileSync(file, model);
    const deployFindings = async (): Promise<Array<{ code: string; element?: string; hint?: string; message: string }>> => runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings.filter((finding) => finding.severity === 'deploy');
    const before = await deployFindings();
    expect(before.length).toBeGreaterThan(0);
    const tried = new Set<string>();
    for (let round = 0; round < 12; round++) {
      const left = (await deployFindings()).filter((finding) => !tried.has(`${finding.code}|${finding.element}|${finding.message}`));
      const nextFinding = left[0];
      if (!nextFinding) break;
      tried.add(`${nextFinding.code}|${nextFinding.element}|${nextFinding.message}`);
      const command = /`(bpmn [^`]+)`/.exec(nextFinding.hint ?? '')?.[1];
      expect(command, `${nextFinding.code}: ${nextFinding.hint}`).toBeDefined();
      let line = command!.replace(/<file>/g, file);
      for (const [placeholder, violation] of Object.entries(FILL)) line = line.split(placeholder).join(violation);
      const cliRun = cli(...shellSplit(line.replace(/^bpmn\s+/, '')), '--no-layout');
      expect([0, 5], `${line}\n${cliRun.err}${cliRun.out}`).toContain(cliRun.code);
    }
    expect((await deployFindings()).map((finding) => `${finding.code} ${finding.element}`)).toEqual([]);
    if (ENGINE) {
      const form = new FormData();
      form.append('resources', new Blob([readFileSync(file, 'utf8').replace(/id="P"/g, `id="P_bpmn_cli_c8_hints_${caseIndex}"`)], { type: 'application/octet-stream' }), `hints-${caseIndex}.bpmn`);
      const res = await fetch(`${ENGINE}/deployments`, { method: 'POST', body: form, headers: { accept: 'application/json' } });
      const json = (await res.json()) as { detail?: string; deployments?: Array<{ processDefinition?: { processDefinitionKey: string } }> };
      expect(res.ok, json.detail).toBe(true);
      for (const deployment of json.deployments ?? []) if (deployment.processDefinition) await fetch(`${ENGINE}/resources/${deployment.processDefinition.processDefinitionKey}/deletion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    }
  }, 60000);
});

const ENGINE = (process.env['BPMN_C8_ENGINE'] ?? '').trim().replace(/\/$/, '');
