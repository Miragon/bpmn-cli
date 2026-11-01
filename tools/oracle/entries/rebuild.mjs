import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { buildSync } from 'esbuild';
import { bundlesOf } from '../../build/bundles.mjs';
import { onRebuild } from '../design-iq-map.mjs';
import { openBuild } from '../lib/build-side.mjs';
import { callCli, validateInProject } from '../lib/cli-call.mjs';
import { MAIN_ROOT, REPO_ROOT, WORK_DIR } from '../lib/paths.mjs';
import { mapOperations, resolveRowAlignsByKind } from '../operation-map.mjs';

const DRAWING_OPERATIONS = new Set(['place', 'align', 'color', 'label', 'route', 'space', 'tidy', 'compact', 'layout']);
const SELECTING_OPERATIONS = ['place', 'align', 'color', 'tidy'];
const EXECUTION_PLATFORMS = { c7: 'Camunda Platform', c8: 'Camunda Cloud' };
const MODELER_NAMESPACE = 'http://camunda.org/schema/modeler/1.0';
const NO_PLANE = 'none';
const CLI_ROOT = join(WORK_DIR, 'rebuild-cli');
const CLI_BINARY = join(CLI_ROOT, 'bpmn.mjs');
const HELP_FOLDERS = ['guide', 'project', 'tables'];

function buildCli() {
  const dist = join(CLI_ROOT, 'dist');
  rmSync(CLI_ROOT, { recursive: true, force: true });
  mkdirSync(CLI_ROOT, { recursive: true });
  buildSync({ ...bundlesOf(REPO_ROOT).cli, outdir: dist });
  for (const folder of HELP_FOLDERS) {
    cpSync(join(REPO_ROOT, 'src/cli/help', folder), join(dist, folder), { recursive: true });
  }
  writeFileSync(CLI_BINARY, `import { Cli } from ${JSON.stringify(pathToFileURL(join(dist, 'cli.js')).href)};\nprocess.exitCode = await new Cli(process).run(process.argv.slice(2));\n`);
}

if (isMainThread) {
  buildCli();
}

function loadPublicSurface() {
  const { outputFiles } = buildSync({ entryPoints: [join(REPO_ROOT, 'src/index.ts')], bundle: true, platform: 'browser', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

async function attempt(action) {
  try {
    return await action();
  } catch (error) {
    return { refused: error.code ?? error.name, reason: error.message };
  }
}

function declaringPlatform(xml, platform) {
  const declared = EXECUTION_PLATFORMS[platform];
  if (!declared) {
    return xml;
  }
  return xml.replace(/<((?:[\w.-]+:)?definitions)\b([^>]*)>/, (_tag, name, attributes) => {
    const others = attributes.replace(/\s[\w.-]+:executionPlatform\s*=\s*("[^"]*"|'[^']*')/, '');
    return `<${name} xmlns:declaredPlatform="${MODELER_NAMESPACE}" declaredPlatform:executionPlatform="${declared}"${others}>`;
  });
}

function rowsOf({ findings }) {
  return findings.map(({ code, severity, element }) => ({ code, severity: severity ?? 'warning', element: element ?? '-' }));
}

function batchesOf(operations) {
  const batches = [[]];
  let drawn = false;
  for (const operation of operations) {
    const isDrawing = DRAWING_OPERATIONS.has(operation.op);
    if (drawn && !isDrawing) {
      batches.push([]);
    }
    drawn = isDrawing;
    batches.at(-1).push(operation);
  }
  return batches;
}

function selectsByKind({ op, kind, via }) {
  return SELECTING_OPERATIONS.includes(op) && (kind || via);
}

async function renderPlane({ renderXml }, xml, plane) {
  const image = await renderXml(xml);
  const drawn = image.plane ?? NO_PLANE;
  const asked = plane === undefined || plane === drawn ? image : await renderXml(xml, { ids: [plane] });
  return { svg: asked.svg, plane: asked.plane ?? NO_PLANE, planes: (image.planes ?? []).filter((candidate) => candidate !== drawn) };
}

function subjectOf(api) {
  const write = (xml, operations, options) => api.applyToXml(xml, mapOperations(operations), options);
  return {
    edit: (xml, operations) => attempt(async () => ({ xml: (await write(xml, operations)).xml })),
    semanticEdit: (xml, operations) => attempt(async () => {
      if (!operations.length) {
        await api.validateXml(xml);
        return { xml, created: [], changed: [], removed: [] };
      }
      const { xml: written, created, changed, removed } = await write(xml, operations).catch((error) => (error.code === 'E_VALIDATION' ? write(xml, operations, { force: true }) : Promise.reject(error)));
      return { xml: written, created, changed, removed };
    }),
    layout: (xml) => attempt(async () => ({ xml: (await api.applyToXml(xml, [{ op: 'layout' }], { force: true })).xml })),
    walkStep: (step) => attempt(async () => {
      const operations = await resolveRowAlignsByKind(step.ops, step.before);
      if (operations.some(selectsByKind)) {
        return { skipped: 'selects by kind, which 1.0 leaves to find' };
      }
      let xml = step.before;
      for (const batch of batchesOf(mapOperations(operations))) {
        ({ xml } = await api.applyToXml(xml, batch, { force: true }));
      }
      return { xml };
    }),
    findings: (xml, platform) => attempt(async () => ({ rows: rowsOf(await api.validateXml(declaringPlatform(xml, platform))) })),
    render: (xml, plane) => attempt(() => renderPlane(api, xml, plane)),
    designIq: (call) => onRebuild(api, call),
    cli: (call) => callCli(CLI_BINARY, call, call.args),
    validateProject: ({ folder, file }) => validateInProject(CLI_BINARY, folder, file),
  };
}

export default {
  name: 'rebuild',
  describes: "the public surface: applyToXml, validateXml and renderXml. 1.0 has no option platform, so a file declares the engine a c7 or c8 input forces, and main answers a none input for the file's own engine. --no-layout goes too, so main answers a roundtrip without layout incrementally, as every 1.0 write draws",
  async open() {
    return subjectOf(await loadPublicSurface());
  },
  async sidesFor(_input, subject) {
    const main = await openBuild(MAIN_ROOT);
    return {
      main: {
        ...main,
        findings: (xml, platform) => main.findings(xml, platform === 'none' ? 'auto' : platform),
        edit: (xml, operations, { layout }) => main.edit(xml, operations, { layout: layout === false ? 'incremental' : layout }),
      },
      subject,
    };
  },
};
