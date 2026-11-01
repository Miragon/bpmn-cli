import { corpusModels, readCorpus } from '../lib/corpus.mjs';
import { hardDefects, harnessScore } from '../lib/main-tools.mjs';

export default {
  name: 'layout',
  inputs() {
    return corpusModels('layout').map((model) => ({ id: model, model }));
  },
  async compare({ id, model }, { main, subject }) {
    const xml = readCorpus(model);
    const [mainDrawing, subjectDrawing] = [await main.layout(xml), await subject.layout(xml)];
    const [mainScore, subjectScore] = [(await harnessScore(mainDrawing)).score, (await harnessScore(subjectDrawing)).score];
    const mainDefects = new Set(await hardDefects(mainDrawing));
    const newDefects = (await hardDefects(subjectDrawing)).filter((defect) => !mainDefects.has(defect));
    const listed = newDefects.map((defect) => `${id}: hard defect main lacks: ${defect}`);
    if (subjectScore > mainScore) {
      listed.push(`${id}: score ${subjectScore}, main ${mainScore}`);
    }
    return { listed, measures: { mainScore, subjectScore } };
  },
  conclude(measures) {
    const total = (name) => measures.reduce((sum, measure) => sum + measure[name], 0);
    const [subjectTotal, mainTotal] = [total('subjectScore'), total('mainScore')];
    return {
      differences: subjectTotal > mainTotal ? [`total over ${measures.length} scenarios: ${subjectTotal}, main ${mainTotal}`] : [],
      measures: { total: subjectTotal, 'main total': mainTotal },
    };
  },
};
