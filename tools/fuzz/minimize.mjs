#!/usr/bin/env node
/**
 * Reduces a failing walk to a short repro (delta debugging over its steps).
 *
 *   node tools/fuzz/minimize.mjs <walk-dir> [--kind regex] [--detail regex] [--out dir]
 *
 * Contract
 *  - Reads <walk-dir>/summary.json (model path, mode, seed, executor) and
 *    <walk-dir>/steps.json. The target is the first violation whose kind
 *    matches --kind (default: the first error-severity violation) and whose
 *    detail matches --detail.
 *  - Replays candidate step lists from the same start model with the walk's
 *    executor and keeps a candidate when it still shows a matching violation
 *    (ddmin; the list is cut after the triggering step each time). A step whose
 *    referenced element no longer exists is refused and has no effect.
 *  - Writes to --out (default <walk-dir>/min-<kind>/): start.bpmn, steps.json
 *    (the minimal list, replayable with walk.mjs --replay), op-NN.json for steps
 *    without an equivalent single command, run.sh (plain CLI calls; BPMN
 *    overrides the command; a refused call has no effect, as in the walk) and min.json
 *    (tests, length, the violation). Exit 0 = reproduced and written, 1 = the
 *    target did not reproduce on replay, 2 = bad arguments.
 * The start model is copied as it is: a repro of a private-corpus model
 * contains that model, so rebuild it synthetically before sharing it.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toArgv } from './lib/generate.mjs';
import { DEFAULT_BIN, loadMetrics, loadRender, makeExecutor, parseArgs, ROOT } from './lib/setup.mjs';
import { runWalk } from './lib/walk.mjs';

const SPEC = { kind: undefined, detail: undefined, out: undefined };

function matcher(summary, options) {
  const kindPattern = options.kind ? new RegExp(options.kind) : undefined;
  const detailPattern = options.detail ? new RegExp(options.detail) : undefined;
  const first = summary.violations.find((violation) => (kindPattern ? kindPattern.test(violation.kind) : violation.severity === 'error') && (!detailPattern || detailPattern.test(String(violation.detail))));
  const kind = kindPattern ?? (first ? new RegExp(`^${first.kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : undefined);
  return { first, hit: (violation) => kind.test(violation.kind) && (!detailPattern || detailPattern.test(String(violation.detail))) };
}

/** ddmin over `steps`; `test(list)` -> index of the triggering step or -1. */
async function ddmin(steps, test) {
  let tests = 0;
  const probe = async (list) => { tests++; return test(list); };
  let at = await probe(steps);
  if (at < 0) return { reproduced: false, tests };
  let cur = steps.slice(0, at + 1);
  let granularity = 2;
  while (cur.length >= 2) {
    const chunk = Math.ceil(cur.length / granularity);
    let reduced = false;
    for (let chunkStart = 0; chunkStart < cur.length && !reduced; chunkStart += chunk) {
      const cand = [...cur.slice(0, chunkStart), ...cur.slice(chunkStart + chunk)];
      if (!cand.length) continue;
      at = await probe(cand);
      if (at >= 0) { cur = cand.slice(0, at + 1); granularity = Math.max(granularity - 1, 2); reduced = true; }
    }
    if (!reduced) {
      if (granularity >= cur.length) break;
      granularity = Math.min(cur.length, granularity * 2);
    }
  }
  return { reproduced: true, tests, steps: cur };
}

