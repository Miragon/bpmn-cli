/**
 * The views round fixes together: the ids and report fixes, the Camunda 8
 * fixes (refAs, the subscription redirect) and the views / layout fixes
 * (lane rule of move, a plain remove of a merge) on one build. Synthetic
 * models only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../../src/api.js';
import { BpmnError } from '../../src/domain/document/BpmnError.js';
import { mutationSummary, renderSummary } from '../../src/index.js';

async function rejection(pending: Promise<unknown>): Promise<BpmnError> {
  try {
    await pending;
  } catch (err) {
    if (err instanceof BpmnError) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

const flowIds = (xml: string): string[] => [...xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)"/g)].map((match) => match[1]!);

/** Start -> Check -> exclusive split (Fix in Billing, Skip) -> join -> Ship -> Done, in two lanes of a pool. */
const LANES_BATCH: unknown[] = [
  { op: 'add', kind: 'participant', name: 'Shop', as: '$pool' },
  { op: 'add', kind: 'lane', name: 'Sales', in: '$pool', as: '$sales' },
  { op: 'add', kind: 'lane', name: 'Billing', in: '$pool', as: '$billing' },
  { op: 'add', kind: 'startEvent', name: 'Start', lane: '$sales', as: '$s' },
  { op: 'add', kind: 'task', name: 'Check', after: '$s', as: '$c' },
  {
    op: 'split',
    after: '$c',
    kind: 'exclusiveGateway',
    name: 'Ok?',
    joinAs: '$j',
    branches: [
      { flowName: 'no', condition: '${!ok}', nodes: [{ kind: 'task', name: 'Fix', lane: '$billing' }] },
      { flowName: 'yes', default: true, nodes: [{ kind: 'task', name: 'Skip' }] },
    ],
  },
  { op: 'add', kind: 'task', name: 'Ship', after: '$j', as: '$ship' },
  { op: 'add', kind: 'endEvent', name: 'Done', after: '$ship' },
];

describe('--summary with aliases, refAs, renamed ids and speaking ids', () => {
  it('lists the message of refAs among the aliases; an element the batch created is not also "changed"', async () => {
    const base = await newXml({ processName: 'Order', target: 'camunda8' });
    const result = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Order received', in: 'order', as: '$s' },
      { op: 'add', kind: 'serviceTask', name: 'Check order', after: '$s', as: '$c' },
      { op: 'add', kind: 'intermediateCatchEvent:message', name: 'Payment received', after: '$c', message: 'Payment received', refAs: '$msg', as: '$w' },
      { op: 'ext', id: '$msg', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '=orderId' } },
      { op: 'add', kind: 'exclusiveGateway', after: '$w', as: '$g' },
      { op: 'add', kind: 'endEvent', after: '$g', as: '$e' },
    ]);
    expect(result.result.aliases).toMatchObject({ $msg: 'message_paymentReceived', $w: 'event_paymentReceived', $g: 'gateway_afterPaymentReceived', $e: 'endEvent_afterPaymentReceivedGateway' });
    const summary = mutationSummary(result.result);
    // before: `changed:` listed the message the batch created (and the ext op then changed)
    expect(summary.changed).toEqual([]);
    const text = renderSummary(summary);
    expect(text).toContain('aliases: $s = startEvent_orderReceived, $c = serviceTask_checkOrder, $w = event_paymentReceived, $msg = message_paymentReceived');
    expect(text).not.toMatch(/^changed:/m);
  });

  it('a batch in lanes: created nodes are not "changed" by the lane they got; a later lane change of an existing node is', async () => {
    const base = await newXml({ processName: 'Shop' });
    const built = await applyToXml(base.xml, LANES_BATCH);
    // before: every node of the batch was listed under changed too ("- lane lane_sales")
    expect(mutationSummary(built.result).changed).toEqual([]);
    expect(built.result.changed.some((change) => change.id === 'task_check' && /lane/.test(change.detail ?? ''))).toBe(true);
    const moved = await applyToXml(built.xml, [{ op: 'set', id: 'task_skip', values: { lane: 'lane_billing' } }]);
    expect(mutationSummary(moved.result).changed).toContain('task_skip');
  });
});

