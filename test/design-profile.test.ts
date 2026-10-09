/**
 * The design profile (src/platform/design.ts): design-iq's save gate as a
 * validation profile. Every model in CASES states what design-iq's own
 * validator (@bpmiq/validator checkBpmnXml, the save gate of the live host)
 * says about it: `fail` = at least one ERROR (the save is refused with 422).
 * The design profile must report an error exactly for those (all synthetic).
 *
 * To check the verdicts against design-iq's validator itself, point
 * BPMN_DESIGN_IQ_VALIDATOR at its validate.ts (packages/validator/src of a
 * design-iq checkout with its dependencies installed; Node 22.6+ strips the
 * types):
 *   BPMN_DESIGN_IQ_VALIDATOR=<checkout>/packages/validator/src/validate.ts npx vitest run test/design-profile.test.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { checkFile, mutateDoc } from '../src/pipeline.js';
import { designFindings } from '../src/platform/design.js';
import { findContentRepo, modelsFolderOf, resolveProfile } from '../src/platform/repo.js';

const ROOT = join(import.meta.dirname, '..');
const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

function defs(roots: string, ns = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} ${ns} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${roots}
</bpmn:definitions>`;
}

const n = (tag: string, id: string, extra = ''): string => `<bpmn:${tag} id="${id}"${extra ? ` ${extra}` : ''} />`;
const f = (id: string, source: string, target: string): string => `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;
const proc = (body: string, id = 'P'): string => `<bpmn:process id="${id}" isExecutable="false">\n${body}\n</bpmn:process>`;
/** start -> A -> end */
const LINE = [n('startEvent', 'S'), n('task', 'A'), n('endEvent', 'E'), f('F1', 'S', 'A'), f('F2', 'A', 'E')].join('\n');

/** The model with a complete diagram (drawn by the clean engine). */
async function withDi(xml: string): Promise<string> {
  return (await mutateDoc(await Doc.fromXml(xml), [], { dryRun: true, layout: 'full', profile: 'none', force: true })).xml;
}

interface Case {
  name: string;
  xml: string;
  /** design profile codes, sorted */
  codes: string[];
  /** design-iq's validator: fail = at least one ERROR */
  designIq: 'pass' | 'fail';
  /** the case is drawn by the engine first (default true) */
  di?: boolean;
  /** design-iq's number of ERRORs, when it is not the number of E_ codes (it reports several start events once per process) */
  diqErrors?: number;
}

const tasks = (k: number): string =>
  [n('startEvent', 'S'), ...Array.from({ length: k }, (_, i) => n('task', `T${i}`)), n('endEvent', 'E'), ...Array.from({ length: k + 1 }, (_, i) => f(`F${i}`, i === 0 ? 'S' : `T${i - 1}`, i === k ? 'E' : `T${i}`))].join('\n');

const LANES = (members: { a: string[]; b: string[] }, body = LINE, extraLane = ''): string =>
  defs(`<bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>
${proc(`<bpmn:laneSet id="LS"><bpmn:lane id="La">${members.a.map((m) => `<bpmn:flowNodeRef>${m}</bpmn:flowNodeRef>`).join('')}</bpmn:lane><bpmn:lane id="Lb">${members.b.map((m) => `<bpmn:flowNodeRef>${m}</bpmn:flowNodeRef>`).join('')}${extraLane}</bpmn:lane></bpmn:laneSet>\n${body}`)}`);

