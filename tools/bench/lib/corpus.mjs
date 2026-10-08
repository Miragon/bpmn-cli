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
 *                 --force`, cached in <out>/corpus/engine: a corpus whose
 *                 diagrams are exactly engine-owned, so `auto` redraws in full
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
import { generate } from '../gen-edits.mjs';
import { ROOT } from './metrics.mjs';

function bpmnFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.bpmn')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function envCorpora(env) {
  const used = new Set(['scenarios', 'engine']);
  return (env.BPMN_BENCH_CORPUS ?? '').split(':').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [given, dir] = entry.includes('=') ? entry.split('=') : [basename(entry), entry];
    const base = given.replace(/[^\w.-]+/g, '_');
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
    used.add(name);
    if (!existsSync(dir)) throw new Error(`BPMN_BENCH_CORPUS: ${dir} does not exist`);
    return { name, dir: resolve(dir) };
  });
}

/** Scenarios redrawn by the reference CLI (a file whose layout fails is left out). */
function engineCorpus(scenarios, out, refBin) {
  const dir = join(out, 'corpus', 'engine');
  mkdirSync(dir, { recursive: true });
  for (const src of bpmnFiles(scenarios)) {
    const dst = join(dir, basename(src));
    if (existsSync(dst)) continue;
    copyFileSync(src, dst);
    const r = spawnSync(process.execPath, [refBin, 'layout', dst, '--force'], { encoding: 'utf8' });
    if (r.status !== 0) rmSync(dst);
  }
  return { name: 'engine', dir };
}

export function resolveCorpora({ only, engine = false, out, refBin, env = process.env }) {
  const scenarios = join(ROOT, 'tools', 'scenarios');
  const list = [{ name: 'scenarios', dir: scenarios }, ...envCorpora(env)];
  if (engine) list.push(engineCorpus(scenarios, out, refBin));
  return list.filter((c) => !only?.length || only.includes(c.name)).map((c) => ({ ...c, files: bpmnFiles(c.dir) }));
}

export const modelName = (corpus, file) => relative(corpus.dir, file).replace(/\.bpmn$/, '').split(/[\\/]/).join('__');

export async function writeSpecs(corpora, out, filter) {
  const specs = [];
  for (const c of corpora) {
    const dir = join(out, 'specs', c.name);
    mkdirSync(dir, { recursive: true });
    for (const file of c.files) {
      const model = modelName(c, file);
      if (filter && !`${c.name}/${model}`.includes(filter)) continue;
      let spec;
      try {
        spec = { corpus: c.name, model, file, ...(await generate(readFileSync(file, 'utf8'))) };
      } catch (e) {
        spec = { corpus: c.name, model, file, unreadable: String(e.message).split('\n')[0], edits: {} };
      }
      writeFileSync(join(dir, `${model}.json`), JSON.stringify(spec, null, 1));
      specs.push(spec);
    }
  }
  return specs;
}
