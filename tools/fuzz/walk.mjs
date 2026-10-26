#!/usr/bin/env node
/**
 * One seeded random walk on one model (see lib/walk.mjs for the invariants).
 *
 *   node tools/fuzz/walk.mjs <model.bpmn> [--seed 1] [--mode auto|incremental|full] [--steps 30]
 *        [--out dir] [--exec cli|lib] [--via commands|apply] [--det-every 10]
 *        [--no-semantic] [--no-format] [--no-render] [--hard error|warn] [--replay steps.json] [--save-steps] [--strict]
 *
 * Contract: copies nothing into the repository; writes <out>/summary.json
 * (counts, violations, the model path, the configuration), <out>/steps.json
 * (the generated steps, replayable with --replay), <out>/log.jsonl (one line
 * per step) and with --save-steps <out>/step-NNN.bpmn after every written
 * step. Prints a one-line JSON summary. Exit 0 = no error-severity violation
 * (with --strict: no violation at all), 1 = violations, 2 = bad arguments.
 * The CLI under test is bin/bpmn.js (env BPMN_BIN overrides); the oracles always
 * use this repository's dist/ (every written step is also rendered, unless
 * --no-render).
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMetrics, loadRender, makeExecutor, parseArgs, ROOT } from './lib/setup.mjs';
import { runWalk } from './lib/walk.mjs';

const SPEC = { seed: 1, mode: 'auto', steps: 30, out: undefined, exec: 'cli', via: 'commands', detEvery: 10, semantic: true, format: true, render: true, hard: 'error', replay: undefined, saveSteps: false, strict: false };

export async function walkOnce(model, options) {
  const out = resolve(options.out ?? join(ROOT, 'tools', 'fuzz', 'out', 'walks', `${basename(model, '.bpmn')}-s${options.seed}-${options.mode}`));
  mkdirSync(out, { recursive: true });
  const log = join(out, 'log.jsonl');
  writeFileSync(log, '');
  const summary = await runWalk({
    xml: readFileSync(model, 'utf8'), model: basename(model), seed: options.seed, mode: options.mode, steps: options.steps,
    exec: await makeExecutor({ exec: options.exec, via: options.via, workDir: join(out, 'work') }), metrics: await loadMetrics(),
    render: options.render ? await loadRender() : undefined,
    semantic: options.semantic, format: options.format, detEvery: options.detEvery, hardSeverity: options.hard,
    replay: options.replay ? JSON.parse(readFileSync(options.replay, 'utf8')) : undefined,
    onStep: (entry, xml) => {
      appendFileSync(log, `${JSON.stringify(entry)}\n`);
      if (options.saveSteps && entry.status === 'ok') writeFileSync(join(out, `step-${String(entry.step).padStart(3, '0')}.bpmn`), xml);
    },
  });
  const { ops, ...rest } = summary;
  writeFileSync(join(out, 'steps.json'), JSON.stringify(ops, null, 1));
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ ...rest, modelPath: resolve(model), config: { exec: options.exec, via: options.via, semantic: options.semantic, format: options.format, render: options.render, detEvery: options.detEvery, hard: options.hard } }, null, 1));
  return { out, summary };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), SPEC);
    if (options._.length !== 1) throw new Error('usage: node tools/fuzz/walk.mjs <model.bpmn> [options]');
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const { summary } = await walkOnce(options._[0], options);
  const kinds = [...new Set(summary.violations.map((violation) => violation.kind))];
  console.log(JSON.stringify({ model: summary.model, seed: summary.seed, mode: summary.mode, steps: summary.steps, ok: summary.ok, refused: summary.refused, errors: summary.errors, warnings: summary.warnings, kinds }));
  process.exit(summary.errors || (options.strict && summary.warnings) ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
