import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAIN_ROOT } from './paths.mjs';

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) {
    throw new Error(`main's tool no longer holds "${start}" ... "${end}": fix tools/oracle/lib/main-tools.mjs`);
  }
  return source.slice(from, to);
}

function importSource(lines) {
  return import(`data:text/javascript;base64,${Buffer.from(lines.join('\n')).toString('base64')}`);
}

function once(load) {
  let loaded;
  return () => {
    loaded ??= load();
    return loaded;
  };
}

const importFromMain = (path) => import(pathToFileURL(join(MAIN_ROOT, path)).href);
const toolSource = (path) => readFileSync(join(MAIN_ROOT, path), 'utf8');

export const loadMainApi = once(() => importFromMain('dist/index.js'));
export const loadMainGenerator = once(() => importFromMain('tools/bench/gen-edits.mjs'));

const loadHarness = once(() => importSource([
  `import { createRequire } from 'node:module';`,
  `const { BpmnModdle } = createRequire(${JSON.stringify(join(MAIN_ROOT, 'package.json'))})('bpmn-moddle');`,
  between(toolSource('tools/layout-regress.mjs'), 'const moddle = new BpmnModdle();', 'const results = {};'),
  'export { analyse, KEYS, WEIGHTS };',
]));

export const loadRoundtrip = once(() => {
  const source = toolSource('tools/roundtrip.mjs');
  return importSource([
    between(source, 'function changedLines', 'const quantile ='),
    between(source, 'function targetsOf', 'async function runBuild'),
    'export { changedLines, targetsOf, VARIANTS };',
  ]);
});

const loadHardKinds = once(async () => {
  const [api, { hardKinds }] = await Promise.all([loadMainApi(), importFromMain('tools/fuzz/lib/metric-kinds.mjs')]);
  return new Set(hardKinds({ KEYS: api.METRIC_KEYS, WEIGHTS: api.METRIC_WEIGHTS }));
});

const loadRasteriser = once(async () => {
  const { PngRenderer } = await importFromMain('dist/adapters/out/files/PngRenderer.js');
  return new PngRenderer();
});

export async function harnessScore(drawing) {
  const { analyse, KEYS, WEIGHTS } = await loadHarness();
  const failedReport = { failed: [drawing.refused] };
  const report = drawing.refused ? failedReport : await analyse(drawing.xml);
  const counts = Object.fromEntries(KEYS.map((kind) => [kind, report[kind]?.length ?? 0]));
  return { counts, score: KEYS.reduce((sum, kind) => sum + counts[kind] * WEIGHTS[kind], 0) };
}

export async function hardDefects(drawing) {
  if (drawing.refused) {
    return [];
  }
  const [api, hard] = await Promise.all([loadMainApi(), loadHardKinds()]);
  const { problems } = await api.layoutProblemsOfXml(drawing.xml);
  return problems.filter(({ kind }) => hard.has(kind)).map(({ kind, ids }) => `${kind} ${ids.join(',')}`);
}

export async function rasterise(svg) {
  const rasteriser = await loadRasteriser();
  try {
    return await rasteriser.rasterize(svg, { pixels: true });
  } catch (error) {
    return { refused: error.code ?? error.name };
  }
}

export async function catalogueCodes() {
  const api = await loadMainApi();
  return api.kindsJson().errors.map(({ code }) => code);
}
