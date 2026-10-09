/**
 * The decision link of a business rule task (src/ops/decision.ts): design-iq's
 * design models write it as an unprefixed calledDecision="<decision>" (hard
 * rule 5), Camunda 7 as camunda:decisionRef, Camunda 8 as a
 * zeebe:calledDecision extension element. `show`, `show <id>` and `find`
 * read every spelling; `set <id> calledDecision=<decision>` writes the one of
 * the file's platform and removes the others (all models synthetic).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { kindsJson } from '../src/guide.js';
import { runOps } from '../src/ops/index.js';
import { settableKeys } from '../src/ops/set.js';
import { checkFile } from '../src/node/files.js';
import { mutateDoc } from '../src/pipeline.js';
import { runProfile } from '../src/platform/profile.js';
import { buildView, elementDetail, findElements } from '../src/view.js';

const ROOT = join(import.meta.dirname, '..');
const BPMN = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
const OPERATON = 'xmlns:operaton="http://operaton.org/schema/1.0/bpmn"';
const ZEEBE = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"';
const MODELER = 'xmlns:modeler="http://camunda.org/schema/modeler/1.0"';

function model(task: string, o: { ns?: string; attrs?: string; process?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${BPMN} ${o.ns ?? ''} ${o.attrs ?? ''} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true" ${o.process ?? ''}>
    <bpmn:startEvent id="S" />
    ${task}
    <bpmn:endEvent id="E" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="R" />
    <bpmn:sequenceFlow id="F2" sourceRef="R" targetRef="E" />
  </bpmn:process>
</bpmn:definitions>`;
}

const C7 = { ns: `${CAMUNDA} ${MODELER}`, attrs: 'modeler:executionPlatform="Camunda Platform"', process: 'camunda:historyTimeToLive="180"' };
const C8 = { ns: `${ZEEBE} ${MODELER}`, attrs: 'modeler:executionPlatform="Camunda Cloud"' };

async function set(source: string, values: Record<string, string>): Promise<{ doc: Doc; xml: string; result: Awaited<ReturnType<typeof mutateDoc>> }> {
  const doc = await Doc.fromXml(source);
  const result = await mutateDoc(doc, [{ op: 'set', id: 'R', values }], { layout: false, profile: 'none' });
  return { doc: await Doc.fromXml(result.xml), xml: result.xml, result };
}

/** The business rule task's start tag, and its whole element. */
const taskTag = (xml: string): string => /<bpmn:businessRuleTask[^>]*>/.exec(xml)![0];
const taskXml = (xml: string): string => /<bpmn:businessRuleTask[\s\S]*?(\/>|<\/bpmn:businessRuleTask>)/.exec(xml)![0];

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-decision-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('reading the decision link', () => {
  const SPELLINGS: Array<[string, string, Record<string, string>]> = [
    ['design: calledDecision', '<bpmn:businessRuleTask id="R" name="Rate" calledDecision="risk" />', {}],
    ['Camunda 7: camunda:decisionRef', '<bpmn:businessRuleTask id="R" name="Rate" camunda:decisionRef="risk" />', C7],
    ['Camunda 8: zeebe:calledDecision', '<bpmn:businessRuleTask id="R" name="Rate"><bpmn:extensionElements><zeebe:calledDecision decisionId="risk" resultVariable="r" /></bpmn:extensionElements></bpmn:businessRuleTask>', C8],
    ['hand-written: calledElement', '<bpmn:businessRuleTask id="R" name="Rate" calledElement="risk" />', {}],
  ];
  for (const [name, task, o] of SPELLINGS) {
    it(`${name}: show, show <id> and find`, async () => {
      const doc = await Doc.fromXml(model(task, o));
      const node = buildView(doc).processes[0]!.nodes.find((x) => x.id === 'R')!;
      expect(node.props).toEqual({ calledDecision: 'risk' });
      expect(elementDetail(doc, doc.require('R')).properties['calledDecision']).toBe('risk');
      expect(findElements(doc, 'risk')).toEqual([expect.objectContaining({ id: 'R', match: expect.stringMatching(/risk/) })]);
    });
  }

  it('the CLI prints it in the model view; a design model\'s calledDecision is no import warning, a Camunda 7 file\'s is', async () => {
    const file = join(dir, 'read.bpmn');
    writeFileSync(file, model('<bpmn:businessRuleTask id="R" name="Rate" calledDecision="risk" />'));
    const show = cli('show', file);
    expect(show.out).toContain('businessRuleTask R "Rate" [calledDecision=risk] -> E (F2)');
    expect(cli('find', file, 'risk').out).toContain('businessRuleTask R "Rate"  (in P)  [calledDecision=risk]');
    expect((await checkFile(file)).importWarnings).toEqual([]);
    const strict = cli('validate', file, '--strict');
    expect(strict.code, strict.out).toBe(0);
    writeFileSync(file, model('<bpmn:businessRuleTask id="R" name="Rate" calledDecision="risk" camunda:decisionRef="risk" />', C7));
    expect((await checkFile(file)).importWarnings).toEqual(['unknown attribute <calledDecision>']);
  }, 60000);
});

