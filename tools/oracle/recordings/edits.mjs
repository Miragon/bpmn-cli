import { corpusModels, readCorpus, writeCorpus } from '../lib/corpus.mjs';
import { loadMainApi, loadMainGenerator, loadRoundtrip } from '../lib/main-tools.mjs';

async function roundtripEdits(api, xml) {
  const { targetsOf, VARIANTS } = await loadRoundtrip();
  let doc;
  try {
    doc = await api.Doc.fromXml(xml);
  } catch (error) {
    return { refused: error.code ?? 'E_PARSE' };
  }
  if (doc.lossyImportWarnings?.length) {
    return { refused: 'E_IMPORT_LOSSY' };
  }
  const targets = targetsOf(api, doc);
  const variants = VARIANTS.filter((variant) => targets[variant.target]);
  return Object.fromEntries(variants.map(({ name, target, ops, layout }) => [name, { ops: ops(targets[target]), layout }]));
}

function operationJson({ cli, pr: _prTool, ...edit }) {
  return cli ? { ...edit, ops: cli } : edit;
}

async function benchEdits(xml) {
  const { generate } = await loadMainGenerator();
  const { edits, ...facts } = await generate(xml);
  return { ...facts, edits: Object.fromEntries(Object.entries(edits).map(([name, edit]) => [name, operationJson(edit)])) };
}

export default {
  order: 2,
  async run() {
    const api = await loadMainApi();
    for (const model of corpusModels('models', 'layout')) {
      const xml = readCorpus(model);
      const { refused, ...roundtrip } = await roundtripEdits(api, xml);
      const record = { model, ...(refused ? { refused } : {}), roundtrip, bench: await benchEdits(xml) };
      writeCorpus(`edits/${model.replace(/\.bpmn$/, '.json')}`, `${JSON.stringify(record, null, 1)}\n`);
    }
  },
};
