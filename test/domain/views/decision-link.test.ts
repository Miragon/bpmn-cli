/**
 * The decision link of a business rule task (src/domain/document/DecisionLinkReader.ts, DecisionLinkWriter.ts): Camunda 7
 * writes it as camunda:decisionRef, Camunda 8 as a zeebe:calledDecision
 * extension element, and bpmn-cli as an unprefixed calledDecision="<decision>"
 * in a model without an engine. `show`, `show <id>` and `find` read every
 * spelling; `set <id> calledDecision=<decision>` writes the one of the file's
 * platform, in a model without an engine the file's own (issue #42), and
 * removes the others (all models synthetic).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../../../src/domain/document/Doc.js';
import { runOps } from '../../../src/index.js';
import { COMMANDS } from '../../../src/adapters/in/report/CommandCatalogue.js';
import { ERROR_CATALOGUE } from '../../../src/adapters/in/report/guide.js';
import { guideText, kindsJson } from '../../../src/index.js';
import { checkFile } from '../../../src/node.js';
import { mutateDoc, type MutationOptions, loadProfiles, runProfile, buildView, elementDetail, findElements } from '../../../src/index.js';
import { PropertyCoercer } from '../../../src/domain/editing/PropertyCoercer.js';
import { EditContext } from '../../../src/domain/document/EditContext.js';
import { cli } from '../../helpers/cli.js';

// the engine rules load on demand; runProfile / validateDoc(doc, { platform }) need them loaded (the pipeline loads them itself)
await loadProfiles();

const BPMN = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
const OPERATON = 'xmlns:operaton="http://operaton.org/schema/1.0/bpmn"';
const ZEEBE = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"';
const MODELER = 'xmlns:modeler="http://camunda.org/schema/modeler/1.0"';

function model(task: string, options: { ns?: string; attrs?: string; process?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${BPMN} ${options.ns ?? ''} ${options.attrs ?? ''} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true" ${options.process ?? ''}>
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
  const result = await mutateDoc(doc, [{ op: 'set', id: 'R', values }], { layout: false });
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
    ['no engine: calledDecision', '<bpmn:businessRuleTask id="R" name="Rate" calledDecision="risk" />', {}],
    ['Camunda 7: camunda:decisionRef', '<bpmn:businessRuleTask id="R" name="Rate" camunda:decisionRef="risk" />', C7],
    ['Camunda 8: zeebe:calledDecision', '<bpmn:businessRuleTask id="R" name="Rate"><bpmn:extensionElements><zeebe:calledDecision decisionId="risk" resultVariable="r" /></bpmn:extensionElements></bpmn:businessRuleTask>', C8],
    ['hand-written: calledElement', '<bpmn:businessRuleTask id="R" name="Rate" calledElement="risk" />', {}],
  ];
  for (const [name, task, options] of SPELLINGS) {
    it(`${name}: show, show <id> and find`, async () => {
      const doc = await Doc.fromXml(model(task, options));
      const node = buildView(doc).processes[0]!.nodes.find((candidate) => candidate.id === 'R')!;
      expect(node.props).toEqual({ calledDecision: 'risk' });
      expect(elementDetail(doc, doc.require('R')).properties['calledDecision']).toBe('risk');
      expect(findElements(doc, 'risk')).toEqual([expect.objectContaining({ id: 'R', match: expect.stringMatching(/risk/) })]);
    });
  }

  it('the CLI prints it in the model view; the calledDecision of a model without an engine is no import warning, a Camunda 7 file\'s is', async () => {
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
  it('model without an engine: the unprefixed attribute; a hand-written calledElement is replaced', async () => {
    const { xml, doc, result } = await set(model('<bpmn:businessRuleTask id="R" calledElement="old" />'), { calledDecision: 'risk' });
    // the file lists no incoming / outgoing: a write does not add them (roundtrip), so the task stays an empty element
    expect(taskTag(xml)).toBe('<bpmn:businessRuleTask id="R" calledDecision="risk" />');
    expect(result.changes.changed[0]!.detail).toBe('calledDecision=risk (calledDecision); removed calledElement');
    expect(doc.require('R').$attrs).toEqual({ calledDecision: 'risk' });
  });

  it('Camunda 7: camunda:decisionRef; a hand-written unprefixed link is converted (W_C7_DEPLOY_SCHEMA resolved)', async () => {
    const source = model('<bpmn:businessRuleTask id="R" calledDecision="old" />', C7);
    expect(runProfile(await Doc.fromXml(source)).findings.map((finding) => finding.code).sort()).toEqual(['W_C7_DEPLOY_IMPLEMENTATION', 'W_C7_DEPLOY_SCHEMA']);
    const { doc, result } = await set(source, { calledDecision: 'risk' });
    expect(doc.require('R').$attrs).toEqual({ 'camunda:decisionRef': 'risk' });
    expect(result.changes.changed[0]!.detail).toBe('calledDecision=risk (camunda:decisionRef); removed calledDecision');
    expect(runProfile(doc).findings).toEqual([]);
    expect(result.validation.platform?.resolved?.map((finding) => finding.code).sort()).toEqual(['W_C7_DEPLOY_IMPLEMENTATION', 'W_C7_DEPLOY_SCHEMA']);
  });

  it('Camunda 7: the schema finding\'s hint is that command, and following it deploys', async () => {
    const file = join(dir, 'c7-hint.bpmn');
    writeFileSync(file, model('<bpmn:businessRuleTask id="R" calledDecision="risk" />', C7));
    const schema = runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings.find((finding) => finding.code === 'W_C7_DEPLOY_SCHEMA');
    expect(schema!.hint).toBe("Write the decision link in the engines' spelling: `bpmn set <file> R calledDecision=risk` (camunda:decisionRef; the unprefixed calledDecision is removed).");
    const result = cli('set', file, 'R', 'calledDecision=risk', '--no-layout');
    expect(result.code, result.err).toBe(0);
    expect(runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings).toEqual([]);
    // next to another implementation the attribute is only removed
    const withClass = runProfile(await Doc.fromXml(model('<bpmn:businessRuleTask id="R" calledDecision="risk" camunda:class="x.Rules" />', C7))).findings;
    expect(withClass.filter((finding) => finding.code === 'W_C7_DEPLOY_SCHEMA').map((finding) => finding.hint)).toEqual(['Remove it: `bpmn set <file> R calledDecision=` (vendor attributes need their namespace prefix, e.g. camunda:<name>).']);
  }, 60000);

  it('Operaton-only file: operaton:decisionRef', async () => {
    const { doc } = await set(model('<bpmn:businessRuleTask id="R" />', { ns: OPERATON, process: 'operaton:historyTimeToLive="180"' }), { calledDecision: 'risk' });
    expect(doc.require('R').$attrs).toEqual({ 'operaton:decisionRef': 'risk' });
  });

  it('Camunda 8: a zeebe:calledDecision decisionId; a missing resultVariable is reported, an existing one kept', async () => {
    const { xml, result } = await set(model('<bpmn:businessRuleTask id="R" calledDecision="old" />', C8), { calledDecision: 'risk' });
    expect(taskXml(xml)).toContain('<zeebe:calledDecision decisionId="risk" />');
    expect(taskTag(xml)).toBe('<bpmn:businessRuleTask id="R">');
    // the Camunda 8 profile (step 3) reports the missing resultVariable itself; the op warning gives way to it
    expect(result.changes.warnings).toEqual([]);
    expect(result.validation.warnings.filter((warning) => warning.code.startsWith('W_C8_')).map((warning) => [warning.code, warning.element, warning.hint])).toEqual([['W_C8_DEPLOY_IMPLEMENTATION', 'R', '`bpmn ext add <file> R zeebe:calledDecision decisionId=risk resultVariable=<variable> --replace`.']]);
    const op = runOps(await Doc.fromXml(model('<bpmn:businessRuleTask id="R" calledDecision="old" />', C8)), [{ op: 'set', id: 'R', values: { calledDecision: 'risk' } }]);
    expect(op.warnings.map((warning) => [warning.code, warning.hint])).toEqual([['W_DECISION_RESULT_VARIABLE', 'Name the variable that receives the result: `bpmn ext add <file> R zeebe:calledDecision decisionId=risk resultVariable=<variable> --replace`.']]);
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
    expect(new PropertyCoercer(doc, new EditContext(doc)).settableKeys(doc.require('R'))).toContain('calledDecision');
    expect(new PropertyCoercer(doc, new EditContext(doc)).settableKeys(doc.require('S'))).not.toContain('calledDecision');
    const keys = (kindsJson()['setKeys'] as Array<{ key: string; appliesTo: string }>).filter((setKey) => setKey.key === 'calledDecision');
    expect(keys.map((setKey) => setKey.appliesTo)).toEqual(['businessRuleTask']);
  });
});

/** Two business rule tasks in a row: Activity_Rate (with `rate`) and Activity_Other (with `other`). */
function pair(rate: string, other = '', options: { ns?: string; executable?: boolean } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${BPMN} ${options.ns ?? ''} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="${options.executable ?? false}">
    <bpmn:startEvent id="S" />
    <bpmn:businessRuleTask id="Activity_Rate" name="Rate"${rate ? ` ${rate}` : ''} />
    <bpmn:businessRuleTask id="Activity_Other" name="Other"${other ? ` ${other}` : ''} />
    <bpmn:endEvent id="E" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Activity_Rate" />
    <bpmn:sequenceFlow id="F2" sourceRef="Activity_Rate" targetRef="Activity_Other" />
    <bpmn:sequenceFlow id="F3" sourceRef="Activity_Other" targetRef="E" />
  </bpmn:process>
</bpmn:definitions>`;
}

/** A model without an engine that declares the camunda and the zeebe namespace and has links in both (issue #42). */
const BOTH = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${BPMN} ${CAMUNDA} ${ZEEBE} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" />
    <bpmn:businessRuleTask id="Activity_RateRisk" name="Rate risk" camunda:decisionRef="old-c7" />
    <bpmn:businessRuleTask id="Activity_Price" name="Price">
      <bpmn:extensionElements>
        <zeebe:calledDecision decisionId="old-c8" resultVariable="price" />
      </bpmn:extensionElements>
    </bpmn:businessRuleTask>
    <bpmn:businessRuleTask id="Activity_New" name="New" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Activity_RateRisk" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Activity_RateRisk" targetRef="Activity_Price" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Activity_Price" targetRef="Activity_New" />
  </bpmn:process>
</bpmn:definitions>`;

async function setOn(source: string, id: string, calledDecision: string, opts: MutationOptions = { platform: 'none' }): Promise<{ xml: string; detail: string; warnings: string[] }> {
  const result = await mutateDoc(await Doc.fromXml(source), [{ op: 'set', id, values: { calledDecision } }], { layout: false, ...opts });
  return { xml: result.xml, detail: result.changes.changed.map((change) => change.detail).join(' | '), warnings: [...result.changes.warnings, ...result.validation.warnings].map((warning) => warning.code) };
}

describe('a model without an engine keeps the file\'s spelling (issue #42)', () => {
  it('a task with camunda:decisionRef: that attribute is updated, no unprefixed one is added', async () => {
    const source = pair('camunda:decisionRef="d1"', '', { ns: CAMUNDA });
    const result = await setOn(source, 'Activity_Rate', 'd2');
    // only the value changes: every other byte stays
    expect(result.xml).toBe(source.replace('camunda:decisionRef="d1"', 'camunda:decisionRef="d2"'));
    expect(result.detail).toBe('calledDecision=d2 (camunda:decisionRef)');
  });

  it('a task with operaton:decisionRef: that attribute is updated', async () => {
    const source = pair('operaton:decisionRef="d1"', '', { ns: OPERATON });
    const result = await setOn(source, 'Activity_Rate', 'd2');
    expect(result.xml).toBe(source.replace('operaton:decisionRef="d1"', 'operaton:decisionRef="d2"'));
    expect(result.detail).toBe('calledDecision=d2 (operaton:decisionRef)');
  });

  it('a task with zeebe:calledDecision: its decisionId is updated and its resultVariable kept; no W_DECISION_RESULT_VARIABLE', async () => {
    const result = await setOn(BOTH, 'Activity_Price', 'new-c8');
    expect(result.xml).toBe(BOTH.replace('decisionId="old-c8"', 'decisionId="new-c8"'));
    expect(result.detail).toBe('calledDecision=new-c8 (zeebe:calledDecision)');
    expect(result.warnings).not.toContain('W_DECISION_RESULT_VARIABLE');
    // without a resultVariable: still none, no engine reads the file
    const bare = BOTH.replace(' resultVariable="price"', '');
    const bareResult = await setOn(bare, 'Activity_Price', 'new-c8');
    expect(bareResult.xml).toBe(bare.replace('decisionId="old-c8"', 'decisionId="new-c8"'));
    expect(bareResult.warnings).not.toContain('W_DECISION_RESULT_VARIABLE');
  });

  it('the file of the issue: camunda:decisionRef and zeebe:calledDecision are kept, a new link between them is unprefixed', async () => {
    const c7 = await setOn(BOTH, 'Activity_RateRisk', 'new-c7');
    expect(c7.xml).toBe(BOTH.replace('camunda:decisionRef="old-c7"', 'camunda:decisionRef="new-c7"'));
    expect(c7.detail).toBe('calledDecision=new-c7 (camunda:decisionRef)');
    // the file's other links have two spellings: bpmn-cli's own
    const fresh = await setOn(BOTH, 'Activity_New', 'new-x');
    expect(fresh.xml).toBe(BOTH.replace('<bpmn:businessRuleTask id="Activity_New" name="New" />', '<bpmn:businessRuleTask id="Activity_New" name="New" calledDecision="new-x" />'));
    expect(fresh.detail).toBe('calledDecision=new-x (calledDecision)');
  });

  it('a new link follows the file\'s single engine spelling (camunda, operaton, zeebe, the file\'s own prefix)', async () => {
    const camunda = await setOn(pair('camunda:decisionRef="d1"', '', { ns: CAMUNDA }), 'Activity_Other', 'd2');
    expect(camunda.xml).toContain('<bpmn:businessRuleTask id="Activity_Other" name="Other" camunda:decisionRef="d2" />');
    expect(camunda.detail).toBe('calledDecision=d2 (camunda:decisionRef)');
    const operaton = await setOn(pair('operaton:decisionRef="d1"', '', { ns: OPERATON }), 'Activity_Other', 'd2');
    expect(operaton.xml).toContain('<bpmn:businessRuleTask id="Activity_Other" name="Other" operaton:decisionRef="d2" />');
    // a prefix of the file's own for the camunda namespace
    const own = pair('c:decisionRef="d1"', '', { ns: 'xmlns:c="http://camunda.org/schema/1.0/bpmn"' });
    const ownResult = await setOn(own, 'Activity_Other', 'd2');
    expect(ownResult.xml).toBe(own.replace('<bpmn:businessRuleTask id="Activity_Other" name="Other" />', '<bpmn:businessRuleTask id="Activity_Other" name="Other" c:decisionRef="d2" />'));
    // zeebe: a zeebe:calledDecision without resultVariable, and no warning about it
    const zeebe = await setOn(BOTH.replace(' camunda:decisionRef="old-c7"', ''), 'Activity_New', 'd2');
    expect(zeebe.xml).toMatch(/<bpmn:businessRuleTask id="Activity_New" name="New">\s*<bpmn:extensionElements>\s*<zeebe:calledDecision decisionId="d2" \/>\s*<\/bpmn:extensionElements>\s*<\/bpmn:businessRuleTask>/);
    expect(zeebe.detail).toBe('calledDecision=d2 (zeebe:calledDecision)');
    expect(zeebe.warnings).not.toContain('W_DECISION_RESULT_VARIABLE');
  });

  it('a link in a sub-process counts; tasks without a link do not', async () => {
    const source = model('<bpmn:businessRuleTask id="R" /><bpmn:businessRuleTask id="Q" /><bpmn:subProcess id="Sub"><bpmn:businessRuleTask id="Deep" camunda:decisionRef="d1" /></bpmn:subProcess>', { ns: CAMUNDA });
    const result = await setOn(source, 'R', 'risk');
    expect(taskTag(result.xml)).toBe('<bpmn:businessRuleTask id="R" camunda:decisionRef="risk" />');
  });

  it('mixed spellings or none: the unprefixed calledDecision', async () => {
    const cases: Array<[string, string, string]> = [
      ['no other link', '', CAMUNDA],
      ['camunda next to an unprefixed calledDecision', 'camunda:decisionRef="d1"', CAMUNDA],
      ['camunda next to operaton', 'camunda:decisionRef="d1" operaton:decisionRef="d1"', `${CAMUNDA} ${OPERATON}`],
      ['a hand-written calledElement', 'calledElement="d1"', ''],
    ];
    for (const [name, rate, ns] of cases) {
      const extra = name === 'camunda next to an unprefixed calledDecision' ? '<bpmn:businessRuleTask id="Activity_Third" calledDecision="d0" />' : '';
      const source = pair(rate, '', { ns }).replace('<bpmn:endEvent id="E" />', `${extra}<bpmn:endEvent id="E" />`);
      const result = await setOn(source, 'Activity_Other', 'd2');
      expect(result.xml, name).toContain('<bpmn:businessRuleTask id="Activity_Other" name="Other" calledDecision="d2" />');
      expect(result.detail, name).toBe('calledDecision=d2 (calledDecision)');
    }
  });

  it('a task\'s own unprefixed link stays unprefixed; a hand-written calledElement is still converted to it', async () => {
    const source = pair('calledDecision="d1"', 'camunda:decisionRef="d0"', { ns: CAMUNDA });
    expect(taskTag((await setOn(source, 'Activity_Rate', 'd2')).xml)).toBe('<bpmn:businessRuleTask id="Activity_Rate" name="Rate" calledDecision="d2" />');
    const element = await setOn(pair('calledElement="d1"', 'camunda:decisionRef="d0"', { ns: CAMUNDA }), 'Activity_Rate', 'd2');
    expect(taskTag(element.xml)).toBe('<bpmn:businessRuleTask id="Activity_Rate" name="Rate" calledDecision="d2" />');
    expect(element.detail).toBe('calledDecision=d2 (calledDecision); removed calledElement');
  });

  it('a task with two spellings keeps the one the readers read first and loses the other', async () => {
    const result = await setOn(pair('calledDecision="d1" camunda:decisionRef="d1"', '', { ns: CAMUNDA }), 'Activity_Rate', 'd2');
    expect(taskTag(result.xml)).toBe('<bpmn:businessRuleTask id="Activity_Rate" name="Rate" camunda:decisionRef="d2" />');
    expect(result.detail).toBe('calledDecision=d2 (camunda:decisionRef); removed calledDecision');
  });

  it('a zeebe:calledDecision without a decisionId is no link: the task follows the file, else gets the unprefixed spelling', async () => {
    const empty = '<bpmn:extensionElements><zeebe:calledDecision resultVariable="r" /></bpmn:extensionElements>';
    const task = (id: string, attrs = '', body = ''): string => (body ? `<bpmn:businessRuleTask id="${id}"${attrs}>${body}</bpmn:businessRuleTask>` : `<bpmn:businessRuleTask id="${id}"${attrs} />`);
    const file = (ns: string, tasks: string): string => model(tasks, { ns });
    // the other tasks use camunda:decisionRef: the new link does too, and the empty zeebe element goes
    const c7 = await setOn(file(`${CAMUNDA} ${ZEEBE}`, `${task('A', ' camunda:decisionRef="d1"')}${task('B', ' camunda:decisionRef="d0"')}${task('R', '', empty)}`), 'R', 'd2');
    expect(c7.detail).toBe('calledDecision=d2 (camunda:decisionRef); removed zeebe:calledDecision');
    expect(taskXml(c7.xml.slice(c7.xml.indexOf('<bpmn:businessRuleTask id="R"')))).toBe('<bpmn:businessRuleTask id="R" camunda:decisionRef="d2" />');
    // the task's own unprefixed link decides, not the empty zeebe element
    const own = await setOn(file(ZEEBE, task('R', ' calledDecision="x"', '<bpmn:extensionElements><zeebe:calledDecision decisionId="" resultVariable="r" /></bpmn:extensionElements>')), 'R', 'd2');
    expect(own.detail).toBe('calledDecision=d2 (calledDecision); removed zeebe:calledDecision');
    expect(taskXml(own.xml)).toBe('<bpmn:businessRuleTask id="R" calledDecision="d2" />');
    // the other tasks use zeebe: the empty element takes the decisionId and keeps its resultVariable
    const zeebe = await setOn(file(ZEEBE, `${task('A', '', '<bpmn:extensionElements><zeebe:calledDecision decisionId="d1" resultVariable="a" /></bpmn:extensionElements>')}${task('R', '', empty)}`), 'R', 'd2');
    expect(zeebe.detail).toBe('calledDecision=d2 (zeebe:calledDecision)');
    expect(zeebe.xml).toContain('<bpmn:businessRuleTask id="R"><bpmn:extensionElements><zeebe:calledDecision resultVariable="r" decisionId="d2" /></bpmn:extensionElements></bpmn:businessRuleTask>');
  });

  it('the CLI\'s path (platform auto): a link in an engine spelling makes the file Camunda 7 / 8, so `set` converts as in 0.6', async () => {
    const c7only = pair('camunda:decisionRef="old"', '', { ns: CAMUNDA });
    expect((await setOn(c7only, 'Activity_Rate', 'risk', {})).detail).toBe('calledDecision=risk (camunda:decisionRef)');
    const both = await setOn(BOTH, 'Activity_Price', 'new-c8', {});
    expect(both.detail).toBe('calledDecision=new-c8 (camunda:decisionRef); removed zeebe:calledDecision');
    expect(both.xml).not.toContain('resultVariable');
  });

  it('`add` with calledDecision follows the file\'s spelling too', async () => {
    const doc = await Doc.fromXml(pair('camunda:decisionRef="d1"', '', { ns: CAMUNDA }));
    const result = await mutateDoc(doc, [{ op: 'add', kind: 'businessRuleTask', name: 'Price', after: 'Activity_Other', set: { calledDecision: 'price' } }], { layout: false, platform: 'none' });
    expect(result.xml).toContain('<bpmn:businessRuleTask id="Activity_Price" name="Price" camunda:decisionRef="price" />');
  });

  it('an empty value still removes the link in every spelling', async () => {
    const result = await setOn(BOTH, 'Activity_Price', '');
    expect(taskXml(result.xml.slice(result.xml.indexOf('<bpmn:businessRuleTask id="Activity_Price"')))).toBe('<bpmn:businessRuleTask id="Activity_Price" name="Price" />');
    expect(result.detail).toBe('calledDecision removed; removed zeebe:calledDecision');
    const c7 = await setOn(BOTH, 'Activity_RateRisk', '');
    expect(c7.xml).toContain('<bpmn:businessRuleTask id="Activity_RateRisk" name="Rate risk" />');
  });

  it('the probes of the follow-up: a plain file, a camunda file edited with platform none, an executable camunda file', async () => {
    // a plain file: calledElement is replaced by the unprefixed calledDecision, a new link next to it is unprefixed (unchanged)
    const plain = pair('calledElement="d1"');
    expect((await setOn(plain, 'Activity_Rate', 'd2', {})).xml).toContain('<bpmn:businessRuleTask id="Activity_Rate" name="Rate" calledDecision="d2" />');
    expect((await setOn(plain, 'Activity_Other', 'd2', {})).xml).toContain('<bpmn:businessRuleTask id="Activity_Other" name="Other" calledDecision="d2" />');
    // a camunda file without an executable process, edited with platform none: the camunda spelling stays and is followed
    const none = pair('camunda:decisionRef="d1"', '', { ns: CAMUNDA });
    expect(taskTag((await setOn(none, 'Activity_Rate', 'd2')).xml)).toBe('<bpmn:businessRuleTask id="Activity_Rate" name="Rate" camunda:decisionRef="d2" />');
    expect((await setOn(none, 'Activity_Other', 'd2')).xml).toContain('<bpmn:businessRuleTask id="Activity_Rate" name="Rate" camunda:decisionRef="d1" />\n    <bpmn:businessRuleTask id="Activity_Other" name="Other" camunda:decisionRef="d2" />');
    // an executable camunda file (detected as Camunda 7): the engine's spelling, as before
    const exec = pair('camunda:decisionRef="d1"', '', { ns: CAMUNDA, executable: true });
    expect((await setOn(exec, 'Activity_Other', 'd2', {})).xml).toContain('<bpmn:businessRuleTask id="Activity_Other" name="Other" camunda:decisionRef="d2" />');
  });

  it('Camunda 7 / 8 still convert: a file with both namespaces edited as Camunda 7 or 8 writes that engine\'s spelling', async () => {
    const c7 = await setOn(BOTH, 'Activity_Price', 'x', { platform: 'c7' });
    expect(c7.detail).toBe('calledDecision=x (camunda:decisionRef); removed zeebe:calledDecision');
    const c8 = await setOn(BOTH, 'Activity_RateRisk', 'x', { platform: 'c8' });
    expect(c8.detail).toBe('calledDecision=x (zeebe:calledDecision); removed camunda:decisionRef');
    // the process is not executable, so the Camunda 8 profile says nothing about it: the op's own warning
    expect(c8.warnings).toContain('W_DECISION_RESULT_VARIABLE');
  });

  it('no guide entry names design-iq as the reason for a spelling', () => {
    const texts = [
      ...ERROR_CATALOGUE.map((entry) => `${entry.meaning} ${entry.fix ?? ''}`),
      ...COMMANDS.map((command) => command.summary),
      ...(kindsJson()['setKeys'] as Array<{ description: string }>).map((setKey) => setKey.description),
      ...guideText().split('\n'),
    ];
    const decision = texts.filter((text) => /calledDecision|decision link|decisionRef/.test(text));
    expect(decision.length).toBeGreaterThan(5);
    expect(decision.filter((text) => /design-iq|design model/i.test(text))).toEqual([]);
  });
});
