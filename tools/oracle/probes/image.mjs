import { corpusModels, readCorpus } from '../lib/corpus.mjs';
import { rasterise } from '../lib/main-tools.mjs';

const MAX_DIFFERING_SHARE = 0.005;

function differingShare(first, second) {
  const width = Math.max(first.width, second.width);
  const height = Math.max(first.height, second.height);
  const sharedWidth = Math.min(first.width, second.width);
  const sharedHeight = Math.min(first.height, second.height);
  let differing = width * height - sharedWidth * sharedHeight;
  for (let row = 0; row < sharedHeight; row++) {
    for (let column = 0; column < sharedWidth; column++) {
      const firstPixel = (row * first.width + column) * 4;
      const secondPixel = (row * second.width + column) * 4;
      const same = [0, 1, 2, 3].every((channel) => first.pixels[firstPixel + channel] === second.pixels[secondPixel + channel]);
      differing += same ? 0 : 1;
    }
  }
  return differing / (width * height);
}

async function planeDifference(id, mainDrawn, subjectDrawn) {
  if (mainDrawn.refused || subjectDrawn.refused) {
    return mainDrawn.refused === subjectDrawn.refused ? { share: 0 } : { text: `${id}: main ${mainDrawn.refused ?? 'draws it'}, subject ${subjectDrawn.refused ?? 'draws it'}` };
  }
  if (mainDrawn.svg === subjectDrawn.svg) {
    return { share: 0 };
  }
  const [mainImage, subjectImage] = [await rasterise(mainDrawn.svg), await rasterise(subjectDrawn.svg)];
  if (mainImage.refused || subjectImage.refused) {
    return mainImage.refused === subjectImage.refused ? { share: 0 } : { text: `${id}: rasterising main ${mainImage.refused ?? 'works'}, subject ${subjectImage.refused ?? 'works'}` };
  }
  const share = differingShare(mainImage, subjectImage);
  return share > MAX_DIFFERING_SHARE ? { share, text: `${id}: ${(share * 100).toFixed(2)} % of pixels differ` } : { share };
}

export default {
  name: 'image',
  inputs() {
    return corpusModels('models', 'layout').map((model) => ({ id: model, model }));
  },
  async compare({ id, model }, { main, subject }) {
    const xml = readCorpus(model);
    const first = await main.render(xml);
    const planes = first.refused ? [undefined] : [first.plane, ...first.planes];
    const differences = [];
    let rasterised = 0;
    for (const plane of planes) {
      const mainDrawn = plane === planes[0] ? first : await main.render(xml, plane);
      const { share, text } = await planeDifference(`${id}@${plane}`, mainDrawn, await subject.render(xml, plane));
      rasterised += share > 0 ? 1 : 0;
      if (text) {
        differences.push(text);
      }
    }
    return { differences, measures: { planes: planes.length, rasterised } };
  },
  conclude(measures) {
    const total = (name) => measures.reduce((sum, measure) => sum + measure[name], 0);
    return { measures: { planes: total('planes'), 'planes with any pixel off': total('rasterised') } };
  },
};
