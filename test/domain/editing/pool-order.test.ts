/**
 * Pool order (`order <collaborationId> <participantId...>`,
 * src/domain/editing/elements/ElementOrder.ts and src/domain/diagram/commands/BandReordering.ts orderPoolBands): the participants
 * of a collaboration are reordered top to bottom, black-box partner pools
 * included; a kept drawing gets its pool bands restacked with their content
 * and the message flows routed again.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from "vitest";
import { parseOps } from '../../../src/index.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import type { DEdge, DShape } from '../../../src/domain/diagram/di/types.js';
import { LayoutAnalysis } from '../../../src/domain/diagram/di/LayoutAnalysis.js';
import { DiagramReader } from '../../../src/domain/diagram/di/DiagramReader.js';
import { isBpmnError } from '../../../src/domain/document/utils/errors.js';
import type { El } from '../../../src/domain/document/utils/moddle.js';
import type { EditCommand } from '../../../src/domain/commands/types.js';
import { mutateDoc } from '../../../src/index.js';
import { type MutationResult } from '../../../src/domain/batch/types.js';

const OPS: EditCommand[] = [
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
  const result = await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true });
  const doc = await Doc.fromXml(result.xml);
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      for (const bounds of [pe.get<El | undefined>('bounds'), pe.get<El | undefined>('label')?.get<El | undefined>('bounds')]) {
        if (bounds) bounds.set('x', bounds.get<number>('x') + 11);
      }
      for (const waypoint of pe.get<El[] | undefined>('waypoint') ?? []) {
        waypoint.set('x', waypoint.get<number>('x') + 11);
      }
    }
  }
  return doc.toXml();
}

async function run(xml: string, ops: EditCommand[]): Promise<{ result: MutationResult; after: Doc }> {
  const result = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  const after = await Doc.fromXml(result.xml);
  expect(after.importWarnings).toEqual([]);
  return { result, after };
}

async function failure(xml: string, ops: EditCommand[]): Promise<{ code: string; message: string; candidates?: string[] }> {
  try {
    await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  } catch (err) {
    if (isBpmnError(err)) {
      return { code: err.code, message: err.message, ...err.details } as Awaited<ReturnType<typeof failure>>;
    }
    throw err;
  }
  throw new Error('expected the mutation to fail');
}

function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const diagramPlane of new DiagramReader(doc.definitions).planes()) {
    for (const drawnShape of diagramPlane.shapes.values()) {
      out.set(drawnShape.id, drawnShape);
    }
  }
  return out;
}

function edges(doc: Doc): Map<string, DEdge> {
  const out = new Map<string, DEdge>();
  for (const diagramPlane of new DiagramReader(doc.definitions).planes()) {
    for (const drawnEdge of diagramPlane.edges.values()) {
      out.set(drawnEdge.id, drawnEdge);
    }
  }
  return out;
}

const participants = (doc: Doc): string[] => doc.collaboration()!.get<El[]>('participants').map((participant) => participant.get<string>('id'));
const collabId = (doc: Doc): string => doc.collaboration()!.get<string>('id');
const HARD = ['overlaps', 'frameIntrusion', 'frameOverlap', 'through', 'degenerateEdge', 'missing', 'outsideLane', 'outsidePool', 'outsideSub'];
const hard = (doc: Doc): string[] => LayoutAnalysis.of(doc.definitions).problems.filter((problem) => HARD.includes(problem.kind)).map((problem) => `${problem.kind} ${problem.ids.join(',')}`);
const orthogonal = (drawnEdge: DEdge): boolean => drawnEdge.points.every((point, index) => index === 0 || point.x === drawnEdge.points[index - 1]!.x || point.y === drawnEdge.points[index - 1]!.y);
const topToBottom = (doc: Doc, ids: string[]): string[] => [...ids].sort((firstId, secondId) => shapes(doc).get(firstId)!.bounds.y - shapes(doc).get(secondId)!.bounds.y);

describe('pool order', () => {
  it('restacks the pool bands with their content; message flows are routed again', async () => {
    const hand = await handXml();
    const before = await Doc.fromXml(hand);
    const s0 = shapes(before);
    const order = topToBottom(before, ['Org', 'Customer', 'Bank']);
    const wanted = [...order].reverse();
    const { result, after } = await run(hand, [{ op: 'order', id: collabId(before), pools: wanted }]);
    expect(participants(after).slice(0, 3)).toEqual(wanted);
    expect(topToBottom(after, ['Org', 'Customer', 'Bank'])).toEqual(wanted);
    const s1 = shapes(after);
    // each pool keeps its size and x; its content moves with it
    for (const id of ['Org', 'Customer', 'Bank']) {
      expect(s1.get(id)!.bounds.height, id).toBe(s0.get(id)!.bounds.height);
      expect(s1.get(id)!.bounds.x, id).toBe(s0.get(id)!.bounds.x);
    }
    const dy = s1.get('Org')!.bounds.y - s0.get('Org')!.bounds.y;
    for (const id of ['L1', 'L2', 'S', 'A', 'B', 'E']) {
      expect(s1.get(id)!.bounds.y - s0.get(id)!.bounds.y, id).toBe(dy);
    }
    // the stack starts where it started and keeps its gaps
    expect(Math.min(...['Org', 'Customer', 'Bank'].map((id) => s1.get(id)!.bounds.y))).toBe(Math.min(...['Org', 'Customer', 'Bank'].map((id) => s0.get(id)!.bounds.y)));
    for (const id of ['M1', 'M2']) {
      const drawnEdge = edges(after).get(id)!;
      expect(orthogonal(drawnEdge), id).toBe(true);
      expect(result.layout.format![0]!.rerouted, id).toContain(id);
    }
    expect(hard(after)).toEqual(hard(before));
    expect(result.changes.changed.map((change) => change.detail)).toEqual([`pool order: ${wanted.join(', ')}`]);
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
    const failed = await failure(hand, [{ op: 'order', id: collabId(doc), pools: ['Bank', 'L1'] }]);
    expect(failed.code).toBe('E_WRONG_KIND');
    // the declared order (Org first) differs from the drawn one (the engine put the pools in message-flow order): the drawing follows it
    const declared = participants(doc);
    const first = await run(hand, [{ op: 'order', id: collabId(doc), pools: declared }]);
    expect(first.result.unchanged).toBe(false);
    expect(topToBottom(first.after, ['Org', 'Customer', 'Bank'])).toEqual(declared);
    const same = declared;
    const { result } = await run(first.result.xml, [{ op: 'order', id: collabId(doc), pools: same }]);
    expect(result.unchanged).toBe(true);
    expect(result.changes.notes.join(' ')).toMatch(/pools already declared in this order/);
    expect(() => parseOps([{ op: 'order', id: 'C', pools: ['A'], lanes: ['B'] }])).toThrow(/give exactly one of "flows" .*, "lanes" .* or "pools"/);
  });

  it('works from the command line, also for a pool the place command cannot move', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bpmn-pool-order-'));
    try {
      const file = join(dir, 'o.bpmn');
      writeFileSync(file, await handXml());
      const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
      const last = topToBottom(doc, ['Org', 'Customer', 'Bank'])[2]!;
      const bin = join(import.meta.dirname, '..', '..', '..', 'src', 'cli.ts');
      const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', bin, ...args], { encoding: 'utf8', cwd: join(import.meta.dirname, '..', '..', '..'), input: '' });
      const placed = cli('place', file, last, '--above', 'Org');
      expect(placed.status).toBe(2);
      expect(placed.stderr).toMatch(/hint: Pools and lanes are bands: `bpmn order <file> <collaborationId> <participantIds...>` reorders pools/);
      const result = cli('order', file, collabId(doc), last);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(new RegExp(`^changed collaboration ${collabId(doc)} - pool order: ${last}, `, 'm'));
      expect(topToBottom(await Doc.fromXml(readFileSync(file, 'utf8')), ['Org', 'Customer', 'Bank'])[0]).toBe(last);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

