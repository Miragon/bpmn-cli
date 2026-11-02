import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { corpusFiles, ROOT } from '../../fuzz/lib/setup.mjs';
import { generate } from '../gen-edits.mjs';
import { ensureMainBuilt, MAIN_ROOT } from '../../../shared/main-build.mjs';

function envCorpora(env) {
  const used = new Set(['scenarios']);
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

export function resolveCorpora({ only, env = process.env }) {
  const list = [{ name: 'scenarios', dir: join(ROOT, 'fixtures', 'layout') }, ...envCorpora(env)];
  return list.filter((corpus) => !only?.length || only.includes(corpus.name)).map((corpus) => ({ ...corpus, files: corpusFiles([corpus.dir]) }));
}

const modelName = (corpus, file) => relative(corpus.dir, file).replace(/\.bpmn$/, '').split(/[\\/]/).join('__');

async function specOf(corpus, file, mainGenerator) {
  const model = modelName(corpus, file);
  const xml = readFileSync(file, 'utf8');
  try {
    const { edits: mainEdits } = await mainGenerator.generate(xml);
    return { corpus: corpus.name, model, file, ...(await generate(xml)), mainEdits };
  } catch (error) {
    return { corpus: corpus.name, model, file, unreadable: String(error.message).split('\n')[0], edits: {} };
  }
}

export async function writeSpecs(corpora, out, filter) {
  ensureMainBuilt({ log: console.log });
  const mainGenerator = await import(pathToFileURL(join(MAIN_ROOT, 'tools', 'verify', 'bench', 'gen-edits.mjs')).href);
  const specs = [];
  for (const corpus of corpora) {
    const dir = join(out, 'specs', corpus.name);
    mkdirSync(dir, { recursive: true });
    for (const file of corpus.files.filter((candidate) => !filter || `${corpus.name}/${modelName(corpus, candidate)}`.includes(filter))) {
      const spec = await specOf(corpus, file, mainGenerator);
      writeFileSync(join(dir, `${spec.model}.json`), JSON.stringify(spec, null, 1));
      specs.push(spec);
    }
  }
  return specs;
}
