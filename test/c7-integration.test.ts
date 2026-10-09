/**
 * Regression tests for the Camunda 7 audit, integration step (synthetic fixtures only):
 *  - new --target rejects unknown platforms (audit #17)
 *  - extension content is shown as an indented tree in `show <id>` and `ext list` (#16)
 *  - extension elements of nested elements: definition. / loop. / condition. on `ext` (#3, the
 *    extension part: retry cycle on a multi-instance loop, camunda:in on a signal definition)
 *  - a boundary event on a compensation handler is a structural error, so `set isForCompensation=true`
 *    on a host with boundary events is refused too (#14)
 *  - move: the event-gateway bridge rule for move --in, and a hint without `--no-bridge` (#5)
 *  - apply: "message" on add ops for send / receive tasks (#11)
 *  - camunda Boolean attributes are written as exactly true / false (#9, asyncBefore=yes)
 *  - `find` prints the matched vendor value; `kinds` documents --message on tasks and the nested keys (#8, #11)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseOps } from '../src/batch.js';
import { Doc } from '../src/document.js';
import { renderDetail, renderExtensionList } from '../src/format.js';
import { kindsJson, kindsText } from '../src/guide.js';
import { is, type El } from '../src/model.js';
import { extensionOp, listAllExtensions } from '../src/ops/ext.js';
import { runOps } from '../src/ops/index.js';
import { moveElements } from '../src/ops/move.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';
import { validateDoc } from '../src/validate.js';
import { elementDetail } from '../src/view.js';
import * as lib from '../src/index.js';
import { definitionsXml } from './helpers.js';

const ROOT = join(__dirname, '..');
const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';

function caught(fn: () => unknown): { code?: string; message: string; details: Record<string, unknown> } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected an error');
}

async function caughtAsync(fn: () => Promise<unknown>): Promise<{ code?: string; message: string; details: Record<string, unknown> }> {
  try {
    await fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected an error');
}

function cli(...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-c7-int-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A C7 model: start -> user task (collection multi-instance) -> signal throw -> end. */
async function nestedDoc(): Promise<Doc> {
  const doc = Doc.create({ target: 'camunda7', processId: 'nested', processName: 'Nested' });
  runOps(doc, [
    { op: 'add', kind: 'startEvent', name: 'Start', id: 'Event_Start' },
    { op: 'add', kind: 'userTask', name: 'Review item', id: 'Activity_Review', after: 'Event_Start', set: { 'loop.camunda:collection': '${items}', 'loop.camunda:elementVariable': 'item' } },
    { op: 'add', kind: 'intermediateThrowEvent:signal', name: 'Go', id: 'Event_Go', after: 'Activity_Review', signal: 'Go' },
    { op: 'add', kind: 'endEvent', name: 'Done', id: 'Event_Done', after: 'Event_Go' },
  ] as Op[]);
  return Doc.fromXml(await doc.toXml());
}

/* ------------------------------------------------------------------ */
/* #17 new --target                                                      */
/* ------------------------------------------------------------------ */

describe('new --target accepts only known platforms (#17)', () => {
  it.each(['camunda-7', 'operaton', 'c7'])('--target %s fails with E_USAGE and writes nothing', (target) => {
    const file = join(dir, `t-${target}.bpmn`);
    const r = cli('new', file, '--target', target);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/E_USAGE/);
    expect(r.err).toMatch(/camunda8 or camunda7/);
    expect(existsSync(file)).toBe(false);
  });

  it('the library refuses an unknown target too', () => {
    expect(caught(() => Doc.create({ target: 'operaton' as never })).code).toBe('E_USAGE');
    expect(lib.TARGETS).toEqual(['camunda8', 'camunda7', 'none']);
  });

  it('camunda7 still works', () => {
    const file = join(dir, 'ok.bpmn');
    expect(cli('new', file, '--target', 'camunda7').code).toBe(0);
    expect(readFileSync(file, 'utf8')).toContain('camunda:historyTimeToLive="180"');
  });
});

/* ------------------------------------------------------------------ */
/* #16 text views of nested extension content                            */
/* ------------------------------------------------------------------ */

