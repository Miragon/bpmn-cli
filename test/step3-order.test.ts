/**
 * Step 3: pool order (`order <collaborationId> <participantId...>`,
 * src/ops/order.ts and src/diagram/ops.ts orderPoolBands): the participants
 * of a collaboration are reordered top to bottom, black-box partner pools
 * included; a kept drawing gets its pool bands restacked with their content
 * and the message flows routed again.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from "vitest";
import { parseOps } from '../src/batch.js';
import { Doc } from '../src/document.js';
import { layoutProblems } from '../src/diagram/metrics.js';
import { readPlanes, type DEdge, type DShape } from '../src/diagram/plane.js';
import { isCliError } from '../src/errors.js';
import type { El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, type MutationResult } from '../src/pipeline.js';

const OPS: Op[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'A' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'participant', id: 'Org', name: 'Org' },
  { op: 'add', kind: 'lane', id: 'L1', name: 'Clerk', in: 'Org', members: ['S', 'A', 'B', 'E'] },
  { op: 'add', kind: 'lane', id: 'L2', name: 'Boss', in: 'Org' },
  { op: 'add', kind: 'participant', id: 'Customer', name: 'Customer', blackBox: true },
  { op: 'add', kind: 'participant', id: 'Bank', name: 'Bank', blackBox: true },
  { op: 'connect', source: 'Customer', target: 'S', id: 'M1', name: 'Order' },
  { op: 'connect', source: 'B', target: 'Bank', id: 'M2', name: 'Payment' },
];

/** The engine drawing moved by a few px: `auto` keeps it. */
async function handXml(): Promise<string> {
  const r = await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true });
  const doc = await Doc.fromXml(r.xml);
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      for (const b of [pe.get<El | undefined>('bounds'), pe.get<El | undefined>('label')?.get<El | undefined>('bounds')]) if (b) b.set('x', b.get<number>('x') + 11);
      for (const w of pe.get<El[] | undefined>('waypoint') ?? []) w.set('x', w.get<number>('x') + 11);
    }
  }
  return doc.toXml();
}

async function run(xml: string, ops: Op[]): Promise<{ r: MutationResult; after: Doc }> {
  const r = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  const after = await Doc.fromXml(r.xml);
  expect(after.importWarnings).toEqual([]);
  return { r, after };
}

async function failure(xml: string, ops: Op[]): Promise<{ code: string; message: string; candidates?: string[] }> {
  try {
    await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  } catch (err) {
    if (isCliError(err)) return { code: err.code, message: err.message, ...err.details } as Awaited<ReturnType<typeof failure>>;
    throw err;
  }
  throw new Error('expected the mutation to fail');
}

function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const p of readPlanes(doc.definitions)) for (const s of p.shapes.values()) out.set(s.id, s);
  return out;
}

function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const p of readPlanes(doc.definitions)) for (const e of p.edges.values()) out.set(e.id, e);
  return out;
}

const participants = (doc: Doc): string[] => doc.collaboration()!.get<El[]>('participants').map((p) => p.get<string>('id'));
const collabId = (doc: Doc): string => doc.collaboration()!.get<string>('id');
const HARD = ['overlaps', 'frameIntrusion', 'frameOverlap', 'through', 'degenerateEdge', 'missing', 'outsideLane', 'outsidePool', 'outsideSub'];
const hard = (doc: Doc): string[] => layoutProblems(doc.definitions).problems.filter((p) => HARD.includes(p.kind)).map((p) => `${p.kind} ${p.ids.join(',')}`);
const orthogonal = (e: DEdge): boolean => e.points.every((p, i) => i === 0 || p.x === e.points[i - 1]!.x || p.y === e.points[i - 1]!.y);
const topToBottom = (doc: Doc, ids: string[]): string[] => [...ids].sort((a, b) => shapes(doc).get(a)!.bounds.y - shapes(doc).get(b)!.bounds.y);