const quote = (arg) => (/^[\w./:=,@%+-]+$/.test(arg) ? arg : `'${String(arg).replace(/'/g, `'\\''`)}'`);

function writeRepro(dir, model, steps, mode) {
  copyFileSync(model, join(dir, 'start.bpmn'));
  writeFileSync(join(dir, 'steps.json'), JSON.stringify(steps, null, 1));
  const bin = resolve(process.env.BPMN_BIN ?? DEFAULT_BIN);
  // relative to the repro when both live in this repository (out/ is git-ignored), else as given
  const binRef = dir.startsWith(`${ROOT}/`) && bin.startsWith(`${ROOT}/`) ? `$D/${relative(dir, bin)}` : bin;
  const layout = mode === 'auto' ? '' : ` --layout ${mode}`;
  const lines = ['#!/bin/sh', '# Minimised fuzz repro: replays the steps on a copy of start.bpmn, then prints the metrics.', 'D=$(cd "$(dirname "$0")" && pwd)',
    `BPMN=\${BPMN:-"node ${binRef}"}`, 'cp "$D/start.bpmn" "$D/work.bpmn"'];
  steps.forEach((step, stepIndex) => {
    if (stepIndex === steps.length - 1) lines.push('cp "$D/work.bpmn" "$D/before-last.bpmn"');
    lines.push(`# step ${stepIndex}: ${step.name}`);
    const argv = toArgv(step.ops);
    if (argv) lines.push(`$BPMN ${argv.map((arg) => (arg === '%F' ? '"$D/work.bpmn"' : quote(arg))).join(' ')}${layout}`);
    else {
      const opsFile = `op-${String(stepIndex).padStart(2, '0')}.json`;
      writeFileSync(join(dir, opsFile), JSON.stringify(step.ops, null, 1));
      lines.push(`$BPMN apply "$D/work.bpmn" "$D/${opsFile}"${layout}`);
    }
  });
  lines.push('$BPMN metrics "$D/work.bpmn"');
  lines.push('$BPMN render "$D/work.bpmn" --problems --tiles -o "$D/work.png"');
  writeFileSync(join(dir, 'run.sh'), `${lines.join('\n')}\n`, { mode: 0o755 });
  return join(dir, 'run.sh');
}

export async function minimizeWalk(walkDir, options = {}) {
  const summary = JSON.parse(readFileSync(join(walkDir, 'summary.json'), 'utf8'));
  const steps = JSON.parse(readFileSync(join(walkDir, 'steps.json'), 'utf8'));
  const { first, hit } = matcher(summary, options);
  if (!first) return { reproduced: false, tests: 0, reason: 'no matching violation in the walk' };
  const slug = first.kind.replace(/[^\w]+/g, '_');
  const out = resolve(options.out ?? join(walkDir, `min-${slug}`));
  mkdirSync(out, { recursive: true });
  const exec = await makeExecutor({ exec: summary.config.exec, via: summary.config.via, workDir: join(out, 'probe') });
  const metrics = await loadMetrics();
  // a render violation needs the render oracle on the replay
  const render = first.kind === 'render' ? await loadRender() : undefined;
  const xml = readFileSync(summary.modelPath, 'utf8');
  const detEvery = /nondeterministic/.test(first.kind) ? 1 : 0;
  const test = async (list) => {
    const walkSummary = await runWalk({ xml, model: summary.model, seed: summary.seed, mode: summary.mode, steps: list.length, replay: list, exec, metrics, render, detEvery });
    return walkSummary.violations.find(hit)?.step ?? -1;
  };
  const minimized = await ddmin(steps, test);
  if (!minimized.reproduced) return minimized;
  rmSync(join(out, 'probe'), { recursive: true, force: true });
  const script = writeRepro(out, summary.modelPath, minimized.steps, summary.mode);
  const result = { reproduced: true, tests: minimized.tests, length: minimized.steps.length, violation: first, script };
  writeFileSync(join(out, 'min.json'), JSON.stringify(result, null, 1));
  return result;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), SPEC);
    if (options._.length !== 1) throw new Error('usage: node tools/fuzz/minimize.mjs <walk-dir> [--kind regex] [--detail regex] [--out dir]');
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const minimized = await minimizeWalk(options._[0], options);
  if (!minimized.reproduced) {
    console.log(`not reproduced${minimized.reason ? `: ${minimized.reason}` : ''}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ tests: minimized.tests, length: minimized.length, violation: minimized.violation }));
  console.log(readFileSync(minimized.script, 'utf8'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
