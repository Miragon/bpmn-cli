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
 *  - Edits E1-E9 (gen-edits.mjs) through `apply` (bpmn-cli) or `edit` (PR
 *    tool; E8 / E9 are bpmn-cli batches only); a bpmn-cli run refused with
 *    E_IMPORT_LOSSY / E_VALIDATION is repeated with --force as a separate
 *    record (variant `force`). E7 runs the applicable edits E1-E6 of a model
 *    one invocation after the other.
 *  - Global: every global variant of the arm (layout, tidy / the
 *    PR's layout and tidy modes) on the unedited model.
 *  - Per record (JSONL, <out>/<track>-<arm key>.jsonl): exit, steps, ms,
 *    semantic check, stability (all flow nodes and without the intentionally
 *    moved ones), before / after / delta of the metrics library's counts and
 *    score (every kind the library knows, so new kinds appear without changes
 *    here), the PR tool's score when BPMN_EDIT_MAIN is set, hard defects added
 *    (lib/measure.mjs hardDelta), crossings and backward flows added
 *    (softDelta) and validity of the written file.
 *  - Results go to --out (default tools/bench/results/latest, git-ignored),
 *    with meta.json (arms, corpora sizes, metric kinds, hard kinds) and work
 *    files under work/ for tools/bench/render.sh. Each run starts the result
 *    files of its arms afresh; with --resume, records already present are kept
 *    and skipped (for long runs that were interrupted).
 *  - --compare <dir>: after the run (or with --no-run on the existing --out),
 *    prints per-edit deltas against <dir> (lib/compare.mjs) and exits 1 when
 *    hard defects or semantic failures increased, or when the runs of E8 / E9
 *    adding crossings or backward flows exceed tools/bench/soft-budget.json.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_ENV, parseArgs } from '../fuzz/lib/setup.mjs';
import { ALL_EDITS } from './gen-edits.mjs';
import { defaultArmNames, FORCEABLE, resolveArms } from './lib/arms.mjs';
import { compareResults, formatComparison } from './lib/compare.mjs';
import { resolveCorpora, writeSpecs } from './lib/corpus.mjs';
import { checkEdit, hardDelta, quality, readModel, softDelta, stability, validity } from './lib/measure.mjs';
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
    const child = spawn(process.execPath, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: CLI_ENV });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('close', (code, signal) => { clearTimeout(timer); done({ exit: code ?? (signal ? 124 : 1), ms: Number(process.hrtime.bigint() - t0) / 1e6, stdout, stderr }); });
  });
}