const IO_TREE = `<bpmn:serviceTask id="Activity_Call" camunda:expression="\${true}"><bpmn:extensionElements><camunda:inputOutput>
  <camunda:inputParameter name="lst"><camunda:list><camunda:value>a</camunda:value><camunda:value>b</camunda:value></camunda:list></camunda:inputParameter>
  <camunda:inputParameter name="mp"><camunda:map><camunda:entry key="k">v</camunda:entry></camunda:map></camunda:inputParameter>
  <camunda:outputParameter name="out">\${x}</camunda:outputParameter>
</camunda:inputOutput></bpmn:extensionElements></bpmn:serviceTask>`;

describe('show <id> and ext list print extension content as an indented tree (#16)', () => {
  const expected = [
    'camunda:inputOutput',
    '  camunda:inputParameter name="lst"',
    '    camunda:list',
    '      camunda:value body="a"',
    '      camunda:value body="b"',
    '  camunda:inputParameter name="mp"',
    '    camunda:map',
    '      camunda:entry key="k" body="v"',
    '  camunda:outputParameter name="out" body="${x}"',
  ];

  it('show <id>: one line per element, children two spaces deeper', async () => {
    const doc = await Doc.fromXml(definitionsXml(IO_TREE, { nsDecl: CAMUNDA }));
    const text = renderDetail(elementDetail(doc, doc.require('Activity_Call')));
    expect(text).toContain(['extensions:', ...expected.map((l) => `  ${l}`)].join('\n'));
  });

  it('ext list: the same tree under the index (text), the full tree in --json', async () => {
    const file = join(dir, 'io.bpmn');
    writeFileSync(file, definitionsXml(IO_TREE, { nsDecl: CAMUNDA }));
    const r = cli('ext', 'list', file, 'Activity_Call');
    expect(r.code).toBe(0);
    expect(r.out.trimEnd()).toBe([`0: ${expected[0]}`, ...expected.slice(1).map((l) => `   ${l}`)].join('\n'));
    const json = JSON.parse(cli('ext', 'list', file, 'Activity_Call', '--json').out);
    expect(json[0].children[0].children[0].children.map((c: { body: string }) => c.body)).toEqual(['a', 'b']);
  });
});

/* ------------------------------------------------------------------ */
/* #3 extension elements of nested elements                              */
/* ------------------------------------------------------------------ */

