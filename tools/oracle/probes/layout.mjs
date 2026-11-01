import { corpusModels, readCorpus } from '../lib/corpus.mjs';
import { hardDefects, harnessScore } from '../lib/main-tools.mjs';
import { walkFiles, walkSteps } from '../lib/walks.mjs';

const SCENARIO = 'scenario';
const WALK_STEP = 'walk step';

function scenarioInputs() {
  return corpusModels('layout').map((model) => ({ id: model, model, kind: SCENARIO }));
}

function walkInputs() {
  return walkFiles().flatMap((file) => walkSteps(file).filter((step) => !step.refused).map(({ index }) => ({ id: `walks/${file}#${index}`, file, index, kind: WALK_STEP })));
}

async function scenarioDrawings({ model }, { main, subject }) {
  const xml = readCorpus(model);
  return [await main.layout(xml), await subject.layout(xml)];
}

async function walkDrawings({ file, index }, { subject }) {
  const step = walkSteps(file)[index];
  const drawing = subject.walkStep ? await subject.walkStep(step) : await subject.edit(step.before, step.ops, { layout: 'incremental' });
  return [{ xml: step.after }, drawing];
}

function totalOf(measures, kind, side) {
  return measures.filter((measure) => measure.kind === kind).reduce((sum, measure) => sum + measure[side], 0);
}

function differenceOf(measures, kind) {
  const count = measures.filter((measure) => measure.kind === kind).length;
  const [subjectTotal, mainTotal] = [totalOf(measures, kind, 'subjectScore'), totalOf(measures, kind, 'mainScore')];
  return subjectTotal > mainTotal ? [`total over ${count} ${kind}s: ${subjectTotal}, main ${mainTotal}`] : [];
}

export default {
  name: 'layout',
  inputs() {
    return [...scenarioInputs(), ...walkInputs()];
  },
  async compare(input, sides) {
    const { id, kind } = input;
    const [mainDrawing, subjectDrawing] = await (kind === SCENARIO ? scenarioDrawings(input, sides) : walkDrawings(input, sides));
    if (subjectDrawing.skipped) {
      return { listed: [`${id}: skipped: ${subjectDrawing.skipped}`], measures: { kind, mainScore: 0, subjectScore: 0, skipped: 1 } };
    }
    const [mainScore, subjectScore] = [(await harnessScore(mainDrawing)).score, (await harnessScore(subjectDrawing)).score];
    const mainDefects = new Set(await hardDefects(mainDrawing));
    const newDefects = (await hardDefects(subjectDrawing)).filter((defect) => !mainDefects.has(defect));
    const listed = newDefects.map((defect) => `${id}: hard defect main lacks: ${defect}`);
    if (subjectScore > mainScore) {
      listed.push(`${id}: score ${subjectScore}, main ${mainScore}`);
    }
    return { listed, measures: { kind, mainScore, subjectScore, skipped: 0 } };
  },
  conclude(measures) {
    return {
      differences: [...differenceOf(measures, SCENARIO), ...differenceOf(measures, WALK_STEP)],
      measures: {
        total: totalOf(measures, SCENARIO, 'subjectScore'),
        'main total': totalOf(measures, SCENARIO, 'mainScore'),
        'walk total': totalOf(measures, WALK_STEP, 'subjectScore'),
        'main walk total': totalOf(measures, WALK_STEP, 'mainScore'),
        'walk steps skipped': measures.reduce((sum, measure) => sum + measure.skipped, 0),
      },
    };
  },
};
