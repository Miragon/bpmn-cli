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
import { applyToXml, newXml } from '../../../src/api.js';
import { renderMutation, parseOps } from '../../../src/index.js';
import { OPS_SCHEMA } from '../../../src/adapters/in/report/OpsSchemaBuilder.js';
import { opsExample } from '../../../src/domain/commands/utils/op-fields.js';
import { idConventionsFromLint } from '../../../src/index.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import { BpmnError } from '../../../src/domain/document/BpmnError.js';
import { ERROR_CATALOGUE } from '../../../src/adapters/in/report/guide.js';
import { guideShort, guideText } from '../../../src/index.js';
import { bpmnlintEngine } from '../../../src/node.js';
import type { EditCommand } from '../../../src/domain/commands/types.js';
import { mutateDoc } from '../../../src/index.js';
import { failure } from '../../helpers/errors.js';

async function rejection(pending: Promise<unknown>): Promise<BpmnError> {
  try {
    await pending;
  } catch (err) {
    if (err instanceof BpmnError) return err;
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
    const outcome = await applyToXml((await newXml({ processName: 'Rechnungsprüfung' })).xml, INVOICE);
    expect(outcome.result.aliases).toEqual({
      $start: 'startEvent_rechnungEingegangen',
      $check: 'userTask_vollstaendigkeitPruefen',
      $ok: 'gateway_vollstaendig',
      $yes: 'flow_vollstaendigToBuchen',
      $book: 'serviceTask_buchen',
      $no: 'flow_vollstaendigToNachfordern',
      $ask: 'userTask_nachfordern',
      $join: 'gateway_vollstaendigJoin',
      $late: 'event_timerOnNachfordern',
      $lateFlow: 'flow_timerOnNachfordernToErinnert',
    });
    expect(outcome.xml).toContain('<bpmn:exclusiveGateway id="gateway_vollstaendig" name="Vollständig?" default="flow_vollstaendigToNachfordern">');
    expect(outcome.xml).toMatch(/<bpmn:sequenceFlow id="flow_vollstaendigToBuchen" name="ja" sourceRef="gateway_vollstaendig" targetRef="serviceTask_buchen">\s*<bpmn:conditionExpression[^>]*>\$\{vollstaendig\}<\/bpmn:conditionExpression>/);
    expect(outcome.result.layout.format?.[0]).toMatchObject({ op: 'color', colored: ['userTask_vollstaendigkeitPruefen', 'flow_vollstaendigToBuchen', 'flow_timerOnNachfordernToErinnert'] });
    expect(renderMutation(outcome.result)).toContain('aliases: $start = startEvent_rechnungEingegangen, $check = userTask_vollstaendigkeitPruefen, $ok = gateway_vollstaendig');
    // without aliases the result has none
    expect((await applyToXml(outcome.xml, [{ op: 'set', id: 'serviceTask_buchen', values: { name: 'Buchen!' } }])).result.aliases).toBeUndefined();
  });

  it('an alias names the element itself: it follows a rename later in the batch', async () => {
    const start = await applyToXml((await newXml({ processName: 'P' })).xml, [
      { op: 'add', kind: 'start', name: 'Start' },
      { op: 'add', kind: 'end', name: 'End', after: 'startEvent_start' },
    ]);
    const outcome = await applyToXml(start.xml, [
      { op: 'add', kind: 'task', name: 'Work', after: 'startEvent_start', as: '$work', flowAs: '$in' },
      // splicing into $in renames it (its id named Start and Work); $in follows
      { op: 'add', kind: 'task', name: 'Prepare', flow: '$in' },
      { op: 'set', id: '$in', values: { name: 'go' } },
      { op: 'color', ids: ['$in'], color: 'blue' },
    ]);
    expect(outcome.result.aliases).toEqual({ $work: 'task_work', $in: 'flow_startToPrepare' });
    expect(outcome.xml).toContain('<bpmn:sequenceFlow id="flow_startToPrepare" name="go" sourceRef="startEvent_start" targetRef="task_prepare" />');
    expect(outcome.result.layout.format?.[0]).toMatchObject({ colored: ['flow_startToPrepare'] });
  });

  it('an alias follows its element through a retype to another type (a new element): later ops, format ops and the result use it', async () => {
    const xml = (await newXml({ processName: 'Invoice' })).xml;
    const outcome = await applyToXml(xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'invoice', as: '$s' },
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
    expect(outcome.result.aliases).toEqual({ $s: 'startEvent_start', $t: 'manualTask_checkInvoice', $ok: 'gateway_ok', $paid: 'event_paid' });
    expect(outcome.xml).toContain('<bpmn:manualTask id="manualTask_checkInvoice" name="Check the invoice">');
    expect(outcome.xml).toContain('<bpmn:parallelGateway id="gateway_ok" name="Ok?">');
    expect(outcome.xml).toContain('<bpmn:intermediateThrowEvent id="event_paid" name="Paid">');
    expect(outcome.result.layout.format?.[0]).toMatchObject({ op: 'color', colored: ['manualTask_checkInvoice', 'gateway_ok'] });
    expect(renderMutation(outcome.result)).toContain('aliases: $s = startEvent_start, $t = manualTask_checkInvoice, $ok = gateway_ok, $paid = event_paid');
    // removed after the retype: still E_NOT_FOUND, and left out of the result
    const removed = await rejection(
      applyToXml(xml, [
        { op: 'add', kind: 'task', name: 'T', in: 'invoice', as: '$t' },
        { op: 'retype', id: '$t', kind: 'userTask' },
        { op: 'remove', ids: ['$t'] },
        { op: 'set', id: '$t', values: { name: 'x' } },
      ]),
    );
    expect([removed.code, removed.message]).toEqual(['E_NOT_FOUND', 'ops[3] (set): "id": $t named userTask_t, which an op before this one removed']);
  });

  it('an alias follows a retype that gives the element a new id under the declared conventions (#34)', async () => {
    const conventions = idConventionsFromLint({ severity: 'warn', config: {} }, bpmnlintEngine().plugin.naming, { source: '.bpmnlintrc in .' }).conventions!;
    const doc = await Doc.fromXml((await newXml({ processName: 'Invoice' })).xml);
    const outcome = await mutateDoc(
      doc,
      [
        { op: 'add', kind: 'startEvent', name: 'Start', in: 'invoice', as: '$s' },
        { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: '$s', as: '$t' },
        { op: 'retype', id: '$t', kind: 'userTask' },
        { op: 'set', id: '$t', values: { name: 'Check the invoice' } },
        { op: 'add', kind: 'end', name: 'Done', after: '$t' },
      ] as EditCommand[],
      { layout: false, conventions },
    );
    expect(outcome.aliases).toEqual({ $s: 'startEvent_start', $t: 'userTask_checkInvoice' });
    expect(outcome.xml).toContain('<bpmn:userTask id="userTask_checkInvoice" name="Check the invoice">');
    expect(outcome.xml).toContain('sourceRef="userTask_checkInvoice" targetRef="endEvent_done"');
    expect(outcome.xml).not.toContain('serviceTask_checkInvoice');
  });

  it('resolve in the lane of split nodes and in the set map of add', async () => {
    const outcome = await applyToXml((await newXml({ processName: 'P' })).xml, [
      { op: 'add', kind: 'participant', name: 'P' },
      { op: 'add', kind: 'lane', name: 'Clerk', in: 'participant_p', as: '$clerk' },
      { op: 'add', kind: 'lane', name: 'Accounting', in: 'participant_p', as: '$acc' },
      { op: 'add', kind: 'start', name: 'S', in: 'p', lane: '$clerk', as: '$s' },
      { op: 'split', after: '$s', name: 'Ok?', as: '$ok', branches: [{ nodes: [{ kind: 'task', name: 'Book', lane: '$acc', set: { lane: '$acc' } }] }, { nodes: [{ kind: 'task', name: 'Ask', flowAs: '$ask' }] }] },
      { op: 'add', kind: 'task', name: 'Log', in: 'p', set: { lane: '$acc' } },
      { op: 'set', id: '$ok', values: { default: '$ask' } },
    ]);
    const doc = await Doc.fromXml(outcome.xml);
    expect(doc.lanesOf(doc.require('task_book')).map((lane) => lane.get('id'))).toEqual(['lane_accounting']);
    expect(doc.lanesOf(doc.require('task_log')).map((lane) => lane.get('id'))).toEqual(['lane_accounting']);
    expect(outcome.xml).toContain('default="flow_okToAsk"');
    expect(() => parseOps([{ op: 'split', after: 'X', branches: [{ nodes: [{ kind: 'task', lane: '$nope' }] }] }])).toThrow(/"branches\[0\]\.nodes\[0\]\.lane": alias \$nope is not defined/);
  });

  it('connect names the connection (not the message it creates); --if-absent binds the existing element', async () => {
    const base = await applyToXml((await newXml({ processName: 'Shop' })).xml, [
      { op: 'add', kind: 'start', name: 'Order' },
      { op: 'add', kind: 'sendTask', name: 'Confirm', after: 'startEvent_order' },
      { op: 'add', kind: 'participant', name: 'Shop' },
      { op: 'add', kind: 'participant', name: 'Customer', blackBox: true },
    ]);
    const outcome = await applyToXml(base.xml, [
      { op: 'connect', source: 'sendTask_confirm', target: 'participant_customer', message: 'Confirmation', as: '$mf' },
      { op: 'add', kind: 'task', id: 'sendTask_confirm', ifAbsent: true, as: '$confirm' },
      { op: 'connect', source: '$confirm', target: 'participant_customer', ifAbsent: true, as: '$same' },
    ]);
    expect(outcome.result.aliases).toEqual({ $mf: 'messageFlow_confirmToCustomer', $confirm: 'sendTask_confirm', $same: 'messageFlow_confirmToCustomer' });
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
    const ops = [{ op: 'add', kind: 'startEvent', name: 'S', as: '$s' }, { op: 'add', kind: 'task', name: 'T', after: '$x' }] as EditCommand[];
    const bpmnError = await rejection(mutateDoc(doc, ops));
    expect([bpmnError.code, bpmnError.details.op, bpmnError.details.candidates]).toEqual(['E_UNKNOWN_ALIAS', 1, ['$s']]);
    const removed = await rejection(mutateDoc(await Doc.fromXml((await newXml({ processName: 'P' })).xml), [{ op: 'add', kind: 'task', name: 'T', as: '$t' }, { op: 'remove', ids: ['$t'] }, { op: 'set', id: '$t', values: { name: 'x' } }] as EditCommand[]));
    expect([removed.code, removed.message]).toEqual(['E_NOT_FOUND', 'ops[2] (set): "id": $t named task_t, which an op before this one removed']);
  });

  it('joinAs without a join gateway is refused', async () => {
    const xml = (await applyToXml((await newXml({ processName: 'P' })).xml, [{ op: 'add', kind: 'start', name: 'S' }, { op: 'add', kind: 'task', name: 'T', after: 'startEvent_s' }])).xml;
    const bpmnError = await rejection(applyToXml(xml, [{ op: 'split', after: 'task_t', join: false, joinAs: '$j', branches: [{ nodes: [{ kind: 'end', name: 'A' }] }, { nodes: [{ kind: 'end', name: 'B' }] }] }]));
    expect([bpmnError.code, bpmnError.message]).toEqual(['E_USAGE', 'joinAs $j: split gateway_afterT creates no join gateway (join is false)']);
  });

  it('the documented example (bpmn kinds --json -> opsExample) runs on the file it describes', async () => {
    const order = await applyToXml((await newXml({ processName: 'Order handling', target: 'camunda8' })).xml, [
      { op: 'add', kind: 'start', name: 'Order received' },
      { op: 'add', kind: 'userTask', name: 'Check invoice', after: 'startEvent_orderReceived' },
      { op: 'add', kind: 'end', name: 'Done', after: 'userTask_checkInvoice' },
    ]);
    const outcome = await applyToXml(order.xml, opsExample());
    expect(outcome.result.aliases).toEqual({ $ok: 'gateway_invoiceOk', $book: 'serviceTask_bookInvoice', $clarify: 'userTask_clarifyInvoice', $reminder: 'event_reminder', $remind: 'sendTask_remindCustomer', $sent: 'endEvent_reminderSent' });
    expect(outcome.result.created.map((change) => change.id)).toContain('flow_remindCustomerToReminderSent');
    expect(outcome.xml).toContain('<zeebe:taskDefinition type="book-invoice" retries="3" />');
  });

  it('the JSON schema describes the alias keys', () => {
    const add = (OPS_SCHEMA['$defs'] as Record<string, { properties: Record<string, { pattern?: string }> }>)['add']!;
    expect(add.properties['as']!.pattern).toBe('^\\$[A-Za-z_][A-Za-z0-9_-]*$');
    expect(add.properties['flowAs']!.pattern).toBe(add.properties['as']!.pattern);
    const split = (OPS_SCHEMA['$defs'] as Record<string, { properties: Record<string, unknown> }>)['split']!;
    expect(Object.keys(split.properties)).toEqual(expect.arrayContaining(['as', 'joinAs']));
  });
});

