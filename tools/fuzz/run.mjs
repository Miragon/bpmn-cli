#!/usr/bin/env node
/**
 * Fuzz campaign: many seeded random walks in parallel, aggregated.
 *
 *   node tools/fuzz/run.mjs [--walks 24] [--steps 30] [--seed 1] [--modes auto,incremental]
 *        [--corpus dir[:dir...]] [--filter text] [--jobs 4] [--out dir] [--exec cli|lib]
 *        [--via commands|apply] [--det-every 10] [--no-semantic] [--no-format] [--no-render]
 *        [--hard error|warn] [--strict] [--minimize]
 *
 * Contract
 *  - Corpus: every *.bpmn below --corpus (colon- or comma-separated), default
 *    test/fixtures + tools/scenarios + the directories in env BPMN_FUZZ_CORPUS
 *    (keep private corpora outside the repository).
 *  - Walk i runs model order[i mod n] (order = the corpus shuffled with --seed)
 *    in mode modes[(i + floor(i / n)) mod |modes|] with seed seedOf(--seed, i):
 *    the same arguments give the same walks.
 *  - Each walk runs tools/fuzz/walk.mjs in its own process and writes to
 *    <out>/walks/<model>-s<seed>-<mode>/ (default out: tools/fuzz/out/latest,
 *    git-ignored). The run writes <out>/report.json and prints a summary:
 *    steps, refusals, layout modes, violations by kind with examples.
 *  - --hard warn reports new hard layout defects as warnings (the robustness
 *    invariants stay errors): `npm run gate` uses it, because open layout bugs
 *    would make a random campaign fail; layout quality is gated by the property
 *    test, the regression budget and `bench --compare`.
 *  - Every written step is rendered (`render` violations, lib/walk.mjs);
 *    --no-render skips that.
 *  - --minimize: for every error kind, the first walk showing it is reduced
 *    with ddmin (minimize.mjs); the repro lands in <walk>/min-<kind>/run.sh.
 *  - Exit 0 = no error-severity violation (with --strict: none at all), 1 =
 *    violations, 2 = bad arguments.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimizeWalk } from './minimize.mjs';
import { corpusFiles, defaultCorpus, loadMetrics, parseArgs, ROOT } from './lib/setup.mjs';
import { rng, seedOf } from './lib/rng.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SPEC = { walks: 24, steps: 30, seed: 1, modes: 'auto,incremental', corpus: undefined, filter: undefined, jobs: 4, out: undefined, exec: 'cli', via: 'commands', detEvery: 10, semantic: true, format: true, render: true, hard: 'error', strict: false, minimize: false };

export function planWalks(files, options) {
  const order = rng(options.seed).shuffle(files);
  const modes = options.modes.split(',').map((mode) => mode.trim()).filter(Boolean);
  return Array.from({ length: options.walks }, (unused, walkIndex) => {
    const model = order[walkIndex % order.length];
    const mode = modes[(walkIndex + Math.floor(walkIndex / order.length)) % modes.length];
    const seed = seedOf(options.seed, walkIndex);
    return { model, mode, seed, dir: `${basename(model, '.bpmn')}-s${seed}-${mode}` };
  });
}

function walkArgs(walk, options, dir) {
  return [join(HERE, 'walk.mjs'), walk.model, '--seed', String(walk.seed), '--mode', walk.mode, '--steps', String(options.steps), '--out', dir,
    '--exec', options.exec, '--via', options.via, '--det-every', String(options.detEvery), '--hard', options.hard, ...(options.semantic ? [] : ['--no-semantic']), ...(options.format ? [] : ['--no-format']), ...(options.render ? [] : ['--no-render'])];
}

function runOne(walk, options, dir) {
  return new Promise((done) => {
    const child = spawn(process.execPath, walkArgs(walk, options, dir), { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.stdout.resume();
    child.on('close', (code) => {
      const file = join(dir, 'summary.json');
      done(existsSync(file) ? { ...JSON.parse(readFileSync(file, 'utf8')), dir } : { model: basename(walk.model), seed: walk.seed, mode: walk.mode, dir, crashed: `walk exited ${code}: ${err.slice(0, 500)}`, violations: [], errors: 1, warnings: 0, steps: 0, ok: 0, refused: {}, modes: {} });
    });
  });
}

async function pool(walks, options, root) {
  const results = [];
  let next = 0, finished = 0;
  const worker = async () => {
    while (next < walks.length) {
      const walk = walks[next++];
      const walkSummary = await runOne(walk, options, join(root, 'walks', walk.dir));
      results.push(walkSummary);
      finished++;
      const flag = walkSummary.errors ? ` ERRORS ${walkSummary.errors}` : walkSummary.warnings ? ` warnings ${walkSummary.warnings}` : '';
      process.stderr.write(`[${finished}/${walks.length}] ${walk.dir}: ${walkSummary.ok}/${walkSummary.steps} ok${flag}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.jobs) }, worker));
  return results.sort((left, right) => left.dir.localeCompare(right.dir));
}

const add = (into, from) => { for (const [key, count] of Object.entries(from ?? {})) into[key] = (into[key] ?? 0) + count; return into; };

export function aggregate(results) {
  const agg = { walks: results.length, steps: 0, ok: 0, refused: {}, modes: {}, errors: 0, warnings: 0, byKind: {}, crashedWalks: [] };
  for (const walkSummary of results) {
    agg.steps += walkSummary.steps; agg.ok += walkSummary.ok; agg.errors += walkSummary.errors; agg.warnings += walkSummary.warnings;
    add(agg.refused, walkSummary.refused); add(agg.modes, walkSummary.modes);
    if (walkSummary.crashed) agg.crashedWalks.push(`${walkSummary.dir}: ${walkSummary.crashed}`);
    for (const violation of walkSummary.violations) {
      const kindStats = (agg.byKind[violation.kind] ??= { severity: violation.severity, n: 0, walks: new Set(), examples: [] });
      kindStats.n++;
      kindStats.walks.add(walkSummary.dir);
      if (kindStats.examples.length < 3) kindStats.examples.push(`${basename(walkSummary.dir)}#${violation.step} ${violation.op}: ${String(violation.detail ?? '').slice(0, 160)}`);
    }
  }
  for (const kindStats of Object.values(agg.byKind)) kindStats.walks = [...kindStats.walks];
  return agg;
}

function report(agg, metrics) {
  const lines = [];
  const fmt = (counts) => Object.entries(counts).sort((left, right) => right[1] - left[1]).map(([key, count]) => `${key} ${count}`).join(', ') || '-';
  lines.push(`FUZZ walks ${agg.walks}  steps ${agg.steps}  ok ${agg.ok}  refused ${agg.steps - agg.ok} (${fmt(agg.refused)})`);
  lines.push(`layout modes: ${fmt(agg.modes)}`);
  lines.push(`hard kinds: ${metrics.hard.join(' ')}${metrics.newKinds.length ? `   (kinds new since the audit: ${metrics.newKinds.join(' ')})` : ''}`);
  for (const sev of ['error', 'warn']) {
    const kinds = Object.entries(agg.byKind).filter(([, kindStats]) => kindStats.severity === sev).sort((left, right) => right[1].n - left[1].n);
    lines.push(`${sev === 'error' ? 'ERRORS' : 'warnings'} ${sev === 'error' ? agg.errors : agg.warnings}`);
    for (const [kind, kindStats] of kinds) {
      lines.push(`  ${kind.padEnd(24)} ${String(kindStats.n).padStart(4)} in ${kindStats.walks.length} walk(s)`);
      for (const example of kindStats.examples) lines.push(`      ${example}`);
    }
  }
  for (const crash of agg.crashedWalks) lines.push(`walk crashed: ${crash}`);
  return lines.join('\n');
}

async function minimizeAll(agg, results) {
  for (const [kind, kindStats] of Object.entries(agg.byKind)) {
    if (kindStats.severity !== 'error') continue;
    const walk = results.find((walkSummary) => walkSummary.dir === kindStats.walks[0]);
    process.stderr.write(`minimising ${kind} from ${basename(walk.dir)} ...\n`);
    const minimized = await minimizeWalk(walk.dir, { kind: `^${kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` });
    console.log(minimized.reproduced ? `  ${kind}: ${minimized.length} step(s), ${minimized.tests} tests -> ${minimized.script}` : `  ${kind}: not reproduced on replay`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), SPEC);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const dirs = options.corpus ? options.corpus.split(/[:,]/).filter(Boolean) : defaultCorpus();
  const files = corpusFiles(dirs, options.filter);
  if (!files.length) { console.error('no .bpmn files in the corpus'); process.exit(2); }
  const root = resolve(options.out ?? join(ROOT, 'tools', 'fuzz', 'out', 'latest'));
  rmSync(join(root, 'walks'), { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const metrics = await loadMetrics();
  const walks = planWalks(files, options);
  console.log(`fuzz: ${walks.length} walk(s) x ${options.steps} steps on ${files.length} model(s), exec ${options.exec}${options.exec === 'cli' ? `/${options.via}` : ''}, seed ${options.seed} -> ${root}`);
  const t0 = Date.now();
  const results = await pool(walks, options, root);
  const agg = aggregate(results);
  writeFileSync(join(root, 'report.json'), JSON.stringify({ options: { ...options, _: undefined }, corpusFiles: files.length, hard: metrics.hard, ...agg, seconds: Math.round((Date.now() - t0) / 1000) }, null, 1));
  console.log(report(agg, metrics));
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s; details in ${join(root, 'report.json')})`);
  if (options.minimize && agg.errors) await minimizeAll(agg, results);
  process.exit(agg.errors || (options.strict && agg.warnings) ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
