/**
 * The format commands and the read side end to end through the CLI
 * (src/cli.ts run with tsx): place / align / color / label / route / space /
 * tidy, `order` of lanes, `show --layout`, `metrics`, `layout --tidy`, their
 * text and JSON output and their errors.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { readPlanes, type DShape } from '../src/diagram/plane.js';
import type { El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';

const ROOT = join(import.meta.dirname, '..');
let dir: string;

function bpmn(...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT, input: '' });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

const OPS: Op[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes', flowId: 'F_yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no', flowId: 'F_no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
  { op: 'add', kind: 'participant', id: 'Pool', name: 'Org' },
  { op: 'add', kind: 'lane', id: 'L1', name: 'Clerk', in: 'Pool', members: ['S', 'A', 'G', 'B', 'E', 'C', 'E2'] },
  { op: 'add', kind: 'lane', id: 'L2', name: 'Boss', in: 'Pool' },
];

/** An engine drawing moved by 20 px (hand-made as far as `auto` is concerned); `mutate` edits the DI first. */
async function handFile(name: string, mutate?: (doc: Doc) => void): Promise<string> {
  const r = await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true });
  const doc = await Doc.fromXml(r.xml);
  for (const d of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of d.get<El>('plane').get<El[]>('planeElement')) {
      const b = pe.get<El | undefined>('bounds');
      if (b) b.set('x', b.get<number>('x') + 20);
      const lb = pe.get<El | undefined>('label')?.get<El | undefined>('bounds');
      if (lb) lb.set('x', lb.get<number>('x') + 20);
      for (const w of pe.get<El[] | undefined>('waypoint') ?? []) w.set('x', w.get<number>('x') + 20);
    }
  }
  mutate?.(doc);
  const file = join(dir, name);
  writeFileSync(file, await doc.toXml());
  return file;
}

async function shapesOf(file: string): Promise<Map<string, DShape>> {
  const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
  const out = new Map<string, DShape>();
  for (const p of readPlanes(doc.definitions)) for (const s of p.shapes.values()) out.set(s.id, s);
  return out;
}

const cy = (s: DShape): number => s.bounds.y + s.bounds.height / 2;
const cx = (s: DShape): number => s.bounds.x + s.bounds.width / 2;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-cli-format-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('format commands', () => {
  it('color, align and place report what they did and keep the rest', async () => {
    const file = await handFile('session.bpmn');
    const before = await shapesOf(file);
    let r = bpmn('color', file, 'A', 'F_yes', 'B', '--color', 'red');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^layout: ok - incremental \(format operations only: drawing kept\)$/m);
    expect(r.out).toMatch(/^ {2}format color #0: colored A, F_yes, B$/m);
    expect(r.out).toMatch(/^written: /m);
    r = bpmn('align', file, 'A', 'C', '--axis', 'column', '--json');
    expect(r.code, r.err).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.layout.format).toEqual([{ op: 'align', index: 0, moved: ['C'], rerouted: expect.arrayContaining(['F_no']) }]);
    expect(j.layout.metrics.added.filter((p: { kind: string }) => ['overlaps', 'through', 'outsideLane', 'outsidePool'].includes(p.kind))).toEqual([]);
    r = bpmn('place', file, 'E2', '--row-of', 'C', '--after', 'C');
    expect(r.code, r.err).toBe(0);
    const after = await shapesOf(file);
    expect(cx(after.get('C')!)).toBe(cx(after.get('A')!));
    expect(cy(after.get('E2')!)).toBe(cy(after.get('C')!));
    for (const id of ['S', 'A', 'G', 'B', 'E']) expect(after.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    expect(readFileSync(file, 'utf8')).toMatch(/bpmnElement="A" bioc:stroke="#831311"/);
  });

  it('label, route, space and tidy', async () => {
    const file = await handFile('more.bpmn');
    let r = bpmn('label', file, 'G', '--side', 'below');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/format label #0: label placed G/);
    r = bpmn('route', file, 'F_no', '--exit', 'bottom', '--entry', 'bottom');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/format route #0: rerouted F_no/);
    r = bpmn('space', file, '--below', 'L1', '--by', '40');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/format space #0: moved Pool, L1, L2/);
    r = bpmn('tidy', file);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/format tidy #0: no change/);
  });

  it('orders lanes with `order <pool> <lanes...>`', async () => {
    const file = await handFile('lanes.bpmn');
    const r = bpmn('order', file, 'Pool', 'L2', 'L1');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^changed participant Pool "Org" - lane order: L2, L1$/m);
    expect(r.out).toMatch(/format order #0: moved /);
    const s = await shapesOf(file);
    expect(s.get('L2')!.bounds.y).toBeLessThan(s.get('L1')!.bounds.y);
    const view = bpmn('show', file, '--layout');
    expect(view.out).toMatch(/ {4}lane L2 "Boss"\n {4}lane L1 "Clerk"\n {6}row 1: S, A, G, B, E\n {6}row 2: C, E2\n/);
  });

  it('reports refusals with code, hint and exit code', async () => {
    const file = await handFile('refuse.bpmn');
    const original = readFileSync(file, 'utf8');
    let r = bpmn('place', file, 'C', '--row-of', 'L2');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^error E_LEAVES_CONTAINER: Placing C in the row of L2 would move it out of its lane L1 \(into lane L2\)$/m);
    expect(r.err).toMatch(/hint: .*bpmn move <file> C --lane L2/);
    r = bpmn('place', file, 'C');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/E_USAGE: place needs a row/);
    r = bpmn('place', file, 'C', '--below', 'A', '--row-of', 'B');
    expect(r.err).toMatch(/E_USAGE: --row-of and --below cannot be combined/);
    r = bpmn('color', file, 'A', '--color', 'pink');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/E_USAGE: .*Allowed choices are blue, orange, green, red, purple, default/);
    r = bpmn('label', file, 'A', '--side', 'below', '--json');
    expect(r.code).toBe(2);
    expect(JSON.parse(r.err).error).toMatchObject({ code: 'E_WRONG_KIND', element: 'A' });
    r = bpmn('space', file);
    expect(r.err).toMatch(/E_USAGE: space needs --after <id>/);
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('applies format ops from a batch after the semantic ops', async () => {
    const file = await handFile('batch.bpmn');
    const ops = join(dir, 'ops.json');
    writeFileSync(ops, JSON.stringify({ ops: [{ op: 'add', kind: 'task', id: 'X', name: 'Extra', after: 'C', before: 'E2' }, { op: 'color', ids: ['X'], color: 'green' }, { op: 'place', ids: ['X'], above: 'C' }] }));
    const r = bpmn('apply', file, ops, '--json');
    expect(r.code, r.err).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.layout.mode).toBe('incremental');
    expect(j.layout.format.map((f: { op: string; index: number }) => `${f.op}#${f.index}`)).toEqual(['color#1', 'place#2']);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify([{ op: 'place', ids: ['X'], rowof: 'C' }]));
    const e = bpmn('apply', file, bad);
    expect(e.code).toBe(1);
    expect(e.err).toMatch(/ops\[0\] \(place\): unknown key "rowof" \(did you mean "rowOf"\?\)/);
  });
});