describe('ext on nested elements: definition. / loop. / condition. (#3)', () => {
  it('adds a retry cycle to the multi-instance loop and camunda:in to the signal definition', async () => {
    const doc = await nestedDoc();
    const cs = extensionOp(doc, { op: 'ext', id: 'Activity_Review', action: 'add', type: 'loop.camunda:failedJobRetryTimeCycle', body: 'R3/PT5M' });
    expect(cs.changed[0]).toMatchObject({ id: 'Activity_Review', detail: 'ext added loop.camunda:failedJobRetryTimeCycle' });
    extensionOp(doc, { op: 'ext', id: 'Event_Go', action: 'add', slot: 'definition', type: 'camunda:in', attrs: { variables: 'all' } });
    const xml = await doc.toXml();
    expect(xml).toMatch(/<bpmn:multiInstanceLoopCharacteristics [^>]*>\s*<bpmn:extensionElements>\s*<camunda:failedJobRetryTimeCycle>R3\/PT5M<\/camunda:failedJobRetryTimeCycle>/);
    expect(xml).toMatch(/<bpmn:signalEventDefinition [^>]*>\s*<bpmn:extensionElements>\s*<camunda:in variables="all" \/>/);
    // the activity itself got nothing
    expect(doc.require('Activity_Review').get('extensionElements')).toBeUndefined();
    // listed with their slot; show <id> prints them under <slot>.extensions
    expect(listAllExtensions(doc.require('Activity_Review'))).toEqual([{ index: 0, slot: 'loop', type: 'camunda:failedJobRetryTimeCycle', attrs: {}, body: 'R3/PT5M' }]);
    expect(renderExtensionList(listAllExtensions(doc.require('Event_Go')))).toBe('definition.0: camunda:in variables="all"');
    expect(renderDetail(elementDetail(doc, doc.require('Activity_Review')))).toContain('loop.extensions:\n  camunda:failedJobRetryTimeCycle body="R3/PT5M"');
  });

  it('merges / refuses like on the element itself, with hints that use the prefix', async () => {
    const doc = await nestedDoc();
    extensionOp(doc, { op: 'ext', id: 'Activity_Review', action: 'add', type: 'loop.camunda:failedJobRetryTimeCycle', body: 'R3/PT5M' });
    const dup = caught(() => extensionOp(doc, { op: 'ext', id: 'Activity_Review', action: 'add', type: 'loop.camunda:failedJobRetryTimeCycle', body: 'R5/PT5M' }));
    expect(dup.code).toBe('E_DUPLICATE_EXTENSION');
    expect(dup.message).toMatch(/the loop characteristics of Activity_Review already has a camunda:failedJobRetryTimeCycle/);
    expect(dup.details['element']).toBe('Activity_Review');
    expect(dup.details['hint']).toMatch(/bpmn ext remove <file> Activity_Review loop\.<selector>/);
    extensionOp(doc, { op: 'ext', id: 'Activity_Review', action: 'add', type: 'loop.camunda:failedJobRetryTimeCycle', body: 'R5/PT5M', replace: true });
    expect(await doc.toXml()).toContain('<camunda:failedJobRetryTimeCycle>R5/PT5M</camunda:failedJobRetryTimeCycle>');
  });

  it('removes by selector and by index; the empty container goes', async () => {
    const doc = await nestedDoc();
    extensionOp(doc, { op: 'ext', id: 'Activity_Review', action: 'add', type: 'loop.camunda:failedJobRetryTimeCycle', body: 'R3/PT5M' });
    const cs = extensionOp(doc, { op: 'ext', id: 'Activity_Review', action: 'remove', type: 'loop.camunda:failedJobRetryTimeCycle' });
    expect(cs.changed[0]!.detail).toBe('ext removed loop.camunda:failedJobRetryTimeCycle');
    expect(doc.require('Activity_Review').get<El>('loopCharacteristics').get('extensionElements')).toBeUndefined();
    extensionOp(doc, { op: 'ext', id: 'Event_Go', action: 'add', type: 'definition.camunda:in', attrs: { variables: 'all' } });
    extensionOp(doc, { op: 'ext', id: 'Event_Go', action: 'remove', slot: 'definition', index: 0 });
    expect(listAllExtensions(doc.require('Event_Go'))).toEqual([]);
  });

  it('explains a missing or impossible nested element', async () => {
    const doc = await nestedDoc();
    const noLoop = caught(() => extensionOp(doc, { op: 'ext', id: 'Event_Go', action: 'add', type: 'loop.camunda:failedJobRetryTimeCycle', body: 'R3/PT5M' }));
    expect(noLoop.code).toBe('E_WRONG_KIND');
    const noDefinition = caught(() => extensionOp(doc, { op: 'ext', id: 'Event_Start', action: 'add', type: 'definition.camunda:in', attrs: { variables: 'all' } }));
    expect(noDefinition.code).toBe('E_NO_NESTED_ELEMENT');
    expect(noDefinition.details['hint']).toMatch(/trigger=/);
    runOps(doc, [{ op: 'set', id: 'Activity_Review', values: { loop: 'none' } }]);
    const removed = caught(() => extensionOp(doc, { op: 'ext', id: 'Activity_Review', action: 'add', type: 'loop.camunda:failedJobRetryTimeCycle', body: 'R3/PT5M' }));
    expect(removed.code).toBe('E_NO_NESTED_ELEMENT');
    expect(removed.details['hint']).toMatch(/loop=parallel/);
  });

  it('works through the CLI (prefix on the type, loop.<n> on remove) and apply ("slot")', async () => {
    const file = join(dir, 'nested.bpmn');
    writeFileSync(file, await (await nestedDoc()).toXml());
    expect(cli('ext', 'add', file, 'Activity_Review', 'loop.camunda:failedJobRetryTimeCycle', '--body', 'R3/PT5M').code).toBe(0);
    expect(cli('ext', 'list', file, 'Activity_Review').out.trim()).toBe('loop.0: camunda:failedJobRetryTimeCycle body="R3/PT5M"');
    const rm = cli('ext', 'remove', file, 'Activity_Review', 'loop.0');
    expect(rm.code).toBe(0);
    expect(rm.out).toContain('ext removed loop.camunda:failedJobRetryTimeCycle');
    const ops = parseOps([{ op: 'ext', id: 'Event_Go', action: 'add', slot: 'definition', type: 'camunda:in', attrs: { variables: 'all' } }]);
    expect(ops[0]).toMatchObject({ slot: 'definition' });
    expect(() => parseOps([{ op: 'ext', id: 'Event_Go', action: 'add', slot: 'body', type: 'camunda:in' }])).toThrow(/slot/);
  });
});

