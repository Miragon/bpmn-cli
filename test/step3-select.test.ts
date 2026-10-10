/**
 * Step 3: selectors of the format ops (src/diagram/select.ts): `path`
 * (with `via`), `kind` and `branch` name the elements of place / align /
 * color / tidy, so a happy path is coloured, every end event aligned or a
 * branch moved in one call. Elements are addressed by id only.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOps } from '../src/batch.js';
import { Doc } from '../src/document.js';
import { layoutView } from '../src/diagram/view.js';
import { readPlanes, type DShape } from '../src/diagram/plane.js';
import { isCliError } from '../src/errors.js';
import type { El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, type MutationResult } from '../src/pipeline.js';

const BASE: Op[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes', flowId: 'F_yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no', flowId: 'F_no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
];

const SPLIT: Op[] = [
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

async function handXml(ops: Op[]): Promise<string> {
  const r = await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true });
  const doc = await Doc.fromXml(r.xml);
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      for (const b of [pe.get<El | undefined>('bounds'), pe.get<El | undefined>('label')?.get<El | undefined>('bounds')]) if (b) b.set('y', b.get<number>('y') + 9);
      for (const w of pe.get<El[] | undefined>('waypoint') ?? []) w.set('y', w.get<number>('y') + 9);
    }
  }
  return doc.toXml();
}

async function run(xml: string, ops: Op[]): Promise<{ r: MutationResult; after: Doc }> {
  const r = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true });
  return { r, after: await Doc.fromXml(r.xml) };
}

async function failure(xml: string, ops: Op[]): Promise<{ code: string; message: string; hint?: string }> {
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

const colored = (doc: Doc): string[] => layoutView(doc.definitions).colors.map((c) => c.id).sort();
const cx = (s: DShape): number => s.bounds.x + s.bounds.width / 2;
const cy = (s: DShape): number => s.bounds.y + s.bounds.height / 2;

describe('--path', () => {
  it('colours every node and flow on the shortest path, the first outgoing flow on ties', async () => {
    const hand = await handXml(BASE);
    const doc = await Doc.fromXml(hand);
    const flowInto = (id: string): string => doc.incoming(doc.get(id)!)[0]!.get<string>('id');
    const { r, after } = await run(hand, [{ op: 'color', path: ['S', 'E'], color: 'green' }]);
    expect(colored(after)).toEqual(['A', 'B', 'E', 'G', 'S', 'F_yes', flowInto('A'), flowInto('G'), flowInto('E')].sort());
    expect(r.layout.format![0]!.colored![0]).toBe('S');
  });

  it('follows --via flows in order and fails clearly when there is no path', async () => {
    const hand = await handXml(BASE);
    const { after } = await run(hand, [{ op: 'color', path: ['S', 'E2'], color: 'red' }]);
    expect(colored(after)).toContain('F_no');
    const via = await run(hand, [{ op: 'color', path: ['A', 'C'], via: ['F_no'], color: 'red' }]);
    expect(colored(via.after)).toEqual(expect.arrayContaining(['A', 'G', 'F_no', 'C']));
    const e = await failure(hand, [{ op: 'color', path: ['E', 'S'], color: 'red' }]);
    expect(e.code).toBe('E_NO_MATCH');
    expect(e.message).toBe('No sequence-flow path leads from E to S');
    const v = await failure(hand, [{ op: 'color', path: ['S', 'E'], via: ['F_no'], color: 'red' }]);
    expect(v.message).toBe('No sequence-flow path leads from C to E');
  });

  it('aligns the nodes of a path on the row of its first node (flows are left out for shape ops)', async () => {
    const hand = await handXml(BASE);
    const { after } = await run(hand, [{ op: 'align', path: ['G', 'E2'], axis: 'row' }]);
    const s = shapes(after);
    expect(cy(s.get('C')!)).toBe(cy(s.get('G')!));
    expect(cy(s.get('E2')!)).toBe(cy(s.get('G')!));
  });
});

describe('--kind', () => {
  it('aligns every end event on the column of the rightmost one', async () => {
    const hand = await handXml(BASE);
    const before = shapes(await Doc.fromXml(hand));
    const rightmost = cx(before.get('E')!) > cx(before.get('E2')!) ? 'E' : 'E2';
    const { r, after } = await run(hand, [{ op: 'align', kind: 'endEvent', axis: 'column' }]);
    const s = shapes(after);
    expect(cx(s.get('E')!)).toBe(cx(s.get('E2')!));
    expect(cx(s.get(rightmost)!)).toBe(cx(before.get(rightmost)!));
    expect(r.layout.metrics!.added.filter((p) => p.kind === 'backwardFlow')).toEqual([]);
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
    const { r, after } = await run(hand, [{ op: 'place', branch: 'F_b', above: 'A1' }]);
    const s = shapes(after);
    expect(cy(s.get('B1')!)).toBeLessThan(cy(s.get('A1')!));
    const dy = s.get('B1')!.bounds.y - before.get('B1')!.bounds.y;
    expect(s.get('B2')!.bounds.y - before.get('B2')!.bounds.y).toBe(dy);
    expect(s.get('B2')!.bounds.x - s.get('B1')!.bounds.x).toBe(before.get('B2')!.bounds.x - before.get('B1')!.bounds.x);
    for (const id of ['G', 'J', 'End']) expect(s.get(id)!.bounds.y, id).toBe(before.get(id)!.bounds.y);
    expect(r.layout.format![0]!.moved).toEqual(expect.arrayContaining(['B1', 'B2']));
  });

  it('colours a branch with its flows; a branch straight to the join has nothing on it', async () => {
    const hand = await handXml(SPLIT);
    const { after } = await run(hand, [{ op: 'color', branch: 'F_a', color: 'orange' }]);
    const doc = await Doc.fromXml(hand);
    const out = (id: string): string => doc.outgoing(doc.get(id)!)[0]!.get<string>('id');
    expect(colored(after)).toEqual(['A1', 'A2', 'F_a', out('A1'), out('A2')].sort());
    const e = await failure(hand, [{ op: 'color', branch: 'F_c', color: 'orange' }]);
    expect(e.code).toBe('E_NO_MATCH');
    expect(e.message).toMatch(/^Nothing lies on the branch of F_c: it leads to J/);
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
      const root = join(import.meta.dirname, '..');
      const r = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src', 'cli.ts'), 'color', file, '--path', 'S', 'E', '--color', 'green'], { encoding: 'utf8', cwd: root, input: '' });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/format color #0: colored S, /);
      expect(colored(await Doc.fromXml(readFileSync(file, 'utf8')))).toContain('B');
      const bad = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src', 'cli.ts'), 'color', file, '--path', 'S', '--color', 'green'], { encoding: 'utf8', cwd: root, input: '' });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/--path takes exactly two ids \(from and to\), got 1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
