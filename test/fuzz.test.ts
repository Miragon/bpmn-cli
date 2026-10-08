/**
 * Seeded property test: short random walks of semantic and format edits,
 * in-process on the library (src/), with the fuzzer's invariants checked after
 * every step (tools/fuzz/lib/walk.mjs): clean re-import, DI complete on the
 * right plane, no new hard layout defect (hard kinds come from the metrics
 * library, so new kinds are included), result metrics equal a standalone
 * measurement, no unreported moves, determinism spot-checks, no crash, no
 * malformed op, nothing written on failure.
 *
 * The walks are fixed (model, mode, seed, steps), so a failure is reproducible:
 *   node tools/fuzz/walk.mjs <model> --seed <seed> --mode <mode> --steps <n> --exec lib
 * after `npm run build`, then tools/fuzz/minimize.mjs on the walk directory.
 * The second block plants defects into otherwise good results and checks that
 * the oracles notice them, so a broken oracle cannot pass silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError, Doc, mutateDoc, parseOps } from '../src/index.js';
import * as metricsLib from '../src/diagram/metrics.js';
// @ts-expect-error plain ESM tooling without type declarations
import { libExecutor } from '../tools/fuzz/lib/exec.mjs';
// @ts-expect-error plain ESM tooling without type declarations
import { hardKinds } from '../tools/fuzz/lib/metric-kinds.mjs';
// @ts-expect-error plain ESM tooling without type declarations
import { runWalk } from '../tools/fuzz/lib/walk.mjs';

interface Violation { step: number; op: string; kind: string; detail?: string; severity: 'error' | 'warn' }
interface Summary { steps: number; ok: number; violations: Violation[]; errors: number; ops: Array<{ name: string; ops: unknown[] }> }
interface ExecResult { status: string; xml?: string; layout?: Record<string, unknown> }
interface Executor { label: string; run(xml: string, ops: unknown[], o: { mode: string }): Promise<ExecResult> }

const ROOT = join(__dirname, '..');
const FIXTURES = join(ROOT, 'test', 'fixtures', 'incremental');
const SCENARIOS = join(ROOT, 'tools', 'scenarios');

const exec: Executor = libExecutor({ Doc, parseOps, mutateDoc, CliError });
const metrics = { measure: metricsLib.layoutProblemsOfXml, diff: metricsLib.diffProblems, hard: hardKinds(metricsLib, {}) as string[] };

type Mode = 'auto' | 'incremental';
const fx = (name: string, mode: Mode, seed: number) => ({ file: join(FIXTURES, name), mode, seed });
const sc = (name: string, mode: Mode, seed: number) => ({ file: join(SCENARIOS, name), mode, seed });

/**
 * Walks that keep every invariant: the synthetic fixtures (pools, lanes, nested
 * and collapsed sub-processes, boundary events, groups, two views, broken DI)
 * and scenarios with collaborations, data objects and loops.
 */
const WALKS = [
  fx('boundary.bpmn', 'incremental', 1), fx('collabnote.bpmn', 'auto', 3), fx('groups.bpmn', 'incremental', 1),
  fx('lanesub.bpmn', 'auto', 3), fx('orders.bpmn', 'auto', 1), fx('orders-boundaries.bpmn', 'incremental', 1),
  fx('polish-collab.bpmn', 'incremental', 2), fx('polish-lanes.bpmn', 'auto', 3), fx('pool.bpmn', 'incremental', 3),
  fx('sub.bpmn', 'auto', 1), fx('sub3.bpmn', 'incremental', 3), fx('twoviews.bpmn', 'auto', 2), fx('nan.bpmn', 'incremental', 2),
  sc('agent__claim.bpmn', 'incremental', 2), sc('agent__o2c.bpmn', 'auto', 1), sc('artifacts__05-data-pool-lanes.bpmn', 'auto', 3),
  sc('artifacts__10-three-boundaries.bpmn', 'incremental', 1), sc('subproc__s03-collapsed.bpmn', 'auto', 2),
  sc('subproc__s08-collab3.bpmn', 'incremental', 2), sc('gallery__03-loop-boundary.bpmn', 'auto', 2),
  // regression walks of audit bug #4 (a growing sub-process covering or pushing its neighbours)
  { ...sc('agent__claim.bpmn', 'incremental', 21), steps: 12 }, fx('polish-remove.bpmn', 'incremental', 3),
  fx('subtop2.bpmn', 'incremental', 3), sc('subproc__s01-sub-xor-loop.bpmn', 'auto', 3),
  // regression walks of audit bug #11 (align / place pushing a shape onto another; fixed by the new-overlap check of makeRoom)
  { ...fx('orders.bpmn', 'incremental', 11), steps: 12 }, sc('subproc__s01-sub-xor-loop.bpmn', 'incremental', 2),
];

/**
 * Walks that currently hit open bugs of the 2026-10 audit (`bug` = the number
 * in the table of docs/audit-2026-10.md). They are expected to fail; when a fix
 * makes one pass, vitest reports it and the walk moves into WALKS.
 */
const KNOWN: Array<{ file: string; mode: Mode; seed: number; steps?: number; bug: string }> = [];
const STEPS = 15;

