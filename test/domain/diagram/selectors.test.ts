/**
 * Selectors of the format ops (src/domain/diagram/format/ElementSelector.ts): `path`
 * (with `via`), `kind` and `branch` name the elements of place / align /
 * color / tidy, so a happy path is coloured, every end event aligned or a
 * branch moved in one call. Elements are addressed by id only.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOps, layoutView } from '../../../src/index.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import type { DShape } from '../../../src/domain/diagram/di/types.js';
import { isCliError } from '../../../src/domain/document/utils/errors.js';
import type { El } from '../../../src/domain/document/utils/moddle.js';
import type { EditCommand } from '../../../src/domain/commands/types.js';
import { mutateDoc } from '../../../src/index.js';
import { type MutationResult } from '../../../src/domain/batch/types.js';
import { shapes } from '../../helpers/drawing.js';

const BASE: EditCommand[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes', flowId: 'F_yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no', flowId: 'F_no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
];

const SPLIT: EditCommand[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  {
    op: 'split',
    after: 'S',
    id: 'G',
    name: 'Which?',
    joinId: 'J',
    branches: [
      { flowId: 'F_a', flowName: 'a', nodes: [{ kind: 'task', id: 'A1', name: 'A one' }, { kind: 'task', id: 'A2', name: 'A two' }] },
      { flowId: 'F_b', flowName: 'b', nodes: [{ kind: 'task', id: 'B1', name: 'B one' }, { kind: 'task', id: 'B2', name: 'B two' }] },
      { flowId: 'F_c', flowName: 'c', nodes: [] },
    ],
  },
  { op: 'add', kind: 'endEvent', id: 'End', name: 'End', after: 'J' },
];

async function handXml(ops: EditCommand[]): Promise<string> {
  const mutation = await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true });
  const doc = await Doc.fromXml(mutation.xml);
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      for (const bounds of [pe.get<El | undefined>('bounds'), pe.get<El | undefined>('label')?.get<El | undefined>('bounds')]) if (bounds) bounds.set('y', bounds.get<number>('y') + 9);
      for (const waypoint of pe.get<El[] | undefined>('waypoint') ?? []) waypoint.set('y', waypoint.get<number>('y') + 9);
    }
  }
  return doc.toXml();
}

async function run(xml: string, ops: EditCommand[]): Promise<{ result: MutationResult; after: Doc }> {
  const mutation = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  return { result: mutation, after: await Doc.fromXml(mutation.xml) };
}

async function failure(xml: string, ops: EditCommand[]): Promise<{ code: string; message: string; hint?: string }> {
  try {
    await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  } catch (err) {
    if (isCliError(err)) return { code: err.code, message: err.message, ...err.details } as Awaited<ReturnType<typeof failure>>;
    throw err;
  }
  throw new Error('expected the mutation to fail');
}

const colored = (doc: Doc): string[] => layoutView(doc.definitions).colors.map((color) => color.id).sort();
const cx = (shape: DShape): number => shape.bounds.x + shape.bounds.width / 2;
const cy = (shape: DShape): number => shape.bounds.y + shape.bounds.height / 2;

describe('--path', () => {
  it('colours every node and flow on the shortest path, the first outgoing flow on ties', async () => {
    const hand = await handXml(BASE);
    const doc = await Doc.fromXml(hand);
    const flowInto = (id: string): string => doc.incoming(doc.get(id)!)[0]!.get<string>('id');
    const { result: mutation, after } = await run(hand, [{ op: 'color', path: ['S', 'E'], color: 'green' }]);
    expect(colored(after)).toEqual(['A', 'B', 'E', 'G', 'S', 'F_yes', flowInto('A'), flowInto('G'), flowInto('E')].sort());
    expect(mutation.layout.format![0]!.colored![0]).toBe('S');
  });

  it('follows --via flows in order and fails clearly when there is no path', async () => {
    const hand = await handXml(BASE);
    const { after } = await run(hand, [{ op: 'color', path: ['S', 'E2'], color: 'red' }]);
    expect(colored(after)).toContain('F_no');
    const via = await run(hand, [{ op: 'color', path: ['A', 'C'], via: ['F_no'], color: 'red' }]);
    expect(colored(via.after)).toEqual(expect.arrayContaining(['A', 'G', 'F_no', 'C']));
    const error = await failure(hand, [{ op: 'color', path: ['E', 'S'], color: 'red' }]);
    expect(error.code).toBe('E_NO_MATCH');
    expect(error.message).toBe('No sequence-flow path leads from E to S');
    const viaError = await failure(hand, [{ op: 'color', path: ['S', 'E'], via: ['F_no'], color: 'red' }]);
    expect(viaError.message).toBe('No sequence-flow path leads from C to E');
  });

  it('aligns the nodes of a path on the row of its first node (flows are left out for shape ops)', async () => {
    const hand = await handXml(BASE);
    const { after } = await run(hand, [{ op: 'align', path: ['G', 'E2'], axis: 'row' }]);
    const laidShapes = shapes(after);
    expect(cy(laidShapes.get('C')!)).toBe(cy(laidShapes.get('G')!));
    expect(cy(laidShapes.get('E2')!)).toBe(cy(laidShapes.get('G')!));
  });
});

describe('--kind', () => {
  it('aligns every end event on the column of the rightmost one', async () => {
    const hand = await handXml(BASE);
    const before = shapes(await Doc.fromXml(hand));
    const rightmost = cx(before.get('E')!) > cx(before.get('E2')!) ? 'E' : 'E2';
    const { result: mutation, after } = await run(hand, [{ op: 'align', kind: 'endEvent', axis: 'column' }]);
    const laidShapes = shapes(after);
    expect(cx(laidShapes.get('E')!)).toBe(cx(laidShapes.get('E2')!));
    expect(cx(laidShapes.get(rightmost)!)).toBe(cx(before.get(rightmost)!));
    expect(mutation.layout.metrics!.added.filter((problem) => problem.kind === 'backwardFlow')).toEqual([]);
  });

  it('colours every sequence flow; a kind without elements is E_NO_MATCH, an unknown kind E_USAGE', async () => {
    const hand = await handXml(BASE);
    const { after } = await run(hand, [{ op: 'color', kind: 'sequenceFlow', color: 'blue' }]);
    expect(colored(after)).toHaveLength(6);
    expect((await failure(hand, [{ op: 'color', kind: 'parallelGateway', color: 'blue' }])).code).toBe('E_NO_MATCH');
    expect((await failure(hand, [{ op: 'color', kind: 'endEvnt', color: 'blue' }])).code).toBe('E_USAGE');
  });
});

describe('--branch', () => {
  it('place --branch moves what only that branch reaches, up to the join, as one group', async () => {
    const hand = await handXml(SPLIT);
    const before = shapes(await Doc.fromXml(hand));
    // the branches as the engine drew them: a on the main row, b below it
    expect(cy(before.get('B1')!)).toBeGreaterThan(cy(before.get('A1')!));
    const { result: mutation, after } = await run(hand, [{ op: 'place', branch: 'F_b', above: 'A1' }]);
    const laidShapes = shapes(after);
    expect(cy(laidShapes.get('B1')!)).toBeLessThan(cy(laidShapes.get('A1')!));
    const dy = laidShapes.get('B1')!.bounds.y - before.get('B1')!.bounds.y;
    expect(laidShapes.get('B2')!.bounds.y - before.get('B2')!.bounds.y).toBe(dy);
    expect(laidShapes.get('B2')!.bounds.x - laidShapes.get('B1')!.bounds.x).toBe(before.get('B2')!.bounds.x - before.get('B1')!.bounds.x);
    for (const id of ['G', 'J', 'End']) expect(laidShapes.get(id)!.bounds.y, id).toBe(before.get(id)!.bounds.y);
    expect(mutation.layout.format![0]!.moved).toEqual(expect.arrayContaining(['B1', 'B2']));
  });

  it('a branch with a boundary event moves with it (the event follows its host, its path goes along)', async () => {
    const hand = await handXml([
      ...SPLIT,
      { op: 'add', kind: 'boundaryEvent:timer', id: 'TB', on: 'B1', timer: 'PT1H' },
      { op: 'add', kind: 'endEvent', id: 'TE', name: 'Late', after: 'TB' },
    ]);
    const before = shapes(await Doc.fromXml(hand));
    const { result: mutation, after } = await run(hand, [{ op: 'place', branch: 'F_b', above: 'A1' }]);
    const laidShapes = shapes(after);
    const dy = laidShapes.get('B1')!.bounds.y - before.get('B1')!.bounds.y;
    expect(dy).toBeLessThan(0);
    for (const id of ['B2', 'TB', 'TE']) expect(laidShapes.get(id)!.bounds.y - before.get(id)!.bounds.y, id).toBe(dy);
    expect(mutation.layout.metrics!.added.filter((problem) => ['overlaps', 'through', 'outsidePool'].includes(problem.kind))).toEqual([]);
  });

  it('colours a branch with its flows; a branch straight to the join has nothing on it', async () => {
    const hand = await handXml(SPLIT);
    const { after } = await run(hand, [{ op: 'color', branch: 'F_a', color: 'orange' }]);
    const doc = await Doc.fromXml(hand);
    const out = (id: string): string => doc.outgoing(doc.get(id)!)[0]!.get<string>('id');
    expect(colored(after)).toEqual(['A1', 'A2', 'F_a', out('A1'), out('A2')].sort());
    const error = await failure(hand, [{ op: 'color', branch: 'F_c', color: 'orange' }]);
    expect(error.code).toBe('E_NO_MATCH');
    expect(error.message).toMatch(/^Nothing lies on the branch of F_c: it leads to J/);
  });
});

describe('selectors in the ops JSON and on the command line', () => {
  it('validates path, via and that something is named', () => {
    const message = (input: unknown): string => {
      try {
        parseOps(input);
      } catch (err) {
        if (isCliError(err)) return err.message;
        throw err;
      }
      return 'ok';
    };
    expect(message([{ op: 'color', path: ['A', 'B', 'C'], color: 'red' }])).toMatch(/"path" takes exactly two ids \(from and to\), got 3/);
    expect(message([{ op: 'color', ids: ['A'], via: ['F'], color: 'red' }])).toMatch(/"via" needs "path"/);
    expect(message([{ op: 'color', color: 'red' }])).toMatch(/give "ids" and \/ or a selector \("path", "kind", "branch"\)/);
    expect(message([{ op: 'place', branch: 'F', below: 'X' }])).toBe('ok');
    expect(message([{ op: 'align', kind: 'endEvent', axis: 'column' }])).toBe('ok');
    expect(message([{ op: 'tidy', kind: 'task' }])).toBe('ok');
  });

  it('`bpmn color <file> --path <from> <to> --color green` colours the happy path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bpmn-select-'));
    try {
      const file = join(dir, 's.bpmn');
      writeFileSync(file, await handXml(BASE));
      const root = join(import.meta.dirname, '..', '..', '..');
      const child = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src', 'cli.ts'), 'color', file, '--path', 'S', 'E', '--color', 'green'], { encoding: 'utf8', cwd: root, input: '' });
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toMatch(/format color #0: colored S, /);
      expect(colored(await Doc.fromXml(readFileSync(file, 'utf8')))).toContain('B');
      const bad = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src', 'cli.ts'), 'color', file, '--path', 'S', '--color', 'green'], { encoding: 'utf8', cwd: root, input: '' });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/--path takes exactly two ids \(from and to\), got 1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
