import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { onMain } from '../design-iq-map.mjs';

async function attempt(action) {
  try {
    return await action();
  } catch (error) {
    return { refused: error.code ?? error.name, reason: error.message };
  }
}

function findingRows(report) {
  const row = (finding, severity) => ({ code: finding.code, severity, element: finding.element ?? '-' });
  return [
    ...report.errors.map((finding) => row(finding, 'error')),
    ...report.warnings.map((finding) => row(finding, finding.severity ?? 'warning')),
  ];
}

export async function openBuild(root) {
  const api = await import(pathToFileURL(join(root, 'dist', 'index.js')).href);
  return {
    edit: (xml, ops, { layout }) => attempt(async () => {
      const result = await api.mutateDoc(await api.Doc.fromXml(xml), ops, { dryRun: true, layout });
      return { xml: result.xml };
    }),
    semanticEdit: (xml, ops) => attempt(async () => {
      const write = async (force) => api.mutateDoc(await api.Doc.fromXml(xml), ops, { dryRun: true, layout: false, force });
      const result = await write(false).catch((error) => (error.code === 'E_VALIDATION' ? write(true) : Promise.reject(error)));
      const { created, changed, removed } = result.changes;
      return { xml: result.xml, created, changed, removed };
    }),
    layout: (xml) => attempt(async () => ({ xml: (await api.layoutXml(xml, { force: true })).xml })),
    findings: (xml, platform) => attempt(async () => ({ rows: findingRows(await api.validateXml(xml, { platform })) })),
    render: (xml, plane) => attempt(async () => {
      const { svg, plane: drawn, planes } = await api.renderSvg(xml, plane === undefined ? {} : { plane });
      return { svg, plane: drawn, planes };
    }),
    designIq: (call) => onMain(api, call),
  };
}
