#!/usr/bin/env node
/**
 * Edit benchmark: applies generated edits (track `edits`) or a global layout
 * (track `global`) to every model of the corpora with every arm, and records
 * per run how stable, how clean and how valid the written file is.
 *
 *   npm run build
 *   node tools/bench/run.mjs [--arms new,baseline,pr] [--layout auto|incremental|full]
 *        [--track edits|global|all] [--corpus scenarios,engine,<name>...] [--engine]
 *        [--filter text] [--jobs 4] [--out dir] [--resume]
 *   node tools/bench/run.mjs --compare <old-results-dir> [--out dir] [--no-run]
 *   node tools/bench/run.mjs --print            # the commands of each arm, runs nothing
 *
 * Contract
 *  - Arms (lib/arms.mjs): new = this repository's bin/bpmn.js; baseline = env
 *    BASELINE_BIN; pr = env BPMN_EDIT_MAIN (PR #218 tool). Default: new plus
 *    the ones whose variable is set.
 *  - Corpora (lib/corpus.mjs): tools/scenarios, every directory in env
 *    BPMN_BENCH_CORPUS, and with --engine the scenarios redrawn by the
 *    reference CLI (BASELINE_BIN when set, else this CLI).
 *  - Edits E1-E7 (gen-edits.mjs) through `apply` (bpmn-cli) or `edit` (PR
 *    tool); a bpmn-cli run refused with E_IMPORT_LOSSY / E_VALIDATION is
 *    repeated with --force as a separate record (variant `force`). E7 runs the
 *    applicable edits of a model one invocation after the other.
 *  - Global: every global variant of the arm (layout, tidy, engine-auto / the
 *    PR's layout and tidy modes) on the unedited model.
 *  - Per record (JSONL, <out>/<track>-<arm key>.jsonl): exit, steps, ms,
 *    semantic check, stability (all flow nodes and without the intentionally
 *    moved ones), before / after / delta of the metrics library's counts and
 *    score (every kind the library knows, so new kinds appear without changes
 *    here), the PR tool's score when BPMN_EDIT_MAIN is set, hard defects added
 *    (lib/measure.mjs hardDelta) and validity of the written file.
 *  - Results go to --out (default tools/bench/results/latest, git-ignored),
 *    with meta.json (arms, corpora sizes, metric kinds, hard kinds) and work
 *    files under work/ for tools/bench/render.sh. Each run starts the result
 *    files of its arms afresh; with --resume, records already present are kept
 *    and skipped (for long runs that were interrupted).
 *  - --compare <dir>: after the run (or with --no-run on the existing --out),
 *    prints per-edit deltas against <dir> (lib/compare.mjs) and exits 1 when
 *    hard defects or semantic failures increased.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../fuzz/lib/setup.mjs';
import { ALL_EDITS } from './gen-edits.mjs';
import { defaultArmNames, FORCEABLE, resolveArms } from './lib/arms.mjs';
import { compareResults, formatComparison } from './lib/compare.mjs';
import { resolveCorpora, writeSpecs } from './lib/corpus.mjs';
import { checkEdit, hardDelta, quality, readModel, stability, validity } from './lib/measure.mjs';
import { loadMetrics, ROOT } from './lib/metrics.mjs';
import { loadPrMetrics } from './lib/pr-metrics.mjs';

const TIMEOUT_MS = 120_000;
const SPEC = { arms: undefined, layout: 'auto', track: 'all', corpus: undefined, engine: false, filter: undefined, jobs: 4, out: undefined, resume: false, compare: undefined, run: true, print: false };

/* ------------------------------------------------------------------ */
/* processes and result files                                           */
/* ------------------------------------------------------------------ */

function exec(argv, cwd) {
  return new Promise((done) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(process.execPath, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('close', (code, signal) => { clearTimeout(timer); done({ exit: code ?? (signal ? 124 : 1), ms: Number(process.hrtime.bigint() - t0) / 1e6, stdout, stderr }); });
  });
}

const resultFile = (out, track, arm) => join(out, `${track}-${arm.key}.jsonl`);
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** Keys already recorded; a primary record that asked for a --force rerun without one counts as not done. */
function doneKeys(file) {
  const recs = readJsonl(file);
  const keys = new Set(recs.filter((r) => !r.crash).map((r) => r.key));
  for (const r of recs) {
    const wantsForce = r.variant === 'primary' && (r.steps || []).some((s) => FORCEABLE.has(s.error?.code));
    if (wantsForce && !keys.has(r.key.replace(/\/primary$/, '/force'))) keys.delete(r.key);
  }
  return keys;
}

function dropKeys(file, keys) {
  if (!existsSync(file)) return;
  const kept = readFileSync(file, 'utf8').split('\n').filter(Boolean).filter((l) => !keys.has(JSON.parse(l).key));
  writeFileSync(file, kept.map((l) => `${l}\n`).join(''));
}

