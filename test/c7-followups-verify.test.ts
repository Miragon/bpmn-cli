/**
 * Camunda 7 follow-ups found by the verifier of the follow-up round (each
 * test marked "before" fails on the code before its fix; all models
 * synthetic):
 *
 *  1. the BPMN schema rules on event definitions ran on the definition the
 *     engines act on only: a conditional definition without condition element
 *     (or a link definition without name) next to a timer was not reported.
 *     The engines validate the whole file against the schema before they pick
 *     the acting definition and refuse it; non-executable processes too. New
 *     schema rule: a timer definition with two time elements.
 *  2. hints for extension content of an event definition or loop that has an
 *     id of its own named that id together with the key prefix
 *     (`ext remove <file> Def_T definition.0` fails with E_WRONG_KIND); the
 *     merge hint of duplicates on a nested element had no prefix at all.
 *  3. start events: a transaction without one deploys (it fails when it runs:
 *     runtime W_C7_TRANSACTION_NO_START), an empty embedded sub-process or
 *     process is refused (it was left to the lint); a connected ad-hoc
 *     sub-process is refused, and so is one with a multi-instance loop by
 *     Camunda 7 and CIB seven; the engines skip the rest of an ad-hoc
 *     sub-process with its content (no deploy findings in it).
 *  4. the W_C7_DEPLOY_START_EVENT hint moved the flows of a second start event
 *     to the first one even into a node the first one already reaches: two
 *     parallel flows, and every instance ran that node twice.
 *
 * Every model in CASES states what Camunda 7.24, CIB seven 2.2 and Operaton
 * 2.1.5 do with it (`operaton`: Operaton's verdict where it differs; `run`:
 * what starting the process does). To re-check
 * against live engines set BPMN_C7_ENGINES to their REST roots,
 * comma-separated, e.g.
 *   BPMN_C7_ENGINES=http://localhost:8080/engine-rest npx vitest run test/c7-followups-verify.test.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { mutateDoc } from '../src/pipeline.js';
import { runProfile } from '../src/platform/profile.js';
import { validateDoc } from '../src/validate.js';

const ROOT = join(import.meta.dirname, '..');
const BPMN = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const C7 = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Platform"';

const OPERATON = 'xmlns:operaton="http://operaton.org/schema/1.0/bpmn" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Platform"';

function xml(body: string, o: { roots?: string; id?: string; extra?: string; operaton?: boolean } = {}): string {
  const p = o.operaton ? 'operaton' : 'camunda';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${BPMN} ${o.operaton ? OPERATON : C7} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${o.roots ?? ''}
  <bpmn:process id="${o.id ?? 'P_Verify'}" isExecutable="true" ${p}:historyTimeToLive="180">
${body}
  </bpmn:process>
${o.extra ?? ''}
</bpmn:definitions>`;
}

const flow = (id: string, from: string, to: string): string => `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}" />`;
const UT = (id: string): string => `<bpmn:userTask id="${id}" />`;
/** Start -> `node` (id SP) -> End */
const around = (node: string, extra = ''): string => `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'SP')}${node}${flow('F2', 'SP', 'End')}<bpmn:endEvent id="End" />${extra}`;
/** Start -> U -> End, plus `extra` that nothing connects */
const beside = (extra: string): string => `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'U')}${UT('U')}${flow('F2', 'U', 'End')}<bpmn:endEvent id="End" />${extra}`;
/** Start -> catch event W (with `defs`) -> End */
const catchWith = (defs: string, tag = 'intermediateCatchEvent'): string => `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'W')}<bpmn:${tag} id="W">${defs}</bpmn:${tag}>${flow('F2', 'W', 'End')}<bpmn:endEvent id="End" />`;
const TIMER = '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
const COND_NONE = '<bpmn:conditionalEventDefinition id="CDef" />';
const LINK_NONAME = '<bpmn:linkEventDefinition id="LDef" />';
const TWO_TIMES = '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDate xsi:type="bpmn:tFormalExpression">2030-01-01T00:00:00Z</bpmn:timeDate><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
const NON_EXECUTABLE = (inner: string): string => `<bpmn:process id="P_Other" isExecutable="false"><bpmn:startEvent id="O_S" />${inner}</bpmn:process>`;
const MSG = '<bpmn:message id="M1" name="Verify1" /><bpmn:message id="M2" name="Verify2" />';
const TASK_INNER = `<bpmn:startEvent id="SS" />${UT('T')}<bpmn:endEvent id="SE" />${flow('s1', 'SS', 'T')}${flow('s2', 'T', 'SE')}`;