/** start -> Check -> Ok, made by bpmn-cli (flow_checkToOk names its ends). */
async function checkToOk(): Promise<string> {
  return (
    await applyToXml((await newXml({ processName: 'Audit' })).xml, [
      { op: 'add', kind: 'start', name: 'Start' },
      { op: 'add', kind: 'userTask', name: 'Check', after: 'startEvent_start' },
      { op: 'add', kind: 'end', name: 'Ok', after: 'userTask_check' },
    ])
  ).xml;
}

/** A gateway spliced into the flow to Ok, its new branch to Rejected the default: what a one-shot batch builds. */
const SPLICE_GATEWAY: unknown[] = [
  { op: 'add', kind: 'exclusiveGateway', name: 'Valid?', flow: 'flow_checkToOk', as: '$valid', flowAs: '$in', outAs: '$yes' },
  { op: 'add', kind: 'end', name: 'Rejected', after: '$valid', flowAs: '$no' },
  { op: 'set', id: '$yes', values: { name: 'yes', condition: '${valid}' } },
  { op: 'set', id: '$no', values: { name: 'no' } },
  { op: 'set', id: '$valid', values: { default: '$no' } },
];

describe('outAs: the flow an add creates out of the new node', () => {
  it('names the flow a splice creates (new node -> old successor): the same batch gives it a condition', async () => {
    const outcome = await applyToXml(await checkToOk(), SPLICE_GATEWAY);
    // flowAs is the flow the file had (renamed after its new ends), outAs the one the splice created
    expect(outcome.result.aliases).toEqual({ $in: 'flow_checkToValid', $yes: 'flow_validToOk', $valid: 'gateway_valid', $no: 'flow_validToRejected' });
    expect(outcome.xml).toMatch(/<bpmn:sequenceFlow id="flow_validToOk" name="yes" sourceRef="gateway_valid" targetRef="endEvent_ok">\s*<bpmn:conditionExpression[^>]*>\$\{valid\}<\/bpmn:conditionExpression>/);
    expect(outcome.xml).toContain('<bpmn:exclusiveGateway id="gateway_valid" name="Valid?" default="flow_validToRejected">');
    expect(outcome.xml).toContain('<bpmn:sequenceFlow id="flow_checkToValid" sourceRef="userTask_check" targetRef="gateway_valid" />');
    expect(renderMutation(outcome.result)).toContain('aliases: $in = flow_checkToValid, $yes = flow_validToOk, $valid = gateway_valid, $no = flow_validToRejected');
    // the other splices: after a node with one outgoing flow, before a node with one incoming flow
    const after = await applyToXml(await checkToOk(), [{ op: 'add', kind: 'task', name: 'Log', after: 'userTask_check', outAs: '$o' }]);
    expect(after.result.aliases).toEqual({ $o: 'flow_logToOk' });
    const before = await applyToXml(await checkToOk(), [{ op: 'add', kind: 'task', name: 'Log', before: 'userTask_check', outAs: '$o' }]);
    expect(before.result.aliases).toEqual({ $o: 'flow_logToCheck' });
  });

  it('names the flow to "to" and the flow of a prepend, follows a later rename, and binds an existing node\'s with --if-absent', async () => {
    const xml = (await applyToXml(await checkToOk(), SPLICE_GATEWAY)).xml;
    const outcome = await applyToXml(xml, [
      // a branch that re-joins: appended after the gateway, connected to "to"
      { op: 'add', kind: 'task', name: 'Escalate', after: 'gateway_valid', to: 'endEvent_ok', condition: '${late}', outAs: '$back' },
      // unconnected with "to", and a boundary event with "to"
      { op: 'add', kind: 'task', name: 'Lone', in: 'audit', to: 'endEvent_rejected', as: '$lone', outAs: '$loneOut' },
      { op: 'add', kind: 'boundaryEvent:timer', on: 'userTask_check', timer: 'PT1H', to: 'endEvent_rejected', outAs: '$timeout' },
      // a prepend: flowAs and outAs both name the one flow it creates (node -> anchor)
      { op: 'add', kind: 'task', name: 'Prepare', before: '$lone', flowAs: '$f', outAs: '$o' },
      // the flow named after its ends follows a later splice into it, and so does its alias
      { op: 'add', kind: 'task', name: 'Recheck', flow: '$back', outAs: '$recheck' },
      { op: 'set', id: '$back', values: { name: 'back' } },
      { op: 'add', kind: 'userTask', id: 'userTask_check', ifAbsent: true, after: 'startEvent_start', outAs: '$checkOut' },
    ]);
    expect(outcome.result.aliases).toEqual({
      $back: 'flow_escalateToRecheck',
      $loneOut: 'flow_loneToRejected',
      $lone: 'task_lone',
      $timeout: 'flow_timerOnCheckToRejected',
      $f: 'flow_prepareToLone',
      $o: 'flow_prepareToLone',
      $recheck: 'flow_recheckToOk',
      $checkOut: 'flow_checkToValid',
    });
    expect(outcome.xml).toContain('<bpmn:sequenceFlow id="flow_escalateToRecheck" name="back" sourceRef="task_escalate" targetRef="task_recheck" />');
    expect(outcome.xml).toContain('<bpmn:sequenceFlow id="flow_recheckToOk" sourceRef="task_recheck" targetRef="endEvent_ok" />');
    expect(outcome.xml).toContain('<bpmn:sequenceFlow id="flow_loneToRejected" sourceRef="task_lone" targetRef="endEvent_rejected" />');
  });

  it('is refused where the add creates no flow out of the node or two (E_USAGE), before anything runs where the keys tell', async () => {
    const xml = (await applyToXml(await checkToOk(), SPLICE_GATEWAY)).xml;
    const parse = failure(() => parseOps([{ op: 'add', kind: 'task', name: 'T', in: 'audit', outAs: '$o' }]));
    expect([parse.code, parse.message]).toEqual(['E_USAGE', 'ops[0] (add): "outAs" names the flow out of the node and needs "after", "before", "flow" or "to"']);
    expect(failure(() => parseOps([{ op: 'add', kind: 'boundaryEvent:timer', on: 'userTask_check', timer: 'PT1H', outAs: '$o' }])).message).toMatch(/"outAs" names the flow out of the node/);
    // an append: the new node ends its path
    const append = await rejection(applyToXml(xml, [{ op: 'add', kind: 'task', name: 'X', after: 'gateway_valid', outAs: '$o' }]));
    expect([append.code, append.message, append.details.op]).toEqual(['E_USAGE', 'outAs $o: task_x gets no flow out of it from this placement (--after gateway_valid appends it)', 0]);
    expect(append.details.hint).toBe('outAs names the flow an add creates out of the new node: a splice, a prepend or "to" creates one. Otherwise connect the node with a connect op that has "as".');
    // a splice with "to": two flows leave the node
    const two = await rejection(applyToXml(xml, [{ op: 'add', kind: 'task', name: 'X', after: 'userTask_check', to: 'endEvent_rejected', outAs: '$o' }]));
    expect([two.code, two.message]).toEqual(['E_USAGE', 'outAs $o: task_x gets 2 flows out of it from this placement (flow_xToValid to gateway_valid, flow_xToRejected to endEvent_rejected)']);
    expect(two.details.hint).toBe('outAs names one flow: drop "to" and connect task_x to endEvent_rejected with a connect op that has "as" (outAs then names the other flow).');
    // no flow node: "to" makes an association, no sequence flow; parseOps knows the kind, so "to" is not suggested
    const data = await rejection(applyToXml(xml, [{ op: 'add', kind: 'dataObject', name: 'D', in: 'audit', to: 'userTask_check', outAs: '$d' }]));
    expect([data.code, data.message]).toEqual(['E_USAGE', 'ops[0] (add): "outAs": add dataObject creates no sequence flow out of it']);
    expect(data.details.hint).toBe('Drop "outAs"; name a connection with a connect op that has "as".');
    for (const kind of ['dataObject', 'textAnnotation', 'lane', 'participant']) {
      expect(failure(() => parseOps([{ op: 'add', kind, name: 'D', in: 'audit', outAs: '$d' }])).message).toBe(`ops[0] (add): "outAs": add ${kind} creates no sequence flow out of it`);
    }
    const typedData = await rejection(mutateDoc(await Doc.fromXml(xml), [{ op: 'add', kind: 'dataObject', name: 'D', in: 'audit', to: 'userTask_check', outAs: '$d' }] as EditCommand[], { layout: false }));
    expect([typedData.code, typedData.message]).toEqual(['E_USAGE', 'outAs $d: add dataObject creates no sequence flow out of it']);
    // split nodes take no outAs (the split creates the flow out of a node with the next one)
    expect(failure(() => parseOps([{ op: 'split', after: 'X', branches: [{ nodes: [{ kind: 'task', outAs: '$o' }] }] }])).message).toMatch(/nodes\[0\]: unknown key "outAs"/);
    // typed ops of the library skip parseOps: the add refuses it while it runs
    const typed = await rejection(mutateDoc(await Doc.fromXml(xml), [{ op: 'add', kind: 'task', name: 'T', in: 'audit', outAs: '$o' }] as EditCommand[], { layout: false }));
    expect([typed.code, typed.message]).toEqual(['E_USAGE', 'outAs $o: task_t gets no flow out of it from this placement (--in)']);
    // an alias like any other: used before its op, the message says which op defines it
    const early = failure(() => parseOps([{ op: 'set', id: '$o', values: { name: 'x' } }, { op: 'add', kind: 'task', name: 'T', after: 'A', outAs: '$o' }]));
    expect(early.message).toBe('ops[0] (set): "id": alias $o is not defined before this op (ops[1] defines it); no op before it defines one');
    expect(early.details.hint).toContain('"outAs" (add: the flow it creates out of the new node)');
  });

  it('with --if-absent binds an existing node\'s flow only when exactly one leaves it: a re-run never puts the condition on another branch', async () => {
    // the one-shot batch made idempotent: the gateway's add skips when it exists
    const batch = [
      { op: 'add', kind: 'exclusiveGateway', id: 'gateway_valid', name: 'Valid?', ifAbsent: true, flow: 'flow_checkToOk', as: '$valid', outAs: '$yes' },
      { op: 'set', id: '$yes', values: { name: 'yes', condition: '${valid}' } },
    ];
    const first = await applyToXml(await checkToOk(), batch);
    expect(first.result.aliases).toEqual({ $valid: 'gateway_valid', $yes: 'flow_validToOk' });
    // the same batch again while the gateway still has one flow out of it binds that one
    expect((await applyToXml(first.xml, batch)).result.aliases).toEqual({ $valid: 'gateway_valid', $yes: 'flow_validToOk' });
    // a second branch, put first: the gateway's first out-flow is now the other branch
    const branched = (
      await applyToXml(first.xml, [
        { op: 'add', kind: 'end', name: 'Rejected', after: 'gateway_valid' },
        { op: 'order', id: 'gateway_valid', flows: ['flow_validToRejected', 'flow_validToOk'] },
      ])
    ).xml;
    const again = await rejection(applyToXml(branched, batch));
    expect([again.code, again.message, again.details.op]).toEqual(['E_USAGE', 'outAs $yes: gateway_valid already exists and has 2 flows out of it (flow_validToRejected, flow_validToOk)', 0]);
    expect(again.details.candidates).toEqual(['flow_validToRejected', 'flow_validToOk']);
    expect(again.details.hint).toBe('With ifAbsent, outAs binds the flow out of an existing node only when exactly one leaves it: drop "outAs" there and use the flow\'s id.');
    // no flow out of it, or no flow node: E_USAGE as on a first run, not an E_UNKNOWN_ALIAS later
    const none = await rejection(applyToXml(branched, [{ op: 'add', kind: 'end', id: 'endEvent_ok', ifAbsent: true, before: 'userTask_check', outAs: '$o' }, { op: 'set', id: '$o', values: { name: 'x' } }]));
    expect([none.code, none.message]).toEqual(['E_USAGE', 'outAs $o: endEvent_ok already exists and has no flow out of it']);
    const pool = (await applyToXml(branched, [{ op: 'add', kind: 'participant', name: 'Audit' }])).xml;
    const notFlowNode = await rejection(applyToXml(pool, [{ op: 'add', kind: 'task', id: 'participant_audit', ifAbsent: true, after: 'userTask_check', outAs: '$o' }]));
    expect([notFlowNode.code, notFlowNode.message]).toEqual(['E_USAGE', 'outAs $o: participant_audit already exists and is a participant, no flow node']);
  });

  it('is in the schema, the full guide and the catalogue; the short guide leaves it out', () => {
    const defs = OPS_SCHEMA['$defs'] as Record<string, { properties: Record<string, { pattern?: string }> }>;
    expect(defs['add']!.properties['outAs']!.pattern).toBe(defs['add']!.properties['as']!.pattern);
    expect(Object.keys(defs['node']!.properties)).not.toContain('outAs');
    expect(guideText()).toMatch(/"outAs" on add: the one flow\s+the add creates out of the node, to the old successor on a splice/);
    expect(guideText()).toMatch(/^ {11}keys: kind, name, id, as, flowAs, outAs, refAs, /m);
    expect(ERROR_CATALOGUE.find((entry) => entry.code === 'E_UNKNOWN_ALIAS')!.fix).toContain('"outAs"');
    expect(guideShort()).not.toContain('outAs');
  });
});

