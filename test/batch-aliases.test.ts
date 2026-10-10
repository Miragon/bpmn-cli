/**
 * Batch aliases: an op names what it creates (`"as": "$name"`, `"flowAs"`,
 * `"joinAs"`), later ops of the batch use the alias wherever an element id
 * goes, the result lists alias -> final id. Synthetic fixtures only.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { renderMutation } from '../src/report.js';
import { OPS_SCHEMA, opsExample, parseOps } from '../src/batch.js';
import { Doc } from '../src/document.js';
import { CliError } from '../src/errors.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';

function failure(fn: () => unknown): CliError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CliError) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

async function rejection(p: Promise<unknown>): Promise<CliError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof CliError) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

/** A German invoice check in one batch: every later op refers to what earlier ops created by alias. */
const INVOICE: unknown[] = [
  { op: 'add', kind: 'start', name: 'Rechnung eingegangen', as: '$start' },
  { op: 'add', kind: 'userTask', name: 'Vollständigkeit prüfen', after: '$start', as: '$check' },
  {
    op: 'split',
    after: '$check',
    name: 'Vollständig?',
    as: '$ok',
    joinAs: '$join',
    branches: [
      { flowName: 'ja', nodes: [{ kind: 'serviceTask', name: 'Buchen', as: '$book', flowAs: '$yes' }] },
      { flowName: 'nein', nodes: [{ kind: 'userTask', name: 'Nachfordern', as: '$ask', flowAs: '$no' }] },
    ],
  },
  { op: 'add', kind: 'end', name: 'Erledigt', after: '$join' },
  { op: 'set', id: '$ok', values: { default: '$no' } },
  { op: 'set', id: '$yes', values: { condition: '${vollstaendig}' } },
  { op: 'add', kind: 'boundaryEvent:timer', on: '$ask', timer: 'P3D', nonInterrupting: true, as: '$late' },
  { op: 'add', kind: 'endEvent', name: 'Erinnert', after: '$late', flowAs: '$lateFlow' },
  { op: 'color', ids: ['$check', '$yes', '$lateFlow'], color: 'green' },
];