describe('Camunda 8: the subscription redirect and the warnings delta', () => {
  it('a subscription given to a receive task goes to its message, says so, and resolves the deploy finding once', async () => {
    const base = await newXml({ processName: 'Inv', target: 'camunda8' });
    const built = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'inv', as: '$s' },
      { op: 'add', kind: 'receiveTask', name: 'Wait for invoice', after: '$s', message: 'Invoice received', as: '$w' },
      { op: 'add', kind: 'endEvent', name: 'Done', after: '$w' },
    ]);
    expect(built.result.warnings.added.map((warning) => warning.code)).toEqual(['W_C8_DEPLOY_MESSAGE']);
    const result = await applyToXml(built.xml, [{ op: 'ext', id: 'receiveTask_waitForInvoice', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '=invoiceId' } }]);
    expect(result.result.notes.join('\n')).toContain('zeebe:subscription goes to message message_invoiceReceived, which receiveTask_waitForInvoice waits for');
    expect(result.result.warnings.added).toEqual([]);
    expect(result.result.warnings.resolved.map((warning) => warning.code)).toEqual(['W_C8_DEPLOY_MESSAGE']);
    expect(result.result.warnings.preexistingCount).toBe(0);
    expect(mutationSummary(result.result).changed).toEqual(['message_invoiceReceived']);
  });
});

describe('remove and move with speaking flow ids', () => {
  it('a plain remove of a merge bridges each path and renames the flows after their new ends', async () => {
    const base = await newXml({ processName: 'Shop' });
    const built = await applyToXml(base.xml, LANES_BATCH);
    expect(built.result.aliases?.['$j']).toBe('gateway_okJoin');
    const result = await applyToXml(built.xml, [{ op: 'remove', ids: ['gateway_okJoin'] }]);
    expect(result.result.renamed).toEqual({ flow_fixToOkJoin: 'flow_fixToShip', flow_skipToOkJoin: 'flow_skipToShip' });
    expect(flowIds(result.xml)).toEqual(expect.arrayContaining(['flow_fixToShip', 'flow_skipToShip']));
    expect(result.result.warnings.added.map((warning) => warning.code)).not.toContain('W_UNREACHABLE');
    expect(renderSummary(mutationSummary(result.result))).toContain('renamed: flow_fixToOkJoin -> flow_fixToShip, flow_skipToOkJoin -> flow_skipToShip');
  });

  it('a plain remove of a parallel join is refused with both commands', async () => {
    const base = await newXml({ processName: 'Par' });
    const built = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'par', as: '$s' },
      { op: 'split', after: '$s', kind: 'parallelGateway', joinAs: '$j', branches: [{ nodes: [{ kind: 'task', name: 'Pack' }] }, { nodes: [{ kind: 'task', name: 'Bill' }] }] },
      { op: 'add', kind: 'endEvent', name: 'Done', after: '$j' },
    ]);
    const join = built.result.aliases!['$j']!;
    expect(join).toBe('gateway_afterStartJoin');
    const err = await rejection(applyToXml(built.xml, [{ op: 'remove', ids: [join] }]));
    expect(err.code).toBe('E_AMBIGUOUS_BRIDGE');
    expect(err.details.hint).toContain(`bpmn remove <file> ${join} --bridge-all`);
    expect(err.details.hint).toContain(`bpmn remove <file> ${join} --no-bridge`);
  });

  it('a node moved out of a sub-process into a cross-lane flow gets add\'s lane and speaking flow ids', async () => {
    const base = await newXml({ processName: 'Shop' });
    const built = await applyToXml(base.xml, [
      ...LANES_BATCH,
      { op: 'add', kind: 'subProcess', name: 'Archive', after: '$ship', as: '$sub' },
      { op: 'add', kind: 'task', name: 'Scan', in: '$sub', as: '$scan' },
    ]);
    expect(flowIds(built.xml)).toContain('flow_okToFix');
    const result = await applyToXml(built.xml, [{ op: 'move', ids: ['task_scan'], flow: 'flow_okToFix' }]);
    // the node had no lane (it was in a sub-process): the lane of the row it is drawn on, W_LANE_INHERITED
    expect(result.result.warnings.added.map((warning) => warning.code)).toContain('W_LANE_INHERITED');
    expect(result.xml).toMatch(/<bpmn:lane id="lane_billing"[^>]*>\s*<bpmn:flowNodeRef>task_fix<\/bpmn:flowNodeRef>\s*<bpmn:flowNodeRef>task_scan<\/bpmn:flowNodeRef>/);
    expect(result.result.renamed).toEqual({ flow_okToFix: 'flow_okToScan' });
    expect(flowIds(result.xml)).toEqual(expect.arrayContaining(['flow_okToScan', 'flow_scanToFix']));
  });
});
