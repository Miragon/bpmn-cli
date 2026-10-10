/**
 * Camunda 7 follow-ups found while integrating the verifier round (each test
 * fails on the code before its fix; all models synthetic):
 *
 *  1. events with several event definitions: the engines act on one of them
 *     (engine-checked order per event type, each pair in both XML orders) and
 *     do not even parse the others. The profile reported deploy findings on
 *     the ignored definition (a message without messageRef next to a timer,
 *     a message + timer catch event behind an event-based gateway), never said
 *     that the others are ignored (new W_C7_MULTIPLE_EVENT_DEFINITIONS), and
 *     its hints said `definition.` where `set` needs `definition[<n>].`.
 *  2. a boundary event on a compensation handler was reported twice
 *     (E_INVALID_HOST and W_C7_DEPLOY_BOUNDARY_HOST).
 *  3. Operaton's namespace in the ops: ext add filed / merged operaton content
 *     like unknown vendor content, renames left operaton:errorEventDefinition
 *     errorRef behind, Booleans were written as given, misplaced operaton
 *     attributes passed, retype did not name operaton content; new processes
 *     of an Operaton file got camunda:historyTimeToLive.
 *  4. an attribute BPMN does not define (W_C7_DEPLOY_SCHEMA) could not be
 *     removed with `set`; the finding's hint had to say "edit the XML".
 *  5. CLI output: `validate` printed "0 refused at deploy" for Camunda 8 files
 *     (no rules), ignored import warnings in its summary and in --strict, and
 *     a write hid an op W_EVENT_GATEWAY_TARGET about one branch when lint
 *     reported another branch of the same gateway.
 *  6. MutationOptions.platform did not reach the ops: the event-gateway rule
 *     of a bridge followed the detected platform, not the explicit one.
 *
 * Every model in CASES states what Camunda 7.24, CIB seven 2.2 and Operaton
 * 2.1.5 do with it. To re-check against live engines set BPMN_C7_ENGINES to
 * their REST roots, comma-separated, e.g.
 *   BPMN_C7_ENGINES=http://localhost:8080/engine-rest npx vitest run test/c7-followups-integration.test.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { kindsJson, kindsText } from '../src/guide.js';
import { listAllExtensions } from '../src/ops/ext.js';
import { runOps } from '../src/ops/index.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';
import { runProfile } from '../src/platform/profile.js';
import { validateDoc } from '../src/validate.js';

const ROOT = join(import.meta.dirname, '..');
const BPMN = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
const OPERATON = 'xmlns:operaton="http://operaton.org/schema/1.0/bpmn"';
const MODELER = 'xmlns:modeler="http://camunda.org/schema/modeler/1.0"';
const C7 = `${CAMUNDA} ${MODELER} modeler:executionPlatform="Camunda Platform"`;

function xml(body: string, o: { ns?: string; roots?: string; attrs?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${BPMN} ${o.ns ?? C7} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${o.roots ?? ''}
  <bpmn:process id="P_Integration" isExecutable="true" ${o.attrs ?? 'camunda:historyTimeToLive="180"'}>
${body}
  </bpmn:process>
</bpmn:definitions>`;
}

/** start -> nodes -> end */
function chain(nodes: Array<[string, string]>, extra = '', start = '<bpmn:startEvent id="Start" />'): string {
  const ids = ['Start', ...nodes.map(([id]) => id), 'End'];
  const flows = ids.slice(1).map((id, i) => `<bpmn:sequenceFlow id="F${i}" sourceRef="${ids[i]}" targetRef="${id}" />`);
  return [start, ...nodes.map(([, x]) => x), '<bpmn:endEvent id="End" />', ...flows, extra].join('\n');
}

const ROOTS = '<bpmn:message id="M" name="Pay" /><bpmn:signal id="Sig" name="Go" />';
const TIMER = '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
const EMPTY_TIMER = '<bpmn:timerEventDefinition id="TDef" />';
const MSG = '<bpmn:messageEventDefinition id="MDef" messageRef="M" />';
const MSG_NOREF = '<bpmn:messageEventDefinition id="MDef" />';
const LINK = '<bpmn:linkEventDefinition id="LDef" name="L" />';
const COND = '<bpmn:conditionalEventDefinition id="CDef"><bpmn:condition xsi:type="bpmn:tFormalExpression">${false}</bpmn:condition></bpmn:conditionalEventDefinition>';
const catchEvent = (id: string, defs: string): [string, string] => [id, `<bpmn:intermediateCatchEvent id="${id}">${defs}</bpmn:intermediateCatchEvent>`];
const eventSub = (defs: string): string =>
  `<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ES_S" isInterrupting="false">${defs}</bpmn:startEvent><bpmn:sequenceFlow id="ES_F" sourceRef="ES_S" targetRef="ES_E" /><bpmn:endEvent id="ES_E" /></bpmn:subProcess>`;
