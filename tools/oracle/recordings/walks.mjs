import { statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { corpusModels, readCorpus, writeCorpus } from '../lib/corpus.mjs';
import { loadMainApi } from '../lib/main-tools.mjs';
import { CORPUS_DIR, MAIN_ROOT } from '../lib/paths.mjs';

const WALKS = 16;
const STEPS = 10;
const SEED = 1;
const LARGEST_MODEL_BYTES = 12_000;

const fromMain = (path) => import(pathToFileURL(join(MAIN_ROOT, path)).href);

function isSmall(model) {
  return statSync(join(CORPUS_DIR, model)).size <= LARGEST_MODEL_BYTES;
}

function relocatedBy(commands, changes) {
  const moved = new Set(changes.relocated);
  const reinserted = commands.filter((command) => command.op === 'move' && (command.after || command.before || command.flow || command.in));
  return reinserted.flatMap((command) => command.ids.filter((id) => moved.has(id)));
}

const DRAWING_COMMANDS = new Set(['place', 'align', 'color', 'label', 'route', 'space', 'tidy', 'compact']);

function isDrawingOnly(commands) {
  return commands.every((command) => DRAWING_COMMANDS.has(command.op));
}

async function answerWithoutLayout(api, xml, ops) {
  const doc = await api.Doc.fromXml(xml);
  const commands = api.parseOps(ops);
  const { xml: file, changes } = await api.mutateDoc(doc, commands, { dryRun: true, layout: false });
  const idsOf = (entries) => entries.map(({ id }) => id);
  return {
    file,
    created: idsOf(changes.created),
    changed: idsOf(changes.changed),
    removed: idsOf(changes.removed),
    renamed: changes.renames.map(({ from, to }) => ({ from, to })),
    relocated: relocatedBy(commands, changes),
    ...doc.layoutRequests.expansion(),
  };
}

function recordingExecutor(api, plain, recorded) {
  return {
    label: plain.label,
    async run(xml, ops, options) {
      const result = await plain.run(xml, ops, options);
      if (result.status === 'ok') {
        const noLayout = isDrawingOnly(api.parseOps(ops)) ? undefined : await answerWithoutLayout(api, xml, ops);
        recorded.steps.push({ ops, before: xml, ...(noLayout ? { noLayout } : {}), after: result.xml });
      } else {
        recorded.steps.push({ ops, before: xml, refused: result.code });
      }
      return result;
    },
  };
}

async function walkOf(tools, api, model, seed) {
  const { runWalk, libExecutor, loadMetrics } = tools;
  const plain = libExecutor({ Doc: api.Doc, parseOps: api.parseOps, mutateDoc: api.mutateDoc, BpmnError: api.BpmnError });
  const recorded = { steps: [] };
  await runWalk({
    xml: readCorpus(model),
    model,
    seed,
    mode: 'incremental',
    steps: STEPS,
    exec: recordingExecutor(api, plain, recorded),
    metrics: await loadMetrics(),
    detEvery: 0,
    hardSeverity: 'warn',
    onStep: ({ step, name }) => {
      recorded.steps[step].name = name;
    },
  });
  return { model, seed, mode: 'incremental', steps: recorded.steps };
}

export default {
  order: 5,
  async run() {
    const api = await loadMainApi();
    const [{ runWalk }, { libExecutor }, { loadMetrics }, { planWalks }] = await Promise.all([fromMain('tools/fuzz/lib/walk.mjs'), fromMain('tools/fuzz/lib/exec.mjs'), fromMain('tools/fuzz/lib/setup.mjs'), fromMain('tools/fuzz/run.mjs')]);
    const models = corpusModels('models', 'layout').filter(isSmall);
    for (const { model, seed } of planWalks(models, { seed: SEED, walks: WALKS, modes: 'incremental' })) {
      const walk = await walkOf({ runWalk, libExecutor, loadMetrics }, api, model, seed);
      writeCorpus(`walks/${model.replace(/\.bpmn$/, '').replace(/[/]/g, '__')}.json`, `${JSON.stringify(walk)}\n`);
    }
  },
};