describe('set <id> calledDecision=<decision>', () => {
  it('design model: the unprefixed attribute; other spellings are removed', async () => {
    const { xml, doc, result } = await set(model('<bpmn:businessRuleTask id="R" calledElement="old" />'), { calledDecision: 'risk' });
    // the file lists no incoming / outgoing: a write does not add them (roundtrip), so the task stays an empty element
    expect(taskTag(xml)).toBe('<bpmn:businessRuleTask id="R" calledDecision="risk" />');
    expect(result.changes.changed[0]!.detail).toBe('calledDecision=risk (calledDecision); removed calledElement');
    expect(doc.require('R').$attrs).toEqual({ calledDecision: 'risk' });
  });

  it('Camunda 7: camunda:decisionRef; a hand-written unprefixed link is converted (W_C7_DEPLOY_SCHEMA resolved)', async () => {
    const source = model('<bpmn:businessRuleTask id="R" calledDecision="old" />', C7);
    expect(runProfile(await Doc.fromXml(source)).findings.map((f) => f.code).sort()).toEqual(['W_C7_DEPLOY_IMPLEMENTATION', 'W_C7_DEPLOY_SCHEMA']);
    const { doc, result } = await set(source, { calledDecision: 'risk' });
    expect(doc.require('R').$attrs).toEqual({ 'camunda:decisionRef': 'risk' });
    expect(result.changes.changed[0]!.detail).toBe('calledDecision=risk (camunda:decisionRef); removed calledDecision');
    expect(runProfile(doc).findings).toEqual([]);
    expect(result.validation.platform?.resolved?.map((f) => f.code).sort()).toEqual(['W_C7_DEPLOY_IMPLEMENTATION', 'W_C7_DEPLOY_SCHEMA']);
  });

  it('Camunda 7: the schema finding\'s hint is that command, and following it deploys', async () => {
    const file = join(dir, 'c7-hint.bpmn');
    writeFileSync(file, model('<bpmn:businessRuleTask id="R" calledDecision="risk" />', C7));
    const schema = runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings.find((f) => f.code === 'W_C7_DEPLOY_SCHEMA');
    expect(schema!.hint).toBe("Write the decision link in the engines' spelling: `bpmn set <file> R calledDecision=risk` (camunda:decisionRef; the unprefixed calledDecision is removed).");
    const r = cli('set', file, 'R', 'calledDecision=risk', '--no-layout');
    expect(r.code, r.err).toBe(0);
    expect(runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings).toEqual([]);
    // next to another implementation the attribute is only removed
    const withClass = runProfile(await Doc.fromXml(model('<bpmn:businessRuleTask id="R" calledDecision="risk" camunda:class="x.Rules" />', C7))).findings;
    expect(withClass.filter((f) => f.code === 'W_C7_DEPLOY_SCHEMA').map((f) => f.hint)).toEqual(['Remove it: `bpmn set <file> R calledDecision=` (vendor attributes need their namespace prefix, e.g. camunda:<name>).']);
  }, 60000);

  it('Operaton-only file: operaton:decisionRef', async () => {
    const { doc } = await set(model('<bpmn:businessRuleTask id="R" />', { ns: OPERATON, process: 'operaton:historyTimeToLive="180"' }), { calledDecision: 'risk' });
    expect(doc.require('R').$attrs).toEqual({ 'operaton:decisionRef': 'risk' });
  });

  it('Camunda 8: a zeebe:calledDecision decisionId; a missing resultVariable is reported, an existing one kept', async () => {
    const { xml, result } = await set(model('<bpmn:businessRuleTask id="R" calledDecision="old" />', C8), { calledDecision: 'risk' });
    expect(taskXml(xml)).toContain('<zeebe:calledDecision decisionId="risk" />');
    expect(taskTag(xml)).toBe('<bpmn:businessRuleTask id="R">');
    expect(result.changes.warnings.map((w) => [w.code, w.hint])).toEqual([['W_DECISION_RESULT_VARIABLE', 'Name the variable that receives the result: `bpmn ext add <file> R zeebe:calledDecision decisionId=risk resultVariable=<variable> --replace`.']]);
    const kept = await set(model('<bpmn:businessRuleTask id="R"><bpmn:extensionElements><zeebe:calledDecision decisionId="old" resultVariable="score" /></bpmn:extensionElements></bpmn:businessRuleTask>', C8), { calledDecision: 'risk' });
    expect(taskXml(kept.xml)).toContain('<zeebe:calledDecision decisionId="risk" resultVariable="score" />');
    expect(kept.result.changes.warnings).toEqual([]);
  });

  it('an empty value removes the link in every spelling', async () => {
    const { doc, xml } = await set(model('<bpmn:businessRuleTask id="R" calledDecision="a" camunda:decisionRef="b"><bpmn:extensionElements><zeebe:calledDecision decisionId="c" /></bpmn:extensionElements></bpmn:businessRuleTask>', { ns: `${CAMUNDA} ${ZEEBE}` }), { calledDecision: '' });
    expect(doc.require('R').$attrs).toEqual({});
    expect(taskTag(xml)).toBe('<bpmn:businessRuleTask id="R" />');
    expect(taskXml(xml)).not.toContain('extensionElements');
  });

  it('only business rule tasks call decisions; an unprefixed calledDecision elsewhere can still be removed', async () => {
    const doc = await Doc.fromXml(model('<bpmn:userTask id="R" calledDecision="x" />'));
    expect(() => runOps(doc, [{ op: 'set', id: 'R', values: { calledDecision: 'risk' } }])).toThrow(/Unknown key "calledDecision" for userTask R/);
    runOps(doc, [{ op: 'set', id: 'R', values: { calledDecision: '' } }]);
    expect(doc.require('R').$attrs).toEqual({});
    expect(() => runOps(doc, [{ op: 'set', id: 'R', values: { calledDecision: '' } }])).toThrow(/Unknown key "calledDecision"/);
  });

  it('works in `add` (trailing key=value / the set map of an add op)', async () => {
    const doc = await Doc.fromXml(model('<bpmn:task id="R" />', C7));
    runOps(doc, [{ op: 'add', kind: 'businessRuleTask', name: 'Rate', after: 'R', set: { calledDecision: 'risk' } }]);
    expect(doc.require('Activity_Rate').$attrs).toEqual({ 'camunda:decisionRef': 'risk' });
  });

  it('is a documented set key of business rule tasks (kinds --json)', async () => {
    const doc = await Doc.fromXml(model('<bpmn:businessRuleTask id="R" />'));
    expect(settableKeys(doc, doc.require('R'))).toContain('calledDecision');
    expect(settableKeys(doc, doc.require('S'))).not.toContain('calledDecision');
    const keys = (kindsJson()['setKeys'] as Array<{ key: string; appliesTo: string }>).filter((k) => k.key === 'calledDecision');
    expect(keys.map((k) => k.appliesTo)).toEqual(['businessRuleTask']);
  });
});

function cli(...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}