/** start -> event-based gateway -> catch event W (with `defs`) -> end, plus a timer branch */
const gateway = (defs: string): string =>
  xml(
    `<bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" /><bpmn:eventBasedGateway id="G" />
<bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="W" /><bpmn:intermediateCatchEvent id="W">${defs}</bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="F3" sourceRef="W" targetRef="End" /><bpmn:endEvent id="End" />
<bpmn:sequenceFlow id="F4" sourceRef="G" targetRef="T2" /><bpmn:intermediateCatchEvent id="T2"><bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT2H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="F5" sourceRef="T2" targetRef="End2" /><bpmn:endEvent id="End2" />`,
    { roots: ROOTS },
  );

interface Case {
  name: string;
  xml: string;
  /** the profile codes the model must produce (sorted multiset) */
  codes: string[];
  /** what Camunda 7.24, CIB seven 2.2 and Operaton 2.1.5 do with it */
  engine: 'reject' | 'accept';
}

const MULTIPLE = 'W_C7_MULTIPLE_EVENT_DEFINITIONS';

const CASES: Case[] = [
  // the engines act on the timer (intermediate catch, process start, boundary), on the message (event sub-process start)
  { name: 'message + timer catch event', xml: xml(chain([catchEvent('W', MSG + TIMER)]), { roots: ROOTS }), codes: [MULTIPLE], engine: 'accept' },
  { name: 'timer + a message without messageRef: the ignored message is not parsed', xml: xml(chain([catchEvent('W', TIMER + MSG_NOREF)]), { roots: ROOTS }), codes: [MULTIPLE], engine: 'accept' },
  { name: 'message + an empty timer: the acting timer is parsed', xml: xml(chain([catchEvent('W', MSG + EMPTY_TIMER)]), { roots: ROOTS }), codes: [MULTIPLE, 'W_C7_DEPLOY_EVENT_DEFINITION'], engine: 'reject' },
  { name: 'event sub-process start: the message acts, an empty timer is ignored', xml: xml(chain([['U', '<bpmn:userTask id="U" />']], eventSub(MSG + EMPTY_TIMER)), { roots: ROOTS }), codes: [MULTIPLE], engine: 'accept' },
  { name: 'event sub-process start: a message without messageRef acts', xml: xml(chain([['U', '<bpmn:userTask id="U" />']], eventSub(TIMER + MSG_NOREF)), { roots: ROOTS }), codes: [MULTIPLE, 'W_C7_DEPLOY_MESSAGE'], engine: 'reject' },
  { name: 'a message + timer start event is a second timer start event', xml: xml(chain([['U', '<bpmn:userTask id="U" />']], `<bpmn:startEvent id="S2">${MSG}${TIMER}</bpmn:startEvent><bpmn:sequenceFlow id="FS2" sourceRef="S2" targetRef="U" />`), { roots: ROOTS }), codes: [MULTIPLE, 'W_C7_DEPLOY_START_EVENT'], engine: 'reject' },
  { name: 'boundary event: signal + message, the signal acts', xml: xml(chain([['U', '<bpmn:userTask id="U" />']], `<bpmn:boundaryEvent id="B" attachedToRef="U"><bpmn:messageEventDefinition messageRef="M" /><bpmn:signalEventDefinition signalRef="Sig" /></bpmn:boundaryEvent><bpmn:sequenceFlow id="FB" sourceRef="B" targetRef="EB" /><bpmn:endEvent id="EB" />`), { roots: ROOTS }), codes: [MULTIPLE], engine: 'accept' },
  // throw events act on one definition too: an end event on the message, an intermediate throw event on the signal
  { name: 'end event: message + signal, the message acts', xml: xml(chain([['U', '<bpmn:userTask id="U" />']]).replace('<bpmn:endEvent id="End" />', `<bpmn:endEvent id="End"><bpmn:messageEventDefinition camunda:expression="\${true}" /><bpmn:signalEventDefinition signalRef="Sig" /></bpmn:endEvent>`), { roots: ROOTS }), codes: [MULTIPLE], engine: 'accept' },
  { name: 'end event: the ignored signal definition without signalRef is not parsed', xml: xml(chain([['U', '<bpmn:userTask id="U" />']]).replace('<bpmn:endEvent id="End" />', '<bpmn:endEvent id="End"><bpmn:messageEventDefinition camunda:expression="${true}" /><bpmn:signalEventDefinition /></bpmn:endEvent>')), codes: [MULTIPLE], engine: 'accept' },
  { name: 'intermediate throw event: the acting signal without signalRef is refused', xml: xml(chain([['T', '<bpmn:intermediateThrowEvent id="T"><bpmn:signalEventDefinition /><bpmn:messageEventDefinition camunda:expression="${true}" /></bpmn:intermediateThrowEvent>']])), codes: [MULTIPLE, 'W_C7_DEPLOY_SIGNAL'], engine: 'reject' },
  { name: 'intermediate throw event: an ignored mail message definition is not parsed', xml: xml(chain([['T', '<bpmn:intermediateThrowEvent id="T"><bpmn:signalEventDefinition signalRef="Sig" /><bpmn:messageEventDefinition camunda:type="mail" /></bpmn:intermediateThrowEvent>']]), { roots: ROOTS }), codes: [MULTIPLE], engine: 'accept' },
  // behind an event-based gateway: the acting definition decides
  { name: 'event-based gateway -> message + timer catch event', xml: gateway(MSG + TIMER), codes: [MULTIPLE], engine: 'accept' },
  { name: 'event-based gateway -> link + timer catch event (the timer acts)', xml: gateway(LINK + TIMER), codes: [MULTIPLE], engine: 'accept' },
  { name: 'event-based gateway -> link + conditional catch event (the link acts)', xml: gateway(LINK + COND), codes: [MULTIPLE, 'W_C7_DEPLOY_EVENT_GATEWAY'], engine: 'reject' },
  // attributes BPMN does not define
  { name: 'unprefixed attributes on a task and on an event definition', xml: xml(chain([['R', '<bpmn:businessRuleTask id="R" calledDecision="d1" camunda:decisionRef="d1" />'], catchEvent('W', TIMER.replace('<bpmn:timerEventDefinition id="TDef">', '<bpmn:timerEventDefinition id="TDef" foo="bar">'))])), codes: ['W_C7_DEPLOY_SCHEMA', 'W_C7_DEPLOY_SCHEMA'], engine: 'reject' },
];