const resultFile = (out, track, arm) => join(out, `${track}-${arm.key}.jsonl`);
const readJsonl = (jsonlPath) => (existsSync(jsonlPath) ? readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

/** Keys already recorded; a primary record that asked for a --force rerun without one counts as not done. */
function doneKeys(file) {
  const recs = readJsonl(file);
  const keys = new Set(recs.filter((record) => !record.crash).map((record) => record.key));
  for (const record of recs) {
    const wantsForce = record.variant === 'primary' && (record.steps || []).some((stepRun) => FORCEABLE.has(stepRun.error?.code));
    if (wantsForce && !keys.has(record.key.replace(/\/primary$/, '/force'))) keys.delete(record.key);
  }
  return keys;
}

function dropKeys(file, keys) {
  if (!existsSync(file)) return;
  const kept = readFileSync(file, 'utf8').split('\n').filter(Boolean).filter((line) => !keys.has(JSON.parse(line).key));
  writeFileSync(file, kept.map((line) => `${line}\n`).join(''));
}

/* ------------------------------------------------------------------ */
/* measurement                                                          */
/* ------------------------------------------------------------------ */

const strip = (outcome) => ({ harness: outcome.harness, pr: outcome.pr });
const deltaOf = (before, after) => ({
  harness: after.harness.score === null || before.harness.score === null ? null : after.harness.score - before.harness.score,
  pr: after.pr.score === undefined || before.pr.score === undefined ? null : +(after.pr.score - before.pr.score).toFixed(2),
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
    try { model = await readModel(xml); } catch (readError) { return { error: `unreadable result: ${String(readError.message).split('\n')[0]}` }; }
    const after = await quality(xml, ctx);
    return {
      model,
      stability: stability(base.model, model),
      stabilityOthers: stability(base.model, model, exclude),
      before: strip(base.quality), after: strip(after), delta: deltaOf(base.quality, after),
      hard: hardDelta(base.quality, after, ctx),
      soft: softDelta(base.quality, after, ctx),
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
    const execution = await exec(arm.edit(file, ops, force), dir);
    const rec = { edit: step, exit: execution.exit, ms: Math.round(execution.ms), ...arm.info(execution.stdout) };
    if (execution.exit !== 0) rec.error = arm.error(execution.stderr);
    records.push(rec);
  }
  return { file, steps: records };
}

async function editCase(env, spec, edit, force) {
  const steps = edit === 'E7' ? spec.edits.E7.steps : [edit];
  const run = await runSteps(env, spec, edit, steps, force);
  const exclude = new Set(steps.flatMap((stepName) => spec.edits[stepName].touched || []));
  const { model, ...measured } = await env.measure(spec.file, run.file, exclude);
  const semantic = {};
  if (model) for (const stepName of steps) semantic[stepName] = checkEdit(spec.edits[stepName].expect, model);
  return {
    key: `${spec.corpus}/${spec.model}/${edit}/${force ? 'force' : 'primary'}`,
    track: 'edits', corpus: spec.corpus, model: spec.model, edit, arm: env.arm.key, variant: force ? 'force' : 'primary',
    target: edit === 'E7' ? steps : spec.edits[edit].target,
    ok: run.steps.every((stepRun) => stepRun.exit === 0), steps: run.steps, ms: run.steps.reduce((total, stepRun) => total + stepRun.ms, 0),
    semantic, semanticOk: Object.values(semantic).length === steps.length && Object.values(semantic).every((check) => check.ok),
    ...measured,
  };
}

function editJobs(env, spec, done) {
  // E8 / E9 have no PR tool ops: bpmn-cli arms only
  const runs = (edit) => spec.edits[edit]?.applicable && (env.arm.kind !== 'pr' || !!spec.edits[edit].pr);
  return ALL_EDITS.filter((edit) => runs(edit) && !done.has(`${spec.corpus}/${spec.model}/${edit}/primary`)).map((edit) => ({
    key: `${spec.corpus}/${spec.model}/${edit}/primary`,
    run: async () => {
      const primary = await editCase(env, spec, edit, false);
      const needForce = env.arm.forceable && primary.steps.some((stepRun) => FORCEABLE.has(stepRun.error?.code));
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
      const execution = await exec(cmd(file), dir);
      const { model: _model, ...measured } = await env.measure(spec.file, file, new Set());
      return [{
        key: `${spec.corpus}/${spec.model}/global/${variant}`, track: 'global', corpus: spec.corpus, model: spec.model, edit: 'global',
        arm: arm.key, variant, ok: execution.exit === 0, exit: execution.exit, ms: Math.round(execution.ms), ...arm.info(execution.stdout),
        ...(execution.exit !== 0 ? { error: arm.error(execution.stderr) } : {}), ...measured,
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
      try { recs = await job.run(); } catch (error) {
        const [corpus, model, edit, variant] = job.key.split('/');
        recs = [{ key: job.key, track, corpus, model, edit, arm: env.arm.key, variant, ok: false, crash: String(error.stack || error).slice(0, 500) }];
      }
      for (const record of recs) appendFileSync(file, `${JSON.stringify(record)}\n`);
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
  const modelPath = '<work>/model.bpmn', ops = '<work>/ops-E1.json';
  for (const arm of arms) {
    console.log(`[${arm.key}] ${arm.path}`);
    console.log(`  edit:  node ${arm.edit(modelPath, ops, false).join(' ')}`);
    if (arm.forceable) console.log(`  force: node ${arm.edit(modelPath, ops, true).join(' ')}`);
    for (const [variant, cmd] of Object.entries(arm.global)) console.log(`  global ${variant}: node ${cmd(modelPath).join(' ')}`);
  }
}

async function runArm(arm, specs, options, ctx) {
  const env = { arm, out: options.out, measure: measurer(ctx) };
  for (const track of options.track === 'all' ? ['edits', 'global'] : [options.track]) {
    const file = resultFile(options.out, track, arm);
    if (!options.resume) rmSync(file, { force: true });
    const done = doneKeys(file);
    const jobs = specs.flatMap((spec) => (track === 'edits' ? editJobs(env, spec, done) : globalJobs(env, spec, done)));
    dropKeys(file, new Set(jobs.flatMap((queuedJob) => [queuedJob.key, queuedJob.key.replace(/\/primary$/, '/force')])));
    console.log(`[${track}/${arm.key}] ${jobs.length} job(s), ${done.size} record(s) already present`);
    await pool(jobs, env, track, options.jobs);
  }
}

function writeMeta(options, arms, corpora, metrics, pr) {
  const meta = {
    created: new Date().toISOString(), node: process.version, layout: options.layout,
    arms: Object.fromEntries(arms.map((benchArm) => [benchArm.key, { name: benchArm.name, kind: benchArm.kind, features: benchArm.features }])),
    corpora: Object.fromEntries(corpora.map((corpus) => [corpus.name, corpus.files.length])),
    metricKeys: metrics.keys, weights: metrics.weights, hardKinds: metrics.hard, newKinds: metrics.newKinds, prScore: !!pr,
  };
  writeFileSync(join(options.out, 'meta.json'), JSON.stringify(meta, null, 1));
}

async function bench(options) {
  const arms = resolveArms(options.arms ? options.arms.split(',') : defaultArmNames(), { layout: options.layout });
  if (options.print) return printCommands(arms);
  mkdirSync(options.out, { recursive: true });
  const metrics = await loadMetrics();
  const pr = await loadPrMetrics();
  const refBin = process.env.BASELINE_BIN ?? join(ROOT, 'bin', 'bpmn.js');
  const only = options.corpus?.split(',').filter(Boolean);
  const corpora = resolveCorpora({ only, engine: options.engine || !!only?.includes('engine'), out: options.out, refBin });
  const specs = (await writeSpecs(corpora, options.out, options.filter)).filter((spec) => !spec.unreadable);
  writeMeta(options, arms, corpora, metrics, pr);
  console.log(`bench: ${specs.length} model(s) in ${corpora.map((corpus) => `${corpus.name} (${corpus.files.length})`).join(', ')}; arms ${arms.map((benchArm) => benchArm.key).join(', ')}; hard kinds ${metrics.hard.join(' ')} -> ${options.out}`);
  for (const arm of arms) await runArm(arm, specs, options, { metrics, pr });
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), SPEC);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  options.out = resolve(options.out ?? join(ROOT, 'tools', 'bench', 'results', 'latest'));
  if (options.compare && resolve(options.compare) === options.out) {
    console.error('--compare needs another results directory than --out');
    process.exit(2);
  }
  if (options.run) await bench(options);
  if (!options.compare) return;
  const cmp = compareResults(resolve(options.compare), options.out);
  console.log(formatComparison(cmp));
  process.exit(cmp.regressed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
