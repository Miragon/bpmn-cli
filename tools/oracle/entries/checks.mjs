import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { loadMainApi } from '../lib/main-tools.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';

const ENTRY_SOURCE = `export { ModelChecks } from './src/checks/index.ts'; export { DocumentReader } from './src/model/index.ts';`;

function loadChecks() {
  const { outputFiles } = buildSync({ stdin: { contents: ENTRY_SOURCE, resolveDir: REPO_ROOT, loader: 'ts' }, bundle: true, platform: 'browser', format: 'esm', write: false, absWorkingDir: join(REPO_ROOT) });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

async function attempt(action) {
  try {
    return await action();
  } catch (error) {
    return { refused: error.code ?? error.name, reason: error.message };
  }
}

function mainRows({ errors, warnings }) {
  const row = (finding, severity) => ({ code: finding.code, severity, element: finding.element ?? '-' });
  return [...errors.map((finding) => row(finding, 'error')), ...warnings.map((finding) => row(finding, finding.severity ?? 'warning'))];
}

const mainSide = {
  findings: (xml, platform) => attempt(async () => {
    const { Doc, loadProfiles, validateDoc } = await loadMainApi();
    await loadProfiles();
    return { rows: mainRows(validateDoc(await Doc.fromXml(xml), { platform })) };
  }),
};

function subjectSide({ DocumentReader, ModelChecks }) {
  return {
    findings: (xml, platform) => attempt(async () => {
      const findings = new ModelChecks(await new DocumentReader().read(xml), platform).all();
      return { rows: findings.map(({ code, severity, element }) => ({ code, severity, element: element ?? '-' })) };
    }),
  };
}

export default {
  name: 'checks',
  describes: "ModelChecks against main's validateDoc, which holds main's structural validator and profiles and neither the project lint nor the layout dry run",
  probes: ['findings'],
  open: loadChecks,
  sidesFor: (_input, checks) => ({ main: mainSide, subject: subjectSide(checks) }),
};