/* ------------------------------------------------------------------ */
/* measurement                                                          */
/* ------------------------------------------------------------------ */

const strip = (q) => ({ harness: q.harness, pr: q.pr });
const deltaOf = (b, a) => ({
  harness: a.harness.score === null || b.harness.score === null ? null : a.harness.score - b.harness.score,
  pr: a.pr.score === undefined || b.pr.score === undefined ? null : +(a.pr.score - b.pr.score).toFixed(2),
});

function measurer(ctx) {
  const cache = new Map();
  const baseline = async (src) => {
    if (!cache.has(src)) {
      const xml = readFileSync(src, 'utf8');
      cache.set(src, { model: await readModel(xml), quality: await quality(xml, ctx) });
    }
    return cache.get(src);
  };
  return async (src, file, exclude) => {
    const base = await baseline(src);
    const xml = readFileSync(file, 'utf8');
    let model;
    try { model = await readModel(xml); } catch (e) { return { error: `unreadable result: ${String(e.message).split('\n')[0]}` }; }
    const after = await quality(xml, ctx);
    return {
      model,
      stability: stability(base.model, model),
      stabilityOthers: stability(base.model, model, exclude),
      before: strip(base.quality), after: strip(after), delta: deltaOf(base.quality, after),
      hard: hardDelta(base.quality, after, ctx, new Set([...base.model.groups, ...model.groups])),
      validity: validity(model),
    };
  };
}

/* ------------------------------------------------------------------ */
/* jobs                                                                 */
/* ------------------------------------------------------------------ */