/* ------------------------------------------------------------------ */
/* #14 boundary events on compensation handlers                          */
/* ------------------------------------------------------------------ */

const COMPENSATION = definitionsXml(
  `
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Activity_Book" />
    <bpmn:serviceTask id="Activity_Book" camunda:expression="\${true}"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:sequenceFlow id="F2" sourceRef="Activity_Book" targetRef="End" />
    <bpmn:endEvent id="End"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:boundaryEvent id="Event_Comp" attachedToRef="Activity_Book"><bpmn:compensateEventDefinition /></bpmn:boundaryEvent>
    <bpmn:serviceTask id="Activity_Revoke" isForCompensation="true" camunda:expression="\${true}" />
    <bpmn:serviceTask id="Activity_Audit" camunda:expression="\${true}" />
    <bpmn:boundaryEvent id="Event_AuditTimeout" attachedToRef="Activity_Audit"><bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>
    <bpmn:association id="A1" associationDirection="One" sourceRef="Event_Comp" targetRef="Activity_Revoke" />`,
  { nsDecl: CAMUNDA },
);

describe('a boundary event on a compensation handler is a structural error (#14)', () => {
  it('validate reports E_INVALID_HOST for a loaded file', async () => {
    const doc = await Doc.fromXml(COMPENSATION.replace('attachedToRef="Activity_Audit"', 'attachedToRef="Activity_Revoke"'));
    const err = validateDoc(doc).errors.find((e) => e.code === 'E_INVALID_HOST');
    expect(err).toMatchObject({ element: 'Event_AuditTimeout', related: ['Activity_Revoke'] });
    expect(err!.hint).toMatch(/isForCompensation=false/);
  });

  it('set isForCompensation=true on an activity with a boundary event is refused (E_VALIDATION)', async () => {
    const doc = await Doc.fromXml(COMPENSATION);
    const err = await caughtAsync(() => mutateDoc(doc, [{ op: 'set', id: 'Activity_Audit', values: { isForCompensation: 'true' } }], { dryRun: true, layout: false }));
    expect(err.code).toBe('E_VALIDATION');
    expect(JSON.stringify(err.details)).toMatch(/E_INVALID_HOST/);
    // without a boundary event it is fine
    const ok = await Doc.fromXml(COMPENSATION);
    await mutateDoc(ok, [{ op: 'set', id: 'Activity_Book', values: { name: 'Book' } }], { dryRun: true, layout: false });
  });
});

/* ------------------------------------------------------------------ */
/* #5 move bridges next to an event-based gateway                        */
/* ------------------------------------------------------------------ */

