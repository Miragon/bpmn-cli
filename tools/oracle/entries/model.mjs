import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { openBuild } from '../lib/build-side.mjs';
import { MAIN_ROOT, REPO_ROOT } from '../lib/paths.mjs';

function loadModel() {
  const { outputFiles } = buildSync({ entryPoints: [join(REPO_ROOT, 'src/model/index.ts')], bundle: true, platform: 'browser', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

async function attempt(action) {
  try {
    return await action();
  } catch (error) {
    return { refused: error.code ?? error.name, reason: error.message };
  }
}

function isSetName(ops) {
  return ops.length === 1 && ops[0].op === 'set' && Object.keys(ops[0].values).join() === 'name';
}

async function setName({ DocumentReader, DocumentWriter }, xml, { id, values }) {
  const document = await new DocumentReader().readForWrite(xml);
  document.assertLossless();
  document.tree.require(id).set('name', values.name);
  return { xml: await new DocumentWriter().write(document) };
}

export default {
  name: 'model',
  describes: 'src/model: a file read and written back, and a name changed through BpmnElement; add operations stand in from main until edit exists',
  probes: ['bytes'],
  async open() {
    const [model, main] = await Promise.all([loadModel(), openBuild(MAIN_ROOT)]);
    return {
      edit: (xml, ops, options) => (isSetName(ops) ? attempt(() => setName(model, xml, ops[0])) : main.edit(xml, ops, options)),
    };
  },
};
