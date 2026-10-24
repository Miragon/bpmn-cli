/**
 * Batch aliases: an op names what it creates (`"as": "$name"`, `"flowAs"`,
 * `"outAs"`, `"joinAs"`), later ops of the batch use the alias wherever an
 * element id goes, the result lists alias -> final id. Synthetic fixtures only.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { renderMutation } from '../src/report/command-report.js';
import { OPS_SCHEMA, opsExample, parseOps } from '../src/ops/batch.js';
import { idConventionsFromLint } from '../src/ids/conventions.js';
import { Doc } from '../src/model/document.js';
import { CliError } from '../src/shared/CliError.js';
import { ERROR_CATALOGUE } from '../src/report/guide.js';
import { guideShort, guideText } from '../src/index.js';
import { bpmnlintEngine } from '../src/node/bpmnlint.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline/index.js';

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
      $lateFlow: 'Flow_TimerOnNachfordernToErinnert',
    });
    expect(r.xml).toContain('<bpmn:exclusiveGateway id="Gateway_Vollstaendig" name="Vollständig?" default="Flow_VollstaendigToNachfordern">');
    expect(r.xml).toMatch(/<bpmn:sequenceFlow id="Flow_VollstaendigToBuchen" name="ja" sourceRef="Gateway_Vollstaendig" targetRef="Activity_Buchen">\s*<bpmn:conditionExpression[^>]*>\$\{vollstaendig\}<\/bpmn:conditionExpression>/);
    expect(r.result.layout.format?.[0]).toMatchObject({ op: 'color', colored: ['Activity_VollstaendigkeitPruefen', 'Flow_VollstaendigToBuchen', 'Flow_TimerOnNachfordernToErinnert'] });
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

  it('an alias follows its element through a retype to another type (a new element): later ops, format ops and the result use it', async () => {
    const xml = (await newXml({ processName: 'Invoice' })).xml;
    const r = await applyToXml(xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Invoice', as: '$s' },
      { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: '$s', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
      { op: 'set', id: '$t', values: { name: 'Check the invoice' } },
      // twice, and a gateway and an event too
      { op: 'retype', id: '$t', kind: 'manualTask' },
      { op: 'add', kind: 'xor', name: 'Ok?', after: '$t', as: '$ok' },
      { op: 'retype', id: '$ok', kind: 'and' },
      { op: 'add', kind: 'intermediateCatchEvent:message', name: 'Paid', after: '$ok', message: 'Paid', as: '$paid' },
      { op: 'retype', id: '$paid', kind: 'intermediateThrowEvent:message' },
      { op: 'add', kind: 'end', name: 'Done', after: '$paid' },
      { op: 'color', ids: ['$t', '$ok'], color: 'green' },
    ]);
    expect(r.result.aliases).toEqual({ $s: 'Event_Start', $t: 'Activity_CheckInvoice', $ok: 'Gateway_Ok', $paid: 'Event_Paid' });
    expect(r.xml).toContain('<bpmn:manualTask id="Activity_CheckInvoice" name="Check the invoice">');
    expect(r.xml).toContain('<bpmn:parallelGateway id="Gateway_Ok" name="Ok?">');
    expect(r.xml).toContain('<bpmn:intermediateThrowEvent id="Event_Paid" name="Paid">');
    expect(r.result.layout.format?.[0]).toMatchObject({ op: 'color', colored: ['Activity_CheckInvoice', 'Gateway_Ok'] });
    expect(renderMutation(r.result)).toContain('aliases: $s = Event_Start, $t = Activity_CheckInvoice, $ok = Gateway_Ok, $paid = Event_Paid');
    // removed after the retype: still E_NOT_FOUND, and left out of the result
    const removed = await rejection(
      applyToXml(xml, [
        { op: 'add', kind: 'task', name: 'T', in: 'Process_Invoice', as: '$t' },
        { op: 'retype', id: '$t', kind: 'userTask' },
        { op: 'remove', ids: ['$t'] },
        { op: 'set', id: '$t', values: { name: 'x' } },
      ]),
    );
    expect([removed.code, removed.message]).toEqual(['E_NOT_FOUND', 'ops[3] (set): "id": $t named Activity_T, which an op before this one removed']);
  });

  it('an alias follows a retype that gives the element a new id under the declared conventions (#34)', async () => {
    const conventions = idConventionsFromLint({ severity: 'warn', config: {} }, bpmnlintEngine().plugin.naming, { source: '.bpmnlintrc in .' }).conventions!;
    const doc = await Doc.fromXml((await newXml({ processName: 'Invoice' })).xml);
    const r = await mutateDoc(
      doc,
      [
        { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Invoice', as: '$s' },
        { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: '$s', as: '$t' },
        { op: 'retype', id: '$t', kind: 'userTask' },
        { op: 'set', id: '$t', values: { name: 'Check the invoice' } },
        { op: 'add', kind: 'end', name: 'Done', after: '$t' },
      ] as Op[],
      { layout: false, conventions },
    );
    expect(r.aliases).toEqual({ $s: 'startEvent_start', $t: 'userTask_checkInvoice' });
    expect(r.xml).toContain('<bpmn:userTask id="userTask_checkInvoice" name="Check the invoice">');
    expect(r.xml).toContain('sourceRef="userTask_checkInvoice" targetRef="endEvent_done"');
    expect(r.xml).not.toContain('serviceTask_checkInvoice');
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

/** start -> Check -> Ok, made by bpmn-cli (Flow_CheckToOk names its ends). */
async function checkToOk(): Promise<string> {
  return (
    await applyToXml((await newXml({ processName: 'Audit' })).xml, [
      { op: 'add', kind: 'start', name: 'Start' },
      { op: 'add', kind: 'userTask', name: 'Check', after: 'Event_Start' },
      { op: 'add', kind: 'end', name: 'Ok', after: 'Activity_Check' },
    ])
  ).xml;
}

