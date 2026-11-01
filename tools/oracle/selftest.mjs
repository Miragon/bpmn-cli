import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ensureMainBuilt } from './lib/main-build.mjs';
import { runOracle } from './lib/oracle.mjs';
import { MAIN_ROOT, PLANTED_DIR } from './lib/paths.mjs';
import { loadModules } from './lib/registry.mjs';
import { judge } from './lib/verdict.mjs';

const PLANTED_ENTRY = fileURLToPath(new URL('./lib/planted-entry.mjs', import.meta.url));
const NOTHING_ALLOWED = { allowList: [], progress: {} };

const failures = [];

function check(passed, text) {
  console.log(`${passed ? 'pass' : 'FAIL'}  ${text}`);
  if (!passed) {
    failures.push(text);
  }
}

function plantedCopy(plant) {
  const root = join(PLANTED_DIR, plant.name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const name of ['bin', 'dist', 'assets', 'package.json']) {
    cpSync(join(MAIN_ROOT, name), join(root, name), { recursive: true });
  }
  symlinkSync(join(MAIN_ROOT, 'node_modules'), join(root, 'node_modules'));
  const target = join(root, 'dist', plant.target);
  const source = readFileSync(target, 'utf8');
  if (source.split(plant.find).length !== 2) {
    throw new Error(`plant ${plant.name}: "${plant.find}" is not once in ${plant.target}`);
  }
  writeFileSync(target, source.replace(plant.find, () => plant.replace));
  return root;
}

const redProbes = ({ verdicts }) => verdicts.filter(({ verdict }) => verdict === 'red').map(({ probe }) => probe);
const redBesides = (judged, { alsoRed = [] }) => redProbes(judged).filter((probe) => !alsoRed.includes(probe));

async function mainAgainstItselfTwice() {
  const firstRun = await runOracle({ entryNames: ['main'] });
  const secondRun = await runOracle({ entryNames: ['main'] });
  for (const [index, run] of [firstRun, secondRun].entries()) {
    const differences = run.runs.reduce((sum, { differences: found }) => sum + found.length, 0);
    check(differences === 0, `main against main, run ${index + 1}: ${differences} differences in ${run.wallSeconds} s`);
  }
  const measuresOf = ({ runs }) => runs.map(({ probe, inputs, measures }) => ({ probe, inputs, measures }));
  check(isDeepStrictEqual(measuresOf(firstRun), measuresOf(secondRun)), 'both runs measure the same');
}

function checkVerdictRules(plant, run) {
  const planted = run.runs.find(({ probe }) => probe === plant.probe);
  const count = planted.differences.length;
  const progressAt = (limit) => ({ allowList: [], progress: { planted: { [plant.probe]: limit } } });
  check(redBesides(judge(run.runs, progressAt(count)), plant).length === 0, `${plant.probe}: in progress at ${count}, it only reports`);
  check(redProbes(judge(run.runs, progressAt(count - 1))).includes(plant.probe), `${plant.probe}: in progress at ${count - 1}, it fails`);
  const allowed = { allowList: [{ probe: plant.probe, pattern: '.', reason: 'selftest' }], progress: {} };
  check(redBesides(judge(run.runs, allowed), plant).length === 0, `${plant.probe}: the allow-list explains what it names`);
}

async function plantedChange(plant) {
  const plantedRoot = plantedCopy(plant);
  const run = await runOracle({ entryFiles: [PLANTED_ENTRY], entryOptions: { plantedRoot } });
  const counts = run.runs.map(({ probe, differences }) => `${probe} ${differences.length}`).join(', ');
  const red = redProbes(judge(run.runs, NOTHING_ALLOWED));
  const expected = [plant.probe, ...(plant.alsoRed ?? [])];
  check(red.length === expected.length && expected.every((probe) => red.includes(probe)), `plant in ${plant.target} turns only ${expected.join(' and ')} red: ${counts}; ${run.wallSeconds} s`);
  checkVerdictRules(plant, run);
  rmSync(plantedRoot, { recursive: true, force: true });
}

async function lintAgainstBpmnlintsCli() {
  const { runs: [run] } = await runOracle({ entryNames: ['lint-cli'], filter: 'lint/' });
  check(run.differences.length === 0 && run.measures.findings > 0, `packages/lint against bpmnlint 12's CLI: ${run.differences.length} differences over ${run.measures.findings} findings`);
}

const started = performance.now();
ensureMainBuilt({ log: console.log });
await mainAgainstItselfTwice();
await lintAgainstBpmnlintsCli();
for (const plant of await loadModules('plants')) {
  await plantedChange(plant);
}
console.log(`${failures.length ? 'RED' : 'green'} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
process.exitCode = failures.length ? 1 : 0;
