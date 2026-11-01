import { buildSync } from 'esbuild';
import { openBuild } from '../lib/build-side.mjs';
import { MAIN_ROOT, REPO_ROOT } from '../lib/paths.mjs';
import { mapOperations } from '../operation-map.mjs';

const ENTRY_SOURCE = `export { ModelOperationRunner } from './src/edit/index.ts'; export { OperationParser } from './src/operations/index.ts'; export { DocumentReader, DocumentWriter } from './src/model/index.ts';`;

function loadEdit() {
  const { outputFiles } = buildSync({ stdin: { contents: ENTRY_SOURCE, resolveDir: REPO_ROOT, loader: 'ts' }, bundle: true, platform: 'browser', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

async function attempt(action) {
  try {
    return await action();
  } catch (error) {
    return { refused: error.code ?? error.name, reason: error.message };
  }
}

function subjectSide({ DocumentReader, DocumentWriter, ModelOperationRunner, OperationParser }) {
  return {
    semanticEdit: (xml, ops) => attempt(async () => {
      const document = await new DocumentReader().readForWrite(xml);
      document.assertLossless();
      const { changes } = new ModelOperationRunner(document).run(new OperationParser().parse(mapOperations(ops)));
      const { created, changed, removed } = changes;
      return { xml: await new DocumentWriter().write(document, changes), created, changed, removed };
    }),
  };
}

export default {
  name: 'edit',
  describes: "ModelOperationRunner against main's mutateDoc with layout: false, without its validation of the outcome, which write answers for",
  probes: ['edits'],
  open: loadEdit,
  sidesFor: async (_input, edit) => ({ main: await openBuild(MAIN_ROOT), subject: subjectSide(edit) }),
};