const CASES: Case[] = [
  { name: 'start -> task -> end', xml: defs(proc(LINE)), codes: [], designIq: 'pass' },
  { name: 'an empty process', xml: defs(proc('')), codes: [], designIq: 'pass' },
  { name: 'no start event', xml: defs(proc([n('task', 'A'), n('endEvent', 'E'), f('F1', 'A', 'E')].join('\n'))), codes: ['E_DESIGN_START_EVENTS', 'E_DESIGN_UNREACHABLE'], designIq: 'fail' },
  { name: 'a second start event (one finding on each)', xml: defs(proc([LINE, n('startEvent', 'S2'), f('F3', 'S2', 'A')].join('\n'))), codes: ['E_DESIGN_START_EVENTS', 'E_DESIGN_START_EVENTS'], designIq: 'fail', diqErrors: 1 },
  { name: 'a second, message start event', xml: defs(proc([LINE, '<bpmn:startEvent id="S2"><bpmn:messageEventDefinition id="MD" /></bpmn:startEvent>', f('F3', 'S2', 'A')].join('\n'))), codes: ['E_DESIGN_START_EVENTS', 'E_DESIGN_START_EVENTS'], designIq: 'fail', diqErrors: 1 },
  { name: 'a dead end', xml: defs(proc([n('startEvent', 'S'), n('task', 'A'), f('F1', 'S', 'A')].join('\n'))), codes: ['E_DESIGN_DEAD_END'], designIq: 'fail' },
  { name: 'an unconnected task', xml: defs(proc([LINE, n('task', 'X')].join('\n'))), codes: ['E_DESIGN_DEAD_END', 'E_DESIGN_UNREACHABLE'], designIq: 'fail' },
  { name: 'a loop without entry is not unreachable (degree check, not reachability)', xml: defs(proc([LINE, n('task', 'X'), n('task', 'Y'), f('F3', 'X', 'Y'), f('F4', 'Y', 'X')].join('\n'))), codes: [], designIq: 'pass' },
  { name: 'a boundary event without outgoing flow', xml: defs(proc([LINE, '<bpmn:boundaryEvent id="B" attachedToRef="A"><bpmn:timerEventDefinition id="TD"><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>'].join('\n'))), codes: ['E_DESIGN_DEAD_END'], designIq: 'fail' },
  { name: 'a boundary event with its path', xml: defs(proc([LINE, '<bpmn:boundaryEvent id="B" attachedToRef="A"><bpmn:timerEventDefinition id="TD"><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>', n('endEvent', 'E2'), f('F3', 'B', 'E2')].join('\n'))), codes: [], designIq: 'pass' },
  {
    name: 'an event sub-process (its own start, never connected)',
    xml: defs(proc([LINE, `<bpmn:subProcess id="ESP" triggeredByEvent="true">${['<bpmn:startEvent id="ES"><bpmn:messageEventDefinition id="EMD" /></bpmn:startEvent>', n('task', 'ET'), n('endEvent', 'EE'), f('EF1', 'ES', 'ET'), f('EF2', 'ET', 'EE')].join('')}</bpmn:subProcess>`].join('\n'))),
    codes: [],
    designIq: 'pass',
  },
  {
    name: 'a dead end inside an event sub-process',
    xml: defs(proc([LINE, `<bpmn:subProcess id="ESP" triggeredByEvent="true">${['<bpmn:startEvent id="ES"><bpmn:messageEventDefinition id="EMD" /></bpmn:startEvent>', n('task', 'ET'), f('EF1', 'ES', 'ET')].join('')}</bpmn:subProcess>`].join('\n'))),
    codes: ['E_DESIGN_DEAD_END'],
    designIq: 'fail',
  },
  {
    name: 'an embedded sub-process with two start events',
    xml: defs(proc([n('startEvent', 'S'), `<bpmn:subProcess id="Sub">${[n('startEvent', 'S1'), n('startEvent', 'S2'), n('task', 'I'), n('endEvent', 'IE'), f('G1', 'S1', 'I'), f('G2', 'S2', 'I'), f('G3', 'I', 'IE')].join('')}</bpmn:subProcess>`, n('endEvent', 'E'), f('F1', 'S', 'Sub'), f('F2', 'Sub', 'E')].join('\n'))),
    codes: ['E_DESIGN_START_EVENTS', 'E_DESIGN_START_EVENTS'],
    designIq: 'fail',
    diqErrors: 1,
  },
  {
    name: 'an embedded sub-process without start event: its first node is unreachable',
    xml: defs(proc([n('startEvent', 'S'), `<bpmn:subProcess id="Sub">${[n('task', 'I'), n('endEvent', 'IE'), f('G1', 'I', 'IE')].join('')}</bpmn:subProcess>`, n('endEvent', 'E'), f('F1', 'S', 'Sub'), f('F2', 'Sub', 'E')].join('\n'))),
    codes: ['E_DESIGN_UNREACHABLE'],
    designIq: 'fail',
  },
  {
    name: 'compensation: boundary event, association and handler (valid BPMN, a design-iq error)',
    xml: defs(proc([LINE, '<bpmn:boundaryEvent id="CB" attachedToRef="A"><bpmn:compensateEventDefinition id="CD" /></bpmn:boundaryEvent>', n('task', 'H', 'isForCompensation="true"'), '<bpmn:association id="AS" associationDirection="One" sourceRef="CB" targetRef="H" />'].join('\n'))),
    codes: ['E_DESIGN_DEAD_END', 'E_DESIGN_DEAD_END', 'E_DESIGN_UNREACHABLE'],
    designIq: 'fail',
  },
  {
    name: 'a link event pair (valid BPMN, a design-iq error)',
    xml: defs(proc([n('startEvent', 'S'), '<bpmn:intermediateThrowEvent id="LT"><bpmn:linkEventDefinition id="LTD" name="L" /></bpmn:intermediateThrowEvent>', '<bpmn:intermediateCatchEvent id="LC"><bpmn:linkEventDefinition id="LCD" name="L" /></bpmn:intermediateCatchEvent>', n('endEvent', 'E'), f('F1', 'S', 'LT'), f('F2', 'LC', 'E')].join('\n'))),
    codes: ['E_DESIGN_DEAD_END', 'E_DESIGN_UNREACHABLE'],
    designIq: 'fail',
  },
  {
    name: 'an ad-hoc sub-process with unconnected content (valid BPMN, a design-iq error)',
    xml: defs(proc([n('startEvent', 'S'), `<bpmn:adHocSubProcess id="AH">${[n('task', 'H1'), n('task', 'H2')].join('')}</bpmn:adHocSubProcess>`, n('endEvent', 'E'), f('F1', 'S', 'AH'), f('F2', 'AH', 'E')].join('\n'))),
    codes: ['E_DESIGN_DEAD_END', 'E_DESIGN_DEAD_END', 'E_DESIGN_UNREACHABLE', 'E_DESIGN_UNREACHABLE'],
    designIq: 'fail',
  },
  { name: 'every node in a lane', xml: LANES({ a: ['S', 'A'], b: ['E'] }), codes: [], designIq: 'pass' },
  { name: 'a node in no lane', xml: LANES({ a: ['S', 'A'], b: [] }), codes: ['E_DESIGN_NOT_IN_LANE'], designIq: 'fail' },
  {
    name: 'a boundary event needs no lane',
    xml: LANES({ a: ['S', 'A'], b: ['E', 'E2'] }, [LINE, '<bpmn:boundaryEvent id="B" attachedToRef="A"><bpmn:timerEventDefinition id="TD"><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>', n('endEvent', 'E2'), f('F3', 'B', 'E2')].join('\n')),
    codes: [],
    designIq: 'pass',
  },
  {
    name: 'a node only in a child lane (design-iq reads the top-level lanes)',
    xml: LANES({ a: ['S', 'A'], b: [] }, LINE, '<bpmn:childLaneSet id="CLS"><bpmn:lane id="Lb1"><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane></bpmn:childLaneSet>'),
    codes: ['E_DESIGN_NOT_IN_LANE'],
    designIq: 'fail',
  },
  { name: '9 activities', xml: defs(proc(tasks(9))), codes: [], designIq: 'pass' },
  { name: '10 activities: a complexity warning', xml: defs(proc(tasks(10))), codes: ['W_DESIGN_COMPLEXITY'], designIq: 'pass' },
  {
    name: 'two pools and a message flow',
    xml: defs(`<bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /><bpmn:participant id="Other" processRef="Q" /><bpmn:messageFlow id="MF" sourceRef="A" targetRef="B" /></bpmn:collaboration>
${proc(LINE)}
${proc([n('startEvent', 'QS'), n('receiveTask', 'B'), n('endEvent', 'QE'), f('Q1', 'QS', 'B'), f('Q2', 'B', 'QE')].join('\n'), 'Q')}`),
    codes: [],
    designIq: 'pass',
  },
  { name: 'a call activity without calledElement (design model)', xml: defs(proc([n('startEvent', 'S'), n('callActivity', 'A'), n('endEvent', 'E'), f('F1', 'S', 'A'), f('F2', 'A', 'E')].join('\n'))), codes: ['W_DESIGN_CALL_LINK'], designIq: 'pass' },
  { name: 'a business rule task without decision (design model)', xml: defs(proc([n('startEvent', 'S'), n('businessRuleTask', 'A'), n('endEvent', 'E'), f('F1', 'S', 'A'), f('F2', 'A', 'E')].join('\n'))), codes: ['W_DESIGN_DECISION_LINK'], designIq: 'pass' },
  { name: 'a business rule task with design-iq\'s calledDecision', xml: defs(proc([n('startEvent', 'S'), n('businessRuleTask', 'A', 'calledDecision="risk"'), n('endEvent', 'E'), f('F1', 'S', 'A'), f('F2', 'A', 'E')].join('\n'))), codes: [], designIq: 'pass' },
  { name: 'no diagram at all', xml: defs(proc(LINE)), codes: ['E_DESIGN_NO_DI', 'E_DESIGN_NO_DI', 'E_DESIGN_NO_DI', 'E_DESIGN_NO_DI', 'E_DESIGN_NO_DI'], designIq: 'fail', di: false },
  { name: 'no process', xml: defs('<bpmn:collaboration id="C"><bpmn:participant id="Pool" /></bpmn:collaboration>'), codes: ['E_DESIGN_NO_PROCESS'], designIq: 'fail', di: false },
];

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-design-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const prepared = new Map<string, string>();
async function prepare(c: Case): Promise<string> {
  let xml = prepared.get(c.name);
  if (xml === undefined) {
    xml = c.di === false ? c.xml : await withDi(c.xml);
    prepared.set(c.name, xml);
  }
  return xml;
}