const GATEWAY = definitionsXml(
  `
    <bpmn:startEvent id="Start"><bpmn:outgoing>F0</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="Gateway_Wait" />
    <bpmn:eventBasedGateway id="Gateway_Wait"><bpmn:incoming>F0</bpmn:incoming><bpmn:outgoing>F_A</bpmn:outgoing><bpmn:outgoing>F_T</bpmn:outgoing></bpmn:eventBasedGateway>
    <bpmn:sequenceFlow id="F_A" sourceRef="Gateway_Wait" targetRef="Event_Paid" />
    <bpmn:intermediateCatchEvent id="Event_Paid"><bpmn:incoming>F_A</bpmn:incoming><bpmn:outgoing>F_A2</bpmn:outgoing><bpmn:messageEventDefinition messageRef="Message_Paid" /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F_A2" sourceRef="Event_Paid" targetRef="Activity_Ship" />
    <bpmn:userTask id="Activity_Ship"><bpmn:incoming>F_A2</bpmn:incoming><bpmn:outgoing>F_A3</bpmn:outgoing></bpmn:userTask>
    <bpmn:sequenceFlow id="F_A3" sourceRef="Activity_Ship" targetRef="End_A" />
    <bpmn:endEvent id="End_A"><bpmn:incoming>F_A3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F_T" sourceRef="Gateway_Wait" targetRef="Event_Timeout" />
    <bpmn:intermediateCatchEvent id="Event_Timeout"><bpmn:incoming>F_T</bpmn:incoming><bpmn:outgoing>F_T2</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F_T2" sourceRef="Event_Timeout" targetRef="End_T" />
    <bpmn:endEvent id="End_T"><bpmn:incoming>F_T2</bpmn:incoming></bpmn:endEvent>
    <bpmn:subProcess id="Activity_Sub"><bpmn:startEvent id="Sub_Start" /></bpmn:subProcess>`,
  { nsDecl: CAMUNDA, extraRoots: '  <bpmn:message id="Message_Paid" name="Paid" />' },
);

