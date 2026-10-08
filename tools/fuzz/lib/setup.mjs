/**
 * Wiring of the fuzz tools to this repository: paths, the measuring library,
 * executors, corpus discovery and argument parsing.
 *
 * Contract
 *  - ROOT is the repository; DEFAULT_BIN its built CLI (bin/bpmn.js), which
 *    env BPMN_BIN overrides.
 *  - `loadMetrics()` imports dist/diagram/metrics.js (always this repo's build,
 *    whatever CLI is fuzzed) -> { measure, diff, hard, keys }.
 *  - `makeExecutor({ exec, via, workDir, bin })`: exec 'cli' (default) or
 *    'lib' (dist/index.js in-process).
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
const DIST = join(ROOT, 'dist');

async function importDist(rel) {
  const file = join(DIST, rel);
  if (!existsSync(file)) throw new Error(`${file} is missing: run \`npm run build\` first`);
  return import(pathToFileURL(file).href);
}

export async function loadMetrics() {
  const lib = await importDist(join('diagram', 'metrics.js'));
  return { measure: lib.layoutProblemsOfXml, diff: lib.diffProblems, hard: hardKinds(lib), keys: [...lib.KEYS], newKinds: newKinds(lib) };
}

export async function makeExecutor({ exec = 'cli', via = 'commands', workDir, bin }) {
  if (exec === 'lib') {
    const api = await importDist('index.js');
    return libExecutor({ Doc: api.Doc, parseOps: api.parseOps, mutateDoc: api.mutateDoc, CliError: api.CliError }, { label: 'lib:dist' });
  }
  return cliExecutor({ bin: bin ?? process.env.BPMN_BIN ?? DEFAULT_BIN, workDir, via });
}

function walkDir(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkDir(p, out);
    else if (name.endsWith('.bpmn')) out.push(p);
  }
}

export function corpusFiles(dirs, filter) {
  const out = [];
  for (const d of dirs) {
    if (!existsSync(d)) throw new Error(`corpus directory ${d} does not exist`);
    if (statSync(d).isDirectory()) walkDir(resolve(d), out);
    else out.push(resolve(d));
  }
  return [...new Set(out)].filter((f) => !filter || f.includes(filter));
}

export const envDirs = (name) => (process.env[name] ?? '').split(':').map((s) => s.trim()).filter(Boolean);

export function defaultCorpus() {
  return [join(ROOT, 'test', 'fixtures'), join(ROOT, 'tools', 'scenarios'), ...envDirs('BPMN_FUZZ_CORPUS')];
}

export function parseArgs(argv, spec) {
  const opts = { ...spec, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const negated = key.startsWith('no') && key.length > 2 ? key[2].toLowerCase() + key.slice(3) : undefined;
    if (negated && typeof spec[negated] === 'boolean') opts[negated] = false;
    else if (typeof spec[key] === 'boolean') opts[key] = true;
    else if (key in spec) opts[key] = typeof spec[key] === 'number' ? Number(argv[++i]) : argv[++i];
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}