describe('design profile rules', () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.codes.join(', ') || 'nothing'} (design-iq: ${c.designIq})`, async () => {
      const doc = await Doc.fromXml(await prepare(c));
      const found = designFindings(doc);
      expect(found.map((x) => x.code).sort()).toEqual(c.codes);
      expect(found.some((x) => x.severity === 'error')).toBe(c.designIq === 'fail');
      for (const x of found) expect(x.hint, x.code).toMatch(/`bpmn |--profile none|XML|--force/);
    });
  }

  it('says when design-iq rejects a construct BPMN allows, and that it cannot be connected', async () => {
    const doc = await Doc.fromXml(await prepare(CASES.find((c) => c.name.startsWith('compensation'))!));
    const handler = designFindings(doc).filter((x) => x.element === 'H');
    expect(handler.map((x) => x.message)).toEqual([
      'task H has no incoming sequence flow (design-iq requires it for every node; a compensation handler has no sequence flows in BPMN (it hangs off a compensation boundary event))',
      'task H has no outgoing sequence flow (design-iq requires it for every node; a compensation handler has no sequence flows in BPMN (it hangs off a compensation boundary event))',
    ]);
    expect(handler[0]!.hint).toContain('bpmn remove <file> H');
  });

  it('an undeclared namespace prefix is an error (the content cannot be read)', async () => {
    const doc = await Doc.fromXml(defs(proc(LINE.replace('<bpmn:task id="A"', '<bpmn:task id="A" foo:bar="1"'))));
    expect(designFindings(doc).filter((x) => x.code === 'E_DESIGN_NAMESPACE').map((x) => x.message)).toEqual([
      'The namespace prefix foo: is used but never declared (xmlns:foo="..." is missing); strict XML parsers, design-iq\'s included, reject the file',
    ]);
  });

  it('inside a content repository the links are checked against its models', async () => {
    const xml = await withDi(defs(proc([n('startEvent', 'S'), n('callActivity', 'C1', 'calledElement="billing"'), n('callActivity', 'C2', 'calledElement="shipping"'), n('businessRuleTask', 'R1', 'calledDecision="risk"'), n('businessRuleTask', 'R2', 'calledDecision="fraud"'), n('endEvent', 'E'), f('F1', 'S', 'C1'), f('F2', 'C1', 'C2'), f('F3', 'C2', 'R1'), f('F4', 'R1', 'R2'), f('F5', 'R2', 'E')].join('\n'))));
    const doc = await Doc.fromXml(xml);
    expect(designFindings(doc)).toEqual([]);
    const linked = designFindings(doc, { processIds: ['billing'], decisionIds: ['risk'] });
    expect(linked.map((x) => [x.code, x.element, x.severity])).toEqual([
      ['W_DESIGN_CALL_LINK', 'C2', 'warning'],
      ['W_DESIGN_DECISION_LINK', 'R2', 'warning'],
    ]);
    expect(linked[0]!.message).toBe('callActivity C2 calls shipping, which is not a process of this content repository (external or dangling?)');
  });

  it('the decision and call links of Camunda 7 / 8 files count, and their missing links are the engine profile\'s business', async () => {
    const c7 = await Doc.fromXml(await withDi(defs(proc([n('startEvent', 'S'), n('businessRuleTask', 'R', 'camunda:class="x.Y"'), n('callActivity', 'C'), n('endEvent', 'E'), f('F1', 'S', 'R'), f('F2', 'R', 'C'), f('F3', 'C', 'E')].join('\n')), 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"')));
    expect(designFindings(c7)).toEqual([]);
    const c8 = await Doc.fromXml(
      await withDi(
        defs(
          proc([n('startEvent', 'S'), '<bpmn:businessRuleTask id="R"><bpmn:extensionElements><zeebe:calledDecision decisionId="risk" resultVariable="r" /></bpmn:extensionElements></bpmn:businessRuleTask>', '<bpmn:callActivity id="C"><bpmn:extensionElements><zeebe:calledElement processId="billing" /></bpmn:extensionElements></bpmn:callActivity>', n('endEvent', 'E'), f('F1', 'S', 'R'), f('F2', 'R', 'C'), f('F3', 'C', 'E')].join('\n')),
          'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"',
        ),
      ),
    );
    expect(designFindings(c8, { processIds: ['billing'], decisionIds: ['risk'] })).toEqual([]);
    expect(designFindings(c8, { processIds: [], decisionIds: [] }).map((x) => x.code)).toEqual(['W_DESIGN_DECISION_LINK', 'W_DESIGN_CALL_LINK']);
  });
});

describe('design profile: validate', () => {
  it('validate --profile design reports the errors (exit 2), with the validator name; none and the default report nothing', async () => {
    const file = join(dir, 'dead-end.bpmn');
    writeFileSync(file, await prepare(CASES.find((c) => c.name === 'a dead end')!));
    const plain = await checkFile(file);
    expect(plain.validation.errors).toEqual([]);
    expect(plain.validation.warnings.map((w) => w.code)).toContain('W_DEAD_END');
    expect(plain.profile).toMatchObject({ profile: 'none', source: 'none' });
    const design = await checkFile(file, { profile: 'design' });
    expect(design.validation.errors.map((e) => [e.code, e.element, (e as { validator?: string }).validator])).toEqual([['E_DESIGN_DEAD_END', 'A', 'design']]);
    // the lint warning about the same node is dropped where the design error says it
    expect(design.validation.warnings.map((w) => w.code)).not.toContain('W_DEAD_END');
    expect(design.validation.validators).toEqual([expect.objectContaining({ name: 'design', detail: '--profile design', counts: { errors: 1, warnings: 0 } })]);
    expect(design.layout.status).toBe('ok');

    const r = cli('validate', file, '--profile', 'design');
    expect(r.code).toBe(2);
    expect(r.out).toContain('[design] E_DESIGN_DEAD_END A: task A has no outgoing sequence flow');
    expect(r.out).toContain('validator design (--profile design): 1 error(s), 0 warning(s) in the file');
    const json = JSON.parse(cli('validate', file, '--profile', 'design', '--json').out);
    expect(json.ok).toBe(false);
    expect(json.profile).toEqual({ profile: 'design', source: 'option', detail: '--profile design' });
    expect(json.validators[0].errors[0]).toMatchObject({ code: 'E_DESIGN_DEAD_END', element: 'A', validator: 'design', severity: 'error' });
    expect(cli('validate', file, '--profile', 'none').code).toBe(0);
    const bad = cli('validate', file, '--profile', 'strict');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('expected auto, design, none');
  }, 60000);

  it('the validators see the file\'s own diagram, not the layout dry run', async () => {
    const file = join(dir, 'no-di.bpmn');
    writeFileSync(file, defs(proc(LINE)));
    const report = await checkFile(file, { profile: 'design' });
    expect(report.layout.status).toBe('ok');
    expect(report.validation.errors.map((e) => e.code)).toEqual(Array(5).fill('E_DESIGN_NO_DI'));
  });
});

describe('design profile: content repositories (bpmiq.yml)', () => {
  it('reads the models folder like design-iq', () => {
    expect(modelsFolderOf('models: processes\n')).toBe('processes');
    expect(modelsFolderOf('processes: "flows/" # legacy\n')).toBe('flows');
    expect(modelsFolderOf('processes: legacy\nmodels: ./m\n')).toBe('m');
    expect(modelsFolderOf('models: .\n')).toBe('.');
    expect(modelsFolderOf('models: ../outside\n')).toBeUndefined();
    expect(modelsFolderOf('models: /abs\n')).toBeUndefined();
    expect(modelsFolderOf('name: x\n  models: nested\n')).toBeUndefined();
    expect(modelsFolderOf('models:\nprocesses: p\n')).toBeUndefined();
  });

  it('auto runs the design profile for the models of a content repository only; links are checked against its .bpmn / .dmn stems', async () => {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'processes', 'sales'), { recursive: true });
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'bpmiq.yml'), 'models: processes\n');
    writeFileSync(join(repo, 'processes', 'sales', 'billing.bpmn'), defs(proc('')));
    writeFileSync(join(repo, 'processes', 'risk.dmn'), '<definitions />');
    const xml = await withDi(defs(proc([n('startEvent', 'S'), n('callActivity', 'C', 'calledElement="billing"'), n('businessRuleTask', 'R', 'calledDecision="fraud"'), n('endEvent', 'E'), f('F1', 'S', 'C'), f('F2', 'C', 'R'), f('F3', 'R', 'E')].join('\n'))));
    const model = join(repo, 'processes', 'order.bpmn');
    const outside = join(repo, 'docs', 'order.bpmn');
    writeFileSync(model, xml);
    writeFileSync(outside, xml);

    expect(findContentRepo(model)).toEqual({ root: repo, models: join(repo, 'processes') });
    expect(findContentRepo(outside)).toBeUndefined();
    expect(resolveProfile('auto', model)).toMatchObject({ profile: 'design', source: 'content-repo' });
    expect(resolveProfile('none', model)).toMatchObject({ profile: 'none', source: 'option' });
    expect(resolveProfile('auto', outside)).toMatchObject({ profile: 'none', source: 'none' });

    const inRepo = await checkFile(model);
    expect(inRepo.validation.warnings.map((w) => [w.code, w.element])).toEqual([['W_DESIGN_DECISION_LINK', 'R']]);
    expect(inRepo.validation.validators?.[0]?.detail).toBe(`bpmiq.yml in ${repo}: a design-iq content repository`);
    expect((await checkFile(outside)).validation.validators).toBeUndefined();
    expect((await checkFile(model, { profile: 'none' })).validation.validators).toBeUndefined();
    // --profile design outside a repository: no repository, no link check
    expect((await checkFile(outside, { profile: 'design' })).validation.warnings.map((w) => w.code)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* opt-in: the verdicts against design-iq's own validator               */
/* ------------------------------------------------------------------ */

const DESIGN_IQ = process.env['BPMN_DESIGN_IQ_VALIDATOR'];

describe.runIf(!!DESIGN_IQ)('design-iq validator verdicts (BPMN_DESIGN_IQ_VALIDATOR)', () => {
  it('every case has the verdict design-iq gives', async () => {
    const cases = join(dir, 'verdicts');
    mkdirSync(cases, { recursive: true });
    const files = await Promise.all(
      CASES.map(async (c, i) => {
        const file = join(cases, `case${i}.bpmn`);
        writeFileSync(file, await prepare(c));
        return file;
      }),
    );
    const script = `import { readFileSync } from 'node:fs'; import { checkModel } from ${JSON.stringify(DESIGN_IQ)};
for (const f of process.argv.slice(1)) { const r = checkModel(readFileSync(f, 'utf8'), { path: 'model.bpmn' }) ?? []; console.log(JSON.stringify(r.filter((x) => x.severity === 'ERROR').map((x) => x.message))); }`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, ...files], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const verdicts = r.stdout.trim().split('\n').map((l) => JSON.parse(l) as string[]);
    CASES.forEach((c, i) => expect(verdicts[i]!.length > 0 ? 'fail' : 'pass', `${c.name}: ${verdicts[i]!.join('; ')}`).toBe(c.designIq));
    // and the same number of errors as the design profile (structure, lanes, DI, start events)
    for (const [i, c] of CASES.entries()) {
      const errors = c.diqErrors ?? c.codes.filter((code) => code.startsWith('E_')).length;
      expect(verdicts[i]!.length, `${c.name}: ${verdicts[i]!.join('; ')}`).toBe(errors);
    }
  }, 60000);
});

function cli(...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

