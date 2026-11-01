import { corpusEdits, readCorpus } from '../lib/corpus.mjs';
import { loadRoundtrip } from '../lib/main-tools.mjs';

function linesDropped(before, after) {
  const remaining = new Map();
  for (const line of after.split('\n')) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  return before.split('\n').filter((line) => {
    const left = remaining.get(line) ?? 0;
    remaining.set(line, left - 1);
    return left === 0;
  });
}

function dropsMainKeeps(original, mainXml, subjectXml) {
  const droppedByMain = new Map();
  for (const line of linesDropped(original, mainXml)) {
    droppedByMain.set(line, (droppedByMain.get(line) ?? 0) + 1);
  }
  return linesDropped(original, subjectXml).filter((line) => {
    const left = droppedByMain.get(line) ?? 0;
    droppedByMain.set(line, left - 1);
    return left === 0;
  });
}

function refusalDifferences(id, mainResult, subjectResult) {
  if (mainResult.refused === subjectResult.refused) {
    return [];
  }
  return [`${id}: main ${mainResult.refused ?? 'writes'}, subject ${subjectResult.refused ?? 'writes'}`];
}

export default {
  name: 'bytes',
  inputs() {
    return corpusEdits().flatMap(({ model, roundtrip }) => Object.entries(roundtrip)
      .map(([variant, { ops, layout }]) => ({ id: `${model}#${variant}`, model, ops, layout })));
  },
  async compare({ id, model, ops, layout }, { main, subject }) {
    const original = readCorpus(model);
    const [mainResult, subjectResult] = [await main.edit(original, ops, { layout }), await subject.edit(original, ops, { layout })];
    if (mainResult.refused || subjectResult.refused) {
      return { differences: refusalDifferences(id, mainResult, subjectResult), measures: { refused: 1 } };
    }
    const { changedLines } = await loadRoundtrip();
    const [mainLines, subjectLines] = [changedLines(original, mainResult.xml), changedLines(original, subjectResult.xml)];
    const differences = [];
    if (mainResult.xml === original && subjectResult.xml !== original) {
      differences.push(`${id}: main keeps the file byte for byte, the subject does not`);
    }
    if (subjectLines > mainLines) {
      differences.push(`${id}: ${subjectLines} changed lines, main ${mainLines}`);
    }
    const dropped = dropsMainKeeps(original, mainResult.xml, subjectResult.xml);
    if (dropped.length) {
      differences.push(`${id}: changes ${dropped.length} lines main keeps, first: ${dropped[0].trim()}`);
    }
    return { differences, measures: { identical: subjectResult.xml === original ? 1 : 0, mainLines, subjectLines } };
  },
  conclude(measures) {
    const total = (name) => measures.reduce((sum, measure) => sum + (measure[name] ?? 0), 0);
    return { measures: { 'byte-identical': total('identical'), refused: total('refused'), 'changed lines': `${total('subjectLines')} (main ${total('mainLines')})` } };
  },
};
