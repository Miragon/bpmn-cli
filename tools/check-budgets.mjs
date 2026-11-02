import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { bundlesOf } from './build/bundles.mjs';

const ROOT = resolve(process.argv[2] ?? '.');
const CORE_ENTRY = 'src/index.ts';
const CLI_PROGRAM = 'src/cli/CliProgram.ts';
const MEASURED_CLI_OUTPUT = 'node_modules/.cache/bpmn-budgets';
const COVERAGE_FLOOR = { lines: 90, branches: 85 };
const RECORDED = ['commands', 'flagSlots', 'guideKilobytes'];
const GUIDE_FOLDERS = ['src/cli/help/guide', 'src/cli/help/project', 'src/cli/help/tables'];
const PARTS = [
  'src/model',
  'src/operations',
  'src/edit',
  'src/scoring',
  'src/drawing',
  'src/checks',
  'src/views',
  'src/write',
  'src/api',
  'src/cli',
  'packages/lint/src',
  'packages/render/src',
];

const budgets = JSON.parse(readFileSync(join(ROOT, 'budgets.json'), 'utf8'));
const problems = [];

function sourceFiles(folder) {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
}

function linesOf(part) {
  return sourceFiles(join(ROOT, part)).reduce((sum, file) => sum + readFileSync(file, 'utf8').trimEnd().split('\n').length, 0);
}

function checkLines() {
  const lines = Object.fromEntries(PARTS.map((part) => [part, linesOf(part)]));
  for (const part of PARTS) {
    if (budgets.lines[part] === undefined) {
      problems.push(`${part} has no line budget`);
    } else if (lines[part] > budgets.lines[part]) {
      problems.push(`${part} has ${lines[part]} lines, over its budget of ${budgets.lines[part]}; raising it needs a reason in the commit`);
    }
  }
  const total = Object.values(lines).reduce((sum, count) => sum + count, 0);
  if (total > budgets.lines.total) {
    problems.push(`src/ and packages/ have ${total} lines, over their budget of ${budgets.lines.total}`);
  }
  return total;
}

function checkCoverageFloors() {
  for (const part of PARTS) {
    const floor = budgets.coverage[part];
    if (floor?.lines === undefined || floor.lines < COVERAGE_FLOOR.lines || floor.branches < COVERAGE_FLOOR.branches) {
      problems.push(`${part}: coverage below ${COVERAGE_FLOOR.lines} % lines, ${COVERAGE_FLOOR.branches} % branches; coverage is raised only`);
    }
  }
}

async function checkRuntimeExports() {
  const { metafile } = await build({ entryPoints: [CORE_ENTRY], bundle: true, format: 'esm', packages: 'external', absWorkingDir: ROOT, write: false, metafile: true, logLevel: 'silent', outfile: join(ROOT, '.budgets-out.js') });
  const { exports } = Object.values(metafile.outputs).find(({ entryPoint }) => entryPoint === CORE_ENTRY);
  if (exports.length > budgets.runtimeExports) {
    problems.push(`the core has ${exports.length} runtime exports, over its budget of ${budgets.runtimeExports}: ${exports.join(', ')}`);
  }
  return exports.length;
}

function checkRecordedBudgets() {
  for (const budget of RECORDED) {
    if (budgets[budget] === undefined) {
      problems.push(`budgets.json lacks ${budget}`);
    }
  }
}

function leavesOf(command) {
  return command.commands.length ? command.commands.flatMap(leavesOf) : [command];
}

async function cliCommands() {
  const output = join(ROOT, MEASURED_CLI_OUTPUT);
  await build({ ...bundlesOf(ROOT).cli, entryPoints: { program: CLI_PROGRAM }, outdir: output });
  const { CliProgram } = await import(pathToFileURL(join(output, 'program.js')).href);
  const silent = { write: () => true };
  const { commander } = new CliProgram({ stdout: silent, stderr: silent, stdin: [], env: {} }, '0');
  rmSync(output, { recursive: true, force: true });
  return leavesOf(commander);
}

async function checkCommandsAndFlags() {
  if (!existsSync(join(ROOT, CLI_PROGRAM))) {
    return { commands: 0, flagSlots: 0 };
  }
  const commands = await cliCommands();
  const measured = { commands: commands.length, flagSlots: commands.reduce((sum, { options }) => sum + options.length, 0) };
  for (const [budget, count] of Object.entries(measured)) {
    if (count > budgets[budget]) {
      problems.push(`the CLI has ${count} ${budget}, over its budget of ${budgets[budget]}`);
    }
  }
  return measured;
}

function checkGuide() {
  const files = GUIDE_FOLDERS.map((folder) => join(ROOT, folder)).filter(existsSync).flatMap((folder) => readdirSync(folder).map((name) => join(folder, name)));
  const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  const kilobytes = Math.ceil(bytes / 100) / 10;
  if (kilobytes > budgets.guideKilobytes) {
    problems.push(`the guide has ${kilobytes} KB, over its budget of ${budgets.guideKilobytes}`);
  }
  return kilobytes;
}

const total = checkLines();
checkCoverageFloors();
checkRecordedBudgets();
const runtimeExports = await checkRuntimeExports();
const { commands, flagSlots } = await checkCommandsAndFlags();
const guideKilobytes = checkGuide();

for (const problem of problems) {
  console.error(`budgets: ${problem}`);
}
if (problems.length > 0) {
  process.exit(1);
}
console.log(`budgets: ${total} lines, ${runtimeExports} runtime exports, ${commands} commands, ${flagSlots} flag slots, guide ${guideKilobytes} KB`);
