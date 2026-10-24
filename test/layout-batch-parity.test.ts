/**
 * Issue #18, stage A: batch parity of the incremental layout, the boundary
 * side control and E_NO_ROOM with a command that works. On the synthetic
 * hand-drawn fixture of the plugin eval `edit-hand-drawn-model`:
 *
 *  - the agent's batches (decision + "no" to the existing node; decision + a
 *    new "no" branch; `split`; a merge gateway; each with and without the
 *    timer reminder path) give the same shapes as the same ops sent as
 *    single commands, and add no backward flow; without the reminder path
 *    they add no layout problem at all (score 0, like two commands; on 0.5.0
 *    the batches gave 9 to 19). The new nodes are placed in op order, a chain
 *    of new nodes stays a splice through a split (diagram/NodePlacer.ts
 *    spliceTarget, chainReaches), exception paths wait for the normal flow,
 *    and the flows of a node are routed as soon as the next one is placed
 *    (incremental.ts routeNow), like the next single command sees them.
 *  - a `connect` into a merge an earlier command spliced, that would enter it
 *    backwards, places the merge again right of its rightmost predecessor
 *    (incremental.ts pullJoins); a loop return does not.
 *  - `place <boundaryEventId> --side top|bottom` (op key "side") moves the
 *    event to that border of its host, routes its flow again and brings its
 *    exception path along: the reminder path above the approval, score 0.
 *  - E_NO_ROOM from place / align carries one command (details.command,
 *    details.ops) that a dry run inside the op checked: running it and then
 *    the place again succeeds, for both refusals of the eval (the drawings
 *    0.5.0 left after the batches the agents sent, test/fixtures/layout-batch).
 *  - bench E8 / E9 (tools/bench/gen-edits.mjs) and the soft budget of
 *    `bench --compare` (tools/bench/lib/compare.mjs).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyToXml, metricsXml } from '../src/api.js';
import { CliError } from '../src/shared/CliError.js';
import { diffProblems } from '../src/diagram/utils/problems.js';
import { LayoutAnalysis } from '../src/diagram/LayoutAnalysis.js';

const ROOT = join(import.meta.dirname, '..');
const FIXTURE = (() => {
  const script = readFileSync(join(ROOT, 'plugins', 'bpmn-cli', 'evals', 'edit-hand-drawn-model', 'scaffold.sh'), 'utf8');
  return /<<'BPMN_FIXTURE'\n([\s\S]*?)\nBPMN_FIXTURE/.exec(script)![1]! + '\n';
})();
const fixture = (name: string): string => readFileSync(join(ROOT, 'test', 'fixtures', 'layout-batch', name), 'utf8');

const approve = { op: 'add', kind: 'userTask', name: 'Approve purchase', id: 'Activity_ApprovePurchase', flow: 'Flow_0yq6cfd' };
const decision = { op: 'add', kind: 'exclusiveGateway', name: 'Purchase approved?', id: 'Gateway_PurchaseApproved', after: 'Activity_ApprovePurchase', before: 'Activity_1v0w8zr' };
const yes = { op: 'set', id: 'Flow_PurchaseApprovedToOrderGoods', values: { name: 'yes', condition: '${purchaseApproved}' } };
const reminder = [
  { op: 'add', kind: 'boundaryEvent:timer', name: '3 days', id: 'Event_ApprovalOverdue', on: 'Activity_ApprovePurchase', timer: 'P3D', nonInterrupting: true },
  { op: 'add', kind: 'sendTask', name: 'Send reminder to manager', id: 'Activity_SendApprovalReminder', after: 'Event_ApprovalOverdue' },
  { op: 'add', kind: 'endEvent', name: 'Reminder sent', id: 'Event_ReminderSent', after: 'Activity_SendApprovalReminder' },
];
const BATCHES: Record<string, object[]> = {
  'decision, "no" to the existing node': [approve, decision, yes, { op: 'connect', source: 'Gateway_PurchaseApproved', target: 'Activity_0f3j5ny', id: 'Flow_PurchaseApprovedToNotifyRequester', name: 'no', default: true }],
  'decision, a new "no" branch': [
    approve,
    decision,
    yes,
    { op: 'add', kind: 'sendTask', name: 'Notify requester of rejection', id: 'Activity_NotifyRequesterOfRejection', after: 'Gateway_PurchaseApproved', flowName: 'no', default: true },
    { op: 'add', kind: 'endEvent', name: 'Purchase rejected', id: 'Event_PurchaseRejected', after: 'Activity_NotifyRequesterOfRejection' },
  ],
  split: [
    approve,
    {
      op: 'split',
      after: 'Activity_ApprovePurchase',
      kind: 'exclusiveGateway',
      name: 'Purchase approved?',
      id: 'Gateway_PurchaseApproved',
      branches: [
        { flowName: 'yes', condition: '${purchaseApproved}', nodes: [] },
        { flowName: 'no', default: true, nodes: [{ kind: 'sendTask', name: 'Notify requester of rejection' }, { kind: 'endEvent', name: 'Purchase not approved' }] },
      ],
    },
  ],
  'a merge gateway': [
    approve,
    decision,
    yes,
    { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_MergeRejection', flow: 'Flow_1r2x9bv' },
    { op: 'connect', source: 'Gateway_PurchaseApproved', target: 'Gateway_MergeRejection', id: 'Flow_PurchaseApprovedToMergeRejection', name: 'no', default: true },
  ],
};

const shapes = (xml: string): string[] => [...xml.matchAll(/bpmnElement="([^"]+)"[^>]*>\s*<dc:Bounds ([^/]+)\/>/g)].map((m) => `${m[1]} ${m[2]}`).sort();
const boundsOf = (xml: string, id: string): { x: number; y: number; width: number; height: number } => {
  const m = new RegExp(`bpmnElement="${id}"[^>]*>\\s*<dc:Bounds x="([-\\d.]+)" y="([-\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`).exec(xml)!;
  return { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) };
};
const bottomOf = (b: { y: number; height: number }): number => b.y + b.height;
const added = async (before: string, after: string): Promise<string[]> => diffProblems((await LayoutAnalysis.ofXml(before)).problems, (await LayoutAnalysis.ofXml(after)).problems).added.map((p) => p.kind);

async function batch(ops: object[], xml = FIXTURE): Promise<string> {
  return (await applyToXml(xml, ops, { force: true })).xml;
}
async function singles(ops: object[], xml = FIXTURE): Promise<string> {
  for (const op of ops) xml = (await applyToXml(xml, [op], { force: true })).xml;
  return xml;
}

describe('a batch places like the same ops as single commands (issue #18 (1))', () => {
  for (const [name, ops] of Object.entries(BATCHES)) {
    it(`${name}: same shapes as single commands, score 0`, async () => {
      const b = await batch(ops);
      expect(shapes(b)).toEqual(shapes(await singles(ops)));
      expect(await added(FIXTURE, b)).toEqual([]);
      expect((await metricsXml(b)).score).toBe(0);
    });
    it(`${name} + the timer reminder path: same shapes as single commands, no backward flow, no more crossings`, async () => {
      const all = [...ops, ...reminder];
      const b = await batch(all);
      const s = await singles(all);
      expect(shapes(b)).toEqual(shapes(s));
      const kb = await added(FIXTURE, b);
      expect(kb).not.toContain('backwardFlow');
      expect(kb.filter((k) => k === 'crossings').length).toBeLessThanOrEqual((await added(FIXTURE, s)).filter((k) => k === 'crossings').length);
      // the hard kinds and the frames stay clean
      expect(kb.filter((k) => !['crossings', 'labelOnLine', 'labelClash'].includes(k))).toEqual([]);
    });
  }

  it('the decision row: the task and the gateway stay in the row of the drawing, the new "no" branch goes below', async () => {
    const b = await batch(BATCHES['decision, a new "no" branch']!);
    const row = (id: string): number => Math.round(boundsOf(b, id).y + boundsOf(b, id).height / 2);
    expect(row('Activity_ApprovePurchase')).toBe(row('Gateway_1hd8x2m'));
    expect(row('Gateway_PurchaseApproved')).toBe(row('Gateway_1hd8x2m'));
    expect(row('Activity_1v0w8zr')).toBe(row('Gateway_1hd8x2m'));
    expect(row('Activity_NotifyRequesterOfRejection')).toBeGreaterThan(row('Gateway_1hd8x2m'));
    expect(boundsOf(b, 'Activity_ApprovePurchase').x).toBeGreaterThan(boundsOf(b, 'Gateway_1hd8x2m').x);
    expect(boundsOf(b, 'Gateway_PurchaseApproved').x).toBeLessThan(boundsOf(b, 'Activity_1v0w8zr').x);
  });

  it('an exception path waits for the normal flow, also when its ops come first', async () => {
    const ops = BATCHES['decision, a new "no" branch']!;
    const first = await batch([ops[0]!, ...reminder, ...ops.slice(1)]);
    expect(await added(FIXTURE, first)).not.toContain('backwardFlow');
    // the normal flow keeps its row: the reminder path does not push the decision off it
    const row = (id: string): number => Math.round(boundsOf(first, id).y + boundsOf(first, id).height / 2);
    expect(row('Gateway_PurchaseApproved')).toBe(row('Gateway_1hd8x2m'));
    // the path leaves the approval's row (since stage B above it: below, it would cross the new "no" branch)
    expect(row('Activity_SendApprovalReminder')).not.toBe(row('Activity_ApprovePurchase'));
  });
});

describe('a connect into a merge that would enter it backwards (issue #18, open question 4)', () => {
  it('the merge an earlier command spliced moves right of its rightmost predecessor, before its successor', async () => {
    const ops = BATCHES['a merge gateway']!;
    const before = await singles(ops.slice(0, -1));
    const r = await applyToXml(before, [ops[ops.length - 1]!], { force: true });
    expect(r.result.layout?.moved).toContain('Gateway_MergeRejection');
    const m = boundsOf(r.xml, 'Gateway_MergeRejection');
    expect(m.x).toBeGreaterThan(boundsOf(r.xml, 'Gateway_PurchaseApproved').x + 50);
    expect(boundsOf(r.xml, 'Activity_0f3j5ny').x).toBeGreaterThan(m.x + m.width);
    expect(await added(before, r.xml)).toEqual([]);
  });

  it('a loop return into an earlier merge stays a loop: the merge does not move', async () => {
    const xml = await batch([{ op: 'add', kind: 'exclusiveGateway', id: 'Gateway_Recheck', flow: 'Flow_0b8wq1x' }]);
    const r = await applyToXml(xml, [{ op: 'connect', source: 'Activity_0f3j5ny', target: 'Gateway_Recheck', name: 'again' }], { force: true });
    expect(boundsOf(r.xml, 'Gateway_Recheck')).toEqual(boundsOf(xml, 'Gateway_Recheck'));
    expect(r.result.layout?.moved ?? []).not.toContain('Gateway_Recheck');
  });
});

describe('place --side: a boundary event on the other border of its host (issue #18 (4))', () => {
  for (const name of ['decision, "no" to the existing node', 'a merge gateway']) {
    it(`${name} + reminder path: --side bottom takes the path below the approval, --side top back above it, score 0`, async () => {
      // since stage B the placement itself puts this path above the approval (below, it crosses the "no" flow)
      for (const xml of [await batch([...BATCHES[name]!, ...reminder]), await singles([...BATCHES[name]!, ...reminder])]) {
        const host = boundsOf(xml, 'Activity_ApprovePurchase');
        const down = await applyToXml(xml, [{ op: 'place', ids: ['Event_ApprovalOverdue'], side: 'bottom' }]);
        const evb = boundsOf(down.xml, 'Event_ApprovalOverdue');
        expect(Math.round(evb.y + evb.height / 2)).toBe(host.y + host.height);
        expect(boundsOf(down.xml, 'Activity_SendApprovalReminder').y).toBeGreaterThanOrEqual(host.y + host.height);
        expect(down.result.layout?.format?.[0]?.rerouted).toContain('Flow_ApprovalOverdueToSendApprovalReminder');
        const r = await applyToXml(down.xml, [{ op: 'place', ids: ['Event_ApprovalOverdue'], side: 'top' }]);
        const ev = boundsOf(r.xml, 'Event_ApprovalOverdue');
        expect(Math.round(ev.y + ev.height / 2)).toBe(host.y);
        expect(boundsOf(r.xml, 'Activity_SendApprovalReminder').y + 80).toBeLessThanOrEqual(host.y);
        expect(boundsOf(r.xml, 'Event_ReminderSent').y + 36).toBeLessThanOrEqual(host.y);
        expect((await metricsXml(r.xml)).score).toBe(0);
        expect(r.result.layout?.format?.[0]?.rerouted).toContain('Flow_ApprovalOverdueToSendApprovalReminder');
      }
    });
  }

  it('in the top lane of a pool the room above the host is made inside its lane first (the lane grows, the path stays in it)', async () => {
    const { newXml } = await import('../src/api.js');
    const drawn = await applyToXml((await newXml({ processName: 'Orders' })).xml, [
      { op: 'add', kind: 'participant', name: 'Company', id: 'Participant_Company' },
      { op: 'add', kind: 'lane', name: 'Sales', id: 'Lane_Sales', in: 'Participant_Company' },
      { op: 'add', kind: 'lane', name: 'Billing', id: 'Lane_Billing', in: 'Participant_Company' },
      { op: 'add', kind: 'startEvent', name: 'Order received', in: 'Participant_Company', lane: 'Lane_Sales', as: '$s' },
      { op: 'add', kind: 'userTask', name: 'Check order', after: '$s', lane: 'Lane_Sales', as: '$c' },
      { op: 'add', kind: 'serviceTask', name: 'Send invoice', after: '$c', lane: 'Lane_Billing', as: '$i' },
      { op: 'add', kind: 'endEvent', name: 'Invoiced', after: '$i', lane: 'Lane_Billing' },
    ]);
    // a format command makes the drawing hand-made; the reminder path goes below the task, in its lane
    const kept = (await applyToXml(drawn.xml, [{ op: 'space', after: 'Activity_CheckOrder', by: 10 }])).xml;
    const path = [
      { op: 'add', kind: 'boundaryEvent:timer', name: '2 days', id: 'Event_CheckOverdue', on: 'Activity_CheckOrder', timer: 'P2D', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', name: 'Remind sales', id: 'Activity_RemindSales', after: 'Event_CheckOverdue' },
      { op: 'add', kind: 'endEvent', name: 'Sales reminded', id: 'Event_SalesReminded', after: 'Activity_RemindSales' },
    ];
    const below = (await applyToXml(kept, path)).xml;
    const r = await applyToXml(below, [{ op: 'place', ids: ['Event_CheckOverdue'], side: 'top' }]);
    const lane = boundsOf(r.xml, 'Lane_Sales');
    const host = boundsOf(r.xml, 'Activity_CheckOrder');
    const remind = boundsOf(r.xml, 'Activity_RemindSales');
    expect(remind.y + remind.height).toBeLessThanOrEqual(host.y);
    expect(remind.y).toBeGreaterThanOrEqual(lane.y);
    expect(boundsOf(r.xml, 'Event_SalesReminded').y).toBeGreaterThanOrEqual(lane.y);
    expect(lane.height).toBeGreaterThan(boundsOf(below, 'Lane_Sales').height);
    expect(r.result.layout?.format?.[0]?.notes?.join(' ')).toMatch(/made \d+ px of room above Activity_CheckOrder in its lane Lane_Sales/);
    const hard = ['overlaps', 'through', 'outsideLane', 'outsidePool', 'frameIntrusion', 'frameOverlap'];
    expect((await added(below, r.xml)).filter((k) => hard.includes(k))).toEqual([]);
  });

  it('the side it already has is a note; a shape that is no boundary event is E_WRONG_KIND; side with a row / column or two ids is a usage error', async () => {
    const xml = await batch([approve, ...reminder]);
    const same = await applyToXml(xml, [{ op: 'place', ids: ['Event_ApprovalOverdue'], side: 'bottom' }]);
    expect(same.unchanged).toBe(true);
    await expect(applyToXml(xml, [{ op: 'place', ids: ['Activity_ApprovePurchase'], side: 'top' }])).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
    await expect(applyToXml(xml, [{ op: 'place', ids: ['Event_ApprovalOverdue'], side: 'top', rowOf: 'Activity_0k3x9qa' }])).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(applyToXml(xml, [{ op: 'place', ids: ['Event_ApprovalOverdue', 'Activity_SendApprovalReminder'], side: 'top' }])).rejects.toMatchObject({ code: 'E_USAGE' });
    await expect(applyToXml(xml, [{ op: 'place', ids: ['Event_ApprovalOverdue'], side: 'left' }])).rejects.toMatchObject({ code: 'E_USAGE' });
    // placing a boundary event with a row / column still refuses, and names --side
    const err = (await applyToXml(xml, [{ op: 'place', ids: ['Event_ApprovalOverdue'], rowOf: 'Activity_0k3x9qa' }]).catch((e: unknown) => e)) as CliError;
    expect(err.code).toBe('E_WRONG_KIND');
    expect(String(err.details.hint)).toContain('--side top|bottom');
  });
});

describe('E_NO_ROOM carries one command that makes the room (issue #18 (5))', () => {
  const place = { op: 'place', ids: ['Activity_ApprovePurchase', 'Gateway_PurchaseApproved'], rowOf: 'Gateway_1hd8x2m', after: 'Gateway_1hd8x2m' };
  for (const name of ['no-room-merge.bpmn', 'no-room-no-branch.bpmn']) {
    it(`${name}: the command of the refusal, then the place again, succeeds`, async () => {
      const xml = fixture(name);
      const err = (await applyToXml(xml, [place]).catch((e: unknown) => e)) as CliError;
      expect(err).toBeInstanceOf(CliError);
      expect(err.code).toBe('E_NO_ROOM');
      expect(err.details['command']).toBe('bpmn space <file> --after Gateway_1hd8x2m --by 2col');
      expect(err.details['ops']).toEqual([{ op: 'space', after: 'Gateway_1hd8x2m', by: '2col' }]);
      expect(String(err.details.hint)).toContain('`bpmn space <file> --after Gateway_1hd8x2m --by 2col` (checked: the place fits then)');
      const roomy = (await applyToXml(xml, err.details['ops'] as object[])).xml;
      const r = await applyToXml(roomy, [place]);
      const row = (id: string): number => Math.round(boundsOf(r.xml, id).y + boundsOf(r.xml, id).height / 2);
      expect(row('Activity_ApprovePurchase')).toBe(row('Gateway_1hd8x2m'));
      // in one batch: the space op before the place
      await expect(applyToXml(xml, [...(err.details['ops'] as object[]), place])).resolves.toBeDefined();
    });
  }

  const dir = mkdtempSync(join(tmpdir(), 'bpmn-no-room-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('on the command line the command names the file and runs as printed', () => {
    mkdirSync(join(dir, 'model dir'), { recursive: true });
    const file = join(dir, 'model dir', 'purchase.bpmn');
    writeFileSync(file, fixture('no-room-merge.bpmn'));
    const cli = (...args: string[]): { code: number; out: string; err: string } => {
      const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
      return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
    };
    const args = ['place', file, 'Activity_ApprovePurchase', 'Gateway_PurchaseApproved', '--row-of', 'Gateway_1hd8x2m', '--after', 'Gateway_1hd8x2m'];
    const refused = cli(...args, '--json');
    expect(refused.code).not.toBe(0);
    const error = JSON.parse(refused.err).error as { code: string; command: string; hint: string };
    expect(error.code).toBe('E_NO_ROOM');
    expect(error.command).toBe(`bpmn space '${file}' --after Gateway_1hd8x2m --by 2col`);
    expect(error.hint).toContain(error.command);
    const argv = ['space', file, '--after', 'Gateway_1hd8x2m', '--by', '2col'];
    expect(error.command).toBe(`bpmn ${argv.map((a) => (a === file ? `'${a}'` : a)).join(' ')}`);
    expect(cli(...argv).code).toBe(0);
    expect(cli(...args).code).toBe(0);
  });

  it('without a space-tool run that helps, the hint names the shapes to move first', async () => {
    // a column inside the pool-less drawing that the start event blocks: no space after the reference makes room left of it
    const xml = fixture('no-room-merge.bpmn');
    const err = (await applyToXml(xml, [{ op: 'place', ids: ['Activity_0f3j5ny'], columnOf: 'StartEvent_1', rowOf: 'StartEvent_1' }]).catch((e: unknown) => e)) as CliError;
    expect(err.code).toBe('E_NO_ROOM');
    expect(err.details['command']).toBeUndefined();
    expect(String(err.details.hint)).toMatch(/^No space-tool run makes this room/);
  });
});

describe('bench E8 / E9 and the soft budget (issue #18 (6))', () => {
  it('E8 splices a decision into a branch of a split with a new "no" branch, E9 adds the timer reminder path', async () => {
    const { generate } = (await import('../tools/bench/gen-edits.mjs')) as { generate: (xml: string) => Promise<{ edits: Record<string, { applicable: boolean; cli: Array<Record<string, unknown>>; expect: Record<string, unknown> }> }> };
    const g = await generate(FIXTURE);
    expect(g.edits['E8']!.applicable).toBe(true);
    expect(g.edits['E8']!.cli.map((o) => `${String(o['op'])}:${String(o['kind'] ?? '')}`)).toEqual(['add:userTask', 'add:exclusiveGateway', 'add:sendTask', 'add:endEvent']);
    expect(g.edits['E8']!.cli[0]!['flow']).toMatch(/^Flow_/);
    expect(g.edits['E9']!.cli.slice(4).map((o) => o['kind'])).toEqual(['boundaryEvent:timer', 'sendTask', 'endEvent']);
    // the semantic check of the bench accepts the result of the batch
    const { checkEdit, readModel } = (await import('../tools/bench/lib/measure.mjs')) as { checkEdit: (e: unknown, m: unknown) => { ok: boolean; hasDi: boolean }; readModel: (xml: string) => Promise<unknown> };
    for (const key of ['E8', 'E9']) {
      const r = await applyToXml(FIXTURE, g.edits[key]!.cli);
      expect(checkEdit(g.edits[key]!.expect, await readModel(r.xml))).toEqual({ ok: true, hasDi: true });
      expect(await added(FIXTURE, r.xml)).not.toContain('backwardFlow');
    }
  });

  it('bench --compare fails when the runs of E8 / E9 adding a soft kind exceed the budget', async () => {
    const { compareResults } = (await import('../tools/bench/lib/compare.mjs')) as { compareResults: (a: string, b: string, budget?: string) => { regressed: boolean; soft: { over: Array<{ edit: string; kind: string }> } } };
    const base = mkdtempSync(join(tmpdir(), 'bench-soft-'));
    try {
      const run = (dir: string, back: number): void => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'meta.json'), JSON.stringify({ arms: { 'new-auto': { name: 'new' } }, hardKinds: ['overlaps'] }));
        const recs = [0, 1, 2].map((i) => ({ key: `scenarios/m${i}/E8/primary`, corpus: 'scenarios', model: `m${i}`, edit: 'E8', variant: 'primary', ok: true, semanticOk: true, hard: { addedKinds: {} }, soft: { addedKinds: { crossings: 0, backwardFlow: i < back ? 1 : 0 } } }));
        writeFileSync(join(dir, 'edits-new-auto.jsonl'), recs.map((r) => `${JSON.stringify(r)}\n`).join(''));
      };
      run(join(base, 'old'), 0);
      run(join(base, 'ok'), 1);
      run(join(base, 'over'), 2);
      const budget = join(base, 'budget.json');
      writeFileSync(budget, JSON.stringify({ corpora: { scenarios: { E8: { crossings: 0, backwardFlow: 1 } } } }));
      expect(compareResults(join(base, 'old'), join(base, 'ok'), budget).regressed).toBe(false);
      const over = compareResults(join(base, 'old'), join(base, 'over'), budget);
      expect(over.regressed).toBe(true);
      expect(over.soft.over.map((r) => `${r.edit} ${r.kind}`)).toEqual(['E8 backwardFlow']);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

/**
 * The findings of the verification of stage A, each failing on the stage A
 * build: a batch that splices into two branches of one gateway (also in a
 * pool with lanes, also with the merge added first), `place --side` back to
 * the bottom in a pool with lanes and next to an annotation on a flow, and
 * E_NO_ROOM picking the best space-tool run and naming a command only when
 * it runs on the file.
 */
