/**
 * The design profile (src/platform/design.ts): design-iq's save gate as a
 * validation profile. Every model in CASES states what design-iq's own
 * validator (@miragon/design-iq-validator checkBpmnXml, the save gate of the
 * live host) says about it: `fail` = at least one ERROR (the save is refused
 * with 422). The design profile must report an error exactly for those (all
 * synthetic).
 *
 * To check the verdicts against design-iq's validator itself, point
 * BPMN_DESIGN_IQ_VALIDATOR at dist/validate.js of the installed package, or
 * at its validate.ts (packages/validator/src of a design-iq checkout with its
 * dependencies installed; Node 22.6+ strips the types):
 *   BPMN_DESIGN_IQ_VALIDATOR=<dir>/node_modules/@miragon/design-iq-validator/dist/validate.js npx vitest run test/design-profile.test.ts
 *   BPMN_DESIGN_IQ_VALIDATOR=<checkout>/packages/validator/src/validate.ts npx vitest run test/design-profile.test.ts
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyToXml } from '../src/api.js';
import { Doc } from '../src/document.js';
import { guideTopic, kindsJson } from '../src/guide.js';
import { CONTENT_CONFIG_FILE, CONTENT_CONFIG_FILES, resolveProfile } from '../src/index.js';
import { checkFile, mutateFile } from '../src/node/files.js';
import { findContentRepo, resolveFileProfile } from '../src/node/repo.js';
import { mutateDoc } from '../src/pipeline.js';
import { designFindings } from '../src/platform/design.js';
import { modelsFolderOf } from '../src/platform/repo.js';

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
  return (await mutateDoc(await Doc.fromXml(xml), [], { layout: 'full', profile: 'none', force: true })).xml;
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
  /** changes the drawn XML (what the engine cannot write: id-less flows, a duplicate attribute) */
  post?: (xml: string) => string;
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
  { name: 'documentation text that looks like a prefixed attribute (design-iq scans the raw text)', xml: defs(proc(LINE.replace('<bpmn:task id="A" />', '<bpmn:task id="A"><bpmn:documentation>Set key app:mode="prod" first</bpmn:documentation></bpmn:task>'))), codes: ['E_DESIGN_NAMESPACE'], designIq: 'fail' },
  { name: 'a CDATA section with a prefixed element', xml: defs(proc(LINE.replace('<bpmn:task id="A" />', '<bpmn:task id="A"><bpmn:documentation><![CDATA[Example: <xs:element name="a"/>]]></bpmn:documentation></bpmn:task>'))), codes: ['E_DESIGN_NAMESPACE'], designIq: 'fail' },
  { name: 'a condition ${x:y="z"} (no whitespace before the prefix)', xml: defs(proc([n('startEvent', 'S'), n('task', 'A'), n('endEvent', 'E'), f('F1', 'S', 'A'), '<bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="E"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${x:y="z"}</bpmn:conditionExpression></bpmn:sequenceFlow>'].join('\n'))), codes: [], designIq: 'pass' },
  {
    name: 'sequence flows without id: design-iq counts one flow per id (the last one)',
    xml: defs(proc(LINE)),
    post: (xml) => xml.replace(/<bpmn:sequenceFlow id="F[12]"/g, '<bpmn:sequenceFlow').replace(/\s*<bpmndi:BPMNEdge id="[^"]*" bpmnElement="F[12]">[\s\S]*?<\/bpmndi:BPMNEdge>/g, ''),
    codes: ['E_DESIGN_DEAD_END', 'E_DESIGN_UNREACHABLE'],
    designIq: 'fail',
  },
  {
    name: 'a second collaboration whose pool has no shape',
    xml: defs(`<bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>\n<bpmn:collaboration id="C2"><bpmn:participant id="Other" /></bpmn:collaboration>\n${proc(LINE)}`),
    codes: ['E_DESIGN_NO_DI'],
    designIq: 'fail',
  },
  {
    name: 'an attribute written twice: not well-formed, nothing else is checked',
    xml: defs(proc(LINE)),
    post: (xml) => xml.replace('<bpmn:task id="A"', '<bpmn:task id="A" name="One" name="Two"'),
    codes: ['E_DESIGN_XML'],
    designIq: 'fail',
  },
  { name: 'a lane member written with whitespace around its id', xml: LANES({ a: ['S', 'A'], b: ['\n          E\n        '] }), codes: [], designIq: 'pass' },
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
    if (c.post) xml = c.post(xml);
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

  it('the namespace check runs on the raw text like design-iq\'s: text, CDATA, comments and attribute values count', async () => {
    const found = async (body: string): Promise<string[]> => designFindings(await Doc.fromXml(defs(proc(LINE.replace('<bpmn:task id="A" />', body))))).filter((x) => x.code === 'E_DESIGN_NAMESPACE').map((x) => `${x.element}: ${x.message}`);
    expect(await found('<bpmn:task id="A"><bpmn:documentation>Set key app:mode="prod" before you start</bpmn:documentation></bpmn:task>')).toEqual([
      'A: design-iq\'s namespace check reads `app:mode="` in the text of <bpmn:documentation> of A as the namespace prefix app:, which the file never declares (it scans the raw text, not only the markup); design-iq refuses to save the file',
    ]);
    expect(await found('<bpmn:task id="A"><bpmn:documentation><![CDATA[Example: <xs:element name="a"/> ]]></bpmn:documentation></bpmn:task>')).toEqual([expect.stringContaining('`<xs:element` in a CDATA section of <bpmn:documentation> of A as the namespace prefix xs:')]);
    expect(await found('<bpmn:task id="A"><!-- <camunda:inputOutput/> --></bpmn:task>')).toEqual([expect.stringContaining('`<camunda:inputOutput` in an XML comment of <bpmn:task> A as the namespace prefix camunda:')]);
    expect(await found(`<bpmn:task id="A" name='Say x:y="hi"' />`)).toEqual([expect.stringContaining('`x:y="` in an attribute value of <bpmn:task> A as the namespace prefix x:')]);
    // what design-iq's expressions do not match passes: no whitespace before the prefix, no quote after `=`, a declared prefix, xml:
    expect(await found('<bpmn:task id="A"><bpmn:documentation>${x:y="z"} and app:mode=prod and a &lt;b&gt;</bpmn:documentation></bpmn:task>')).toEqual([]);
    expect(designFindings(await Doc.fromXml(defs(proc(LINE.replace('<bpmn:task id="A" />', '<bpmn:task id="A"><bpmn:documentation>Use app:mode="x"</bpmn:documentation></bpmn:task>')), 'xmlns:app="http://example.com/app"'))).filter((x) => x.code === 'E_DESIGN_NAMESPACE')).toEqual([]);
    expect(await found('<bpmn:task id="A"><bpmn:documentation xml:lang="de">Text</bpmn:documentation></bpmn:task>')).toEqual([]);
  });

  it('a write whose text design-iq\'s namespace check refuses is refused (documentation, annotation text, CDATA)', async () => {
    const xml = await withDi(defs(proc(LINE)));
    const opts = { profile: 'design' as const, contentRepo: { processIds: ['order'], decisionIds: [] }, file: 'models/order.bpmn' };
    const refusal = async (ops: Parameters<typeof applyToXml>[1], base = xml): Promise<string[]> => {
      try {
        await applyToXml(base, ops, opts);
        return [];
      } catch (err) {
        const e = err as { code?: string; details?: { errors?: Array<{ code: string; validator?: string }> } };
        expect(e.code).toBe('E_VALIDATION');
        return (e.details?.errors ?? []).map((x) => `${x.validator}:${x.code}`);
      }
    };
    expect(await refusal([{ op: 'set', id: 'A', values: { doc: 'Set key app:mode="prod" before you start' } }])).toEqual(['design:E_DESIGN_NAMESPACE']);
    expect(await refusal([{ op: 'add', kind: 'userTask', name: 'Review', after: 'A', doc: 'Use cfg:level="high"' }])).toEqual(['design:E_DESIGN_NAMESPACE']);
    expect(await refusal([{ op: 'add', kind: 'textAnnotation', text: 'Rule: ns:attr="x" applies', in: 'P' }])).toEqual(['design:E_DESIGN_NAMESPACE']);
    // the text step keeps CDATA, so the new documentation is written as a literal <xs:element
    const cdata = await withDi(defs(proc(LINE.replace('<bpmn:task id="A" />', '<bpmn:task id="A"><bpmn:documentation><![CDATA[Old note]]></bpmn:documentation></bpmn:task>'))));
    expect(await refusal([{ op: 'set', id: 'A', values: { doc: 'Template: <xs:element name="a"/> here' } }], cdata)).toEqual(['design:E_DESIGN_NAMESPACE']);
    // the same texts without what design-iq's expressions match are written
    expect((await applyToXml(xml, [{ op: 'set', id: 'A', values: { doc: 'Set key app: mode=prod before you start' } }], opts)).unchanged).toBe(false);
    expect((await applyToXml(xml, [{ op: 'add', kind: 'userTask', name: 'Review', after: 'A', doc: 'Template ${x:y="z"}' }], opts)).unchanged).toBe(false);
  });

  it('a node in no lane of two lane sets is reported (design-iq checks no lanes of a process with two lane sets: a documented difference)', async () => {
    const xml = await withDi(defs(proc(`<bpmn:laneSet id="LS1"><bpmn:lane id="La"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>A</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet><bpmn:laneSet id="LS2"><bpmn:lane id="Lb" /></bpmn:laneSet>\n${LINE}`)));
    expect(designFindings(await Doc.fromXml(xml)).map((x) => [x.code, x.element])).toContainEqual(['E_DESIGN_NOT_IN_LANE', 'E']);
  });

  it('says why a node lacks a flow when design-iq does not count a flow without id', async () => {
    const xml = await prepare(CASES.find((c) => c.name.startsWith('sequence flows without id'))!);
    const found = designFindings(await Doc.fromXml(xml));
    expect(found.find((x) => x.element === 'S')!.message).toBe(
      'startEvent S has no outgoing sequence flow (it has a sequence flow without id, but design-iq counts one sequence flow per id: give each flow an id of its own, `bpmn layout <file>` gives one to each flow without)',
    );
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

describe('design profile: content repositories (designiq.yml, legacy bpmiq.yml)', () => {
  it('reads the models folder (design-iq\'s models ?? processes)', () => {
    expect(modelsFolderOf('models: processes\n')).toBe('processes');
    expect(modelsFolderOf('processes: "flows/" # legacy\n')).toBe('flows');
    expect(modelsFolderOf('processes: legacy\nmodels: ./m\n')).toBe('m');
    expect(modelsFolderOf('models: .\n')).toBe('.');
    expect(modelsFolderOf('models: ../outside\n')).toBeUndefined();
    expect(modelsFolderOf('models: /abs\n')).toBeUndefined();
    expect(modelsFolderOf('name: x\n  models: nested\n')).toBeUndefined();
    // design-iq reads `models ?? processes`: an empty or null `models` is no key, a quoted empty one names no folder
    expect(modelsFolderOf('models:\nprocesses: p\n')).toBe('p');
    expect(modelsFolderOf('models: ~\nprocesses: p\n')).toBe('p');
    expect(modelsFolderOf('models: null\nprocesses: p\n')).toBe('p');
    expect(modelsFolderOf('models: NULL # later\nprocesses: p\n')).toBe('p');
    expect(modelsFolderOf('models:   # later\nprocesses: p\n')).toBe('p');
    expect(modelsFolderOf('models: ""\nprocesses: p\n')).toBeUndefined();
    expect(modelsFolderOf('models: "~"\n')).toBe('~');
    expect(modelsFolderOf('models:\n')).toBeUndefined();
    expect(modelsFolderOf('models:\n  # later\nprocesses: p\n')).toBe('p');
    // a value on the next lines (indented, or a `- ` list) is not read: the key is there and names no folder
    expect(modelsFolderOf('models:\n  other\nprocesses: p\n')).toBeUndefined();
    expect(modelsFolderOf('models:\n- other\nprocesses: p\n')).toBeUndefined();
    expect(modelsFolderOf('models:\r\n  # c\r\n  - other\r\nprocesses: p\r\n')).toBeUndefined();
    // a # inside quotes is part of the value
    expect(modelsFolderOf("models: 'a # b' # c\n")).toBe('a # b');
    // a byte order mark before the first key
    expect(modelsFolderOf('\uFEFFmodels: processes\n')).toBe('processes');
  });

  it('the contract file names: designiq.yml, then the legacy bpmiq.yml', () => {
    expect(CONTENT_CONFIG_FILES).toEqual(['designiq.yml', 'bpmiq.yml']);
    expect(CONTENT_CONFIG_FILE).toBe('designiq.yml');
    // a host that gives a root but no contract file name: the documented name
    expect(resolveProfile('auto', { root: '/r' }).detail).toBe('designiq.yml in /r: a design-iq content repository');
    expect(resolveProfile('auto', { root: '/r', config: 'bpmiq.yml' }).detail).toBe('bpmiq.yml in /r: a design-iq content repository');
    expect(resolveProfile('design', { root: '/r', config: 'bpmiq.yml' }).detail).toBe('--profile design; links checked against the models of bpmiq.yml in /r');
    expect(resolveProfile('auto', {}).detail).toBe('the content repository given by the host: a design-iq content repository');
    expect(guideTopic('design')).toContain('designiq.yml');
    expect(guideTopic('design')).not.toContain('@bpmiq/');
    const auto = (kindsJson()['profiles'] as Array<{ profile: string; description: string }>).find((p) => p.profile === 'auto');
    expect(auto?.description).toContain('designiq.yml');
  });

  it('auto runs the design profile for the models of a content repository only; links are checked against its .bpmn / .dmn stems', async () => {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'processes', 'sales'), { recursive: true });
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'designiq.yml'), 'models: processes\n');
    writeFileSync(join(repo, 'processes', 'sales', 'billing.bpmn'), defs(proc('')));
    writeFileSync(join(repo, 'processes', 'risk.dmn'), '<definitions />');
    const xml = await withDi(defs(proc([n('startEvent', 'S'), n('callActivity', 'C', 'calledElement="billing"'), n('businessRuleTask', 'R', 'calledDecision="fraud"'), n('endEvent', 'E'), f('F1', 'S', 'C'), f('F2', 'C', 'R'), f('F3', 'R', 'E')].join('\n'))));
    const model = join(repo, 'processes', 'order.bpmn');
    const outside = join(repo, 'docs', 'order.bpmn');
    writeFileSync(model, xml);
    writeFileSync(outside, xml);

    expect(findContentRepo(model)).toEqual({ root: repo, models: join(repo, 'processes'), config: 'designiq.yml' });
    expect(findContentRepo(outside)).toBeUndefined();
    expect(resolveFileProfile('auto', model)).toMatchObject({ profile: 'design', source: 'content-repo', repo: { config: 'designiq.yml' } });
    expect(resolveFileProfile('none', model)).toMatchObject({ profile: 'none', source: 'option' });
    expect(resolveFileProfile('auto', outside)).toMatchObject({ profile: 'none', source: 'none' });

    const inRepo = await checkFile(model);
    expect(inRepo.validation.warnings.map((w) => [w.code, w.element])).toEqual([['W_DESIGN_DECISION_LINK', 'R']]);
    expect(inRepo.validation.validators?.[0]?.detail).toBe(`designiq.yml in ${repo}: a design-iq content repository`);
    expect(inRepo.profile).toMatchObject({ profile: 'design', repo: { root: repo, config: 'designiq.yml' } });
    expect((await checkFile(outside)).validation.validators).toBeUndefined();
    expect((await checkFile(model, { profile: 'none' })).validation.validators).toBeUndefined();
    // --profile design outside a repository: no repository, no link check
    expect((await checkFile(outside, { profile: 'design' })).validation.warnings.map((w) => w.code)).toEqual([]);
  });

  /** A content repository at `dir/name` with the given contract files, holding a drawn model `processes/order.bpmn` (start -> A -> end) under `models`. */
  async function contentRepo(name: string, files: Record<string, string>, models = 'processes'): Promise<{ repo: string; model: string }> {
    const repo = join(dir, name);
    mkdirSync(join(repo, models), { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(repo, file), text);
    const model = join(repo, models, 'order.bpmn');
    writeFileSync(model, await withDi(defs(proc(LINE))));
    return { repo, model };
  }
  const DANGLING = [{ op: 'add' as const, kind: 'task', name: 'Dangling', in: 'P' }];
  const NO_REPO = 'not a model of a design-iq content repository (no designiq.yml or legacy bpmiq.yml above the file, or the nearest one names no models folder that holds it)';

  it('a designiq.yml repository gets the design gate: a dangling task is refused (issue #30)', async () => {
    const { repo, model } = await contentRepo('gate', { 'designiq.yml': 'models: processes\n' });
    const err = await mutateFile(model, DANGLING, { dryRun: true }).then(() => undefined, (e: unknown) => e as { code: string; details: Record<string, unknown> });
    expect(err?.code).toBe('E_VALIDATION');
    expect((err?.details['errors'] as Array<{ code: string; validator?: string }>).map((e) => `${e.validator} ${e.code}`)).toEqual(['design E_DESIGN_UNREACHABLE', 'design E_DESIGN_DEAD_END']);
    const ok = await mutateFile(model, [{ op: 'add', kind: 'task', name: 'Check', after: 'A' }], { dryRun: true });
    expect(ok.validation.validators?.[0]).toMatchObject({ name: 'design', detail: `designiq.yml in ${repo}: a design-iq content repository`, errors: [] });
  });

  it('the legacy bpmiq.yml alone is still a content repository, named as such', async () => {
    const { repo, model } = await contentRepo('legacy', { 'bpmiq.yml': 'models: processes\n' });
    expect(findContentRepo(model)).toEqual({ root: repo, models: join(repo, 'processes'), config: 'bpmiq.yml' });
    expect(resolveFileProfile('auto', model)).toMatchObject({ profile: 'design', source: 'content-repo', detail: `bpmiq.yml in ${repo}: a design-iq content repository` });
    expect((await checkFile(model)).validation.validators?.[0]?.detail).toBe(`bpmiq.yml in ${repo}: a design-iq content repository`);
    await expect(mutateFile(model, DANGLING, { dryRun: true })).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });

  it('with both names designiq.yml is read, also when the two disagree', async () => {
    const agree = await contentRepo('both-agree', { 'designiq.yml': 'models: processes\n', 'bpmiq.yml': 'models: processes\n' });
    expect(findContentRepo(agree.model)).toMatchObject({ root: agree.repo, config: 'designiq.yml' });
    // designiq.yml names models/, bpmiq.yml processes/: a file in processes/ is no model
    const disagree = await contentRepo('both-disagree', { 'designiq.yml': 'models: models\n', 'bpmiq.yml': 'models: processes\n' });
    expect(findContentRepo(disagree.model)).toBeUndefined();
    expect(resolveFileProfile('auto', disagree.model)).toMatchObject({ profile: 'none', source: 'none' });
    await expect(mutateFile(disagree.model, DANGLING, { dryRun: true })).resolves.toMatchObject({ validation: { errors: [] } });
    const other = join(disagree.repo, 'models', 'other.bpmn');
    mkdirSync(join(disagree.repo, 'models'), { recursive: true });
    writeFileSync(other, defs(proc(LINE)));
    expect(findContentRepo(other)).toEqual({ root: disagree.repo, models: join(disagree.repo, 'models'), config: 'designiq.yml' });
  });

  it('a designiq.yml that names no usable folder makes no content repository: no fallback to bpmiq.yml, nothing above is read', async () => {
    const broken: Array<[string, string]> = [
      ['no-key', 'name: claims\n'],
      ['outside', 'models: ../x\n'],
      ['empty', 'models: ""\n'],
      ['elsewhere', 'models: models\n'],
    ];
    // a valid contract one level up must not be consulted either
    writeFileSync(join(dir, 'designiq.yml'), 'models: .\n');
    try {
      for (const [name, text] of broken) {
        const { model } = await contentRepo(`broken-${name}`, { 'designiq.yml': text, 'bpmiq.yml': 'models: processes\n' });
        expect(findContentRepo(model), name).toBeUndefined();
        const info = resolveFileProfile('auto', model);
        expect(info, name).toMatchObject({ profile: 'none', source: 'none' });
        expect(info.detail).toBe(NO_REPO);
        await expect(mutateFile(model, DANGLING, { dryRun: true }), name).resolves.toMatchObject({ validation: { errors: [] } });
      }
      // an unreadable designiq.yml (a superuser reads it anyway)
      if (process.getuid?.() !== 0) {
        const { repo, model } = await contentRepo('broken-unreadable', { 'designiq.yml': 'models: processes\n', 'bpmiq.yml': 'models: processes\n' });
        chmodSync(join(repo, 'designiq.yml'), 0o000);
        try {
          expect(findContentRepo(model)).toBeUndefined();
        } finally {
          chmodSync(join(repo, 'designiq.yml'), 0o644);
        }
      }
    } finally {
      rmSync(join(dir, 'designiq.yml'));
    }
  });

  it('a directory that carries a contract name is no contract file', async () => {
    // a directory named designiq.yml beside a bpmiq.yml file: the bpmiq.yml is read
    const { repo, model } = await contentRepo('dir-designiq', { 'bpmiq.yml': 'models: processes\n' });
    mkdirSync(join(repo, 'designiq.yml'));
    expect(findContentRepo(model)).toEqual({ root: repo, models: join(repo, 'processes'), config: 'bpmiq.yml' });
    // a directory named bpmiq.yml in the models folder does not stop the walk: the contract file above is found
    const nested = await contentRepo('dir-bpmiq', { 'designiq.yml': 'models: processes\n' });
    mkdirSync(join(nested.repo, 'processes', 'bpmiq.yml'));
    expect(findContentRepo(nested.model)).toEqual({ root: nested.repo, models: join(nested.repo, 'processes'), config: 'designiq.yml' });
    expect(resolveFileProfile('auto', nested.model)).toMatchObject({ profile: 'design', source: 'content-repo' });
  });

  it('the nearest contract file above the file decides (a nested repository); an outer one is not read', async () => {
    const outer = await contentRepo('outer', { 'designiq.yml': 'models: .\n' });
    const inner = join(outer.repo, 'processes', 'inner');
    mkdirSync(join(inner, 'models'), { recursive: true });
    writeFileSync(join(inner, 'bpmiq.yml'), 'models: models\n');
    const innerModel = join(inner, 'models', 'order.bpmn');
    writeFileSync(innerModel, defs(proc(LINE)));
    expect(findContentRepo(innerModel)).toEqual({ root: inner, models: join(inner, 'models'), config: 'bpmiq.yml' });
    // a file of the inner repository outside its models folder: the outer designiq.yml (models: .) is not consulted
    const stray = join(inner, 'stray.bpmn');
    writeFileSync(stray, defs(proc(LINE)));
    expect(findContentRepo(stray)).toBeUndefined();
    expect(resolveFileProfile('auto', stray).detail).toBe(NO_REPO);
    expect(findContentRepo(outer.model)).toEqual({ root: outer.repo, models: outer.repo, config: 'designiq.yml' });
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