const walk = (file: string, o: { mode: string; seed: number; steps?: number; exec?: Executor; detEvery?: number }): Promise<Summary> =>
  runWalk({ xml: readFileSync(file, 'utf8'), model: file, seed: o.seed, mode: o.mode, steps: o.steps ?? STEPS, exec: o.exec ?? exec, metrics, detEvery: o.detEvery ?? 4 });

const errorsOf = (s: Summary) => s.violations.filter((v) => v.severity === 'error').map((v) => `step ${v.step} ${v.op}: ${v.kind} ${v.detail ?? ''}`);

describe('fuzz: seeded random walks keep the invariants', () => {
  for (const w of WALKS) {
    const name = w.file.split('/').pop();
    it(`${name} ${w.mode} seed ${w.seed}`, async () => {
      const s = await walk(w.file, w);
      expect(errorsOf(s)).toEqual([]);
      expect(s.ok).toBeGreaterThan(STEPS / 2);
    });
  }

  for (const w of KNOWN) {
    it.fails(`known bug ${w.bug}: ${w.file.split('/').pop()} ${w.mode} seed ${w.seed}`, async () => {
      const s = await walk(w.file, w);
      expect(errorsOf(s)).toEqual([]);
    });
  }

  it('the same seed gives the same steps and the same result', async () => {
    const file = join(FIXTURES, 'orders.bpmn');
    const a = await walk(file, { mode: 'incremental', seed: 7, steps: 6, detEvery: 0 });
    const b = await walk(file, { mode: 'incremental', seed: 7, steps: 6, detEvery: 0 });
    expect(JSON.stringify(b.ops)).toBe(JSON.stringify(a.ops));
    expect(b.violations).toEqual(a.violations);
  });
});

/* ------------------------------------------------------------------ */
/* the oracles themselves                                               */
/* ------------------------------------------------------------------ */

/** Runs the real step, then rewrites the written XML. */
const sabotage = (edit: (xml: string) => string): Executor => ({
  label: 'sabotage',
  async run(xml, ops, o) {
    const r = await exec.run(xml, ops, o);
    return r.status === 'ok' && r.xml ? { ...r, xml: edit(r.xml) } : r;
  },
});

/** Shifts the first BPMNShape's bounds by `dx` (an unreported move or, far enough, an overlap). */
const shiftFirstShape = (dx: number) => (xml: string) => xml.replace(/(<bpmndi:BPMNShape\b[\s\S]*?<dc:Bounds x=")(-?[\d.]+)/, (_m, pre: string, x: string) => `${pre}${Number(x) + dx}`);

const kindsOf = (s: Summary) => new Set(s.violations.map((v) => v.kind));

describe('fuzz oracles detect planted defects', () => {
  const file = join(FIXTURES, 'orders.bpmn');

  it('an unreported shape move', async () => {
    const s = await walk(file, { mode: 'incremental', seed: 11, steps: 2, exec: sabotage(shiftFirstShape(7)), detEvery: 0 });
    expect(kindsOf(s)).toContain('unreportedMove');
  });

  it('a flow node without DI', async () => {
    const dropTaskShape = (xml: string) => xml.replace(/<bpmndi:BPMNShape\b[^>]*bpmnElement="Task_[^"]*"[\s\S]*?<\/bpmndi:BPMNShape>/, '');
    const s = await walk(file, { mode: 'incremental', seed: 11, steps: 2, exec: sabotage(dropTaskShape), detEvery: 0 });
    expect([...kindsOf(s)].some((k) => k === 'di:noDi')).toBe(true);
    expect([...kindsOf(s)].some((k) => k === 'hard:missing')).toBe(true);
  });

  it('a new overlap of two shapes', async () => {
    const stack = (xml: string) => {
      const boxes = [...xml.matchAll(/<bpmndi:BPMNShape\b[^>]*bpmnElement="(Task_[^"]*)"[\s\S]*?<dc:Bounds x="(-?[\d.]+)" y="(-?[\d.]+)"/g)];
      const [first, second] = boxes;
      if (!first || !second) return xml;
      return xml.replace(second[0], second[0].replace(/x="(-?[\d.]+)" y="(-?[\d.]+)"$/, `x="${first[2]}" y="${first[3]}"`));
    };
    const s = await walk(file, { mode: 'incremental', seed: 11, steps: 2, exec: sabotage(stack), detEvery: 0 });
    expect(kindsOf(s)).toContain('hard:overlaps');
  });

  it('a step that gives other bytes on a re-run', async () => {
    let n = 0;
    const flaky = sabotage((xml) => (n++ % 2 ? xml.replace('</bpmn:definitions>', '<!-- x --></bpmn:definitions>') : xml));
    const s = await walk(file, { mode: 'incremental', seed: 11, steps: 1, exec: flaky, detEvery: 1 });
    expect(kindsOf(s)).toContain('nondeterministic');
  });

  it('a crash and a write on failure', async () => {
    const crashing: Executor = { label: 'crash', run: async () => ({ status: 'crash', code: 'E_INTERNAL', message: 'boom', readBack: 'changed' } as ExecResult) };
    const s = await walk(file, { mode: 'incremental', seed: 11, steps: 1, exec: crashing, detEvery: 0 });
    expect(kindsOf(s)).toContain('crash');
    expect(kindsOf(s)).toContain('writtenOnFailure');
  });
});