describe('integration follow-ups: one synthetic model per rule', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const findings = runProfile(await Doc.fromXml(c.xml)).findings;
    expect(findings.map((f) => f.code).sort()).toEqual([...c.codes].sort());
    expect(findings.some((f) => f.severity === 'deploy')).toBe(c.engine === 'reject');
    for (const f of findings) expect(f.hint, `${f.code}: ${f.hint}`).toMatch(/`bpmn (set|add|remove|move|ext (add|remove|list)) <file> /);
  });

  it('names the definition the engines act on and how to keep only it', async () => {
    const [f] = runProfile(await Doc.fromXml(xml(chain([catchEvent('W', MSG + TIMER)]), { roots: ROOTS }))).findings;
    expect(f).toMatchObject({ code: MULTIPLE, element: 'W', severity: 'runtime' });
    expect(f!.message).toContain('the engines act on the timer only and ignore the message');
    expect(f!.hint).toContain('`bpmn set <file> W trigger=timer`');
    const end = runProfile(await Doc.fromXml(CASES.find((c) => c.name.startsWith('end event'))!.xml)).findings[0]!;
    expect(end.message).toContain('the engines act on the message only and ignore the signal');
  });
});

/* ------------------------------------------------------------------ */
/* CLI helpers                                                          */
/* ------------------------------------------------------------------ */

function cli(...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

/** The `bpmn ...` command lines of a hint, as argv (single quotes honoured, `bpmn` dropped). */
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

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-c7-int-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/* ------------------------------------------------------------------ */
/* 1. hints on one of several event definitions                         */
/* ------------------------------------------------------------------ */

describe('hints name one of several event definitions with definition[<n>].', () => {
  it('a misplaced attribute and a bad value on the second definition: the hints run through the CLI', async () => {
    const file = join(dir, 'multi.bpmn');
    const defs = `<bpmn:messageEventDefinition id="MDef" messageRef="M" camunda:asyncc="true" />${TIMER.replace('<bpmn:timerEventDefinition id="TDef">', '<bpmn:timerEventDefinition id="TDef" camunda:jobPriority="high">')}`;
    writeFileSync(file, xml(chain([catchEvent('W', defs)]), { roots: ROOTS }));
    const findings = runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings;
    const unknown = findings.find((f) => f.code === 'W_C7_UNKNOWN_ATTRIBUTE')!;
    const priority = findings.find((f) => f.code === 'W_C7_MISPLACED_ATTRIBUTE')!;
    expect(unknown.hint).toContain("`bpmn set <file> W 'definition[0].camunda:asyncc='`");
    expect(priority.hint).toContain("`bpmn set <file> W 'definition[1].camunda:jobPriority='`");
    for (const f of [unknown, priority]) {
      for (const argv of commandsOf(f.hint!)) {
        const r = cli(...argv.map((a) => (a === '<file>' ? file : a)), '--no-layout');
        expect(r.code, `${argv.join(' ')}\n${r.out}\n${r.err}`).toBe(0);
      }
    }
    expect(runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings.map((f) => f.code)).toEqual([MULTIPLE]);
  }, 60000);
});

/* ------------------------------------------------------------------ */
/* 2. one report per problem                                            */
/* ------------------------------------------------------------------ */

describe('a boundary event on a compensation handler is reported once', () => {
  const XML = xml(
    chain(
      [['X', '<bpmn:serviceTask id="X" camunda:expression="${true}" />']],
      `<bpmn:boundaryEvent id="BC" attachedToRef="X"><bpmn:compensateEventDefinition /></bpmn:boundaryEvent>
<bpmn:serviceTask id="H" isForCompensation="true" camunda:expression="\${true}" />
<bpmn:boundaryEvent id="BT" attachedToRef="H">${TIMER}</bpmn:boundaryEvent><bpmn:sequenceFlow id="FT" sourceRef="BT" targetRef="End2" /><bpmn:endEvent id="End2" />
<bpmn:association id="A1" associationDirection="One" sourceRef="BC" targetRef="H" />`,
    ),
  );

  it('validate: E_INVALID_HOST, no W_C7_DEPLOY_BOUNDARY_HOST (neither listed nor counted)', async () => {
    const r = validateDoc(await Doc.fromXml(XML), { platform: 'auto' });
    expect(r.errors.map((e) => `${e.code} ${e.element}`)).toContain('E_INVALID_HOST BT');
    expect(r.warnings.map((w) => w.code)).not.toContain('W_C7_DEPLOY_BOUNDARY_HOST');
    expect(r.platform!.counts.deploy).toBe(0);
    // the profile on its own (library) still knows the engine rule
    expect(runProfile(await Doc.fromXml(XML)).findings.map((f) => f.code)).toEqual(['W_C7_DEPLOY_BOUNDARY_HOST']);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Operaton's namespace in the ops                                   */
/* ------------------------------------------------------------------ */

describe("Operaton's namespace in the ops", () => {
  const OP = xml(
    chain([
      ['Activity_Host', '<bpmn:serviceTask id="Activity_Host" operaton:type="external" operaton:topic="host" />'],
      ['Activity_Review', '<bpmn:userTask id="Activity_Review" operaton:assignee="demo"><bpmn:extensionElements><operaton:taskListener event="create" class="a.B" /></bpmn:extensionElements></bpmn:userTask>'],
    ]),
    { ns: OPERATON, attrs: 'operaton:historyTimeToLive="180"', roots: '<bpmn:error id="Error_Biz" name="Biz" errorCode="BIZ" />' },
  );
  const fresh = async (): Promise<Doc> => Doc.fromXml(OP);
  const error = (fn: () => unknown): { code?: string; message: string; hint?: string } => {
    try {
      fn();
    } catch (err) {
      const e = err as { code?: string; message: string; details?: { hint?: string } };
      return { code: e.code, message: e.message, hint: e.details?.hint };
    }
    throw new Error('expected an error');
  };

  it('ext add files an operaton parameter into an operaton:inputOutput and merges a second one', async () => {
    const doc = await fresh();
    const cs = runOps(doc, [
      { op: 'ext', id: 'Activity_Host', action: 'add', type: 'operaton:inputParameter', attrs: { name: 'a' }, body: '1' },
      { op: 'ext', id: 'Activity_Host', action: 'add', xml: '<operaton:inputOutput><operaton:outputParameter name="c">3</operaton:outputParameter></operaton:inputOutput>' },
    ]);
    expect(cs.warnings.map((w) => w.code)).toEqual([]);
    const list = listAllExtensions(doc.require('Activity_Host'));
    expect(list.map((e) => e.type)).toEqual(['operaton:inputOutput']);
    expect(list[0]!.children!.map((c) => `${c.type} ${c.attrs['name']}`)).toEqual(['operaton:inputParameter a', 'operaton:outputParameter c']);
    expect(runProfile(doc).findings.map((f) => f.code)).toEqual([]);
    // the file does not get the camunda namespace on the way
    expect(await doc.toXml()).not.toContain('xmlns:camunda');
  });

  it('a keyed operaton item is replaced, a conflicting single container is E_DUPLICATE_EXTENSION', async () => {
    const doc = await fresh();
    runOps(doc, [{ op: 'ext', id: 'Activity_Host', action: 'add', type: 'operaton:inputParameter', attrs: { name: 'a' }, body: '1' }]);
    runOps(doc, [{ op: 'ext', id: 'Activity_Host', action: 'add', type: 'operaton:inputParameter', attrs: { name: 'a' }, body: '2' }]);
    expect(listAllExtensions(doc.require('Activity_Host'))[0]!.children!.map((c) => c.body)).toEqual(['2']);
    runOps(doc, [{ op: 'ext', id: 'Activity_Review', action: 'add', type: 'operaton:failedJobRetryTimeCycle', body: 'R3/PT1M' }]);
    expect(error(() => runOps(doc, [{ op: 'ext', id: 'Activity_Review', action: 'add', type: 'operaton:failedJobRetryTimeCycle', body: 'R5/PT1M' }])).code).toBe('E_DUPLICATE_EXTENSION');
  });

  it('a camunda container next to an operaton one stays separate (Operaton reads one of each)', async () => {
    const doc = await Doc.fromXml(OP.replace(OPERATON, `${OPERATON} ${CAMUNDA}`));
    runOps(doc, [
      { op: 'ext', id: 'Activity_Host', action: 'add', type: 'camunda:inputParameter', attrs: { name: 'x' }, body: '1' },
      { op: 'ext', id: 'Activity_Host', action: 'add', type: 'operaton:inputParameter', attrs: { name: 'y' }, body: '2' },
    ]);
    expect(listAllExtensions(doc.require('Activity_Host')).map((e) => `${e.type}: ${e.children!.map((c) => c.attrs['name']).join(',')}`)).toEqual(['camunda:inputOutput: x', 'operaton:inputOutput: y']);
  });

  it('a rename re-points operaton:errorEventDefinition errorRef', async () => {
    const doc = await fresh();
    runOps(doc, [{ op: 'ext', id: 'Activity_Host', action: 'add', type: 'operaton:errorEventDefinition', attrs: { id: 'OEED_1', errorRef: 'Error_Biz', expression: '${true}' } }]);
    runOps(doc, [{ op: 'set', id: 'Error_Biz', values: { id: 'Error_New' } }]);
    expect(listAllExtensions(doc.require('Activity_Host'))[0]!.attrs['errorRef']).toBe('Error_New');
    expect(runProfile(doc).findings.map((f) => f.code)).not.toContain('W_C7_DANGLING_REF');
  });

  it('Booleans are written as true / false, misplaced attributes are E_WRONG_HOST, a resource condition is a condition', async () => {
    const doc = await fresh();
    runOps(doc, [{ op: 'set', id: 'Activity_Host', values: { 'operaton:asyncBefore': 'yes' } }]);
    expect(doc.require('Activity_Host').$attrs['operaton:asyncBefore']).toBe('true');
    const e = error(() => runOps(doc, [{ op: 'set', id: 'Activity_Review', values: { 'operaton:collection': '${items}' } }]));
    expect(e.code).toBe('E_WRONG_HOST');
    expect(e.hint).toContain("'loop.operaton:collection=${items}'");
    // a conditional event whose script resource is operaton:resource: when= drops it (reported), it is not left behind
    const cond = await Doc.fromXml(
      xml(chain([['W', '<bpmn:intermediateCatchEvent id="W"><bpmn:conditionalEventDefinition><bpmn:condition xsi:type="bpmn:tFormalExpression" language="groovy" operaton:resource="deployment://c.groovy" /></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>']]), { ns: OPERATON, attrs: 'operaton:historyTimeToLive="180"' }),
    );
    const cs = runOps(cond, [{ op: 'set', id: 'W', values: { when: '${x > 1}' } }]);
    expect(cs.warnings.map((w) => w.message).join(' ')).toContain('operaton:resource');
    expect(await cond.toXml()).not.toContain('operaton:resource');
    expect(error(() => runOps(cond, [{ op: 'set', id: 'W', values: { 'condition.operaton:resource': 'deployment://c.groovy' } }, { op: 'set', id: 'W', values: { 'condition.operaton:resource': '' } }])).code).toBe('E_INVALID_VALUE');
  });

  it('retype names the operaton content the new kind cannot use (once, through the profile, in a write)', async () => {
    const retype: Op[] = [{ op: 'retype', id: 'Activity_Review', kind: 'serviceTask' }];
    const cs = runOps(await fresh(), retype);
    const w = cs.warnings.find((x) => x.code === 'W_PROPERTY_INAPPLICABLE');
    expect(w?.message).toMatch(/operaton:assignee/);
    expect(w?.message).toMatch(/operaton:taskListener/);
    const r = await mutateDoc(await fresh(), retype, { dryRun: true, layout: false });
    expect(r.changes.warnings.map((x) => x.code)).not.toContain('W_PROPERTY_INAPPLICABLE');
    expect(r.validation.platform!.added!.map((f) => f.code).sort()).toEqual(['W_C7_DEPLOY_IMPLEMENTATION', 'W_C7_MISPLACED_ATTRIBUTE', 'W_C7_MISPLACED_EXTENSION']);
  });

  it('a new process of an Operaton file gets operaton:historyTimeToLive (camunda files keep camunda:)', async () => {
    const doc = await fresh();
    const proc = doc.moddle.create('bpmn:Process', { id: 'P_New', isExecutable: true });
    doc.initProcess(proc);
    expect(proc.$attrs).toEqual({ 'operaton:historyTimeToLive': '180' });
    expect(await doc.toXml()).not.toContain('xmlns:camunda');
    const c7 = await Doc.fromXml(xml(chain([])));
    const p2 = c7.moddle.create('bpmn:Process', { id: 'P_New', isExecutable: true });
    c7.initProcess(p2);
    expect(p2.$attrs).toEqual({ 'camunda:historyTimeToLive': '180' });
  });
});

/* ------------------------------------------------------------------ */
/* 4. removing an attribute BPMN does not define                        */
/* ------------------------------------------------------------------ */

describe('W_C7_DEPLOY_SCHEMA: `set <id> <attr>=` removes the attribute', () => {
  it('on the element and on a nested element; following the hints leaves a file the engines deploy', async () => {
    const file = join(dir, 'schema.bpmn');
    writeFileSync(file, CASES.find((c) => c.name.startsWith('unprefixed'))!.xml.replace('<bpmn:userTask', '<bpmn:userTask'));
    const findings = runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings;
    // a business rule task's calledDecision is design-iq's decision link: `set calledDecision=` writes the engines' spelling (step 2 of the design-iq work)
    expect(findings.map((f) => f.hint)).toEqual(["Write the decision link in the engines' spelling: `bpmn set <file> R calledDecision=d1` (camunda:decisionRef; the unprefixed calledDecision is removed).", 'Remove it: `bpmn set <file> W definition.foo=` (vendor attributes need their namespace prefix, e.g. camunda:<name>).']);
    for (const f of findings) {
      for (const argv of commandsOf(f.hint!)) {
        const r = cli(...argv.map((a) => (a === '<file>' ? file : a)), '--no-layout');
        expect(r.code, `${argv.join(' ')}\n${r.out}\n${r.err}`).toBe(0);
      }
    }
    expect(runProfile(await Doc.fromXml(readFileSync(file, 'utf8'))).findings).toEqual([]);
  }, 60000);

  it('in the diagram `set` cannot reach it: the hint says so; on bpmn:definitions it can', async () => {
    const x = xml(chain([])).replace('<bpmn:definitions ', '<bpmn:definitions bar="2" ').replace('</bpmn:process>', '</bpmn:process><bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="P_Integration" foo="1" /></bpmndi:BPMNDiagram>').replace(BPMN, `${BPMN} xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"`);
    const findings = runProfile(await Doc.fromXml(x)).findings;
    expect(findings.map((f) => [f.element, f.hint])).toEqual([
      ['Definitions_1', 'Remove it: `bpmn set <file> Definitions_1 bar=` (vendor attributes need their namespace prefix, e.g. camunda:<name>).'],
      ['Plane_1', 'Remove foo="..." from the XML of Plane_1, or redraw the diagram, which writes new diagram elements: `bpmn layout <file>` (the hand-made layout is lost).'],
    ]);
  });

  it('a misspelt vendor attribute is moved in one command; a defined key still cannot be set to an unknown one', async () => {
    const doc = await Doc.fromXml(xml(chain([['T', '<bpmn:userTask id="T" assignee="demo" />']])));
    const [f] = runProfile(doc).findings;
    expect(f!.hint).toContain('`bpmn set <file> T assignee= camunda:assignee=demo`');
    runOps(doc, [{ op: 'set', id: 'T', values: { assignee: '', 'camunda:assignee': 'demo' } }]);
    expect(doc.require('T').$attrs).toEqual({ 'camunda:assignee': 'demo' });
    expect(() => runOps(doc, [{ op: 'set', id: 'T', values: { assignee: 'x' } }])).toThrow(/Unknown key "assignee"/);
  });
});