/* two start events: A stays, B is the second one (see extraStartHint) */
const twoStarts = {
  /** A -> U, B -> U: the verifier's repro */
  same: `<bpmn:startEvent id="A" /><bpmn:startEvent id="B" />${UT('U')}<bpmn:endEvent id="E" />${flow('F1', 'A', 'U')}${flow('F3', 'B', 'U')}${flow('F2', 'U', 'E')}`,
  /** A -> X -> U, B -> U: A reaches U too */
  reach: `<bpmn:startEvent id="A" /><bpmn:startEvent id="B" />${UT('X')}${UT('U')}<bpmn:endEvent id="E" />${flow('F1', 'A', 'X')}${flow('F2', 'X', 'U')}${flow('F3', 'U', 'E')}${flow('F4', 'B', 'U')}`,
  /** A -> U -> E, B -> V -> E2: branches of their own */
  separate: `<bpmn:startEvent id="A" /><bpmn:startEvent id="B" />${UT('U')}${UT('V')}<bpmn:endEvent id="E" /><bpmn:endEvent id="E2" />${flow('F1', 'A', 'U')}${flow('F2', 'U', 'E')}${flow('F3', 'B', 'V')}${flow('F4', 'V', 'E2')}`,
  /** A -> X -> U, B -> Y -> U: B's branch runs into U */
  meet: `<bpmn:startEvent id="A" /><bpmn:startEvent id="B" />${UT('X')}${UT('Y')}${UT('U')}<bpmn:endEvent id="E" />${flow('F1', 'A', 'X')}${flow('F2', 'X', 'U')}${flow('F3', 'U', 'E')}${flow('F4', 'B', 'Y')}${flow('F5', 'Y', 'U')}`,
  /** B -> U (A reaches it) and B -> V (its own) */
  mixed: `<bpmn:startEvent id="A" /><bpmn:startEvent id="B" />${UT('U')}${UT('V')}<bpmn:endEvent id="E" /><bpmn:endEvent id="E2" />${flow('F1', 'A', 'U')}${flow('F2', 'U', 'E')}${flow('F3', 'B', 'U')}${flow('F4', 'B', 'V')}${flow('F5', 'V', 'E2')}`,
};
const inSub = (inner: string): string => around(`<bpmn:subProcess id="SP">${inner}</bpmn:subProcess>`);
const ESP_TWO = `<bpmn:startEvent id="Start" />${UT('W')}<bpmn:endEvent id="End" />${flow('G1', 'Start', 'W')}${flow('G2', 'W', 'End')}<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="A" isInterrupting="false"><bpmn:messageEventDefinition messageRef="M1" /></bpmn:startEvent><bpmn:startEvent id="B" isInterrupting="false"><bpmn:messageEventDefinition messageRef="M2" /></bpmn:startEvent>${UT('U')}<bpmn:endEvent id="SE" />${flow('F1', 'A', 'U')}${flow('F3', 'B', 'U')}${flow('F2', 'U', 'SE')}</bpmn:subProcess>`;

interface Case {
  name: string;
  xml: string;
  /** the profile codes the model must produce (sorted multiset) */
  codes: string[];
  /** what Camunda 7.24, CIB seven 2.2 and Operaton 2.1.5 do with the file */
  engine: 'reject' | 'accept';
  /** Operaton's verdict where it differs (an Operaton-namespace file is checked the way Operaton reads it) */
  operaton?: 'reject' | 'accept';
  /** what starting the process does (engine 'accept' only) */
  run?: 'fails' | 'ok';
  /** fails on the code before the fix */
  before?: boolean;
}

const MULTIPLE = 'W_C7_MULTIPLE_EVENT_DEFINITIONS';

