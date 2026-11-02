import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openBuild } from '../lib/build-side.mjs';
import { corpusModels, readCorpus, writeCorpus } from '../lib/corpus.mjs';
import { harnessScore, loadMainApi } from '../lib/main-tools.mjs';
import { MAIN_ROOT, WORK_DIR } from '../lib/paths.mjs';

const REGRESS_RESULT = join(WORK_DIR, 'regress.json');

async function drawnScore(api, build, xml) {
  const drawing = await build.layout(xml);
  const harness = await harnessScore(drawing);
  const { counts, score } = await api.layoutProblemsOfXml(drawing.xml);
  return { score, harness: harness.score, counts };
}

function assertHarnessAgrees(files) {
  execFileSync(process.execPath, ['tools/layout-regress.mjs', '--save', REGRESS_RESULT, '--work', join(WORK_DIR, 'regress-work')], { cwd: MAIN_ROOT, stdio: 'ignore' });
  const regress = JSON.parse(readFileSync(REGRESS_RESULT, 'utf8'));
  for (const [name, { score }] of Object.entries(regress)) {
    const recorded = files[`layout/${name}`].drawn.harness;
    if (recorded !== score) {
      throw new Error(`layout-regress scores ${name} ${score}, the oracle ${recorded}`);
    }
  }
}

function scoresText({ files, ...head }) {
  const headLines = Object.entries(head).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const fileLines = Object.entries(files).map(([path, score]) => `  ${JSON.stringify(path)}: ${JSON.stringify(score)}`);
  return `{\n${headLines.map((line) => ` ${line},`).join('\n')}\n "files": {\n${fileLines.join(',\n')}\n }\n}\n`;
}

export default {
  order: 3,
  async run({ commit }) {
    const api = await loadMainApi();
    const build = await openBuild(MAIN_ROOT);
    const scenarios = new Set(corpusModels('layout'));
    const files = {};
    for (const model of corpusModels('models', 'layout')) {
      const xml = readCorpus(model);
      const { counts, score } = await api.layoutProblemsOfXml(xml);
      files[model] = { score, counts, ...(scenarios.has(model) ? { drawn: await drawnScore(api, build, xml) } : {}) };
    }
    assertHarnessAgrees(files);
    writeCorpus('layout/scores.json', scoresText({ commit, kinds: api.METRIC_KEYS, weights: api.METRIC_WEIGHTS, files }));
  },
};