/** A gateway spliced into the flow to Ok, its new branch to Rejected the default: what a one-shot batch builds. */
const SPLICE_GATEWAY: unknown[] = [
  { op: 'add', kind: 'exclusiveGateway', name: 'Valid?', flow: 'Flow_CheckToOk', as: '$valid', flowAs: '$in', outAs: '$yes' },
  { op: 'add', kind: 'end', name: 'Rejected', after: '$valid', flowAs: '$no' },
  { op: 'set', id: '$yes', values: { name: 'yes', condition: '${valid}' } },
  { op: 'set', id: '$no', values: { name: 'no' } },
  { op: 'set', id: '$valid', values: { default: '$no' } },
];

describe('outAs: the flow an add creates out of the new node', () => {
  it('names the flow a splice creates (new node -> old successor): the same batch gives it a condition', async () => {
    const r = await applyToXml(await checkToOk(), SPLICE_GATEWAY);
    // flowAs is the flow the file had (renamed after its new ends), outAs the one the splice created
    expect(r.result.aliases).toEqual({ $in: 'Flow_CheckToValid', $yes: 'Flow_ValidToOk', $valid: 'Gateway_Valid', $no: 'Flow_ValidToRejected' });
    expect(r.xml).toMatch(/<bpmn:sequenceFlow id="Flow_ValidToOk" name="yes" sourceRef="Gateway_Valid" targetRef="Event_Ok">\s*<bpmn:conditionExpression[^>]*>\$\{valid\}<\/bpmn:conditionExpression>/);
    expect(r.xml).toContain('<bpmn:exclusiveGateway id="Gateway_Valid" name="Valid?" default="Flow_ValidToRejected">');
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_CheckToValid" sourceRef="Activity_Check" targetRef="Gateway_Valid" />');
    expect(renderMutation(r.result)).toContain('aliases: $in = Flow_CheckToValid, $yes = Flow_ValidToOk, $valid = Gateway_Valid, $no = Flow_ValidToRejected');
    // the other splices: after a node with one outgoing flow, before a node with one incoming flow
    const after = await applyToXml(await checkToOk(), [{ op: 'add', kind: 'task', name: 'Log', after: 'Activity_Check', outAs: '$o' }]);
    expect(after.result.aliases).toEqual({ $o: 'Flow_LogToOk' });
    const before = await applyToXml(await checkToOk(), [{ op: 'add', kind: 'task', name: 'Log', before: 'Activity_Check', outAs: '$o' }]);
    expect(before.result.aliases).toEqual({ $o: 'Flow_LogToCheck' });
  });

  it('names the flow to "to" and the flow of a prepend, follows a later rename, and binds an existing node\'s with --if-absent', async () => {
    const xml = (await applyToXml(await checkToOk(), SPLICE_GATEWAY)).xml;
    const r = await applyToXml(xml, [
      // a branch that re-joins: appended after the gateway, connected to "to"
      { op: 'add', kind: 'task', name: 'Escalate', after: 'Gateway_Valid', to: 'Event_Ok', condition: '${late}', outAs: '$back' },
      // unconnected with "to", and a boundary event with "to"
      { op: 'add', kind: 'task', name: 'Lone', in: 'Process_Audit', to: 'Event_Rejected', as: '$lone', outAs: '$loneOut' },
      { op: 'add', kind: 'boundaryEvent:timer', on: 'Activity_Check', timer: 'PT1H', to: 'Event_Rejected', outAs: '$timeout' },
      // a prepend: flowAs and outAs both name the one flow it creates (node -> anchor)
      { op: 'add', kind: 'task', name: 'Prepare', before: '$lone', flowAs: '$f', outAs: '$o' },
      // the flow named after its ends follows a later splice into it, and so does its alias
      { op: 'add', kind: 'task', name: 'Recheck', flow: '$back', outAs: '$recheck' },
      { op: 'set', id: '$back', values: { name: 'back' } },
      { op: 'add', kind: 'userTask', id: 'Activity_Check', ifAbsent: true, after: 'Event_Start', outAs: '$checkOut' },
    ]);
    expect(r.result.aliases).toEqual({
      $back: 'Flow_EscalateToRecheck',
      $loneOut: 'Flow_LoneToRejected',
      $lone: 'Activity_Lone',
      $timeout: 'Flow_TimerOnCheckToRejected',
      $f: 'Flow_PrepareToLone',
      $o: 'Flow_PrepareToLone',
      $recheck: 'Flow_RecheckToOk',
      $checkOut: 'Flow_CheckToValid',
    });
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_EscalateToRecheck" name="back" sourceRef="Activity_Escalate" targetRef="Activity_Recheck" />');
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_RecheckToOk" sourceRef="Activity_Recheck" targetRef="Event_Ok" />');
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_LoneToRejected" sourceRef="Activity_Lone" targetRef="Event_Rejected" />');
  });

  it('is refused where the add creates no flow out of the node or two (E_USAGE), before anything runs where the keys tell', async () => {
    const xml = (await applyToXml(await checkToOk(), SPLICE_GATEWAY)).xml;
    const parse = failure(() => parseOps([{ op: 'add', kind: 'task', name: 'T', in: 'Process_Audit', outAs: '$o' }]));
    expect([parse.code, parse.message]).toEqual(['E_USAGE', 'ops[0] (add): "outAs" names the flow out of the node and needs "after", "before", "flow" or "to"']);
    expect(failure(() => parseOps([{ op: 'add', kind: 'boundaryEvent:timer', on: 'Activity_Check', timer: 'PT1H', outAs: '$o' }])).message).toMatch(/"outAs" names the flow out of the node/);
    // an append: the new node ends its path
    const append = await rejection(applyToXml(xml, [{ op: 'add', kind: 'task', name: 'X', after: 'Gateway_Valid', outAs: '$o' }]));
    expect([append.code, append.message, append.details.op]).toEqual(['E_USAGE', 'outAs $o: Activity_X gets no flow out of it from this placement (--after Gateway_Valid appends it)', 0]);
    expect(append.details.hint).toBe('outAs names the flow an add creates out of the new node: a splice, a prepend or "to" creates one. Otherwise connect the node with a connect op that has "as".');
    // a splice with "to": two flows leave the node
    const two = await rejection(applyToXml(xml, [{ op: 'add', kind: 'task', name: 'X', after: 'Activity_Check', to: 'Event_Rejected', outAs: '$o' }]));
    expect([two.code, two.message]).toEqual(['E_USAGE', 'outAs $o: Activity_X gets 2 flows out of it from this placement (Flow_XToValid to Gateway_Valid, Flow_XToRejected to Event_Rejected)']);
    expect(two.details.hint).toBe('outAs names one flow: drop "to" and connect Activity_X to Event_Rejected with a connect op that has "as" (outAs then names the other flow).');
    // no flow node: "to" makes an association, no sequence flow; parseOps knows the kind, so "to" is not suggested
    const data = await rejection(applyToXml(xml, [{ op: 'add', kind: 'dataObject', name: 'D', in: 'Process_Audit', to: 'Activity_Check', outAs: '$d' }]));
    expect([data.code, data.message]).toEqual(['E_USAGE', 'ops[0] (add): "outAs": add dataObject creates no sequence flow out of it']);
    expect(data.details.hint).toBe('Drop "outAs"; name a connection with a connect op that has "as".');
    for (const kind of ['dataObject', 'textAnnotation', 'lane', 'participant']) {
      expect(failure(() => parseOps([{ op: 'add', kind, name: 'D', in: 'Process_Audit', outAs: '$d' }])).message).toBe(`ops[0] (add): "outAs": add ${kind} creates no sequence flow out of it`);
    }
    const typedData = await rejection(mutateDoc(await Doc.fromXml(xml), [{ op: 'add', kind: 'dataObject', name: 'D', in: 'Process_Audit', to: 'Activity_Check', outAs: '$d' }] as Op[], { layout: false }));
    expect([typedData.code, typedData.message]).toEqual(['E_USAGE', 'outAs $d: add dataObject creates no sequence flow out of it']);
    // split nodes take no outAs (the split creates the flow out of a node with the next one)
    expect(failure(() => parseOps([{ op: 'split', after: 'X', branches: [{ nodes: [{ kind: 'task', outAs: '$o' }] }] }])).message).toMatch(/nodes\[0\]: unknown key "outAs"/);
    // typed ops of the library skip parseOps: the add refuses it while it runs
    const typed = await rejection(mutateDoc(await Doc.fromXml(xml), [{ op: 'add', kind: 'task', name: 'T', in: 'Process_Audit', outAs: '$o' }] as Op[], { layout: false }));
    expect([typed.code, typed.message]).toEqual(['E_USAGE', 'outAs $o: Activity_T gets no flow out of it from this placement (--in)']);
    // an alias like any other: used before its op, the message says which op defines it
    const early = failure(() => parseOps([{ op: 'set', id: '$o', values: { name: 'x' } }, { op: 'add', kind: 'task', name: 'T', after: 'A', outAs: '$o' }]));
    expect(early.message).toBe('ops[0] (set): "id": alias $o is not defined before this op (ops[1] defines it); no op before it defines one');
    expect(early.details.hint).toContain('"outAs" (add: the flow it creates out of the new node)');
  });

  it('with --if-absent binds an existing node\'s flow only when exactly one leaves it: a re-run never puts the condition on another branch', async () => {
    // the one-shot batch made idempotent: the gateway's add skips when it exists
    const batch = [
      { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_Valid', name: 'Valid?', ifAbsent: true, flow: 'Flow_CheckToOk', as: '$valid', outAs: '$yes' },
      { op: 'set', id: '$yes', values: { name: 'yes', condition: '${valid}' } },
    ];
    const first = await applyToXml(await checkToOk(), batch);
    expect(first.result.aliases).toEqual({ $valid: 'Gateway_Valid', $yes: 'Flow_ValidToOk' });
    // the same batch again while the gateway still has one flow out of it binds that one
    expect((await applyToXml(first.xml, batch)).result.aliases).toEqual({ $valid: 'Gateway_Valid', $yes: 'Flow_ValidToOk' });
    // a second branch, put first: the gateway's first out-flow is now the other branch
    const branched = (
      await applyToXml(first.xml, [
        { op: 'add', kind: 'end', name: 'Rejected', after: 'Gateway_Valid' },
        { op: 'order', id: 'Gateway_Valid', flows: ['Flow_ValidToRejected', 'Flow_ValidToOk'] },
      ])
    ).xml;
    const again = await rejection(applyToXml(branched, batch));
    expect([again.code, again.message, again.details.op]).toEqual(['E_USAGE', 'outAs $yes: Gateway_Valid already exists and has 2 flows out of it (Flow_ValidToRejected, Flow_ValidToOk)', 0]);
    expect(again.details.candidates).toEqual(['Flow_ValidToRejected', 'Flow_ValidToOk']);
    expect(again.details.hint).toBe('With ifAbsent, outAs binds the flow out of an existing node only when exactly one leaves it: drop "outAs" there and use the flow\'s id.');
    // no flow out of it, or no flow node: E_USAGE as on a first run, not an E_UNKNOWN_ALIAS later
    const none = await rejection(applyToXml(branched, [{ op: 'add', kind: 'end', id: 'Event_Ok', ifAbsent: true, before: 'Activity_Check', outAs: '$o' }, { op: 'set', id: '$o', values: { name: 'x' } }]));
    expect([none.code, none.message]).toEqual(['E_USAGE', 'outAs $o: Event_Ok already exists and has no flow out of it']);
    const pool = (await applyToXml(branched, [{ op: 'add', kind: 'participant', name: 'Audit' }])).xml;
    const notFlowNode = await rejection(applyToXml(pool, [{ op: 'add', kind: 'task', id: 'Participant_Audit', ifAbsent: true, after: 'Activity_Check', outAs: '$o' }]));
    expect([notFlowNode.code, notFlowNode.message]).toEqual(['E_USAGE', 'outAs $o: Participant_Audit already exists and is a participant, no flow node']);
  });

  it('is in the schema, the full guide and the catalogue; the short guide leaves it out', () => {
    const defs = OPS_SCHEMA['$defs'] as Record<string, { properties: Record<string, { pattern?: string }> }>;
    expect(defs['add']!.properties['outAs']!.pattern).toBe(defs['add']!.properties['as']!.pattern);
    expect(Object.keys(defs['node']!.properties)).not.toContain('outAs');
    expect(guideText()).toMatch(/"outAs" on add: the one flow\s+the add creates out of the node, to the old successor on a splice/);
    expect(guideText()).toMatch(/^ {11}keys: kind, name, id, as, flowAs, outAs, refAs, /m);
    expect(ERROR_CATALOGUE.find((e) => e.code === 'E_UNKNOWN_ALIAS')!.fix).toContain('"outAs"');
    expect(guideShort()).not.toContain('outAs');
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
    expect(text).toMatch(/^aliases: \$start = Event_RechnungEingegangen, .*\$lateFlow = Flow_TimerOnNachfordernToErinnert$/m);
    const json = JSON.parse(execFileSync('node', [bin, 'apply', file, '-', '--json'], { encoding: 'utf8', input: JSON.stringify([{ op: 'add', kind: 'task', name: 'Archivieren', after: 'Activity_Buchen', as: '$archive' }]) }));
    expect(json.aliases).toEqual({ $archive: 'Activity_Archivieren' });
    expect(readFileSync(file, 'utf8')).toContain('id="Activity_Archivieren"');
  });

  it('lists the alias of an element retyped to another type, in the aliases line and in the JSON', async () => {
    const file = join(dir, 'retyped.bpmn');
    writeFileSync(file, (await newXml({ processName: 'Invoice' })).xml);
    const ops = [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Invoice', as: '$s' },
      { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: '$s', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
    ];
    const json = JSON.parse(execFileSync('node', [bin, 'apply', file, '-', '--json', '--dry-run'], { encoding: 'utf8', input: JSON.stringify(ops) }));
    expect(json.aliases).toEqual({ $s: 'Event_Start', $t: 'Activity_CheckInvoice' });
    const text = execFileSync('node', [bin, 'apply', file, '-'], { encoding: 'utf8', input: JSON.stringify([...ops, { op: 'set', id: '$t', values: { name: 'Check the invoice' } }]) });
    expect(text).toMatch(/^aliases: \$s = Event_Start, \$t = Activity_CheckInvoice$/m);
    expect(readFileSync(file, 'utf8')).toContain('<bpmn:userTask id="Activity_CheckInvoice" name="Check the invoice">');
  });

  it('lists the outAs alias of a spliced gateway\'s new flow, in the aliases line and in the JSON', async () => {
    const file = join(dir, 'spliced.bpmn');
    writeFileSync(file, await checkToOk());
    const json = JSON.parse(execFileSync('node', [bin, 'apply', file, '-', '--json', '--dry-run'], { encoding: 'utf8', input: JSON.stringify(SPLICE_GATEWAY) }));
    expect(json.aliases).toEqual({ $in: 'Flow_CheckToValid', $yes: 'Flow_ValidToOk', $valid: 'Gateway_Valid', $no: 'Flow_ValidToRejected' });
    const text = execFileSync('node', [bin, 'apply', file, '-'], { encoding: 'utf8', input: JSON.stringify(SPLICE_GATEWAY) });
    expect(text).toMatch(/^aliases: \$in = Flow_CheckToValid, \$yes = Flow_ValidToOk, \$valid = Gateway_Valid, \$no = Flow_ValidToRejected$/m);
    expect(readFileSync(file, 'utf8')).toMatch(/<bpmn:sequenceFlow id="Flow_ValidToOk" name="yes" sourceRef="Gateway_Valid" targetRef="Event_Ok">\s*<bpmn:conditionExpression/);
  });
});
