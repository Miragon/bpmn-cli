/**
 * Step 3 round 1 fixes together: the ids and report fixes, the Camunda 8
 * fixes (refAs, the subscription redirect) and the views / layout fixes
 * (lane rule of move, a plain remove of a merge) on one build. Synthetic
 * models only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { CliError } from '../src/errors.js';
import { mutationSummary, renderSummary } from '../src/report.js';

async function rejection(p: Promise<unknown>): Promise<CliError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof CliError) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

const flowIds = (xml: string): string[] => [...xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)"/g)].map((m) => m[1]!);

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
    const r = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Order received', in: 'Process_Order', as: '$s' },
      { op: 'add', kind: 'serviceTask', name: 'Check order', after: '$s', as: '$c' },
      { op: 'add', kind: 'intermediateCatchEvent:message', name: 'Payment received', after: '$c', message: 'Payment received', refAs: '$msg', as: '$w' },
      { op: 'ext', id: '$msg', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '=orderId' } },
      { op: 'add', kind: 'exclusiveGateway', after: '$w', as: '$g' },
      { op: 'add', kind: 'endEvent', after: '$g', as: '$e' },
    ]);
    expect(r.result.aliases).toMatchObject({ $msg: 'Message_PaymentReceived', $w: 'Event_PaymentReceived', $g: 'Gateway_AfterPaymentReceived', $e: 'Event_EndAfterPaymentReceived' });
    const summary = mutationSummary(r.result);
    // before: `changed:` listed the message the batch created (and the ext op then changed)
    expect(summary.changed).toEqual([]);
    const text = renderSummary(summary);
    expect(text).toContain('aliases: $s = Event_OrderReceived, $c = Activity_CheckOrder, $w = Event_PaymentReceived, $msg = Message_PaymentReceived');
    expect(text).not.toMatch(/^changed:/m);
  });

  it('a batch in lanes: created nodes are not "changed" by the lane they got; a later lane change of an existing node is', async () => {
    const base = await newXml({ processName: 'Shop' });
    const built = await applyToXml(base.xml, LANES_BATCH);
    // before: every node of the batch was listed under changed too ("- lane Lane_Sales")
    expect(mutationSummary(built.result).changed).toEqual([]);
    expect(built.result.changed.some((c) => c.id === 'Activity_Check' && /lane/.test(c.detail ?? ''))).toBe(true);
    const moved = await applyToXml(built.xml, [{ op: 'set', id: 'Activity_Skip', values: { lane: 'Lane_Billing' } }]);
    expect(mutationSummary(moved.result).changed).toContain('Activity_Skip');
  });
});

describe('Camunda 8: the subscription redirect and the warnings delta', () => {
  it('a subscription given to a receive task goes to its message, says so, and resolves the deploy finding once', async () => {
    const base = await newXml({ processName: 'Inv', target: 'camunda8' });
    const built = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Go', in: 'Process_Inv', as: '$s' },
      { op: 'add', kind: 'receiveTask', name: 'Wait for invoice', after: '$s', message: 'Invoice received', as: '$w' },
      { op: 'add', kind: 'endEvent', name: 'Done', after: '$w' },
    ]);
    expect(built.result.warnings.added.map((w) => w.code)).toEqual(['W_C8_DEPLOY_MESSAGE']);
    const r = await applyToXml(built.xml, [{ op: 'ext', id: 'Activity_WaitForInvoice', action: 'add', type: 'zeebe:subscription', attrs: { correlationKey: '=invoiceId' } }]);
    expect(r.result.notes.join('\n')).toContain('zeebe:subscription goes to message Message_InvoiceReceived, which Activity_WaitForInvoice waits for');
    expect(r.result.warnings.added).toEqual([]);
    expect(r.result.warnings.resolved.map((w) => w.code)).toEqual(['W_C8_DEPLOY_MESSAGE']);
    expect(r.result.warnings.preexistingCount).toBe(0);
    expect(mutationSummary(r.result).changed).toEqual(['Message_InvoiceReceived']);
  });
});

describe('remove and move with speaking flow ids', () => {
  it('a plain remove of a merge bridges each path and renames the flows after their new ends', async () => {
    const base = await newXml({ processName: 'Shop' });
    const built = await applyToXml(base.xml, LANES_BATCH);
    expect(built.result.aliases?.['$j']).toBe('Gateway_Ok_join');
    const r = await applyToXml(built.xml, [{ op: 'remove', ids: ['Gateway_Ok_join'] }]);
    expect(r.result.renamed).toEqual({ Flow_FixToOkJoin: 'Flow_FixToShip', Flow_SkipToOkJoin: 'Flow_SkipToShip' });
    expect(flowIds(r.xml)).toEqual(expect.arrayContaining(['Flow_FixToShip', 'Flow_SkipToShip']));
    expect(r.result.warnings.added.map((w) => w.code)).not.toContain('W_UNREACHABLE');
    expect(renderSummary(mutationSummary(r.result))).toContain('renamed: Flow_FixToOkJoin -> Flow_FixToShip, Flow_SkipToOkJoin -> Flow_SkipToShip');
  });

  it('a plain remove of a parallel join is refused with both commands', async () => {
    const base = await newXml({ processName: 'Par' });
    const built = await applyToXml(base.xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Par', as: '$s' },
      { op: 'split', after: '$s', kind: 'parallelGateway', joinAs: '$j', branches: [{ nodes: [{ kind: 'task', name: 'Pack' }] }, { nodes: [{ kind: 'task', name: 'Bill' }] }] },
      { op: 'add', kind: 'endEvent', name: 'Done', after: '$j' },
    ]);
    const join = built.result.aliases!['$j']!;
    expect(join).toBe('Gateway_AfterStart_join');
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
    expect(flowIds(built.xml)).toContain('Flow_OkToFix');
    const r = await applyToXml(built.xml, [{ op: 'move', ids: ['Activity_Scan'], flow: 'Flow_OkToFix' }]);
    // the node had no lane (it was in a sub-process): the lane of the row it is drawn on, W_LANE_INHERITED
    expect(r.result.warnings.added.map((w) => w.code)).toContain('W_LANE_INHERITED');
    expect(r.xml).toMatch(/<bpmn:lane id="Lane_Billing"[^>]*>\s*<bpmn:flowNodeRef>Activity_Fix<\/bpmn:flowNodeRef>\s*<bpmn:flowNodeRef>Activity_Scan<\/bpmn:flowNodeRef>/);
    expect(r.result.renamed).toEqual({ Flow_OkToFix: 'Flow_OkToScan' });
    expect(flowIds(r.xml)).toEqual(expect.arrayContaining(['Flow_OkToScan', 'Flow_ScanToFix']));
  });
});
