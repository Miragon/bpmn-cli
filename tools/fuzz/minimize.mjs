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
import { DEFAULT_BIN, loadMetrics, makeExecutor, parseArgs, ROOT } from './lib/setup.mjs';
import { runWalk } from './lib/walk.mjs';

const SPEC = { kind: undefined, detail: undefined, out: undefined };

function matcher(summary, o) {
  const K = o.kind ? new RegExp(o.kind) : undefined;
  const D = o.detail ? new RegExp(o.detail) : undefined;
  const first = summary.violations.find((v) => (K ? K.test(v.kind) : v.severity === 'error') && (!D || D.test(String(v.detail))));
  const kind = K ?? (first ? new RegExp(`^${first.kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : undefined);
  return { first, hit: (v) => kind.test(v.kind) && (!D || D.test(String(v.detail))) };
}

/** ddmin over `steps`; `test(list)` -> index of the triggering step or -1. */
async function ddmin(steps, test) {
  let tests = 0;
  const probe = async (list) => { tests++; return test(list); };
  let at = await probe(steps);
  if (at < 0) return { reproduced: false, tests };
  let cur = steps.slice(0, at + 1);
  let n = 2;
  while (cur.length >= 2) {
    const chunk = Math.ceil(cur.length / n);
    let reduced = false;
    for (let i = 0; i < cur.length && !reduced; i += chunk) {
      const cand = [...cur.slice(0, i), ...cur.slice(i + chunk)];
      if (!cand.length) continue;
      at = await probe(cand);
      if (at >= 0) { cur = cand.slice(0, at + 1); n = Math.max(n - 1, 2); reduced = true; }
    }
    if (!reduced) {
      if (n >= cur.length) break;
      n = Math.min(cur.length, n * 2);
    }
  }
  return { reproduced: true, tests, steps: cur };
}

const quote = (s) => (/^[\w./:=,@%+-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

function writeRepro(dir, model, steps, mode) {
  copyFileSync(model, join(dir, 'start.bpmn'));
  writeFileSync(join(dir, 'steps.json'), JSON.stringify(steps, null, 1));
  const bin = resolve(process.env.BPMN_BIN ?? DEFAULT_BIN);
  // relative to the repro when both live in this repository (out/ is git-ignored), else as given
  const binRef = dir.startsWith(`${ROOT}/`) && bin.startsWith(`${ROOT}/`) ? `$D/${relative(dir, bin)}` : bin;
  const layout = mode === 'auto' ? '' : ` --layout ${mode}`;
  const lines = ['#!/bin/sh', '# Minimised fuzz repro: replays the steps on a copy of start.bpmn, then prints the metrics.', 'D=$(cd "$(dirname "$0")" && pwd)',
    `BPMN=\${BPMN:-"node ${binRef}"}`, 'cp "$D/start.bpmn" "$D/work.bpmn"'];
  steps.forEach((s, i) => {
    if (i === steps.length - 1) lines.push('cp "$D/work.bpmn" "$D/before-last.bpmn"');
    lines.push(`# step ${i}: ${s.name}`);
    const argv = toArgv(s.ops);
    if (argv) lines.push(`$BPMN ${argv.map((a) => (a === '%F' ? '"$D/work.bpmn"' : quote(a))).join(' ')}${layout}`);
    else {
      const f = `op-${String(i).padStart(2, '0')}.json`;
      writeFileSync(join(dir, f), JSON.stringify(s.ops, null, 1));
      lines.push(`$BPMN apply "$D/work.bpmn" "$D/${f}"${layout}`);
    }
  });
  lines.push('$BPMN metrics "$D/work.bpmn"');
  writeFileSync(join(dir, 'run.sh'), `${lines.join('\n')}\n`, { mode: 0o755 });
  return join(dir, 'run.sh');
}

export async function minimizeWalk(walkDir, o = {}) {
  const summary = JSON.parse(readFileSync(join(walkDir, 'summary.json'), 'utf8'));
  const steps = JSON.parse(readFileSync(join(walkDir, 'steps.json'), 'utf8'));
  const { first, hit } = matcher(summary, o);
  if (!first) return { reproduced: false, tests: 0, reason: 'no matching violation in the walk' };
  const slug = first.kind.replace(/[^\w]+/g, '_');
  const out = resolve(o.out ?? join(walkDir, `min-${slug}`));
  mkdirSync(out, { recursive: true });
  const exec = await makeExecutor({ exec: summary.config.exec, via: summary.config.via, workDir: join(out, 'probe') });
  const metrics = await loadMetrics();
  const xml = readFileSync(summary.modelPath, 'utf8');
  const detEvery = /nondeterministic/.test(first.kind) ? 1 : 0;
  const test = async (list) => {
    const s = await runWalk({ xml, model: summary.model, seed: summary.seed, mode: summary.mode, steps: list.length, replay: list, exec, metrics, detEvery });
    return s.violations.find(hit)?.step ?? -1;
  };
  const r = await ddmin(steps, test);
  if (!r.reproduced) return r;
  rmSync(join(out, 'probe'), { recursive: true, force: true });
  const script = writeRepro(out, summary.modelPath, r.steps, summary.mode);
  const result = { reproduced: true, tests: r.tests, length: r.steps.length, violation: first, script };
  writeFileSync(join(out, 'min.json'), JSON.stringify(result, null, 1));
  return result;
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2), SPEC);
    if (o._.length !== 1) throw new Error('usage: node tools/fuzz/minimize.mjs <walk-dir> [--kind regex] [--detail regex] [--out dir]');
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const r = await minimizeWalk(o._[0], o);
  if (!r.reproduced) {
    console.log(`not reproduced${r.reason ? `: ${r.reason}` : ''}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ tests: r.tests, length: r.length, violation: r.violation }));
  console.log(readFileSync(r.script, 'utf8'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
