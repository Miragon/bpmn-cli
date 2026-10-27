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
import { Doc } from '../../src/domain/document/Doc.js';
import type { DShape } from '../../src/domain/diagram/di/types.js';
import { DiagramReader } from '../../src/domain/diagram/di/DiagramReader.js';
import type { El } from '../../src/domain/document/utils/moddle.js';
import type { EditCommand } from '../../src/domain/commands/types.js';
import { mutateDoc } from '../../src/index.js';

const ROOT = join(import.meta.dirname, '..', '..');
let dir: string;

function bpmn(...args: string[]): { code: number; out: string; err: string } {
  const spawned = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT, input: '' });
  return { code: spawned.status ?? -1, out: spawned.stdout, err: spawned.stderr };
}

const OPS: EditCommand[] = [
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
  const outcome = await mutateDoc(Doc.create({ processId: 'P' }), OPS, { dryRun: true });
  const doc = await Doc.fromXml(outcome.xml);
  for (const diagram of doc.definitions.get<El[]>('diagrams')) {
    for (const pe of diagram.get<El>('plane').get<El[]>('planeElement')) {
      const bounds = pe.get<El | undefined>('bounds');
      if (bounds) bounds.set('x', bounds.get<number>('x') + 20);
      const lb = pe.get<El | undefined>('label')?.get<El | undefined>('bounds');
      if (lb) lb.set('x', lb.get<number>('x') + 20);
      for (const waypoint of pe.get<El[] | undefined>('waypoint') ?? []) waypoint.set('x', waypoint.get<number>('x') + 20);
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
  for (const plane of new DiagramReader(doc.definitions).planes()) for (const shape of plane.shapes.values()) out.set(shape.id, shape);
  return out;
}

const cy = (shape: DShape): number => shape.bounds.y + shape.bounds.height / 2;
const cx = (shape: DShape): number => shape.bounds.x + shape.bounds.width / 2;

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
    let cliRun = bpmn('color', file, 'A', 'F_yes', 'B', '--color', 'red');
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/^layout: ok - incremental \(format operations only: drawing kept\)$/m);
    expect(cliRun.out).toMatch(/^ {2}format color #0: colored A, F_yes, B$/m);
    expect(cliRun.out).toMatch(/^written: /m);
    cliRun = bpmn('align', file, 'A', 'C', '--axis', 'column', '--json');
    expect(cliRun.code, cliRun.err).toBe(0);
    const json = JSON.parse(cliRun.out);
    expect(json.layout.format).toEqual([{ op: 'align', index: 0, moved: ['C'], rerouted: expect.arrayContaining(['F_no']) }]);
    expect(json.layout.metrics.added.filter((problem: { kind: string }) => ['overlaps', 'through', 'outsideLane', 'outsidePool'].includes(problem.kind))).toEqual([]);
    cliRun = bpmn('place', file, 'E2', '--row-of', 'C', '--after', 'C');
    expect(cliRun.code, cliRun.err).toBe(0);
    const after = await shapesOf(file);
    expect(cx(after.get('C')!)).toBe(cx(after.get('A')!));
    expect(cy(after.get('E2')!)).toBe(cy(after.get('C')!));
    for (const id of ['S', 'A', 'G', 'B', 'E']) expect(after.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    expect(readFileSync(file, 'utf8')).toMatch(/bpmnElement="A" bioc:stroke="#831311"/);
  });

  it('label, route, space and tidy', async () => {
    const file = await handFile('more.bpmn');
    let cliRun = bpmn('label', file, 'G', '--side', 'below');
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/format label #0: label placed G/);
    cliRun = bpmn('route', file, 'F_no', '--exit', 'bottom', '--entry', 'bottom');
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/format route #0: rerouted F_no/);
    cliRun = bpmn('space', file, '--below', 'L1', '--by', '40');
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/format space #0: moved Pool, L1, L2/);
    cliRun = bpmn('tidy', file);
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/format tidy #0: no change/);
  });

  it('orders lanes with `order <pool> <lanes...>`', async () => {
    const file = await handFile('lanes.bpmn');
    const cliRun = bpmn('order', file, 'Pool', 'L2', 'L1');
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/^changed participant Pool "Org" - lane order: L2, L1$/m);
    expect(cliRun.out).toMatch(/format order #0: moved /);
    const shape = await shapesOf(file);
    expect(shape.get('L2')!.bounds.y).toBeLessThan(shape.get('L1')!.bounds.y);
    const view = bpmn('show', file, '--layout');
    expect(view.out).toMatch(/ {4}lane L2 "Boss"\n {4}lane L1 "Clerk"\n {6}row 1: c0 S, c1 A, c2 G, c3 B, c4 E\n {6}row 2: c3 C, c4 E2\n/);
  });

  it('reports refusals with code, hint and exit code', async () => {
    const file = await handFile('refuse.bpmn');
    const original = readFileSync(file, 'utf8');
    let cliRun = bpmn('place', file, 'C', '--row-of', 'L2');
    expect(cliRun.code).toBe(2);
    expect(cliRun.err).toMatch(/^error E_LEAVES_CONTAINER: Placing C in the row of L2 would move it out of its lane L1 \(into lane L2\)$/m);
    expect(cliRun.err).toMatch(/hint: .*bpmn move <file> C --lane L2/);
    cliRun = bpmn('place', file, 'C');
    expect(cliRun.code).toBe(1);
    expect(cliRun.err).toMatch(/E_USAGE: place needs a row/);
    cliRun = bpmn('place', file, 'C', '--below', 'A', '--row-of', 'B');
    expect(cliRun.err).toMatch(/E_USAGE: --row-of and --below cannot be combined/);
    cliRun = bpmn('color', file, 'A', '--color', 'pink');
    expect(cliRun.code).toBe(1);
    expect(cliRun.err).toMatch(/E_USAGE: .*Allowed choices are blue, orange, green, red, purple, default/);
    cliRun = bpmn('label', file, 'A', '--side', 'below', '--json');
    expect(cliRun.code).toBe(2);
    expect(JSON.parse(cliRun.err).error).toMatchObject({ code: 'E_WRONG_KIND', element: 'A' });
    cliRun = bpmn('space', file);
    expect(cliRun.err).toMatch(/E_USAGE: space needs --after <id>/);
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('applies format ops from a batch after the semantic ops', async () => {
    const file = await handFile('batch.bpmn');
    const ops = join(dir, 'ops.json');
    writeFileSync(ops, JSON.stringify({ ops: [{ op: 'add', kind: 'task', id: 'X', name: 'Extra', after: 'C', before: 'E2' }, { op: 'color', ids: ['X'], color: 'green' }, { op: 'place', ids: ['X'], above: 'C' }] }));
    const cliRun = bpmn('apply', file, ops, '--json');
    expect(cliRun.code, cliRun.err).toBe(0);
    const json = JSON.parse(cliRun.out);
    expect(json.layout.mode).toBe('incremental');
    expect(json.layout.format.map((entry: { op: string; index: number }) => `${entry.op}#${entry.index}`)).toEqual(['color#1', 'place#2']);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify([{ op: 'place', ids: ['X'], rowof: 'C' }]));
    const failedRun = bpmn('apply', file, bad);
    expect(failedRun.code).toBe(1);
    expect(failedRun.err).toMatch(/ops\[0\] \(place\): unknown key "rowof" \(did you mean "rowOf"\?\)/);
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
    const cliRun = bpmn('show', file, '--layout');
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/^diagram BPMNPlane_(Collaboration_P) \(\1\)\n {2}columns: c0\.\.c4\n {2}participant Pool "Org"\n {4}lane L1 "Clerk"\n {6}row 1: c0 S, c1 A, c2 G, c3 B, c4 E\n {6}row 2: c3 C\n {6}row 3: c4 E2\n {4}lane L2 "Boss"\n/);
    expect(cliRun.out).toMatch(/^colors: A blue$/m);
    expect(cliRun.out).toMatch(/^layout quality: score \d+: .*overlaps 1/m);
    expect(cliRun.out).toMatch(/^ {2}overlaps \[B, C\]$/m);
    const json = JSON.parse(bpmn('show', file, '--layout', '--json').out);
    expect(json.diagrams[0].groups[1]).toEqual({ id: 'L1', kind: 'lane', name: 'Clerk', parent: 'Pool', rows: [['S', 'A', 'G', 'B', 'E'], ['C'], ['E2']], columns: [[0, 1, 2, 3, 4], [3], [4]] });
    expect(json.colors).toEqual([{ id: 'A', color: 'blue', fill: '#bbdefb', stroke: '#0d4372' }]);
    expect(json.metrics.problems).toEqual(expect.arrayContaining([{ kind: 'overlaps', ids: ['B', 'C'] }]));
    expect(bpmn('show', file, 'A', '--layout').err).toMatch(/E_USAGE: --layout shows the whole drawing/);
  });

  it('metrics prints the score and the problems with ids; layout --tidy removes the overlap and keeps the rest', async () => {
    const file = await handFile('metrics.bpmn', overlap);
    let cliRun = bpmn('metrics', file);
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/^score \d+: .*overlaps 1/);
    expect(cliRun.out).toMatch(/^ {2}overlaps \[B, C\]$/m);
    const json = JSON.parse(bpmn('metrics', file, '--json').out);
    expect(json).toMatchObject({ file, counts: { overlaps: 1 } });
    expect(json.problems).toEqual(expect.arrayContaining([{ kind: 'overlaps', ids: ['B', 'C'] }]));
    const before = await shapesOf(file);
    cliRun = bpmn('layout', file, '--tidy');
    expect(cliRun.code, cliRun.err).toBe(0);
    expect(cliRun.out).toMatch(/^layout: ok - incremental \(format operations only: drawing kept\)$/m);
    expect(cliRun.out).toMatch(/format tidy #0: moved /);
    expect(JSON.parse(bpmn('metrics', file, '--json').out).counts.overlaps).toBe(0);
    const after = await shapesOf(file);
    for (const id of ['S', 'A', 'G']) expect(after.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
    expect(bpmn('layout', file, '--tidy', '--collapse', 'X').err).toMatch(/E_USAGE: --tidy keeps the drawing/);
  });
});
