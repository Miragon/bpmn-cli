import { corpusModels, readCorpus } from '../lib/corpus.mjs';
import { catalogueCodes } from '../lib/main-tools.mjs';

const PLATFORMS = ['c7', 'c8', 'none'];

const rowText = ({ code, severity, element }) => `${code} ${severity} ${element}`;

function unmatched(rows, others) {
  const remaining = new Map();
  for (const row of others) {
    remaining.set(row, (remaining.get(row) ?? 0) + 1);
  }
  return rows.filter((row) => {
    const left = remaining.get(row) ?? 0;
    remaining.set(row, left - 1);
    return left === 0;
  });
}

export default {
  name: 'findings',
  inputs() {
    return corpusModels('models', 'layout', 'lint', 'engine').flatMap((model) => PLATFORMS.map((platform) => ({ id: `${model}#${platform}`, model, platform })));
  },
  async compare({ id, model, platform }, { main, subject }) {
    const xml = readCorpus(model);
    const [mainResult, subjectResult] = [await main.findings(xml, platform), await subject.findings(xml, platform)];
    if (mainResult.refused || subjectResult.refused) {
      const same = mainResult.refused === subjectResult.refused;
      return { differences: same ? [] : [`${id}: main ${mainResult.refused ?? 'reads it'}, subject ${subjectResult.refused ?? 'reads it'}`], measures: { codes: [] } };
    }
    const [mainRows, subjectRows] = [mainResult.rows.map(rowText), subjectResult.rows.map(rowText)];
    return {
      differences: [
        ...unmatched(mainRows, subjectRows).map((row) => `${id}: main only: ${row}`),
        ...unmatched(subjectRows, mainRows).map((row) => `${id}: subject only: ${row}`),
      ],
      measures: { findings: mainRows.length, codes: [...new Set(mainResult.rows.map(({ code }) => code))] },
    };
  },
  async conclude(measures) {
    const catalogue = new Set(await catalogueCodes());
    const reached = new Set(measures.flatMap(({ codes }) => codes));
    return {
      measures: {
        findings: measures.reduce((sum, { findings = 0 }) => sum + findings, 0),
        'catalogue codes reached': `${[...reached].filter((code) => catalogue.has(code)).length} of ${catalogue.size}`,
      },
    };
  },
};
