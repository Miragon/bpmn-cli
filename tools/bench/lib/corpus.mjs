/**
 * The benchmark's corpora and their edit specs.
 *
 * Contract
 *  - `resolveCorpora({ only, engine, out, refBin })` -> [{ name, dir, files }]:
 *      scenarios  tools/scenarios (public, always available)
 *      <name>     every directory in env BPMN_BENCH_CORPUS (colon-separated,
 *                 `name=dir` or plain `dir`, then named after its basename);
 *                 private corpora stay outside the repository and only their
 *                 results land in the git-ignored results directory
 *      engine     (with `engine: true`) the scenarios redrawn by `refBin layout
 *                 --force` (and `--no-lint-config` when the build has it: a
 *                 .bpmnlintrc above <out> never changes the corpus), cached in
 *                 <out>/corpus/engine: a corpus whose diagrams are exactly
 *                 engine-owned, so `auto` redraws in full
 *    `only` (names) filters; files are every *.bpmn below the directory, sorted.
 *  - `modelName(corpus, file)`: the path below the corpus directory without
 *    .bpmn, slashes as `__`.
 *  - `writeSpecs(corpora, out, filter)` generates the edit specs
 *    (gen-edits.mjs) into <out>/specs/<corpus>/<model>.json and returns them;
 *    regenerated on every run (deterministic and cheap).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { CLI_ENV } from '../../fuzz/lib/setup.mjs';
import { generate } from '../gen-edits.mjs';
import { ROOT } from './metrics.mjs';

function bpmnFiles(dir) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const entryPath = join(dir, name);
      if (statSync(entryPath).isDirectory()) {
        walk(entryPath);
      } else if (name.endsWith('.bpmn')) {
        out.push(entryPath);
      }
    }
  };
  walk(dir);
  return out;
}

function envCorpora(env) {
  const used = new Set(['scenarios', 'engine']);
  return (env.BPMN_BENCH_CORPUS ?? '').split(':').map((entrySpec) => entrySpec.trim()).filter(Boolean).map((entry) => {
    const [given, dir] = entry.includes('=') ? entry.split('=') : [basename(entry), entry];
    const base = given.replace(/[^\w.-]+/g, '_');
    let name = base;
    for (let suffix = 2; used.has(name); suffix++) {
      name = `${base}-${suffix}`;
    }
    used.add(name);
    if (!existsSync(dir)) {
      throw new Error(`BPMN_BENCH_CORPUS: ${dir} does not exist`);
    }
    return { name, dir: resolve(dir) };
  });
}

/** Scenarios redrawn by the reference CLI (a file whose layout fails is left out). */
function engineCorpus(scenarios, out, refBin) {
  const dir = join(out, 'corpus', 'engine');
  mkdirSync(dir, { recursive: true });
  let noLint;
  for (const src of bpmnFiles(scenarios)) {
    const dst = join(dir, basename(src));
    if (existsSync(dst)) continue;
    // as arms.mjs and fuzz/lib/exec.mjs: only a build that has the flag gets it (an older BASELINE_BIN)
    noLint ??= /--no-lint-config/.test(spawnSync(process.execPath, [refBin, 'layout', '--help'], { encoding: 'utf8' }).stdout ?? '') ? ['--no-lint-config'] : [];
    copyFileSync(src, dst);
    const layoutRun = spawnSync(process.execPath, [refBin, 'layout', dst, '--force', ...noLint], { encoding: 'utf8', env: CLI_ENV });
    if (layoutRun.status !== 0) rmSync(dst);
  }
  return { name: 'engine', dir };
}

export function resolveCorpora({ only, engine = false, out, refBin, env = process.env }) {
  const scenarios = join(ROOT, 'tools', 'scenarios');
  const list = [{ name: 'scenarios', dir: scenarios }, ...envCorpora(env)];
  if (engine) list.push(engineCorpus(scenarios, out, refBin));
  return list.filter((corpus) => !only?.length || only.includes(corpus.name)).map((corpus) => ({ ...corpus, files: bpmnFiles(corpus.dir) }));
}

export const modelName = (corpus, file) => relative(corpus.dir, file).replace(/\.bpmn$/, '').split(/[\\/]/).join('__');

export async function writeSpecs(corpora, out, filter) {
  const specs = [];
  for (const corpus of corpora) {
    const dir = join(out, 'specs', corpus.name);
    mkdirSync(dir, { recursive: true });
    for (const file of corpus.files) {
      const model = modelName(corpus, file);
      if (filter && !`${corpus.name}/${model}`.includes(filter)) continue;
      let spec;
      try {
        spec = { corpus: corpus.name, model, file, ...(await generate(readFileSync(file, 'utf8'))) };
      } catch (error) {
        spec = { corpus: corpus.name, model, file, unreadable: String(error.message).split('\n')[0], edits: {} };
      }
      writeFileSync(join(dir, `${model}.json`), JSON.stringify(spec, null, 1));
      specs.push(spec);
    }
  }
  return specs;
}
