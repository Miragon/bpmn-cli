#!/usr/bin/env node
/**
 * Gate on the clean-engine regression harness (tools/layout-regress.mjs).
 *
 *   node tools/bench/regress-gate.mjs            # used by `npm run gate`
 *
 * Contract: runs the harness on the built CLI, parses its `FILES n  SCORE s`
 * line and exits 1 when s exceeds the budget (env LAYOUT_REGRESS_MAX, else
 * maxScore in tools/bench/regress-budget.json) or when the harness fails or
 * prints no score. When the score is below the budget it says so, so the
 * budget can be lowered with the improvement (it never moves on its own). The
 * harness output is passed through.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/metrics.mjs';

const BUDGET_FILE = join(ROOT, 'tools', 'bench', 'regress-budget.json');

function budget() {
  if (process.env.LAYOUT_REGRESS_MAX) return { maxScore: Number(process.env.LAYOUT_REGRESS_MAX), from: 'LAYOUT_REGRESS_MAX' };
  return { ...JSON.parse(readFileSync(BUDGET_FILE, 'utf8')), from: 'tools/bench/regress-budget.json' };
}

const run = spawnSync(process.execPath, [join(ROOT, 'tools', 'layout-regress.mjs')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
process.stdout.write(run.stdout ?? '');
process.stderr.write(run.stderr ?? '');
const m = /FILES\s+(\d+)\s+SCORE\s+(\d+)/.exec(run.stdout ?? '');
if (run.status !== 0 || !m) {
  console.error(`regress-gate: the harness failed (exit ${run.status}) or printed no score`);
  process.exit(1);
}
const [files, score] = [Number(m[1]), Number(m[2])];
const b = budget();
if (score > b.maxScore) {
  console.error(`regress-gate: FAIL score ${score} > budget ${b.maxScore} (${b.from}) on ${files} files`);
  process.exit(1);
}
console.log(`regress-gate: ok, score ${score} <= budget ${b.maxScore} (${b.from}) on ${files} files${score < b.maxScore ? `; lower the budget to ${score} to keep the improvement` : ''}`);