describe('pool order', () => {
  it('restacks the pool bands with their content; message flows are routed again', async () => {
    const hand = await handXml();
    const before = await Doc.fromXml(hand);
    const s0 = shapes(before);
    const order = topToBottom(before, ['Org', 'Customer', 'Bank']);
    const wanted = [...order].reverse();
    const { r, after } = await run(hand, [{ op: 'order', id: collabId(before), pools: wanted }]);
    expect(participants(after).slice(0, 3)).toEqual(wanted);
    expect(topToBottom(after, ['Org', 'Customer', 'Bank'])).toEqual(wanted);
    const s1 = shapes(after);
    // each pool keeps its size and x; its content moves with it
    for (const id of ['Org', 'Customer', 'Bank']) {
      expect(s1.get(id)!.bounds.height, id).toBe(s0.get(id)!.bounds.height);
      expect(s1.get(id)!.bounds.x, id).toBe(s0.get(id)!.bounds.x);
    }
    const dy = s1.get('Org')!.bounds.y - s0.get('Org')!.bounds.y;
    for (const id of ['L1', 'L2', 'S', 'A', 'B', 'E']) expect(s1.get(id)!.bounds.y - s0.get(id)!.bounds.y, id).toBe(dy);
    // the stack starts where it started and keeps its gaps
    expect(Math.min(...['Org', 'Customer', 'Bank'].map((id) => s1.get(id)!.bounds.y))).toBe(Math.min(...['Org', 'Customer', 'Bank'].map((id) => s0.get(id)!.bounds.y)));
    for (const id of ['M1', 'M2']) {
      const e = edges(after).get(id)!;
      expect(orthogonal(e), id).toBe(true);
      expect(r.layout.format![0]!.rerouted, id).toContain(id);
    }
    expect(hard(after)).toEqual(hard(before));
    expect(r.changes.changed.map((c) => c.detail)).toEqual([`pool order: ${wanted.join(', ')}`]);
  });

  it('takes the participant ids as `flows` too (the CLI form), unlisted pools follow in their old order', async () => {
    const hand = await handXml();
    const doc = await Doc.fromXml(hand);
    const last = topToBottom(doc, ['Org', 'Customer', 'Bank'])[2]!;
    const { after } = await run(hand, [{ op: 'order', id: collabId(doc), flows: [last] }]);
    expect(topToBottom(after, ['Org', 'Customer', 'Bank'])[0]).toBe(last);
    expect(participants(after)[0]).toBe(last);
  });

  it('refuses ids that are no participants of the collaboration, and notes an order that is already there', async () => {
    const hand = await handXml();
    const doc = await Doc.fromXml(hand);
    const e = await failure(hand, [{ op: 'order', id: collabId(doc), pools: ['Bank', 'L1'] }]);
    expect(e.code).toBe('E_WRONG_KIND');
    // the declared order (Org first) differs from the drawn one (the engine put the pools in message-flow order): the drawing follows it
    const declared = participants(doc);
    const first = await run(hand, [{ op: 'order', id: collabId(doc), pools: declared }]);
    expect(first.r.unchanged).toBe(false);
    expect(topToBottom(first.after, ['Org', 'Customer', 'Bank'])).toEqual(declared);
    const same = declared;
    const { r } = await run(first.r.xml, [{ op: 'order', id: collabId(doc), pools: same }]);
    expect(r.unchanged).toBe(true);
    expect(r.changes.notes.join(' ')).toMatch(/pools already declared in this order/);
    expect(() => parseOps([{ op: 'order', id: 'C', pools: ['A'], lanes: ['B'] }])).toThrow(/give exactly one of "flows" .*, "lanes" .* or "pools"/);
  });

  it('works from the command line, also for a pool the place command cannot move', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bpmn-pool-order-'));
    try {
      const file = join(dir, 'o.bpmn');
      writeFileSync(file, await handXml());
      const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
      const last = topToBottom(doc, ['Org', 'Customer', 'Bank'])[2]!;
      const bin = join(import.meta.dirname, '..', 'src', 'cli.ts');
      const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', bin, ...args], { encoding: 'utf8', cwd: join(import.meta.dirname, '..'), input: '' });
      const placed = cli('place', file, last, '--above', 'Org');
      expect(placed.status).toBe(2);
      expect(placed.stderr).toMatch(/hint: Pools and lanes are bands: `bpmn order <file> <collaborationId> <participantIds...>` reorders pools/);
      const r = cli('order', file, collabId(doc), last);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(new RegExp(`^changed collaboration ${collabId(doc)} - pool order: ${last}, `, 'm'));
      expect(topToBottom(await Doc.fromXml(readFileSync(file, 'utf8')), ['Org', 'Customer', 'Bank'])[0]).toBe(last);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