const CASES: Case[] = [
  // 1. schema rules on every event definition
  { name: 'timer + conditional without condition (intermediate catch)', xml: xml(catchWith(TIMER + COND_NONE)), codes: [MULTIPLE, 'W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject', before: true },
  { name: 'conditional without condition + timer (intermediate catch, the timer acts)', xml: xml(catchWith(COND_NONE + TIMER)), codes: [MULTIPLE, 'W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject', before: true },
  { name: 'timer + conditional without condition (boundary event)', xml: xml(beside(`<bpmn:boundaryEvent id="W" attachedToRef="U">${TIMER}${COND_NONE}</bpmn:boundaryEvent>${flow('FB', 'W', 'EB')}<bpmn:endEvent id="EB" />`)), codes: [MULTIPLE, 'W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject', before: true },
  { name: 'timer + conditional without condition (process start event)', xml: xml(`<bpmn:startEvent id="W">${TIMER}${COND_NONE}</bpmn:startEvent>${flow('F1', 'W', 'End')}<bpmn:endEvent id="End" />`), codes: [MULTIPLE, 'W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject', before: true },
  { name: 'timer + link without name (intermediate catch)', xml: xml(catchWith(TIMER + LINK_NONAME)), codes: [MULTIPLE, 'W_C7_DEPLOY_LINK'], engine: 'reject', before: true },
  { name: 'timer with timeDate and timeDuration', xml: xml(catchWith(TWO_TIMES)), codes: ['W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject', before: true },
  { name: 'event sub-process start: message acts, an ignored timer with two time elements', xml: xml(beside(`<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="W" isInterrupting="false"><bpmn:messageEventDefinition messageRef="M1" />${TWO_TIMES}</bpmn:startEvent>${flow('e1', 'W', 'ESE')}<bpmn:endEvent id="ESE" /></bpmn:subProcess>`), { roots: MSG }), codes: [MULTIPLE, 'W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject', before: true },
  { name: 'conditional without condition in a non-executable process', xml: xml(beside(''), { extra: NON_EXECUTABLE(`<bpmn:intermediateCatchEvent id="O_W">${COND_NONE}</bpmn:intermediateCatchEvent>${flow('O_F', 'O_S', 'O_W')}`) }), codes: ['W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject', before: true },
  { name: 'link without name in a non-executable process', xml: xml(beside(''), { extra: NON_EXECUTABLE(`<bpmn:intermediateThrowEvent id="O_W">${LINK_NONAME}</bpmn:intermediateThrowEvent>${flow('O_F', 'O_S', 'O_W')}`) }), codes: ['W_C7_DEPLOY_LINK'], engine: 'reject', before: true },
  { name: 'semantic rules stay on the acting definition: timer + message without messageRef', xml: xml(catchWith(`${TIMER}<bpmn:messageEventDefinition id="MDef" />`)), codes: [MULTIPLE], engine: 'accept' },
  // 2. a duplicate on a loop with an id of its own (the hints are followed below)
  {
    name: 'two failedJobRetryTimeCycle on an asynchronous multi-instance loop',
    xml: xml(around(`<bpmn:userTask id="SP"><bpmn:multiInstanceLoopCharacteristics camunda:asyncBefore="true" camunda:collection="\${items}" camunda:elementVariable="item"><bpmn:extensionElements><camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle><camunda:failedJobRetryTimeCycle>R5/PT1M</camunda:failedJobRetryTimeCycle></bpmn:extensionElements></bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>`)),
    codes: ['W_C7_DEPLOY_DUPLICATE_EXTENSION'],
    engine: 'reject',
  },
  // 3. start events of transactions, sub-processes, processes; ad-hoc sub-processes
  { name: 'transaction with a task but no start event', xml: xml(around(`<bpmn:transaction id="SP">${UT('T')}</bpmn:transaction>`)), codes: ['W_C7_TRANSACTION_NO_START'], engine: 'accept', run: 'fails', before: true },
  { name: 'empty transaction', xml: xml(around('<bpmn:transaction id="SP" />')), codes: ['W_C7_TRANSACTION_NO_START'], engine: 'accept', run: 'fails', before: true },
  { name: 'transaction with only an event sub-process', xml: xml(around(`<bpmn:transaction id="SP"><bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ESS" isInterrupting="false"><bpmn:messageEventDefinition messageRef="M1" /></bpmn:startEvent><bpmn:endEvent id="ESE" />${flow('e1', 'ESS', 'ESE')}</bpmn:subProcess></bpmn:transaction>`), { roots: MSG }), codes: ['W_C7_TRANSACTION_NO_START'], engine: 'accept', run: 'fails', before: true },
  { name: 'transaction with a start event', xml: xml(around(`<bpmn:transaction id="SP">${TASK_INNER}</bpmn:transaction>`)), codes: [], engine: 'accept', run: 'ok' },
  { name: 'empty embedded sub-process', xml: xml(around('<bpmn:subProcess id="SP" />')), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject', before: true },
  { name: 'empty embedded sub-process that nothing connects', xml: xml(beside('<bpmn:subProcess id="SP" />')), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject', before: true },
  { name: 'empty process', xml: xml(''), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject', before: true },
  { name: 'sub-process with a task but no start event', xml: xml(around(`<bpmn:subProcess id="SP">${UT('T')}</bpmn:subProcess>`)), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'ad-hoc sub-process with sequence flows', xml: xml(around(`<bpmn:adHocSubProcess id="SP">${UT('T')}</bpmn:adHocSubProcess>`)), codes: ['W_C7_DEPLOY_AD_HOC_SUBPROCESS'], engine: 'reject', before: true },
  { name: 'empty ad-hoc sub-process with an incoming flow only', xml: xml(`<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'SP')}<bpmn:adHocSubProcess id="SP" />`), codes: ['W_C7_DEPLOY_AD_HOC_SUBPROCESS'], engine: 'reject', before: true },
  { name: 'ad-hoc sub-process with a boundary event', xml: xml(beside(`<bpmn:adHocSubProcess id="SP">${UT('T')}</bpmn:adHocSubProcess><bpmn:boundaryEvent id="B" attachedToRef="SP">${TIMER}</bpmn:boundaryEvent>`)), codes: ['W_C7_DEPLOY_AD_HOC_SUBPROCESS'], engine: 'reject', before: true },
  {
    name: 'ad-hoc sub-process that nothing connects: its content is skipped',
    xml: xml(beside(`<bpmn:adHocSubProcess id="SP"><bpmn:serviceTask id="X" /><bpmn:scriptTask id="Y" /><bpmn:subProcess id="Z">${UT('Z1')}</bpmn:subProcess><bpmn:startEvent id="A1" /><bpmn:startEvent id="A2" />${flow('a1', 'A1', 'X')}${flow('a2', 'A2', 'X')}</bpmn:adHocSubProcess>`)),
    codes: [],
    engine: 'accept',
    run: 'ok',
    before: true,
  },
  {
    name: 'ad-hoc sub-process that nothing connects: broken settings on it are skipped too',
    xml: xml(beside(`<bpmn:adHocSubProcess id="SP" camunda:asyncBefore="true" camunda:jobPriority="abc"><bpmn:extensionElements><camunda:failedJobRetryTimeCycle>R1/PT1M</camunda:failedJobRetryTimeCycle><camunda:failedJobRetryTimeCycle>R2/PT1M</camunda:failedJobRetryTimeCycle><camunda:executionListener event="start" /></bpmn:extensionElements>${UT('T')}</bpmn:adHocSubProcess>`)),
    codes: [],
    engine: 'accept',
    run: 'ok',
    before: true,
  },
  { name: 'ad-hoc sub-process with a valid multi-instance loop', xml: xml(beside(`<bpmn:adHocSubProcess id="SP"><bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality>2</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>${UT('T')}</bpmn:adHocSubProcess>`)), codes: ['W_C7_DEPLOY_AD_HOC_SUBPROCESS'], engine: 'reject', operaton: 'accept', before: true },
  { name: 'ad-hoc sub-process with a multi-instance loop without cardinality', xml: xml(beside(`<bpmn:adHocSubProcess id="SP"><bpmn:multiInstanceLoopCharacteristics />${UT('T')}</bpmn:adHocSubProcess>`)), codes: ['W_C7_DEPLOY_AD_HOC_SUBPROCESS', 'W_C7_DEPLOY_MULTI_INSTANCE'], engine: 'reject', before: true },
  { name: 'Operaton file: ad-hoc sub-process with a valid multi-instance loop', xml: xml(beside(`<bpmn:adHocSubProcess id="SP"><bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality>2</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>${UT('T')}</bpmn:adHocSubProcess>`), { operaton: true }), codes: [], engine: 'reject', operaton: 'accept' },
  { name: 'Operaton file: ad-hoc sub-process with a multi-instance loop without cardinality', xml: xml(beside(`<bpmn:adHocSubProcess id="SP"><bpmn:multiInstanceLoopCharacteristics />${UT('T')}</bpmn:adHocSubProcess>`), { operaton: true }), codes: ['W_C7_DEPLOY_MULTI_INSTANCE'], engine: 'reject', operaton: 'reject' },
  // 4. second start events (the hints are followed below)
  { name: 'two none start events into one task', xml: xml(twoStarts.same), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'sub-process with two start events into one task', xml: xml(inSub(twoStarts.same.replace(/id="E"/, 'id="SE"').replace(/targetRef="E"/, 'targetRef="SE"'))), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'event sub-process with two message start events', xml: xml(ESP_TWO, { roots: MSG }), codes: ['W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
];

describe('verifier follow-ups: one synthetic model per rule', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const report = runProfile(await Doc.fromXml(c.xml));
    const findings = report.findings;
    expect(findings.map((f) => f.code).sort(), JSON.stringify(findings, null, 1)).toEqual([...c.codes].sort());
    // deploy findings exactly where the engine that reads the file refuses it
    expect(findings.some((f) => f.severity === 'deploy')).toBe((report.operaton ? (c.operaton ?? c.engine) : c.engine) === 'reject');
    expect(findings.every((f) => f.code.startsWith('W_C7_DEPLOY_') === (f.severity === 'deploy'))).toBe(true);
    for (const f of findings) expect(f.hint, `${f.code}: ${f.hint}`).toMatch(/`bpmn (set|add|remove|move|retype|ext (add|remove|list)) <file> /);
  });

  it('a schema finding on an ignored definition names the acting one and both ways out', async () => {
    const f = runProfile(await Doc.fromXml(CASES[0]!.xml)).findings.find((x) => x.code === 'W_C7_DEPLOY_EVENT_DEFINITION')!;
    expect(f).toMatchObject({ element: 'W', severity: 'deploy' });
    expect(f.message).toBe('The conditional definition of intermediateCatchEvent:timer W has no condition element, which the BPMN schema requires; the engines refuse the file');
    expect(f.hint).toContain('`bpmn set <file> W trigger=timer` (keeps only the timer)');
    expect(f.hint).toContain("`bpmn set <file> W 'when=${expression}'` (keeps only the conditional definition)");
    // a single definition keeps the message and the subject of before (a write does not report it as new)
    const single = runProfile(await Doc.fromXml(xml(catchWith(COND_NONE)))).findings[0]!;
    expect(single.message).toBe('Conditional event W has no condition element, which the BPMN schema requires; the engines refuse the file');
    expect(single.hint).toBe("`bpmn set <file> W 'when=${expression}'`.");
  });

  it('the start-event and empty-sub-process lint gives way to the engine finding about the same scope', async () => {
    const empty = validateDoc(await Doc.fromXml(CASES.find((c) => c.name === 'empty embedded sub-process')!.xml), { platform: 'auto' });
    expect(empty.warnings.map((w) => w.code)).toEqual(['W_C7_DEPLOY_START_EVENT']);
    expect(empty.warnings[0]!.message).toBe('Sub-process SP is empty, without a start event; the engines refuse the file (subProcess must define a startEvent element)');
    const tx = validateDoc(await Doc.fromXml(CASES.find((c) => c.name === 'transaction with a task but no start event')!.xml), { platform: 'auto' });
    expect(tx.warnings.map((w) => w.code)).not.toContain('W_NO_START');
    expect(tx.platform).toMatchObject({ counts: { deploy: 0, runtime: 1 } });
    // without the profile the lint stays
    expect(validateDoc(await Doc.fromXml(CASES.find((c) => c.name === 'empty embedded sub-process')!.xml)).warnings.map((w) => w.code)).toContain('W_EMPTY_SUBPROCESS');
  });

  it('second start events: removed when the first one reaches where they lead, never two flows into one node', async () => {
    const hint = async (body: string, o: { roots?: string } = {}): Promise<string> => runProfile(await Doc.fromXml(xml(body, o))).findings.find((f) => f.code === 'W_C7_DEPLOY_START_EVENT')!.hint!;
    const same = await hint(twoStarts.same);
    expect(same).toMatch(/^Remove it: `bpmn remove <file> B` \(A already leads to U; F3 goes with it\), or give it another trigger/);
    expect(same).not.toContain('source=');
    expect(await hint(twoStarts.reach)).not.toContain('source=');
    expect(await hint(twoStarts.meet)).toMatch(/^Remove it: `bpmn remove <file> B` \(Y is then no longer started; starting it from A instead would run U, which A reaches too, once per branch\)/);
    expect(await hint(twoStarts.separate)).toMatch(/^Start its branch from A: `bpmn set <file> F3 source=A`, then `bpmn remove <file> B` \(A then starts both branches in parallel\)/);
    const mixed = await hint(twoStarts.mixed);
    expect(mixed).toContain('`bpmn set <file> F4 source=A`');
    expect(mixed).not.toContain('F3 source=');
    expect(await hint(ESP_TWO, { roots: MSG })).toContain('then keep its message trigger in an event sub-process of its own: `bpmn add <file> eventSubProcess:message "<Name>" --in P_Verify --message Verify2 --non-interrupting`');
  });
});

/* ------------------------------------------------------------------ */
/* hints, run through the real CLI                                      */
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

describe('hints run through the CLI', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-c7-fv-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function cli(...args: string[]): { code: number; out: string; err: string } {
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  }

  /** writes `content`, runs the commands `pick` selects from the hint of the finding `code` on `element` (placeholders filled), and returns the profile after */
  async function follow(name: string, content: string, code: string, element: string, opts: { pick?: (cmds: string[][]) => string[][]; fill?: Record<string, string> } = {}): Promise<{ file: string; hint: string; after: Doc }> {
    const file = join(dir, `${name}.bpmn`);
    writeFileSync(file, content);
    const f = runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings.find((x) => x.code === code && x.element === element);
    expect(f, `${code} on ${element}`).toBeDefined();
    const all = commandsOf(f!.hint!);
    const cmds = opts.pick ? opts.pick(all) : all;
    expect(cmds.length).toBeGreaterThan(0);
    for (const argv of cmds) {
      const args = argv.map((a) => Object.entries(opts.fill ?? {}).reduce((s, [k, v]) => s.split(k).join(v), a.replace('<file>', file)));
      const r = cli(...args);
      expect(r.code, `${args.join(' ')}\n${r.out}\n${r.err}`).toBe(0);
    }
    return { file, hint: f!.hint!, after: await Doc.fromXml(readFileSync(file, 'utf8')) };
  }

  const remaining = (doc: Doc, code: string): string[] => runProfile(doc).findings.filter((f) => f.code === code).map((f) => f.element ?? '');
  const ext = (inner: string): string => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  /** a timer catch event W whose definition holds `inner`, with or without an id of its own */
  const timerHost = (inner: string, defId: boolean): string => xml(catchWith(`<bpmn:timerEventDefinition${defId ? ' id="Def_T"' : ''}>${ext(inner)}<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>`));
  /** a multi-instance user task SP whose loop holds `inner`, with or without an id of its own */
  const loopHost = (inner: string, loopId: boolean): string => xml(around(`<bpmn:userTask id="SP"><bpmn:multiInstanceLoopCharacteristics${loopId ? ' id="MI_1"' : ''} camunda:collection="\${items}" camunda:elementVariable="item">${ext(inner)}</bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>`));

  describe.each([
    ['with an id of its own', true],
    ['without an id', false],
  ])('extension content of an event definition or loop %s', (_label, ownId) => {
    const tag = ownId ? 'id' : 'noid';

    it('W_C7_MISPLACED_EXTENSION on a timer definition: removed there and added to the event', async () => {
      const { hint, after } = await follow(`mis-def-${tag}`, timerHost('<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle>', ownId), 'W_C7_MISPLACED_EXTENSION', 'W');
      expect(hint).toContain('`bpmn ext remove <file> W definition.0`');
      expect(runProfile(after).findings).toEqual([]);
      expect(after.require('W').get<{ values: Array<{ $type: string; $body: string }> }>('extensionElements').values.map((v) => `${v.$type}:${v.$body}`)).toEqual(['camunda:failedJobRetryTimeCycle:R3/PT1M']);
    }, 60000);

    it('W_C7_UNKNOWN_ELEMENT on a timer definition: the remove command works', async () => {
      const { hint, after } = await follow(`unknown-def-${tag}`, timerHost('<camunda:foo />', ownId), 'W_C7_UNKNOWN_ELEMENT', 'W', { pick: (c) => c.slice(0, 1) });
      expect(hint).toContain('`bpmn ext remove <file> W definition.0`');
      expect(runProfile(after).findings).toEqual([]);
    }, 60000);

    it('W_C7_MISPLACED_EXTENSION on a multi-instance loop: removed there and added to the task', async () => {
      const { hint, after } = await follow(`mis-loop-${tag}`, loopHost('<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle><camunda:taskListener event="create" expression="${x}" />', ownId), 'W_C7_MISPLACED_EXTENSION', 'SP');
      expect(hint).toContain('`bpmn ext remove <file> SP loop.1`');
      expect(remaining(after, 'W_C7_MISPLACED_EXTENSION')).toEqual([]);
    }, 60000);

    it('W_C7_UNKNOWN_ELEMENT on a multi-instance loop: the remove command works', async () => {
      const { hint, after } = await follow(`unknown-loop-${tag}`, loopHost('<camunda:foo />', ownId), 'W_C7_UNKNOWN_ELEMENT', 'SP', { pick: (c) => c.slice(0, 1) });
      expect(hint).toContain('`bpmn ext remove <file> SP loop.0`');
      expect(runProfile(after).findings).toEqual([]);
    }, 60000);

    it('W_C7_DEPLOY_DUPLICATE_EXTENSION on an asynchronous loop: the merge goes to the loop', async () => {
      const content = loopHost('<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle><camunda:failedJobRetryTimeCycle>R5/PT1M</camunda:failedJobRetryTimeCycle>', ownId).replace('<bpmn:multiInstanceLoopCharacteristics', '<bpmn:multiInstanceLoopCharacteristics camunda:asyncBefore="true"');
      const { hint, after } = await follow(`dup-loop-${tag}`, content, 'W_C7_DEPLOY_DUPLICATE_EXTENSION', 'SP', { fill: { '...': 'R3/PT1M' } });
      expect(hint).toContain('`bpmn ext add <file> SP loop.camunda:failedJobRetryTimeCycle --replace');
      expect(runProfile(after).findings).toEqual([]);
    }, 60000);
  });

  it('schema findings on an ignored definition: both ways out deploy-clean', async () => {
    const content = CASES[0]!.xml;
    const keep = await follow('schema-keep', content, 'W_C7_DEPLOY_EVENT_DEFINITION', 'W', { pick: (c) => c.slice(0, 1) });
    expect(runProfile(keep.after).findings).toEqual([]);
    expect(keep.after.require('W').get<unknown[]>('eventDefinitions').length).toBe(1);
    const cond = await follow('schema-cond', content, 'W_C7_DEPLOY_EVENT_DEFINITION', 'W', { pick: (c) => c.slice(1, 2), fill: { '${expression}': '${ready}' } });
    expect(runProfile(cond.after).findings).toEqual([]);
    const link = await follow('schema-link', xml(catchWith(TIMER + LINK_NONAME)), 'W_C7_DEPLOY_LINK', 'W', { pick: (c) => c.slice(0, 1) });
    expect(runProfile(link.after).findings).toEqual([]);
    const times = await follow('schema-times', xml(catchWith(TWO_TIMES)), 'W_C7_DEPLOY_EVENT_DEFINITION', 'W', { fill: { '<value>': 'PT2H' } });
    expect(runProfile(times.after).findings).toEqual([]);
  }, 60000);

  it.each([
    ['same', twoStarts.same, 'U'],
    ['reach', twoStarts.reach, 'X'],
    ['separate', twoStarts.separate, 'U,V'],
    ['meet', twoStarts.meet, 'X'],
    ['mixed', twoStarts.mixed, 'U,V'],
  ])('a second start event (%s): following the first way out leaves no doubled branch', async (name, body, targets) => {
    const { after } = await follow(`two-${name}`, xml(body), 'W_C7_DEPLOY_START_EVENT', 'B', { pick: (c) => c.filter((argv) => !argv.includes('trigger=message')) });
    expect(runProfile(after).findings).toEqual([]);
    expect(after.get('B')).toBeUndefined();
    const out = after.outgoing(after.require('A')).map((f) => f.get<{ id: string }>('targetRef').id);
    expect(new Set(out).size).toBe(out.length);
    expect(out.sort().join(',')).toBe(targets);
  }, 60000);

  it('a second start event: another trigger keeps both ways in', async () => {
    const { after } = await follow('two-trigger', xml(twoStarts.same), 'W_C7_DEPLOY_START_EVENT', 'B', { pick: (c) => c.filter((argv) => argv.includes('trigger=message')), fill: { '<Name>': 'Other' } });
    expect(runProfile(after).findings).toEqual([]);
  }, 60000);

  it('a second start event of an event sub-process: removed, its trigger in an event sub-process of its own', async () => {
    const { after } = await follow('two-esp', xml(ESP_TWO, { roots: MSG }), 'W_C7_DEPLOY_START_EVENT', 'B', { fill: { '<Name>': 'Other' } });
    expect(runProfile(after).findings).toEqual([]);
  }, 60000);

  it('an empty sub-process, a transaction without start, a connected ad-hoc sub-process: the hints lead to a clean file', async () => {
    const sp = await follow('empty-sub', CASES.find((c) => c.name === 'empty embedded sub-process')!.xml, 'W_C7_DEPLOY_START_EVENT', 'SP', { pick: (c) => c.slice(0, 1), fill: { '<Name>': 'Go' } });
    expect(runProfile(sp.after).findings).toEqual([]);
    const tx = await follow('tx', CASES.find((c) => c.name === 'transaction with a task but no start event')!.xml, 'W_C7_TRANSACTION_NO_START', 'SP', { pick: (c) => c.slice(0, 1), fill: { '<Name>': 'Go', '<firstNodeId>': 'T' } });
    expect(runProfile(tx.after).findings).toEqual([]);
    const adHoc = await follow('adhoc', CASES.find((c) => c.name === 'ad-hoc sub-process with sequence flows')!.xml, 'W_C7_DEPLOY_AD_HOC_SUBPROCESS', 'SP', { pick: (c) => c.slice(0, 2), fill: { '<Name>': 'Go' } });
    expect(remaining(adHoc.after, 'W_C7_DEPLOY_AD_HOC_SUBPROCESS')).toEqual([]);
    expect(adHoc.after.require('SP').$type).toBe('bpmn:SubProcess');
  }, 60000);
});

/* ------------------------------------------------------------------ */
/* live engines (opt-in)                                                */
/* ------------------------------------------------------------------ */

const ENGINES = (process.env['BPMN_C7_ENGINES'] ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

async function json(res: Response): Promise<Record<string, unknown> & { message?: string }> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** deploys, optionally starts the process, and always deletes the deployment */
async function deploy(engine: string, name: string, bpmn: string, start?: string): Promise<{ ok: boolean; message: string; started?: boolean; tasks?: string[] }> {
  const form = new FormData();
  form.append('deployment-name', name);
  form.append('deployment-source', 'bpmn-cli-test');
  form.append('enable-duplicate-filtering', 'false');
  form.append('data', new Blob([bpmn], { type: 'application/octet-stream' }), `${name}.bpmn`);
  const res = await fetch(`${engine}/deployment/create`, { method: 'POST', body: form });
  const body = await json(res);
  if (!res.ok || typeof body['id'] !== 'string') return { ok: false, message: body.message ?? String(res.status) };
  try {
    if (!start) return { ok: true, message: '' };
    const s = await fetch(`${engine}/process-definition/key/${start}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const instance = await json(s);
    if (!s.ok) return { ok: true, message: instance.message ?? '', started: false };
    const tasks = (await (await fetch(`${engine}/task?processInstanceId=${String(instance['id'])}`)).json()) as Array<{ taskDefinitionKey: string }>;
    return { ok: true, message: '', started: true, tasks: tasks.map((t) => t.taskDefinitionKey).sort() };
  } finally {
    await fetch(`${engine}/deployment/${String(body['id'])}?cascade=true`, { method: 'DELETE' });
  }
}

async function isOperaton(engine: string): Promise<boolean> {
  try {
    const body = (await (await fetch(`${engine}/telemetry/data`)).json()) as { product?: { name?: string } };
    return /operaton/i.test(body.product?.name ?? '');
  } catch {
    return false;
  }
}

describe.skipIf(!ENGINES.length)('live engines: the engines agree with CASES', () => {
  for (const engine of ENGINES) {
    it.each(CASES.map((c, i) => [c.name, c, i] as const))(`${engine}: %s`, async (_name, c, i) => {
      const result = await deploy(engine, `bpmn-cli-c7-verify-${i}`, c.xml, c.run ? 'P_Verify' : undefined);
      expect(result.ok, result.message).toBe(((await isOperaton(engine)) ? (c.operaton ?? c.engine) : c.engine) === 'accept');
      if (c.run) expect(result.started, result.message).toBe(c.run === 'ok');
    }, 30000);

    it(`${engine}: following the second-start hint, each node runs once`, async () => {
      for (const [name, body, tasks] of [
        ['same', twoStarts.same, ['U']],
        ['separate', twoStarts.separate, ['U', 'V']],
        ['mixed', twoStarts.mixed, ['U', 'V']],
      ] as const) {
        const doc = await Doc.fromXml(xml(body));
        const hint = runProfile(doc).findings.find((f) => f.code === 'W_C7_DEPLOY_START_EVENT')!.hint!;
        // the hint's first way out, as ops: `set <flow> source=A` for each flow it names, then `remove B`
        const moves = [...hint.split(', or ')[0]!.matchAll(/`bpmn set <file> (\w+) source=A`/g)].map((m) => ({ op: 'set' as const, id: m[1]!, values: { source: 'A' } }));
        await mutateDoc(doc, [...moves, { op: 'remove', ids: ['B'] }], { dryRun: true, layout: false });
        const result = await deploy(engine, `bpmn-cli-c7-verify-two-${name}`, await doc.toXml(), 'P_Verify');
        expect(result.tasks, `${name}: ${result.message}`).toEqual([...tasks]);
      }
    }, 60000);
  }
});
