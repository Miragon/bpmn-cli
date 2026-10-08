#!/usr/bin/env node
/**
 * Fuzz campaign: many seeded random walks in parallel, aggregated.
 *
 *   node tools/fuzz/run.mjs [--walks 24] [--steps 30] [--seed 1] [--modes auto,incremental]
 *        [--corpus dir[:dir...]] [--filter text] [--jobs 4] [--out dir] [--exec cli|lib]
 *        [--via commands|apply] [--det-every 10] [--no-semantic] [--no-format]
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
const SPEC = { walks: 24, steps: 30, seed: 1, modes: 'auto,incremental', corpus: undefined, filter: undefined, jobs: 4, out: undefined, exec: 'cli', via: 'commands', detEvery: 10, semantic: true, format: true, hard: 'error', strict: false, minimize: false };

export function planWalks(files, o) {
  const order = rng(o.seed).shuffle(files);
  const modes = o.modes.split(',').map((m) => m.trim()).filter(Boolean);
  return Array.from({ length: o.walks }, (_, i) => {
    const model = order[i % order.length];
    const mode = modes[(i + Math.floor(i / order.length)) % modes.length];
    const seed = seedOf(o.seed, i);
    return { model, mode, seed, dir: `${basename(model, '.bpmn')}-s${seed}-${mode}` };
  });
}

function walkArgs(w, o, dir) {
  return [join(HERE, 'walk.mjs'), w.model, '--seed', String(w.seed), '--mode', w.mode, '--steps', String(o.steps), '--out', dir,
    '--exec', o.exec, '--via', o.via, '--det-every', String(o.detEvery), '--hard', o.hard, ...(o.semantic ? [] : ['--no-semantic']), ...(o.format ? [] : ['--no-format'])];
}

function runOne(w, o, dir) {
  return new Promise((done) => {
    const child = spawn(process.execPath, walkArgs(w, o, dir), { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.resume();
    child.on('close', (code) => {
      const file = join(dir, 'summary.json');
      done(existsSync(file) ? { ...JSON.parse(readFileSync(file, 'utf8')), dir } : { model: basename(w.model), seed: w.seed, mode: w.mode, dir, crashed: `walk exited ${code}: ${err.slice(0, 500)}`, violations: [], errors: 1, warnings: 0, steps: 0, ok: 0, refused: {}, modes: {} });
    });
  });
}

async function pool(walks, o, root) {
  const results = [];
  let next = 0, finished = 0;
  const worker = async () => {
    while (next < walks.length) {
      const w = walks[next++];
      const s = await runOne(w, o, join(root, 'walks', w.dir));
      results.push(s);
      finished++;
      const flag = s.errors ? ` ERRORS ${s.errors}` : s.warnings ? ` warnings ${s.warnings}` : '';
      process.stderr.write(`[${finished}/${walks.length}] ${w.dir}: ${s.ok}/${s.steps} ok${flag}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.jobs) }, worker));
  return results.sort((a, b) => a.dir.localeCompare(b.dir));
}

const add = (into, from) => { for (const [k, v] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + v; return into; };

export function aggregate(results) {
  const agg = { walks: results.length, steps: 0, ok: 0, refused: {}, modes: {}, errors: 0, warnings: 0, byKind: {}, crashedWalks: [] };
  for (const s of results) {
    agg.steps += s.steps; agg.ok += s.ok; agg.errors += s.errors; agg.warnings += s.warnings;
    add(agg.refused, s.refused); add(agg.modes, s.modes);
    if (s.crashed) agg.crashedWalks.push(`${s.dir}: ${s.crashed}`);
    for (const v of s.violations) {
      const k = (agg.byKind[v.kind] ??= { severity: v.severity, n: 0, walks: new Set(), examples: [] });
      k.n++;
      k.walks.add(s.dir);
      if (k.examples.length < 3) k.examples.push(`${basename(s.dir)}#${v.step} ${v.op}: ${String(v.detail ?? '').slice(0, 160)}`);
    }
  }
  for (const k of Object.values(agg.byKind)) k.walks = [...k.walks];
  return agg;
}

function report(agg, metrics) {
  const lines = [];
  const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
  lines.push(`FUZZ walks ${agg.walks}  steps ${agg.steps}  ok ${agg.ok}  refused ${agg.steps - agg.ok} (${fmt(agg.refused)})`);
  lines.push(`layout modes: ${fmt(agg.modes)}`);
  lines.push(`hard kinds: ${metrics.hard.join(' ')}${metrics.newKinds.length ? `   (kinds new since the audit: ${metrics.newKinds.join(' ')})` : ''}`);
  for (const sev of ['error', 'warn']) {
    const kinds = Object.entries(agg.byKind).filter(([, k]) => k.severity === sev).sort((a, b) => b[1].n - a[1].n);
    lines.push(`${sev === 'error' ? 'ERRORS' : 'warnings'} ${sev === 'error' ? agg.errors : agg.warnings}`);
    for (const [kind, k] of kinds) {
      lines.push(`  ${kind.padEnd(24)} ${String(k.n).padStart(4)} in ${k.walks.length} walk(s)`);
      for (const e of k.examples) lines.push(`      ${e}`);
    }
  }
  for (const c of agg.crashedWalks) lines.push(`walk crashed: ${c}`);
  return lines.join('\n');
}

async function minimizeAll(agg, results) {
  for (const [kind, k] of Object.entries(agg.byKind)) {
    if (k.severity !== 'error') continue;
    const walk = results.find((s) => s.dir === k.walks[0]);
    process.stderr.write(`minimising ${kind} from ${basename(walk.dir)} ...\n`);
    const m = await minimizeWalk(walk.dir, { kind: `^${kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` });
    console.log(m.reproduced ? `  ${kind}: ${m.length} step(s), ${m.tests} tests -> ${m.script}` : `  ${kind}: not reproduced on replay`);
  }
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2), SPEC);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const dirs = o.corpus ? o.corpus.split(/[:,]/).filter(Boolean) : defaultCorpus();
  const files = corpusFiles(dirs, o.filter);
  if (!files.length) { console.error('no .bpmn files in the corpus'); process.exit(2); }
  const root = resolve(o.out ?? join(ROOT, 'tools', 'fuzz', 'out', 'latest'));
  rmSync(join(root, 'walks'), { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const metrics = await loadMetrics();
  const walks = planWalks(files, o);
  console.log(`fuzz: ${walks.length} walk(s) x ${o.steps} steps on ${files.length} model(s), exec ${o.exec}${o.exec === 'cli' ? `/${o.via}` : ''}, seed ${o.seed} -> ${root}`);
  const t0 = Date.now();
  const results = await pool(walks, o, root);
  const agg = aggregate(results);
  writeFileSync(join(root, 'report.json'), JSON.stringify({ options: { ...o, _: undefined }, corpusFiles: files.length, hard: metrics.hard, ...agg, seconds: Math.round((Date.now() - t0) / 1000) }, null, 1));
  console.log(report(agg, metrics));
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s; details in ${join(root, 'report.json')})`);
  if (o.minimize && agg.errors) await minimizeAll(agg, results);
  process.exit(agg.errors || (o.strict && agg.warnings) ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
