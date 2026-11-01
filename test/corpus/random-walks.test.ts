import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyToXml, BpmnError, diagramXml, kindsJson } from '../../src/index.js';
import { type Executor, libExecutor } from '../../tools/fuzz/lib/exec.mjs';
import { analyse, diInvariants } from '../../tools/fuzz/lib/analyse.mjs';
import { runWalk, type WalkMetrics, type WalkSummary } from '../../tools/fuzz/lib/walk.mjs';
import { ProblemKinds, ScoreChange } from '../support/ModelValues.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus');
const STEPS = 15;
const EVERY_FOURTH_STEP = 4;
const SYNTHETIC = ['boundary', 'collabnote', 'groups', 'lanesub', 'orders', 'orders-boundaries', 'polish-collab', 'polish-lanes', 'polish-remove', 'pool', 'sub', 'sub3', 'subtop2', 'twoviews', 'nan', 'vertical'].map((name) => `models/incremental/${name}.bpmn`);
const SCENARIOS = ['agent__claim', 'agent__o2c', 'artifacts__05-data-pool-lanes', 'artifacts__10-three-boundaries', 'subproc__s01-sub-xor-loop', 'subproc__s03-collapsed', 'subproc__s08-collab3', 'gallery__03-loop-boundary'].map((name) => `layout/${name}.bpmn`);
const WALKS = [...SYNTHETIC, ...SCENARIOS].flatMap((path, index) => [{ path, seed: index + 1 }, { path, seed: index + 101 }]);
const ORDERS = 'models/incremental/orders.bpmn';

const library = libExecutor({ applyToXml, BpmnError });
const scored = (problems: readonly never[]): ConstructorParameters<typeof ScoreChange>[1] => ({ counts: ProblemKinds.perKind(() => 0), score: 0, problems });
const realChecks: WalkMetrics = {
  measure: diagramXml,
  diff: (before, after) => ({ added: new ScoreChange(scored(before), scored(after)).added }),
  hard: ProblemKinds.ALL.filter((kind) => ProblemKinds.isHard(kind)),
};

const textOf = (path: string) => readFileSync(join(CORPUS, path), 'utf8');

function walk(path: string, seed: number, steps: number, exec: Executor = library, detEvery = EVERY_FOURTH_STEP): Promise<WalkSummary> {
  return runWalk({ xml: textOf(path), model: path, seed, steps, exec, metrics: realChecks, detEvery, hardSeverity: 'warn' });
}

function errorsOf({ violations }: WalkSummary): string[] {
  return violations.filter(({ severity }) => severity === 'error').map(({ step, op, kind, detail }) => `step ${step} ${op}: ${kind} ${detail ?? ''}`);
}

function sabotaged(edit: (xml: string) => string): Executor {
  return {
    label: 'sabotaged',
    async run(xml, ops) {
      const step = await library.run(xml, ops);
      return step.status === 'ok' && step.xml ? { ...step, xml: edit(step.xml) } : step;
    },
  };
}

function kindsOf({ violations }: WalkSummary): string[] {
  return violations.map(({ kind }) => kind);
}

describe('seeded random walks through the public API', () => {
  it('walks real models and synthetic ones', () => {
    expect(kindsJson().kinds.length).toBeGreaterThan(0);
    expect(WALKS.length).toBeGreaterThanOrEqual(48);
  });

  it('keeps the DI complete and the bytes deterministic over every walk, with hard defects counted as warnings', async () => {
    const summaries = await Promise.all(WALKS.map(({ path, seed }) => walk(path, seed, STEPS)));
    const warnings = summaries.reduce((sum, { warnings: found }) => sum + found, 0);
    console.info(`random walks: ${WALKS.length} walks, ${warnings} warnings, the hard defects among them`);

    expect(summaries.flatMap(errorsOf)).toEqual([]);
    expect(summaries.every(({ ok }) => ok > 0)).toBe(true);
  }, 120000);

  it('gives the same steps and the same result for the same seed', async () => {
    const [first, second] = [await walk(ORDERS, 7, 6, library, 0), await walk(ORDERS, 7, 6, library, 0)];

    expect(second.ops).toEqual(first.ops);
    expect(second.violations).toEqual(first.violations);
  });

  it.each(SCENARIOS)('redraws %s in full, the same bytes twice, every element drawn', async (path) => {
    const xml = textOf(path);
    const [first, second] = [await applyToXml(xml, [{ op: 'layout' }]), await applyToXml(xml, [{ op: 'layout' }])];

    expect(second.xml).toBe(first.xml);
    expect(diInvariants(await analyse(first.xml))).toEqual([]);
  });
});

describe('the invariants of a walk over planted defects', () => {
  it('names a flow node left without a shape', async () => {
    const dropShape = (xml: string) => xml.replace(/<bpmndi:BPMNShape\b[^>]*bpmnElement="Task_[^"]*"[\s\S]*?<\/bpmndi:BPMNShape>/, '');

    expect(kindsOf(await walk(ORDERS, 11, 2, sabotaged(dropShape), 0))).toContain('di:noDi');
  });

  it('names a step that gives other bytes when it runs again', async () => {
    let calls = 0;
    const flaky = sabotaged((xml) => (calls++ % 2 ? xml.replace(/<\/((?:\w+:)?definitions)>/, '<!-- again --></$1>') : xml));

    expect(kindsOf(await walk(ORDERS, 11, 1, flaky, 1))).toContain('nondeterministic');
  });

  it('counts a hard defect the write adds as a warning, and goes on', async () => {
    const piled = sabotaged((xml) => xml.replace(/(<(?:\w+:)?Bounds )x="[^"]*" y="[^"]*"/g, '$1x="200" y="200"'));

    const { violations } = await walk(ORDERS, 11, 1, piled, 0);

    expect(violations.filter(({ kind }) => kind.startsWith('hard:')).map(({ severity }) => severity)).toContain('warn');
  });

  it('names a crash and a file written on failure', async () => {
    const crashing: Executor = { label: 'crashing', run: () => ({ status: 'crash', code: 'E_INTERNAL', message: 'boom', readBack: 'changed' }) };

    expect(kindsOf(await walk(ORDERS, 11, 1, crashing, 0))).toEqual(['crash', 'writtenOnFailure']);
  });
});
