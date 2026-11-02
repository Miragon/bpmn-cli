import { describe, expect, it } from 'vitest';
import { IdRegistry } from '../../../src/model/ids/IdRegistry.js';
import { IdStyle } from '../../../src/model/ids/IdStyle.js';

describe('IdStyle', () => {
  const defaults = IdStyle.of();
  const snake = IdStyle.of({ prefixes: { 'bpmn:UserTask': 'ut_', 'bpmn:SequenceFlow': 'f_' }, case: 'snake_case' });
  const kebab = IdStyle.of({ prefixes: { 'bpmn:UserTask': 'ut-', 'bpmn:SequenceFlow': 'f-' }, case: 'kebab-case' });
  const pascal = IdStyle.of({ prefixes: { 'bpmn:UserTask': 'UserTask_', 'bpmn:SequenceFlow': 'Flow_' }, case: 'PascalCase' });

  function claimed(style: IdStyle, request: Parameters<IdStyle['next']>[0], taken: string[], times: number): string[] {
    const registry = new IdRegistry(taken);
    const ids: string[] = [];
    for (let round = 0; round < times; round++) {
      const { id } = style.next(request, registry);
      registry.claim(id);
      ids.push(id);
    }
    return ids;
  }

  it('says whether its conventions were declared or are the defaults', () => {
    expect([defaults.declared, IdStyle.of({ prefixes: {} }).declared]).toEqual([false, true]);
    expect(defaults.explain({ key: 'userTask' }).source).toBe('default');
    expect(IdStyle.of({ prefixes: { 'bpmn:UserTask': 'ut_' } }).explain({ key: 'userTask' })).toEqual({ head: 'ut_', source: 'lint', body: 'camel' });
  });

  it('asks by kind when the key is a kind and by type otherwise', () => {
    expect(IdStyle.keyRequest('userTask')).toEqual({ key: 'userTask' });
    expect(IdStyle.keyRequest('bpmn:Message')).toEqual({ key: 'bpmn:Message' });
  });

  it.each([
    [defaults, ''],
    [pascal, ''],
    [snake, '_'],
    [kebab, '-'],
  ])('numbers colliding ids with the separator "%s" of its case', (style, separator) => {
    expect(style.suffixSep()).toBe(separator);
  });

  it.each([
    [{ key: 'userTask', name: 'Check invoice' }, 'userTask_checkInvoice'],
    [{ key: 'userTask', name: 'Rechnung prüfen' }, 'userTask_rechnungPruefen'],
    [{ key: 'userTask' }, 'userTask_userTask'],
    [{ key: 'exclusiveGateway', context: 'After Check invoice' }, 'gateway_afterCheckInvoice'],
    [{ key: 'startEvent', trigger: 'timer' }, 'startEvent_timer'],
    [{ key: 'startEvent', trigger: 'message', name: 'Order in' }, 'startEvent_orderIn'],
    [{ key: 'boundaryEvent', trigger: 'timer', context: 'On Review' }, 'event_timerOnReview'],
    [{ key: 'bpmn:Message', name: 'Order placed' }, 'message_orderPlaced'],
    [{ key: 'bpmn:DataObject', name: 'Order' }, 'dataObjectItem_order'],
    [{ key: 'bpmn:Process', name: 'Order flow' }, 'orderFlow'],
    [{ key: 'bpmn:Process' }, 'Process_1'],
    [{ key: 'userTask', name: '2nd check' }, 'userTask_userTask2ndCheck'],
    [{ key: 'userTask', name: 'x'.repeat(100) }, `userTask_${'x'.repeat(40)}`],
  ])('bases the id of %j on "%s"', (request, base) => {
    expect(defaults.derivedBase(request)).toBe(base);
  });

  it('writes the same name in the body case of the declared conventions', () => {
    const request = { key: 'userTask', name: 'Check invoice' };

    expect([snake, kebab, pascal].map((style) => style.derivedBase(request))).toEqual(['ut_check_invoice', 'ut-check-invoice', 'UserTask_CheckInvoice']);
  });

  it('bases the id of a flow on the labels of its two ends', () => {
    const request = { key: 'bpmn:SequenceFlow', source: 'a', target: 'b', sourceLabel: 'Check invoice', targetLabel: 'Pay bill' };

    expect([defaults, snake, kebab, pascal].map((style) => style.derivedBase(request))).toEqual(['flow_checkInvoiceToPayBill', 'f_check_invoice_to_pay_bill', 'f-check-invoice-to-pay-bill', 'Flow_CheckInvoiceToPayBill']);
  });

  it('falls back to the speaking stems of the ends when a flow has no labels, and starts a number with From', () => {
    expect(defaults.derivedBase({ key: 'bpmn:SequenceFlow', source: 'task_check', target: 'task_pay' })).toBe('flow_checkToPay');
    expect(pascal.derivedBase({ key: 'bpmn:SequenceFlow', source: 'a', target: 'b', sourceLabel: '12 check', targetLabel: 'Pay' })).toBe('Flow_From12CheckToPay');
  });

  it('lists every way a long base may be cut, from the cut ones to the whole', () => {
    const long = IdStyle.of({ prefixes: { 'bpmn:UserTask': `${'u'.repeat(30)}_` } });
    const request = { key: 'userTask', name: 'Prüfen und Freigeben der Rechnung des Kunden mit allen Anlagen und Belegen aus dem Archiv' };
    const bases = long.derivedBases(request);

    expect(bases).toContain(long.derivedBase(request));
    expect(bases.at(-1)!.length).toBeGreaterThan(64);
    expect(bases.slice(0, -1).every((base) => base.length <= 64)).toBe(true);
    expect(defaults.derivedBases({ key: 'userTask', name: 'Check invoice' })).toEqual(['userTask_checkInvoice']);
  });

  it('explains where the head of an id comes from', () => {
    expect(defaults.explain({ key: 'bpmn:Process' })).toEqual({ head: '', source: 'bpmn-cli', body: 'camel' });
    expect(defaults.explain({ key: 'bpmn:Message' })).toEqual({ head: 'message_', source: 'bpmn-cli', body: 'camel' });
    expect(snake.explain({ key: 'userTask' }).body).toBe('snake');
  });

  it('suggests the head of the new type for an id that carries the head of the old one', () => {
    expect(defaults.stalePrefix('task_Check', { type: 'bpmn:Task' }, { type: 'bpmn:UserTask' })).toEqual({ was: 'task_', heads: ['userTask_'], suggested: 'userTask_Check' });
  });

  it('leaves an id alone that the new type accepts or that carries no head of the old type', () => {
    expect(defaults.stalePrefix('userTask_Check', { type: 'bpmn:UserTask' }, { type: 'bpmn:UserTask' })).toBeUndefined();
    expect(defaults.stalePrefix('startEvent_Order', { type: 'bpmn:StartEvent' }, { type: 'bpmn:StartEvent', trigger: 'message' })).toBeUndefined();
    expect(defaults.stalePrefix('foo', { type: 'bpmn:Task' }, { type: 'bpmn:UserTask' })).toBeUndefined();
    expect(defaults.stalePrefix('Activity_0f3k9d2', { type: 'bpmn:Task' }, { type: 'bpmn:UserTask' })).toBeUndefined();
  });

  it('suggests a new id from the name or the context when the old one was not in the declared case', () => {
    const named = { key: 'userTask', name: 'Review order' };
    const placed = { key: 'userTask', context: 'After Start' };

    expect(defaults.stalePrefix('task_Check', { type: 'bpmn:Task' }, { type: 'bpmn:UserTask' }, named)).toEqual({ was: 'task_', heads: ['userTask_'], suggested: 'userTask_reviewOrder' });
    expect(defaults.stalePrefix('task_AfterStart', { type: 'bpmn:Task' }, { type: 'bpmn:UserTask' }, placed)?.suggested).toBe('userTask_afterStart');
  });

  it('builds the id of a join from the id of its gateway in the case of the style', () => {
    expect(defaults.joinId('gateway_afterCheck')).toBe('gateway_afterCheckJoin');
    expect(defaults.joinId('Gateway_Check', 'parallelGateway')).toBe('gateway_checkJoin');
    expect(defaults.joinId('x', 'exclusiveGateway', 'Check it')).toBe('gateway_checkItJoin');
    expect([snake.joinId('gateway_Check'), kebab.joinId('gateway_Check'), pascal.joinId('gateway_Check')]).toEqual(['gateway_Check_join', 'gateway_Check-join', 'gateway_CheckJoin']);
  });

  it('numbers the second element of a name and the second process', () => {
    expect(claimed(defaults, { key: 'userTask', name: 'Check invoice' }, [], 3)).toEqual(['userTask_checkInvoice', 'userTask_checkInvoice2', 'userTask_checkInvoice3']);
    expect(claimed(defaults, { key: 'bpmn:Process' }, [], 2)).toEqual(['Process_1', 'Process_2']);
    expect(claimed(snake, { key: 'userTask', name: 'Pay' }, [], 3)).toEqual(['ut_pay', 'ut_pay_2', 'ut_pay_3']);
    expect(claimed(kebab, { key: 'userTask', name: 'Pay' }, [], 2)).toEqual(['ut-pay', 'ut-pay-2']);
  });

  it('chooses a spelled or an anchored variant before it numbers an id that is taken', () => {
    const gateway = { key: 'exclusiveGateway', context: 'After Check' };
    const anchored = { ...gateway, anchorKind: 'Task' };

    expect(claimed(defaults, gateway, ['gateway_afterCheck'], 1)).toEqual(['gateway_exclusiveAfterCheck']);
    expect(claimed(defaults, anchored, ['gateway_afterCheck', 'gateway_exclusiveAfterCheck'], 1)).toEqual(['gateway_afterCheckTask']);
    expect(claimed(defaults, anchored, ['gateway_afterCheck', 'gateway_exclusiveAfterCheck', 'gateway_afterCheckTask'], 1)).toEqual(['gateway_afterCheck2']);
  });

  it('takes a variant when the body is already taken under another prefix', () => {
    expect(claimed(defaults, { key: 'serviceTask', context: 'After Check' }, ['serviceTask_afterCheck', 'userTask_afterCheck'], 1)).toEqual(['serviceTask_afterCheck2']);
  });
});
