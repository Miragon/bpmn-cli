/**
 * Wiring of the fuzz tools to this repository: paths, the measuring library,
 * executors, corpus discovery and argument parsing.
 *
 * Contract
 *  - ROOT is the repository; DEFAULT_BIN its built CLI (bin/bpmn.js), which
 *    env BPMN_BIN overrides.
 *  - `loadMetrics()` imports dist/index.js (always this repo's build,
 *    whatever CLI is fuzzed) -> { measure, diff, hard, keys }.
 *  - `loadRender()` imports dist/node.js -> { draw(xml), maxSize }:
 *    the PNG of `bpmn render --problems --tiles` (the walk's render oracle).
 *  - `makeExecutor({ exec, via, workDir, bin })`: exec 'cli' (default, in
 *    CLI_ENV) or 'lib' (dist/index.js in-process).
 *  - `CLI_ENV`: the environment the tools run the CLI in (also the benchmark,
 *    tools/layout-regress.mjs and the demo).
 *  - `corpusFiles(dirs, filter)`: every *.bpmn below the given directories,
 *    sorted, de-duplicated. `defaultCorpus()`: test/fixtures and tools/scenarios
 *    plus the directories in env BPMN_FUZZ_CORPUS (colon-separated; private
 *    corpora stay outside the repository).
 *  - `parseArgs(argv, spec)`: `--name value` / `--flag` / `--no-flag` options;
 *    spec maps names to defaults (boolean defaults make flags).
 * Throws a readable error when dist/ is missing (run `npm run build`).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cliExecutor, libExecutor } from './exec.mjs';
import { hardKinds, newKinds } from './metric-kinds.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_BIN = join(ROOT, 'bin', 'bpmn.js');
export const CLI_ENV = process.env;
const DIST = join(ROOT, 'dist');

async function importDist(rel) {
  const file = join(DIST, rel);
  if (!existsSync(file)) {
    throw new Error(`${file} is missing: run \`npm run build\` first`);
  }
  return import(pathToFileURL(file).href);
}

export async function loadMetrics() {
  const api = await importDist('index.js');
  const lib = { KEYS: api.METRIC_KEYS, WEIGHTS: api.METRIC_WEIGHTS };
  return { measure: api.layoutProblemsOfXml, diff: api.diffProblems, hard: hardKinds(lib), keys: [...lib.KEYS], newKinds: newKinds(lib) };
}

export async function loadRender() {
  const lib = await importDist('node.js');
  const core = await importDist('index.js');
  return { draw: (xml) => lib.renderPng(xml, { problems: true, tiles: true }), maxSize: core.RENDER_MAX_SIZE };
}

export async function makeExecutor({ exec = 'cli', via = 'commands', workDir, bin }) {
  if (exec === 'lib') {
    const api = await importDist('index.js');
    return libExecutor({ Doc: api.Doc, parseOps: api.parseOps, mutateDoc: api.mutateDoc, BpmnError: api.BpmnError }, { label: 'lib:dist' });
  }
  return cliExecutor({ bin: bin ?? process.env.BPMN_BIN ?? DEFAULT_BIN, workDir, via, env: CLI_ENV });
}

function walkDir(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const entryPath = join(dir, name);
    if (statSync(entryPath).isDirectory()) {
      walkDir(entryPath, out);
    } else if (name.endsWith('.bpmn')) {
      out.push(entryPath);
    }
  }
}

export function corpusFiles(dirs, filter) {
  const out = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) throw new Error(`corpus directory ${dir} does not exist`);
    if (statSync(dir).isDirectory()) {
      walkDir(resolve(dir), out);
    } else {
      out.push(resolve(dir));
    }
  }
  return [...new Set(out)].filter((file) => !filter || file.includes(filter));
}

export const envDirs = (name) => (process.env[name] ?? '').split(':').map((entry) => entry.trim()).filter(Boolean);

export function defaultCorpus() {
  return [join(ROOT, 'test', 'fixtures'), join(ROOT, 'tools', 'scenarios'), ...envDirs('BPMN_FUZZ_CORPUS')];
}

export function parseArgs(argv, spec) {
  const opts = { ...spec, _: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (wholeMatch, letter) => letter.toUpperCase());
    const negated = key.startsWith('no') && key.length > 2 ? key[2].toLowerCase() + key.slice(3) : undefined;
    if (negated && typeof spec[negated] === 'boolean') {
      opts[negated] = false;
    } else if (typeof spec[key] === 'boolean') {
      opts[key] = true;
    } else if (key in spec) {
      opts[key] = typeof spec[key] === 'number' ? Number(argv[++index]) : argv[++index];
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }
  return opts;
}