describe('stage A verification findings (issue #18)', () => {
  /** The eval's purchase flow in a pool with two lanes ("yes" leads into the lower lane), made hand-drawn by a space op. */
  const lanes = async (): Promise<string> => {
    const { newXml } = await import('../src/api.js');
    const drawn = await applyToXml((await newXml({ processName: 'Purchase' })).xml, [
      { op: 'add', kind: 'participant', name: 'Company', id: 'Participant_Company' },
      { op: 'add', kind: 'lane', name: 'Requester', id: 'Lane_Requester', in: 'Participant_Company' },
      { op: 'add', kind: 'lane', name: 'Purchasing', id: 'Lane_Purchasing', in: 'Participant_Company' },
      { op: 'add', kind: 'startEvent', id: 'StartEvent_Request', name: 'Request', in: 'Participant_Company', lane: 'Lane_Requester' },
      { op: 'add', kind: 'userTask', id: 'Activity_CheckBudget', name: 'Check budget', after: 'StartEvent_Request' },
      { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_Budget', name: 'Budget available?', after: 'Activity_CheckBudget' },
      { op: 'add', kind: 'serviceTask', id: 'Activity_OrderGoods', name: 'Order goods', after: 'Gateway_Budget', flowName: 'yes', flowId: 'Flow_BudgetYes', condition: '${ok}', lane: 'Lane_Purchasing' },
      { op: 'add', kind: 'endEvent', id: 'Event_GoodsOrdered', name: 'Goods ordered', after: 'Activity_OrderGoods' },
      { op: 'add', kind: 'sendTask', id: 'Activity_NotifyRequester', name: 'Notify requester', after: 'Gateway_Budget', flowName: 'no', flowId: 'Flow_BudgetNo', default: true },
      { op: 'add', kind: 'endEvent', id: 'Event_RequestRejected', name: 'Request rejected', after: 'Activity_NotifyRequester' },
    ]);
    return (await applyToXml(drawn.xml, [{ op: 'space', after: 'Activity_CheckBudget', by: 10 }])).xml;
  };
  const ids = (xml: string): { yes: string; no: string; order: string; notify: string } =>
    xml.includes('Flow_BudgetYes') ? { yes: 'Flow_BudgetYes', no: 'Flow_BudgetNo', order: 'Activity_OrderGoods', notify: 'Activity_NotifyRequester' } : { yes: 'Flow_0yq6cfd', no: 'Flow_1r2x9bv', order: 'Activity_1v0w8zr', notify: 'Activity_0f3j5ny' };
  const variants = (xml: string): Record<string, object[]> => {
    const f = ids(xml);
    const task = { op: 'add', kind: 'userTask', name: 'Approve purchase', id: 'Activity_ApprovePurchase', flow: f.yes };
    const merge = { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_MergeRejection', flow: f.no };
    const dec = { op: 'add', kind: 'exclusiveGateway', name: 'Purchase approved?', id: 'Gateway_PurchaseApproved', after: 'Activity_ApprovePurchase', before: f.order };
    const conn = { op: 'connect', source: 'Gateway_PurchaseApproved', target: 'Gateway_MergeRejection', id: 'Flow_PurchaseApprovedToMergeRejection', name: 'no', default: true };
    return {
      'a task into "yes", a merge into "no"': [task, merge],
      'a merge into "no", a task into "yes"': [merge, task],
      'a task into each branch': [task, { op: 'add', kind: 'userTask', name: 'Log rejection', id: 'Activity_LogRejection', flow: f.no }],
      'the merge batch': [task, dec, merge, conn],
      'the merge batch, the merge first': [merge, task, dec, conn],
    };
  };

  for (const model of ['the eval fixture', 'a pool with lanes']) {
    it(`${model}: splices into two branches of one gateway give the shapes and the score of single commands`, async () => {
      const xml = model === 'the eval fixture' ? FIXTURE : await lanes();
      for (const [name, ops] of Object.entries(variants(xml))) {
        const b = await batch(ops, xml);
        const s = await singles(ops, xml);
        expect(shapes(b), name).toEqual(shapes(s));
        expect((await metricsXml(b)).score, name).toBe((await metricsXml(s)).score);
        expect(await added(xml, b), name).not.toContain('backwardFlow');
      }
    });
  }

  it('a pool with lanes: a node spliced before a successor in another row of a branching gateway keeps that row in a batch', async () => {
    const xml = await lanes();
    const b = await batch(variants(xml)['a task into each branch']!, xml);
    const row = (id: string): number => Math.round(boundsOf(b, id).y + boundsOf(b, id).height / 2);
    expect(row('Activity_ApprovePurchase')).toBe(row('Activity_OrderGoods'));
    expect(row('Activity_LogRejection')).toBe(row('Activity_NotifyRequester'));
    // the lane did not grow for a row of its own
    expect(boundsOf(b, 'Lane_Purchasing').height).toBe(boundsOf(xml, 'Lane_Purchasing').height);
  });

  const scenario = (name: string): string => readFileSync(join(ROOT, 'tools', 'scenarios', `${name}.bpmn`), 'utf8');
  const hard = ['overlaps', 'through', 'outsideLane', 'outsidePool', 'outsideSub', 'frameIntrusion', 'frameOverlap', 'degenerateEdge', 'missing'];

  it('place --side: top and back to the bottom in a pool with lanes (a node of another lane is no part of the path)', async () => {
    for (const [name, id] of [['lanes__complaint-t1', 'Event_VersandFehlgeschlagen'], ['subproc__s15-lanes-sub-eventsub', 'Event_Overdue']] as const) {
      const xml = scenario(name);
      const top = await applyToXml(xml, [{ op: 'place', ids: [id], side: 'top' }]);
      const back = await applyToXml(top.xml, [{ op: 'place', ids: [id], side: 'bottom' }]);
      expect(back.result.layout?.format?.[0]?.notes?.join(' '), name).toContain(`${id} moved to the bottom border`);
      expect((await added(xml, back.xml)).filter((k) => hard.includes(k)), name).toEqual([]);
      // and top again: the drawing of the first move
      const again = await applyToXml(back.xml, [{ op: 'place', ids: [id], side: 'top' }]);
      expect((await metricsXml(again.xml)).score, name).toBe((await metricsXml(top.xml)).score);
    }
  });

  it('place --side: the way back to a border two other boundary events take reaches over its corner, as the drawing had it', async () => {
    const xml = scenario('artifacts__10-three-boundaries');
    const top = await applyToXml(xml, [{ op: 'place', ids: ['Event_Withdrawn'], side: 'top' }]);
    const back = await applyToXml(top.xml, [{ op: 'place', ids: ['Event_Withdrawn'], side: 'bottom' }]);
    const host = boundsOf(back.xml, 'Activity_Approve');
    const ev = boundsOf(back.xml, 'Event_Withdrawn');
    expect(ev.y + ev.height / 2).toBe(host.y + host.height);
    for (const other of ['Event_SysErr', 'Event_Reminder']) {
      const o = boundsOf(back.xml, other);
      expect(ev.x + ev.width <= o.x || o.x + o.width <= ev.x, other).toBe(true);
    }
    expect((await added(xml, back.xml)).filter((k) => hard.includes(k))).toEqual([]);
  });

  it('place --side bottom in a lane with a lane underneath: the lane grows at its bottom first, the path stays in it', async () => {
    const { newXml } = await import('../src/api.js');
    const drawn = await applyToXml((await newXml({ processName: 'Orders' })).xml, [
      { op: 'add', kind: 'participant', name: 'Company', id: 'Participant_Company' },
      { op: 'add', kind: 'lane', name: 'Sales', id: 'Lane_Sales', in: 'Participant_Company' },
      { op: 'add', kind: 'lane', name: 'Billing', id: 'Lane_Billing', in: 'Participant_Company' },
      { op: 'add', kind: 'startEvent', name: 'Order received', in: 'Participant_Company', lane: 'Lane_Sales', as: '$s' },
      { op: 'add', kind: 'userTask', name: 'Check order', after: '$s', lane: 'Lane_Sales', as: '$c' },
      { op: 'add', kind: 'serviceTask', name: 'Send invoice', after: '$c', lane: 'Lane_Billing', as: '$i' },
      { op: 'add', kind: 'endEvent', name: 'Invoiced', after: '$i', lane: 'Lane_Billing' },
    ]);
    const kept = (await applyToXml(drawn.xml, [{ op: 'space', after: 'Activity_CheckOrder', by: 10 }])).xml;
    const below = await batch(
      [
        { op: 'add', kind: 'boundaryEvent:timer', name: '2 days', id: 'Event_CheckOverdue', on: 'Activity_CheckOrder', timer: 'P2D', nonInterrupting: true },
        { op: 'add', kind: 'sendTask', name: 'Remind sales', id: 'Activity_RemindSales', after: 'Event_CheckOverdue' },
        { op: 'add', kind: 'endEvent', name: 'Sales reminded', id: 'Event_SalesReminded', after: 'Activity_RemindSales' },
      ],
      kept,
    );
    // the path above the task, then the empty rows of the lane closed: no room below the task in its lane
    const top = (await applyToXml(below, [{ op: 'place', ids: ['Event_CheckOverdue'], side: 'top' }])).xml;
    const tight = (await applyToXml(top, [{ op: 'compact', ids: ['Lane_Sales'] }])).xml;
    const host = boundsOf(tight, 'Activity_CheckOrder');
    expect(bottomOf(boundsOf(tight, 'Lane_Sales')) - (host.y + host.height)).toBeLessThan(80);
    const r = await applyToXml(tight, [{ op: 'place', ids: ['Event_CheckOverdue'], side: 'bottom' }]);
    const lane = boundsOf(r.xml, 'Lane_Sales');
    expect(boundsOf(r.xml, 'Activity_RemindSales').y).toBeGreaterThanOrEqual(host.y + host.height);
    expect(bottomOf(boundsOf(r.xml, 'Activity_RemindSales'))).toBeLessThanOrEqual(bottomOf(lane));
    expect(boundsOf(r.xml, 'Lane_Billing').y).toBeGreaterThanOrEqual(bottomOf(lane));
    expect(r.result.layout?.format?.[0]?.notes?.join(' ')).toMatch(/made \d+ px of room below Activity_CheckOrder in its lane Lane_Sales/);
    expect((await added(tight, r.xml)).filter((k) => hard.includes(k))).toEqual([]);
    // a position below the lane, in no lane: the hint does not claim it lies in the shape's own lane
    const err = (await applyToXml(kept, [{ op: 'place', ids: ['Activity_CheckOrder'], below: 'Event_Invoiced' }]).catch((e: unknown) => e)) as CliError;
    expect(err.code).toBe('E_LEAVES_CONTAINER');
    expect(String(err.details.hint)).not.toContain('That position is in lane Lane_Sales');
    expect(String(err.details.hint)).toContain('below lane Lane_Sales, in no lane of its pool');
  });

  it('place --side next to an annotation on a flow the move reroutes: the association docks on the flow around the shapes', async () => {
    const xml = scenario('artifacts__16-annotations-events-loop');
    const r = await applyToXml(xml, [{ op: 'place', ids: ['Event_Overdue'], side: 'top' }]);
    expect((await added(xml, r.xml)).filter((k) => hard.includes(k))).toEqual([]);
    // the association ends on its flow's line
    const pts = (id: string, x: string): Array<{ x: number; y: number }> =>
      [...new RegExp(`bpmnElement="${id}">([\\s\\S]*?)</bpmndi:BPMNEdge>`).exec(x)![1]!.matchAll(/<di:waypoint x="([-\d.]+)" y="([-\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const end = pts('Association_3', r.xml).at(-1)!;
    const flow = pts('Flow_6', r.xml);
    const onFlow = flow.slice(1).some((q, i) => {
      const p = flow[i]!;
      return end.x >= Math.min(p.x, q.x) - 1 && end.x <= Math.max(p.x, q.x) + 1 && end.y >= Math.min(p.y, q.y) - 1 && end.y <= Math.max(p.y, q.y) + 1;
    });
    expect(onFlow).toBe(true);
  });

  it('E_NO_ROOM: of the space-tool runs that make the room, the one that leaves the fewest layout problems', async () => {
    const place = { op: 'place', ids: ['Activity_ApprovePurchase', 'Gateway_PurchaseApproved'], rowOf: 'Gateway_1hd8x2m', after: 'Gateway_1hd8x2m' };
    for (const name of ['no-room-merge.bpmn', 'no-room-no-branch.bpmn']) {
      const xml = fixture(name);
      const score = async (by: string): Promise<number> => (await metricsXml(await batch([{ op: 'space', after: 'Gateway_1hd8x2m', by }, place], xml))).score;
      const err = (await applyToXml(xml, [place]).catch((e: unknown) => e)) as CliError;
      const ops = err.details['ops'] as Array<{ by: string }>;
      expect(await score(ops[0]!.by), name).toBeLessThan(await score('1col'));
    }
  });

  it('E_NO_ROOM after other ops of a batch: the space op to put before this one, checked there, and no command for the file', async () => {
    const place = { op: 'place', ids: ['Activity_ApprovePurchase', 'Gateway_PurchaseApproved'], rowOf: 'Gateway_1hd8x2m', after: 'Activity_NewGate' };
    const addGate = { op: 'add', kind: 'userTask', id: 'Activity_NewGate', name: 'New gate', after: 'Gateway_1hd8x2m', flowName: 'maybe' };
    const xml = fixture('no-room-merge.bpmn');
    const err = (await applyToXml(xml, [addGate, place]).catch((e: unknown) => e)) as CliError;
    expect(err.code).toBe('E_NO_ROOM');
    // Activity_NewGate exists only in the refused batch: a command on the file could not run
    expect(err.details['command']).toBeUndefined();
    expect(String(err.details.hint)).not.toContain('bpmn space');
    expect(String(err.details.hint)).toContain('in this batch, put {"op":"space","after":"Activity_NewGate"');
    const ops = err.details['ops'] as object[];
    await expect(applyToXml(xml, [addGate, ...ops, place])).resolves.toBeDefined();
    // a format op after another format op does not see the file's drawing either
    const second = (await applyToXml(fixture('no-room-merge.bpmn'), [{ op: 'color', ids: ['Activity_0k3x9qa'], color: 'blue' }, { ...place, after: 'Gateway_1hd8x2m' }]).catch((e: unknown) => e)) as CliError;
    expect(second.code).toBe('E_NO_ROOM');
    expect(second.details['command']).toBeUndefined();
    expect(second.details['ops']).toBeDefined();
  });
});