describe('read side', () => {
  /** C pushed onto B: one overlap. */
  const overlap = (doc: Doc): void => {
    for (const pe of doc.definitions.get<El[]>('diagrams')[0]!.get<El>('plane').get<El[]>('planeElement')) {
      if (pe.get<El>('bpmnElement').get<string>('id') === 'C') pe.get<El>('bounds').set('y', 150);
    }
  };

  it('show --layout prints rows per lane, colours and problems; --json the same data', async () => {
    const file = await handFile('show.bpmn', overlap);
    bpmn('color', file, 'A', '--color', 'blue');
    const r = bpmn('show', file, '--layout');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^diagram BPMNPlane_Collaboration_1 \(Collaboration_1\)\n {2}participant Pool "Org"\n {4}lane L1 "Clerk"\n {6}row 1: S, A, G, B, E\n {6}row 2: C\n {6}row 3: E2\n {4}lane L2 "Boss"\n/);
    expect(r.out).toMatch(/^colors: A blue$/m);
    expect(r.out).toMatch(/^layout quality: score \d+: .*overlaps 1/m);
    expect(r.out).toMatch(/^ {2}overlaps \[B, C\]$/m);
    const j = JSON.parse(bpmn('show', file, '--layout', '--json').out);
    expect(j.diagrams[0].groups[1]).toEqual({ id: 'L1', kind: 'lane', name: 'Clerk', parent: 'Pool', rows: [['S', 'A', 'G', 'B', 'E'], ['C'], ['E2']] });
    expect(j.colors).toEqual([{ id: 'A', color: 'blue', fill: '#bbdefb', stroke: '#0d4372' }]);
    expect(j.metrics.problems).toEqual(expect.arrayContaining([{ kind: 'overlaps', ids: ['B', 'C'] }]));
    expect(bpmn('show', file, 'A', '--layout').err).toMatch(/E_USAGE: --layout shows the whole drawing/);
  });

  it('metrics prints the score and the problems with ids; layout --tidy removes the overlap and keeps the rest', async () => {
    const file = await handFile('metrics.bpmn', overlap);
    let r = bpmn('metrics', file);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^score \d+: .*overlaps 1/);
    expect(r.out).toMatch(/^ {2}overlaps \[B, C\]$/m);
    const j = JSON.parse(bpmn('metrics', file, '--json').out);
    expect(j).toMatchObject({ file, counts: { overlaps: 1 } });
    expect(j.problems).toEqual(expect.arrayContaining([{ kind: 'overlaps', ids: ['B', 'C'] }]));
    const before = await shapesOf(file);
    r = bpmn('layout', file, '--tidy');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^layout: ok - incremental \(format operations only: drawing kept\)$/m);
    expect(r.out).toMatch(/format tidy #0: moved /);
    expect(JSON.parse(bpmn('metrics', file, '--json').out).counts.overlaps).toBe(0);
    const after = await shapesOf(file);
    for (const id of ['S', 'A', 'G']) expect(after.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    expect(bpmn('layout', file, '--tidy', '--collapse', 'X').err).toMatch(/E_USAGE: --tidy keeps the drawing/);
  });
});