function workDir(out, track, arm, spec, name) {
  const dir = join(out, 'work', track, arm.key, spec.corpus, spec.model, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function runSteps(env, spec, edit, steps, force) {
  const { arm, out } = env;
  const dir = workDir(out, 'edits', arm, spec, force ? `${edit}-force` : edit);
  const file = join(dir, 'model.bpmn');
  copyFileSync(spec.file, file);
  const records = [];
  for (const step of steps) {
    const ops = join(dir, `ops-${step}.json`);
    writeFileSync(ops, JSON.stringify(arm.kind === 'pr' ? spec.edits[step].pr : spec.edits[step].cli, null, 1));
    const r = await exec(arm.edit(file, ops, force), dir);
    const rec = { edit: step, exit: r.exit, ms: Math.round(r.ms), ...arm.info(r.stdout) };
    if (r.exit !== 0) rec.error = arm.error(r.stderr);
    records.push(rec);
  }
  return { file, steps: records };
}

async function editCase(env, spec, edit, force) {
  const steps = edit === 'E7' ? spec.edits.E7.steps : [edit];
  const run = await runSteps(env, spec, edit, steps, force);
  const exclude = new Set(steps.flatMap((s) => spec.edits[s].touched || []));
  const { model, ...measured } = await env.measure(spec.file, run.file, exclude);
  const semantic = {};
  if (model) for (const s of steps) semantic[s] = checkEdit(spec.edits[s].expect, model);
  return {
    key: `${spec.corpus}/${spec.model}/${edit}/${force ? 'force' : 'primary'}`,
    track: 'edits', corpus: spec.corpus, model: spec.model, edit, arm: env.arm.key, variant: force ? 'force' : 'primary',
    target: edit === 'E7' ? steps : spec.edits[edit].target,
    ok: run.steps.every((s) => s.exit === 0), steps: run.steps, ms: run.steps.reduce((a, s) => a + s.ms, 0),
    semantic, semanticOk: Object.values(semantic).length === steps.length && Object.values(semantic).every((c) => c.ok),
    ...measured,
  };
}

function editJobs(env, spec, done) {
  return ALL_EDITS.filter((edit) => spec.edits[edit]?.applicable && !done.has(`${spec.corpus}/${spec.model}/${edit}/primary`)).map((edit) => ({
    key: `${spec.corpus}/${spec.model}/${edit}/primary`,
    run: async () => {
      const primary = await editCase(env, spec, edit, false);
      const needForce = env.arm.forceable && primary.steps.some((s) => FORCEABLE.has(s.error?.code));
      return needForce ? [primary, await editCase(env, spec, edit, true)] : [primary];
    },
  }));
}

function globalJobs(env, spec, done) {
  const { arm, out } = env;
  return Object.entries(arm.global).filter(([variant]) => !done.has(`${spec.corpus}/${spec.model}/global/${variant}`)).map(([variant, cmd]) => ({
    key: `${spec.corpus}/${spec.model}/global/${variant}`,
    run: async () => {
      const dir = workDir(out, 'global', arm, spec, variant);
      const file = join(dir, 'model.bpmn');
      copyFileSync(spec.file, file);
      const r = await exec(cmd(file), dir);
      const { model: _model, ...measured } = await env.measure(spec.file, file, new Set());
      return [{
        key: `${spec.corpus}/${spec.model}/global/${variant}`, track: 'global', corpus: spec.corpus, model: spec.model, edit: 'global',
        arm: arm.key, variant, ok: r.exit === 0, exit: r.exit, ms: Math.round(r.ms), ...arm.info(r.stdout),
        ...(r.exit !== 0 ? { error: arm.error(r.stderr) } : {}), ...measured,
      }];
    },
  }));
}

async function pool(jobs, env, track, jobsN) {
  const file = resultFile(env.out, track, env.arm);
  let next = 0, finished = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      let recs;
      try { recs = await job.run(); } catch (e) {
        const [corpus, model, edit, variant] = job.key.split('/');
        recs = [{ key: job.key, track, corpus, model, edit, arm: env.arm.key, variant, ok: false, crash: String(e.stack || e).slice(0, 500) }];
      }
      for (const r of recs) appendFileSync(file, `${JSON.stringify(r)}\n`);
      finished++;
      if (finished % 50 === 0 || finished === jobs.length) console.log(`[${track}/${env.arm.key}] ${finished}/${jobs.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, jobsN) }, worker));
}

/* ------------------------------------------------------------------ */
/* main                                                                 */
/* ------------------------------------------------------------------ */

function printCommands(arms) {
  const f = '<work>/model.bpmn', ops = '<work>/ops-E1.json';
  for (const arm of arms) {
    console.log(`[${arm.key}] ${arm.path}`);
    console.log(`  edit:  node ${arm.edit(f, ops, false).join(' ')}`);
    if (arm.forceable) console.log(`  force: node ${arm.edit(f, ops, true).join(' ')}`);
    for (const [variant, cmd] of Object.entries(arm.global)) console.log(`  global ${variant}: node ${cmd(f).join(' ')}`);
  }
}

async function runArm(arm, specs, o, ctx) {
  const env = { arm, out: o.out, measure: measurer(ctx) };
  for (const track of o.track === 'all' ? ['edits', 'global'] : [o.track]) {
    const file = resultFile(o.out, track, arm);
    if (!o.resume) rmSync(file, { force: true });
    const done = doneKeys(file);
    const jobs = specs.flatMap((s) => (track === 'edits' ? editJobs(env, s, done) : globalJobs(env, s, done)));
    dropKeys(file, new Set(jobs.flatMap((j) => [j.key, j.key.replace(/\/primary$/, '/force')])));
    console.log(`[${track}/${arm.key}] ${jobs.length} job(s), ${done.size} record(s) already present`);
    await pool(jobs, env, track, o.jobs);
  }
}

function writeMeta(o, arms, corpora, metrics, pr) {
  const meta = {
    created: new Date().toISOString(), node: process.version, layout: o.layout,
    arms: Object.fromEntries(arms.map((a) => [a.key, { name: a.name, kind: a.kind, features: a.features }])),
    corpora: Object.fromEntries(corpora.map((c) => [c.name, c.files.length])),
    metricKeys: metrics.keys, weights: metrics.weights, hardKinds: metrics.hard, newKinds: metrics.newKinds, prScore: !!pr,
  };
  writeFileSync(join(o.out, 'meta.json'), JSON.stringify(meta, null, 1));
}

async function bench(o) {
  const arms = resolveArms(o.arms ? o.arms.split(',') : defaultArmNames(), { layout: o.layout });
  if (o.print) return printCommands(arms);
  mkdirSync(o.out, { recursive: true });
  const metrics = await loadMetrics();
  const pr = await loadPrMetrics();
  const refBin = process.env.BASELINE_BIN ?? join(ROOT, 'bin', 'bpmn.js');
  const only = o.corpus?.split(',').filter(Boolean);
  const corpora = resolveCorpora({ only, engine: o.engine || !!only?.includes('engine'), out: o.out, refBin });
  const specs = (await writeSpecs(corpora, o.out, o.filter)).filter((s) => !s.unreadable);
  writeMeta(o, arms, corpora, metrics, pr);
  console.log(`bench: ${specs.length} model(s) in ${corpora.map((c) => `${c.name} (${c.files.length})`).join(', ')}; arms ${arms.map((a) => a.key).join(', ')}; hard kinds ${metrics.hard.join(' ')} -> ${o.out}`);
  for (const arm of arms) await runArm(arm, specs, o, { metrics, pr });
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2), SPEC);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  o.out = resolve(o.out ?? join(ROOT, 'tools', 'bench', 'results', 'latest'));
  if (o.compare && resolve(o.compare) === o.out) {
    console.error('--compare needs another results directory than --out');
    process.exit(2);
  }
  if (o.run) await bench(o);
  if (!o.compare) return;
  const cmp = compareResults(resolve(o.compare), o.out);
  console.log(formatComparison(cmp));
  process.exit(cmp.regressed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
