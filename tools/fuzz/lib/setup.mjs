import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureScorersBuilt, SCORERS_ROOT } from '../../bench/lib/main-build.mjs';
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
  ensureScorersBuilt();
  const fromScorers = (path) => import(pathToFileURL(join(SCORERS_ROOT, path)).href);
  const [scorers, { hardKinds }] = await Promise.all([fromScorers('dist/index.js'), fromScorers('tools/fuzz/lib/metric-kinds.mjs')]);
  const hard = hardKinds({ KEYS: scorers.METRIC_KEYS, WEIGHTS: scorers.METRIC_WEIGHTS });
  return { measure: scorers.layoutProblemsOfXml, diff: scorers.diffProblems, hard, keys: [...scorers.METRIC_KEYS], weights: { ...scorers.METRIC_WEIGHTS } };
}

function renderingCli(bin, workDir) {
  mkdirSync(workDir, { recursive: true });
  const [file, png] = [join(workDir, 'rendered.bpmn'), join(workDir, 'rendered.png')];
  return {
    draw(xml) {
      writeFileSync(file, xml);
      const { status, stdout, stderr } = spawnSync(process.execPath, [bin, 'render', file, '-o', png, '--problems', '--json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      if (status !== 0) {
        throw new Error(`exit ${status}: ${stderr || stdout}`);
      }
      return JSON.parse(stdout);
    },
  };
}

export async function loadRender({ exec = 'cli', workDir, bin }) {
  if (exec === 'cli') {
    return renderingCli(bin ?? process.env.BPMN_BIN ?? DEFAULT_BIN, workDir);
  }
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