describe('batch aliases on the command line (`bpmn apply`)', () => {
  let dir = '';
  const bin = join(__dirname, '..', '..', '..', 'bin', 'bpmn.js');
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-cli-aliases-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads aliases from a file or stdin and prints them, also as JSON', async () => {
    const file = join(dir, 'invoice.bpmn');
    writeFileSync(file, (await newXml({ processName: 'Rechnungsprüfung' })).xml);
    writeFileSync(join(dir, 'ops.json'), JSON.stringify({ ops: INVOICE }));
    const text = execFileSync('node', [bin, 'apply', file, join(dir, 'ops.json')], { encoding: 'utf8' });
    expect(text).toMatch(/^aliases: \$start = startEvent_rechnungEingegangen, .*\$lateFlow = flow_timerOnNachfordernToErinnert$/m);
    const json = JSON.parse(execFileSync('node', [bin, 'apply', file, '-', '--json'], { encoding: 'utf8', input: JSON.stringify([{ op: 'add', kind: 'task', name: 'Archivieren', after: 'serviceTask_buchen', as: '$archive' }]) }));
    expect(json.aliases).toEqual({ $archive: 'task_archivieren' });
    expect(readFileSync(file, 'utf8')).toContain('id="task_archivieren"');
  });

  it('lists the alias of an element retyped to another type, in the aliases line and in the JSON', async () => {
    const file = join(dir, 'retyped.bpmn');
    writeFileSync(file, (await newXml({ processName: 'Invoice' })).xml);
    const ops = [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'invoice', as: '$s' },
      { op: 'add', kind: 'serviceTask', name: 'Check invoice', after: '$s', as: '$t' },
      { op: 'retype', id: '$t', kind: 'userTask' },
    ];
    const json = JSON.parse(execFileSync('node', [bin, 'apply', file, '-', '--json', '--dry-run'], { encoding: 'utf8', input: JSON.stringify(ops) }));
    expect(json.aliases).toEqual({ $s: 'startEvent_start', $t: 'userTask_checkInvoice' });
    const text = execFileSync('node', [bin, 'apply', file, '-'], { encoding: 'utf8', input: JSON.stringify([...ops, { op: 'set', id: '$t', values: { name: 'Check the invoice' } }]) });
    expect(text).toMatch(/^aliases: \$s = startEvent_start, \$t = userTask_checkInvoice$/m);
    expect(readFileSync(file, 'utf8')).toContain('<bpmn:userTask id="userTask_checkInvoice" name="Check the invoice">');
  });

  it('lists the outAs alias of a spliced gateway\'s new flow, in the aliases line and in the JSON', async () => {
    const file = join(dir, 'spliced.bpmn');
    writeFileSync(file, await checkToOk());
    const json = JSON.parse(execFileSync('node', [bin, 'apply', file, '-', '--json', '--dry-run'], { encoding: 'utf8', input: JSON.stringify(SPLICE_GATEWAY) }));
    expect(json.aliases).toEqual({ $in: 'flow_checkToValid', $yes: 'flow_validToOk', $valid: 'gateway_valid', $no: 'flow_validToRejected' });
    const text = execFileSync('node', [bin, 'apply', file, '-'], { encoding: 'utf8', input: JSON.stringify(SPLICE_GATEWAY) });
    expect(text).toMatch(/^aliases: \$in = flow_checkToValid, \$yes = flow_validToOk, \$valid = gateway_valid, \$no = flow_validToRejected$/m);
    expect(readFileSync(file, 'utf8')).toMatch(/<bpmn:sequenceFlow id="flow_validToOk" name="yes" sourceRef="gateway_valid" targetRef="endEvent_ok">\s*<bpmn:conditionExpression/);
  });
});