describe('batch aliases', () => {
  it('resolve in every id field, in set values and in format ops; the result lists alias -> final id', async () => {
    const r = await applyToXml((await newXml({ processName: 'Rechnungsprüfung' })).xml, INVOICE);
    expect(r.result.aliases).toEqual({
      $start: 'Event_RechnungEingegangen',
      $check: 'Activity_VollstaendigkeitPruefen',
      $ok: 'Gateway_Vollstaendig',
      $yes: 'Flow_VollstaendigToBuchen',
      $book: 'Activity_Buchen',
      $no: 'Flow_VollstaendigToNachfordern',
      $ask: 'Activity_Nachfordern',
      $join: 'Gateway_Vollstaendig_join',
      $late: 'Event_TimerOnNachfordern',
      $lateFlow: 'Flow_TimerToErinnert',
    });
    expect(r.xml).toContain('<bpmn:exclusiveGateway id="Gateway_Vollstaendig" name="Vollständig?" default="Flow_VollstaendigToNachfordern">');
    expect(r.xml).toMatch(/<bpmn:sequenceFlow id="Flow_VollstaendigToBuchen" name="ja" sourceRef="Gateway_Vollstaendig" targetRef="Activity_Buchen">\s*<bpmn:conditionExpression[^>]*>\$\{vollstaendig\}<\/bpmn:conditionExpression>/);
    expect(r.result.layout.format?.[0]).toMatchObject({ op: 'color', colored: ['Activity_VollstaendigkeitPruefen', 'Flow_VollstaendigToBuchen', 'Flow_TimerToErinnert'] });
    expect(renderMutation(r.result)).toContain('aliases: $start = Event_RechnungEingegangen, $check = Activity_VollstaendigkeitPruefen, $ok = Gateway_Vollstaendig');
    // without aliases the result has none
    expect((await applyToXml(r.xml, [{ op: 'set', id: 'Activity_Buchen', values: { name: 'Buchen!' } }])).result.aliases).toBeUndefined();
  });

  it('an alias names the element itself: it follows a rename later in the batch', async () => {
    const start = await applyToXml((await newXml({ processName: 'P' })).xml, [
      { op: 'add', kind: 'start', name: 'Start' },
      { op: 'add', kind: 'end', name: 'End', after: 'Event_Start' },
    ]);
    const r = await applyToXml(start.xml, [
      { op: 'add', kind: 'task', name: 'Work', after: 'Event_Start', as: '$work', flowAs: '$in' },
      // splicing into $in renames it (its id named Start and Work); $in follows
      { op: 'add', kind: 'task', name: 'Prepare', flow: '$in' },
      { op: 'set', id: '$in', values: { name: 'go' } },
      { op: 'color', ids: ['$in'], color: 'blue' },
    ]);
    expect(r.result.aliases).toEqual({ $work: 'Activity_Work', $in: 'Flow_StartToPrepare' });
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_StartToPrepare" name="go" sourceRef="Event_Start" targetRef="Activity_Prepare" />');
    expect(r.result.layout.format?.[0]).toMatchObject({ colored: ['Flow_StartToPrepare'] });
  });

  it('resolve in the lane of split nodes and in the set map of add', async () => {
    const r = await applyToXml((await newXml({ processName: 'P' })).xml, [
      { op: 'add', kind: 'participant', name: 'P' },
      { op: 'add', kind: 'lane', name: 'Clerk', in: 'Participant_P', as: '$clerk' },
      { op: 'add', kind: 'lane', name: 'Accounting', in: 'Participant_P', as: '$acc' },
      { op: 'add', kind: 'start', name: 'S', in: 'Process_P', lane: '$clerk', as: '$s' },
      { op: 'split', after: '$s', name: 'Ok?', as: '$ok', branches: [{ nodes: [{ kind: 'task', name: 'Book', lane: '$acc', set: { lane: '$acc' } }] }, { nodes: [{ kind: 'task', name: 'Ask', flowAs: '$ask' }] }] },
      { op: 'add', kind: 'task', name: 'Log', in: 'Process_P', set: { lane: '$acc' } },
      { op: 'set', id: '$ok', values: { default: '$ask' } },
    ]);
    const doc = await Doc.fromXml(r.xml);
    expect(doc.lanesOf(doc.require('Activity_Book')).map((l) => l.get('id'))).toEqual(['Lane_Accounting']);
    expect(doc.lanesOf(doc.require('Activity_Log')).map((l) => l.get('id'))).toEqual(['Lane_Accounting']);
    expect(r.xml).toContain('default="Flow_OkToAsk"');
    expect(() => parseOps([{ op: 'split', after: 'X', branches: [{ nodes: [{ kind: 'task', lane: '$nope' }] }] }])).toThrow(/"branches\[0\]\.nodes\[0\]\.lane": alias \$nope is not defined/);
  });

  it('connect names the connection (not the message it creates); --if-absent binds the existing element', async () => {
    const base = await applyToXml((await newXml({ processName: 'Shop' })).xml, [
      { op: 'add', kind: 'start', name: 'Order' },
      { op: 'add', kind: 'sendTask', name: 'Confirm', after: 'Event_Order' },
      { op: 'add', kind: 'participant', name: 'Shop' },
      { op: 'add', kind: 'participant', name: 'Customer', blackBox: true },
    ]);
    const r = await applyToXml(base.xml, [
      { op: 'connect', source: 'Activity_Confirm', target: 'Participant_Customer', message: 'Confirmation', as: '$mf' },
      { op: 'add', kind: 'task', id: 'Activity_Confirm', ifAbsent: true, as: '$confirm' },
      { op: 'connect', source: '$confirm', target: 'Participant_Customer', ifAbsent: true, as: '$same' },
    ]);
    expect(r.result.aliases).toEqual({ $mf: 'Flow_ConfirmToCustomer', $confirm: 'Activity_Confirm', $same: 'Flow_ConfirmToCustomer' });
  });

  it('is checked before anything runs: unknown (with the defined ones), defined later or twice, malformed, in an id field', () => {
    const unknown = failure(() => parseOps([{ op: 'add', kind: 'start', name: 'S', as: '$start' }, { op: 'add', kind: 'task', name: 'T', after: '$strat' }]));
    expect(unknown.code).toBe('E_UNKNOWN_ALIAS');
    expect(unknown.exitCode).toBe(1);
    expect(unknown.message).toBe('ops[1] (add): "after": alias $strat is not defined (did you mean $start?); defined so far: $start (ops[0])');
    expect(unknown.details.candidates).toEqual(['$start']);
    expect(unknown.details.op).toBe(1);
    const later = failure(() => parseOps([{ op: 'remove', ids: ['$t'] }, { op: 'add', kind: 'task', name: 'T', as: '$t' }]));
    expect(later.message).toBe('ops[0] (remove): "ids[0]": alias $t is not defined before this op (ops[1] defines it); no op before it defines one');
    const own = failure(() => parseOps([{ op: 'add', kind: 'task', name: 'T', as: '$t', after: '$t' }]));
    expect(own.message).toMatch(/alias \$t is not defined yet \(this op defines it/);
    const twice = failure(() => parseOps([{ op: 'add', kind: 'task', name: 'A', as: '$t' }, { op: 'add', kind: 'task', name: 'B', as: '$t' }]));
    expect([twice.code, twice.message]).toEqual(['E_DUPLICATE_ALIAS', 'ops[1] (add): alias $t is already defined by ops[0]']);
    expect(failure(() => parseOps([{ op: 'add', kind: 'task', name: 'A', as: 'check' }])).message).toMatch(/"as" must be an alias like "\$check"/);
    expect(failure(() => parseOps([{ op: 'add', kind: 'task', name: 'A', id: '$a' }])).message).toBe('ops[0] (add): "id" is the id of the new element, not an alias; give the alias with "as": "$a"');
    expect(failure(() => parseOps([{ op: 'add', kind: 'task', name: 'A', in: 'Process_1', flowAs: '$f' }])).message).toMatch(/"flowAs" describe the flow into the node and need "after", "before" or "flow"/);
    // expressions are no aliases: set values other than ids stay as they are
    expect(parseOps([{ op: 'set', id: 'Flow_1', values: { condition: '${ok}', name: '$5 fee' } }])).toHaveLength(1);
  });

  it('typed ops of the library are resolved and checked the same way while they run', async () => {
    const doc = await Doc.fromXml((await newXml({ processName: 'P' })).xml);
    const ops = [{ op: 'add', kind: 'startEvent', name: 'S', as: '$s' }, { op: 'add', kind: 'task', name: 'T', after: '$x' }] as Op[];
    const e = await rejection(mutateDoc(doc, ops));
    expect([e.code, e.details.op, e.details.candidates]).toEqual(['E_UNKNOWN_ALIAS', 1, ['$s']]);
    const removed = await rejection(mutateDoc(await Doc.fromXml((await newXml({ processName: 'P' })).xml), [{ op: 'add', kind: 'task', name: 'T', as: '$t' }, { op: 'remove', ids: ['$t'] }, { op: 'set', id: '$t', values: { name: 'x' } }] as Op[]));
    expect([removed.code, removed.message]).toEqual(['E_NOT_FOUND', 'ops[2] (set): "id": $t named Activity_T, which an op before this one removed']);
  });

  it('joinAs without a join gateway is refused', async () => {
    const xml = (await applyToXml((await newXml({ processName: 'P' })).xml, [{ op: 'add', kind: 'start', name: 'S' }, { op: 'add', kind: 'task', name: 'T', after: 'Event_S' }])).xml;
    const e = await rejection(applyToXml(xml, [{ op: 'split', after: 'Activity_T', join: false, joinAs: '$j', branches: [{ nodes: [{ kind: 'end', name: 'A' }] }, { nodes: [{ kind: 'end', name: 'B' }] }] }]));
    expect([e.code, e.message]).toEqual(['E_USAGE', 'joinAs $j: split Gateway_AfterT creates no join gateway (join is false)']);
  });

  it('the documented example (bpmn kinds --json -> opsExample) runs on the file it describes', async () => {
    const order = await applyToXml((await newXml({ processName: 'Order handling', target: 'camunda8' })).xml, [
      { op: 'add', kind: 'start', name: 'Order received' },
      { op: 'add', kind: 'userTask', name: 'Check invoice', after: 'Event_OrderReceived' },
      { op: 'add', kind: 'end', name: 'Done', after: 'Activity_CheckInvoice' },
    ]);
    const r = await applyToXml(order.xml, opsExample());
    expect(r.result.aliases).toEqual({ $ok: 'Gateway_InvoiceOk', $book: 'Activity_BookInvoice', $clarify: 'Activity_ClarifyInvoice', $reminder: 'Event_Reminder', $remind: 'Activity_RemindCustomer', $sent: 'Event_ReminderSent' });
    expect(r.result.created.map((c) => c.id)).toContain('Flow_RemindCustomerToReminderSent');
    expect(r.xml).toContain('<zeebe:taskDefinition type="book-invoice" retries="3" />');
  });

  it('the JSON schema describes the alias keys', () => {
    const add = (OPS_SCHEMA['$defs'] as Record<string, { properties: Record<string, { pattern?: string }> }>)['add']!;
    expect(add.properties['as']!.pattern).toBe('^\\$[A-Za-z_][A-Za-z0-9_-]*$');
    expect(add.properties['flowAs']!.pattern).toBe(add.properties['as']!.pattern);
    const split = (OPS_SCHEMA['$defs'] as Record<string, { properties: Record<string, unknown> }>)['split']!;
    expect(Object.keys(split.properties)).toEqual(expect.arrayContaining(['as', 'joinAs']));
  });
});

describe('batch aliases on the command line (`bpmn apply`)', () => {
  let dir = '';
  const bin = join(__dirname, '..', 'bin', 'bpmn.js');
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-cli-aliases-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads aliases from a file or stdin and prints them, also as JSON', async () => {
    const file = join(dir, 'invoice.bpmn');
    writeFileSync(file, (await newXml({ processName: 'Rechnungsprüfung' })).xml);
    writeFileSync(join(dir, 'ops.json'), JSON.stringify({ ops: INVOICE }));
    const text = execFileSync('node', [bin, 'apply', file, join(dir, 'ops.json')], { encoding: 'utf8' });
    expect(text).toMatch(/^aliases: \$start = Event_RechnungEingegangen, .*\$lateFlow = Flow_TimerToErinnert$/m);
    const json = JSON.parse(execFileSync('node', [bin, 'apply', file, '-', '--json'], { encoding: 'utf8', input: JSON.stringify([{ op: 'add', kind: 'task', name: 'Archivieren', after: 'Activity_Buchen', as: '$archive' }]) }));
    expect(json.aliases).toEqual({ $archive: 'Activity_Archivieren' });
    expect(readFileSync(file, 'utf8')).toContain('id="Activity_Archivieren"');
  });
});
