import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadHardKinds, loadMainApi } from '../../oracle/lib/main-tools.mjs';
import { ensureMainBuilt } from '../../oracle/lib/main-build.mjs';
import { cliExecutor, libExecutor } from './exec.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_BIN = join(ROOT, 'bin', 'bpmn.js');
const LIBRARY = join(ROOT, 'dist', 'index.js');

export async function loadLibrary() {
  if (!existsSync(LIBRARY)) {
    throw new Error(`${LIBRARY} is missing: run \`npm run build\` first`);
  }
  return import(pathToFileURL(LIBRARY).href);
}

export async function loadMetrics() {
  ensureMainBuilt();
  const [main, hard] = await Promise.all([loadMainApi(), loadHardKinds()]);
  return { measure: main.layoutProblemsOfXml, diff: main.diffProblems, hard: [...hard], keys: [...main.METRIC_KEYS], weights: { ...main.METRIC_WEIGHTS } };
}

export async function loadRender() {
  const { renderXml } = await loadLibrary();
  return { draw: (xml) => renderXml(xml, { problems: true }) };
}

export async function makeExecutor({ exec = 'cli', via = 'commands', workDir, bin }) {
  if (exec === 'lib') {
    return libExecutor(await loadLibrary(), { label: 'lib:dist' });
  }
  return cliExecutor({ bin: bin ?? process.env.BPMN_BIN ?? DEFAULT_BIN, workDir, via });
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
    if (!existsSync(dir)) {
      throw new Error(`corpus directory ${dir} does not exist`);
    }
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
  return [join(ROOT, 'corpus', 'models'), join(ROOT, 'corpus', 'layout'), ...envDirs('BPMN_FUZZ_CORPUS')];
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
