/**
 * Step 3 follow-ups, ops and usage (the verifier's split finding and what
 * agents ran into in the Claude Code plugin evals):
 *
 *  - split creates a join only where two branches reach it: a branch that
 *    ends in an end event terminates, a single continuing branch runs on to
 *    the old successor without a pass-through gateway.
 *  - `space --by` takes `<n>col` / `<n>row` (steps of the drawing's grid)
 *    and `<n>px`; the result notes the distance moved, and a few pixels say
 *    how to ask for columns.
 *  - E_NOT_FOUND ranks ids with the query's prefix first (a mistyped flow id
 *    suggests the flow, not the gateway its words contain).
 *  - Wrong shapes get a hint with the right one (never accepted): `add
 *    --kind userTask --name X` (positional arguments), `set <id> --name X`
 *    (a key=value pair), a route op with "flowId", a set op with its
 *    properties at the top level.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { parseOps } from '../src/batch.js';
import { CliError } from '../src/errors.js';
import { Doc } from '../src/document.js';
import { parseSpaceAmount } from '../src/ops/types.js';

const ROOT = join(import.meta.dirname, '..');
const BIN = join(ROOT, 'dist', 'cli.js');
const CLAIM = readFileSync(join(ROOT, 'tools', 'scenarios', 'agent__claim.bpmn'), 'utf8');

async function rejected(p: Promise<unknown>): Promise<CliError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof CliError) return err;
    throw err;
  }
  throw new Error('expected an error');
}

/* ------------------------------------------------------------------ */
/* split                                                                */
/* ------------------------------------------------------------------ */