describe('move: no bridge from an event-based gateway to a target the engines reject (#5)', () => {
  it('move --in refuses the group bridge (it used to bridge Gateway_Wait -> Activity_Ship)', async () => {
    const doc = await Doc.fromXml(GATEWAY);
    const err = caught(() => moveElements(doc, { op: 'move', ids: ['Event_Paid'], in: 'Activity_Sub' }));
    expect(err.code).toBe('E_INVALID_BRIDGE');
    expect(err.message).toMatch(/Moving Event_Paid would connect the event-based gateway Gateway_Wait to Activity_Ship/);
    expect(doc.require('F_A').get<El>('targetRef').get('id')).toBe('Event_Paid');
  });

  it('the move hint does not offer `move --no-bridge` (there is none)', async () => {
    const doc = await Doc.fromXml(GATEWAY);
    const err = caught(() => moveElements(doc, { op: 'move', ids: ['Event_Paid'], after: 'Event_Timeout' }));
    expect(err.code).toBe('E_INVALID_BRIDGE');
    expect(err.details['hint']).toMatch(/A move always bridges its old place/);
    expect(err.details['hint']).not.toMatch(/bpmn move [^`]*--no-bridge/);
  });
});

/* ------------------------------------------------------------------ */
/* #11 apply: message on send / receive task add ops                    */
/* ------------------------------------------------------------------ */

describe('apply: "message" on add ops for send and receive tasks (#11)', () => {
  it('accepts it for receiveTask / sendTask and still refuses it for other tasks', async () => {
    const ops = parseOps([
      { op: 'add', kind: 'startEvent', id: 'Event_Start' },
      { op: 'add', kind: 'receiveTask', name: 'Wait payment', after: 'Event_Start', message: 'PaymentReceived' },
      { op: 'add', kind: 'sendTask', name: 'Send invoice', after: 'Activity_WaitPayment', message: 'Invoice' },
    ]);
    const doc = Doc.create({ target: 'camunda7' });
    const cs = runOps(doc, ops);
    expect(cs.warnings.map((w) => w.code)).not.toContain('W_OPTION_IGNORED');
    expect(doc.require('Activity_WaitPayment').get<El>('messageRef').get('name')).toBe('PaymentReceived');
    expect(doc.require('Activity_SendInvoice').get<El>('messageRef').get('name')).toBe('Invoice');
    expect(() => parseOps([{ op: 'add', kind: 'userTask', message: 'X' }])).toThrow(/only apply to events/);
  });
});

/* ------------------------------------------------------------------ */
/* #9 camunda Boolean attributes                                         */
/* ------------------------------------------------------------------ */

describe('camunda Boolean attributes are written as exactly true / false (#9)', () => {
  it('normalises yes / 1 / TRUE and refuses other values', async () => {
    const doc = await nestedDoc();
    const cs = runOps(doc, [{ op: 'set', id: 'Activity_Review', values: { 'camunda:asyncBefore': 'yes', 'camunda:exclusive': 'FALSE', 'loop.camunda:asyncAfter': '1' } }]);
    expect(cs.changed.map((c) => c.detail)).toEqual(['camunda:asyncBefore=true', 'camunda:exclusive=false', 'loop.camunda:asyncAfter=true']);
    const task = doc.require('Activity_Review');
    expect(task.$attrs['camunda:asyncBefore']).toBe('true');
    expect(task.get<El>('loopCharacteristics').$attrs['camunda:asyncAfter']).toBe('true');
    expect(caught(() => runOps(doc, [{ op: 'set', id: 'Activity_Review', values: { 'camunda:asyncBefore': 'maybe' } }])).code).toBe('E_INVALID_VALUE');
    // string attributes stay as given
    runOps(doc, [{ op: 'set', id: 'Activity_Review', values: { 'camunda:assignee': 'Yes' } }]);
    expect(task.$attrs['camunda:assignee']).toBe('Yes');
  });
});

/* ------------------------------------------------------------------ */
/* #8 / #11 find text, kinds                                             */
/* ------------------------------------------------------------------ */

describe('find shows the matched vendor value; kinds documents the C7 keys (#8, #11)', () => {
  it('find <text> prints the match of a vendor value hit', async () => {
    const doc = Doc.create({ target: 'camunda7', processId: 'p' });
    runOps(doc, [
      { op: 'add', kind: 'startEvent', id: 'Event_Start' },
      { op: 'add', kind: 'serviceTask', name: 'Charge', after: 'Event_Start', set: { 'camunda:type': 'external', 'camunda:topic': 'charge-card' } },
    ] as Op[]);
    const file = join(dir, 'find.bpmn');
    writeFileSync(file, await doc.toXml());
    const r = cli('find', file, 'charge-card');
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('serviceTask Activity_Charge "Charge"  (in p)  [camunda:topic=charge-card]');
  });

  it('kinds: --message on send / receive tasks, the set key groups and the nested keys', () => {
    const text = kindsText();
    expect(text).toMatch(/message +--message <name> .*on: .*boundaryEvent, sendTask, receiveTask/);
    expect(text).toMatch(/\nsendTask, receiveTask\n {2}message /);
    expect(text).toMatch(/NESTED KEYS/);
    const json = kindsJson() as { nestedKeys: Record<string, Record<string, string[]>>; triggers: Record<string, { alsoOn?: string[] }> };
    expect(json.nestedKeys['definition']!['bpmn:ErrorEventDefinition']).toEqual(expect.arrayContaining(['definition.id', 'definition.camunda:errorCodeVariable', 'definition.camunda:errorMessageVariable']));
    expect(json.nestedKeys['definition']!['bpmn:MessageEventDefinition']).toEqual(expect.arrayContaining(['definition.camunda:type', 'definition.camunda:topic']));
    expect(json.nestedKeys['loop']!['bpmn:MultiInstanceLoopCharacteristics']).toEqual(expect.arrayContaining(['loop.isSequential', 'loop.camunda:collection', 'loop.camunda:elementVariable', 'loop.camunda:asyncBefore']));
    expect(json.nestedKeys['condition']!['bpmn:FormalExpression']).toEqual(expect.arrayContaining(['condition.camunda:resource', 'condition.language']));
    expect(json.triggers['message']!.alsoOn).toEqual(['sendTask', 'receiveTask']);
  });

  it('the library exports the platform profile', () => {
    expect(typeof lib.runProfile).toBe('function');
    expect(typeof lib.detectPlatform).toBe('function');
    expect(lib.PLATFORM_CHOICES).toEqual(['auto', 'c7', 'c8', 'none']);
  });
});

it('fixtures are BPMN elements (sanity)', async () => {
  const doc = await Doc.fromXml(GATEWAY);
  expect(is(doc.require('Gateway_Wait'), 'bpmn:EventBasedGateway')).toBe(true);
});