/* ------------------------------------------------------------------ */
/* 5. CLI output                                                        */
/* ------------------------------------------------------------------ */

describe('CLI output', () => {
  it('validate: a Camunda 8 file counts the findings of the Camunda 8 profile (step 3; before: "no Camunda 8 engine rules yet")', () => {
    const file = join(dir, 'c8.bpmn');
    writeFileSync(file, xml(chain([['T', '<bpmn:serviceTask id="T"><bpmn:extensionElements><zeebe:taskDefinition type="t" /></bpmn:extensionElements></bpmn:serviceTask>']]), { ns: 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"', attrs: '' }));
    const r = cli('validate', file);
    expect(r.out).toContain('platform: c8 (1 zeebe attribute(s)/element(s)) - 0 refused at deploy, 0 runtime, 0 practice finding(s)');
    expect(r.out).not.toContain('no Camunda 8 engine rules yet');
  });

  it('validate: import warnings are counted, and --strict fails on them', () => {
    const file = join(dir, 'twoloops.bpmn');
    writeFileSync(file, xml(chain([['T', '<bpmn:userTask id="T"><bpmn:standardLoopCharacteristics id="SL" /><bpmn:multiInstanceLoopCharacteristics id="MI" camunda:collection="${items}" /></bpmn:userTask>']])));
    const r = cli('validate', file);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^import: duplicate element/m);
    expect(r.out).toMatch(/valid, 0 warning\(s\), 1 import warning\(s\)$/m);
    expect(cli('validate', file, '--strict').code).toBe(5);
  });

  it('a write shows an op W_EVENT_GATEWAY_TARGET about a new branch next to the lint one about another branch', () => {
    const file = join(dir, 'gw.bpmn');
    writeFileSync(
      file,
      xml(
        `<bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" /><bpmn:eventBasedGateway id="G" />
<bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="W" /><bpmn:intermediateCatchEvent id="W">${MSG}</bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="F3" sourceRef="W" targetRef="End" /><bpmn:endEvent id="End" />
<bpmn:sequenceFlow id="F4" sourceRef="G" targetRef="U" /><bpmn:userTask id="U" /><bpmn:sequenceFlow id="F5" sourceRef="U" targetRef="End" />
<bpmn:receiveTask id="R" messageRef="M2" /><bpmn:sequenceFlow id="F6" sourceRef="R" targetRef="End" />`,
        { ns: '', attrs: '', roots: `${ROOTS}<bpmn:message id="M2" name="Ship" />` },
      ),
    );
    const r = cli('connect', file, 'G', 'R', '--no-layout');
    expect(r.code, r.err).toBe(0);
    const lines = r.out.split('\n').filter((l) => l.includes('W_EVENT_GATEWAY_TARGET'));
    // lint: G -> U (a user task); op: G -> R (a receive task mixed with a message catch event)
    expect(lines.filter((l) => l.includes('leads to userTask U'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('now leads to R'))).toHaveLength(1);
  }, 30000);
});

describe('an explicit mutation platform decides the engine rules of the ops', () => {
  /** start -> event-based gateway -> message catch Catch -> receive task R -> end, plus a timer branch */
  const GW = (ns: string, attrs: string): string =>
    xml(
      `<bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" /><bpmn:eventBasedGateway id="G" />
<bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="Catch" /><bpmn:intermediateCatchEvent id="Catch">${MSG}</bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="F3" sourceRef="Catch" targetRef="R" />
<bpmn:receiveTask id="R" messageRef="M2" /><bpmn:sequenceFlow id="F4" sourceRef="R" targetRef="End" /><bpmn:endEvent id="End" />
<bpmn:sequenceFlow id="F5" sourceRef="G" targetRef="T" /><bpmn:intermediateCatchEvent id="T">${TIMER}</bpmn:intermediateCatchEvent><bpmn:sequenceFlow id="F6" sourceRef="T" targetRef="End2" /><bpmn:endEvent id="End2" />`,
      { ns, attrs, roots: `${ROOTS}<bpmn:message id="M2" name="Ship" />` },
    );
  const remove: Op[] = [{ op: 'remove', ids: ['Catch'] }];
  const code = async (x: string, platform?: 'c7' | 'none'): Promise<string> => {
    try {
      await mutateDoc(await Doc.fromXml(x), remove, { dryRun: true, layout: false, ...(platform ? { platform } : {}) });
      return 'ok';
    } catch (err) {
      return (err as { code: string }).code;
    }
  };

  it('a plain file bridges to a receive task (BPMN 2.0), with platform c7 the engines refuse it', async () => {
    expect(await code(GW('', ''))).toBe('ok');
    expect(await code(GW('', ''), 'c7')).toBe('E_INVALID_BRIDGE');
  });

  it('a Camunda 7 file refuses the bridge, with platform none BPMN 2.0 decides', async () => {
    expect(await code(GW(C7, 'camunda:historyTimeToLive="180"'))).toBe('E_INVALID_BRIDGE');
    expect(await code(GW(C7, 'camunda:historyTimeToLive="180"'), 'none')).toBe('ok');
  });
});

describe('self-description', () => {
  it('kinds (text and --json) documents the definition[<n>] / definition[<trigger>] selectors and the new codes', () => {
    const json = kindsJson() as { nestedSelectors: Record<string, string>; errors: Array<{ code: string }> };
    expect(Object.keys(json.nestedSelectors)).toEqual(['definition[<n>].<key>', 'definition[<trigger>].<key>']);
    expect(kindsText()).toContain('definition[<n>].<key>: one of several event definitions');
    for (const code of ['E_AMBIGUOUS_NESTED', 'W_C7_DEPLOY_START_EVENT', 'W_C7_DEPLOY_LINK', 'W_C7_DEPLOY_SCHEMA', 'W_C7_EMPTY_CONDITION', MULTIPLE]) {
      expect(json.errors.map((e) => e.code)).toContain(code);
    }
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
  form.append('enable-duplicate-filtering', 'false');
  form.append('data', new Blob([bpmn], { type: 'application/octet-stream' }), `${name}.bpmn`);
  const res = await fetch(`${engine}/deployment/create`, { method: 'POST', body: form });
  const body = (await res.json()) as { id?: string; message?: string };
  if (res.ok && body.id) {
    await fetch(`${engine}/deployment/${body.id}?cascade=true`, { method: 'DELETE' });
    return { ok: true, message: '' };
  }
  return { ok: false, message: body.message ?? String(res.status) };
}

describe.skipIf(!ENGINES.length)('live engines: the engines agree with CASES', () => {
  for (const engine of ENGINES) {
    it.each(CASES.map((c, i) => [c.name, c, i] as const))(`${engine}: %s`, async (_name, c, i) => {
      const result = await deploy(engine, `bpmn-cli-c7-integration-${i}`, c.xml);
      expect(result.ok, result.message).toBe(c.engine === 'accept');
    }, 30000);
  }
});