describe('split: a join only where two branches reach it', () => {
  const start = [
    { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Sj', as: '$s' },
    { op: 'add', kind: 'task', name: 'Check', after: '$s', as: '$c' },
    { op: 'add', kind: 'endEvent', name: 'Done', after: '$c' },
  ];
  const rejectBranch = { flowName: 'no', default: true, nodes: [{ kind: 'endEvent', name: 'Rejected' }] };

  it('the other branch ends in an end event: no pass-through join, the branch runs on to the successor', async () => {
    const r = await applyToXml((await newXml({ processName: 'Sj' })).xml, [...start, { op: 'split', after: '$c', kind: 'exclusiveGateway', name: 'Ok?', branches: [{ flowName: 'yes', condition: '${ok}', nodes: [{ kind: 'task', name: 'Book' }] }, rejectBranch] }], { layout: false });
    expect(r.xml).not.toContain('Gateway_Ok_join');
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_BookToDone" sourceRef="Activity_Book" targetRef="Event_Done" />');
    expect(r.result.notes).toContain('only the branch ending at Activity_Book continues; no join gateway created (it runs on to Event_Done)');
    expect(r.result.notes).toContain('split Gateway_Ok: 2 branch(es) ending at Activity_Book, Event_Rejected (end event), continues to Event_Done');
    expect(r.result.validation.errors).toEqual([]);
  });

  it('a direct branch next to a terminating one: the gateway runs on to the successor', async () => {
    const r = await applyToXml((await newXml({ processName: 'Sj' })).xml, [...start, { op: 'split', after: '$c', kind: 'exclusiveGateway', name: 'Ok?', branches: [{ flowName: 'yes', condition: '${ok}', nodes: [] }, rejectBranch] }], { layout: false });
    expect(r.xml).not.toMatch(/_join/);
    expect(r.xml).toMatch(/<bpmn:sequenceFlow id="Flow_OkToDone" name="yes" sourceRef="Gateway_Ok" targetRef="Event_Done">/);
  });

  it('two continuing branches and a terminating one keep their join; joinAs with one continuing branch is refused', async () => {
    const r = await applyToXml((await newXml({ processName: 'Sj' })).xml, [...start, { op: 'split', after: '$c', kind: 'exclusiveGateway', name: 'Ok?', branches: [{ flowName: 'a', condition: '${a}', nodes: [{ kind: 'task', name: 'A' }] }, { flowName: 'b', condition: '${b}', nodes: [{ kind: 'task', name: 'B' }] }, rejectBranch] }], { layout: false });
    expect(r.xml).toContain('id="Gateway_Ok_join"');
    expect([...r.xml.matchAll(/targetRef="Gateway_Ok_join"/g)].length).toBe(2);
    const e = await rejected(applyToXml((await newXml({ processName: 'Sj' })).xml, [...start, { op: 'split', after: '$c', joinAs: '$j', branches: [{ condition: '${ok}', nodes: [{ kind: 'task', name: 'Book' }] }, rejectBranch] }], { layout: false }));
    expect(e.code).toBe('E_USAGE');
    expect(e.message).toContain('only one branch continues');
  });
});

/* ------------------------------------------------------------------ */
/* space --by                                                           */
/* ------------------------------------------------------------------ */

describe('space --by: columns, rows and pixels, the distance noted', () => {
  it('parseSpaceAmount', () => {
    expect(parseSpaceAmount('2col')).toEqual({ count: 2, unit: 'column' });
    expect(parseSpaceAmount('2 columns')).toEqual({ count: 2, unit: 'column' });
    expect(parseSpaceAmount('column')).toEqual({ count: 1, unit: 'column' });
    expect(parseSpaceAmount('-2col')).toEqual({ count: -2, unit: 'column' });
    expect(parseSpaceAmount('3rows')).toEqual({ count: 3, unit: 'row' });
    expect(parseSpaceAmount('-row')).toEqual({ count: -1, unit: 'row' });
    expect(parseSpaceAmount('80px')).toEqual({ count: 80, unit: 'px' });
    expect(parseSpaceAmount(80)).toEqual({ count: 80, unit: 'px' });
    for (const bad of ['0', 0, '2x', 'px', '', 'lots', 1.5]) expect(parseSpaceAmount(bad), String(bad)).toBeUndefined();
  });

  const spaceNote = async (by: string | number): Promise<string> => {
    const r = await applyToXml(CLAIM, [{ op: 'space', after: 'Activity_RegisterClaim', by }]);
    return r.result.layout.format![0]!.notes!.join(' | ');
  };

  it('2col moves by two columns, 2 by two pixels and says how to ask for columns', async () => {
    expect(await spaceNote('2col')).toMatch(/^inserted (\d+) px \(2 columns of (\d+) px\) right of Activity_RegisterClaim$/);
    const [, total, one] = /^inserted (\d+) px \(2 columns of (\d+) px\)/.exec(await spaceNote('2columns'))!;
    expect(Number(total)).toBe(2 * Number(one));
    expect(await spaceNote(2)).toMatch(/^inserted 2 px right of Activity_RegisterClaim; one column is \d+ px: --by 2col moves by 2 columns$/);
    expect(await spaceNote('80px')).toBe('inserted 80 px right of Activity_RegisterClaim');
  });

  it('the batch refuses an amount it cannot read', () => {
    expect(() => parseOps([{ op: 'space', after: 'T', by: '2x' }])).toThrow(/"by" must be "column", "row", a number of them \("2col", "3rows"\)/);
    expect(parseOps([{ op: 'space', after: 'T', by: '2col' }])[0]).toEqual({ op: 'space', after: 'T', by: '2col' });
    expect(parseOps([{ op: 'space', after: 'T', by: '-40' }])[0]).toEqual({ op: 'space', after: 'T', by: -40 });
  });
});

/* ------------------------------------------------------------------ */
/* E_NOT_FOUND                                                          */
/* ------------------------------------------------------------------ */

describe('E_NOT_FOUND: ids with the query prefix first', () => {
  it('a mistyped flow id suggests the flow, not the gateway its words contain', async () => {
    const r = await applyToXml((await newXml({ processName: 'Purchase' })).xml, [
      { op: 'add', kind: 'startEvent', name: 'Start', in: 'Process_Purchase', as: '$s' },
      { op: 'add', kind: 'userTask', name: 'Approve purchase', after: '$s', as: '$a' },
      { op: 'split', after: '$a', name: 'Purchase approved?', branches: [{ flowName: 'yes', condition: '${ok}', nodes: [{ kind: 'task', name: 'Order goods' }] }, { flowName: 'no', default: true, nodes: [{ kind: 'endEvent', name: 'Rejected' }] }] },
    ]);
    const doc = await Doc.fromXml(r.xml);
    expect(doc.has('Flow_PurchaseApprovedToOrderGoods')).toBe(true);
    expect(doc.suggest('Flow_GatewayPurchaseApprovedToOrderGoods')[0]).toBe('Flow_PurchaseApprovedToOrderGoods');
    // a query with another prefix still finds the element
    expect(doc.suggest('Task_ApprovePurchase')[0]).toBe('Activity_ApprovePurchase');
    expect(doc.suggest('Flow_ApprovePurchaseToPurchaseAproved')[0]).toBe('Flow_ApprovePurchaseToPurchaseApproved');
  });
});

/* ------------------------------------------------------------------ */
/* usage hints                                                          */
/* ------------------------------------------------------------------ */

describe('wrong op shapes: a hint with the right one', () => {
  const hintOf = (ops: unknown): { message: string; hint?: string } => {
    try {
      parseOps(ops);
    } catch (err) {
      const e = err as CliError;
      return { message: e.message, hint: e.details.hint as string | undefined };
    }
    throw new Error('expected E_USAGE');
  };

  it('route with "flowId"', () => {
    const e = hintOf([{ op: 'route', flowId: 'Flow_2', exit: 'bottom' }]);
    expect(e.message).toContain('unknown key "flowId" (did you mean "id"?)');
    expect(e.hint).toBe('route names its flow with "id": {"op":"route","id":"Flow_2","exit":"bottom"}.');
  });

  it('set with the properties at the top level', () => {
    const e = hintOf([{ op: 'set', id: 'Activity_RegisterClaim', name: 'Register', documentation: 'x' }]);
    expect(e.message).toContain('unknown key "name" (did you mean "values"?)');
    expect(e.hint).toBe('set takes the properties to set in "values" (an object): {"op":"set","id":"Activity_RegisterClaim","values":{"name":"Register","documentation":"x"}}.');
  });
});

describe('CLI: options that are positional arguments', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpmn-followups-'));
    writeFileSync(join(dir, 'claim.bpmn'), CLAIM);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const bpmn = (...args: string[]): { code: number; err: string } => {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: dir, input: '' });
    return { code: r.status ?? -1, err: r.stderr };
  };

  it('add --kind userTask --name X', () => {
    const r = bpmn('add', 'claim.bpmn', '--kind', 'userTask', '--name', 'Check it', '--after', 'Activity_RegisterClaim');
    expect(r.code).toBe(1);
    expect(r.err).toContain("unknown option '--kind'");
    expect(r.err).toContain('hint: --kind and --name are not options of `bpmn add` (<file> <kind> [name] [keyValues...]): write them as arguments: `bpmn add claim.bpmn userTask "Check it" --after Activity_RegisterClaim`.');
  });

  it('set <id> --name X', () => {
    const r = bpmn('set', 'claim.bpmn', 'Activity_RegisterClaim', '--name', 'Register it');
    expect(r.err).toContain('hint: --name is not an option of `bpmn set` (<file> <id> [keyValues...]): write it as a key=value pair: `bpmn set claim.bpmn Activity_RegisterClaim name="Register it"`.');
  });

  it('a misspelt option keeps the generic hint', () => {
    expect(bpmn('add', 'claim.bpmn', 'userTask', '--aftr').err).toContain('hint: Run `bpmn <command> --help` for the options');
  });
});
