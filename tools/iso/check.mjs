import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const ROOT = realpathSync(resolve(process.argv[2] ?? '.'));
const NODE_GLOBALS = ['process', 'Buffer', 'global', 'require', '__dirname', '__filename', 'setImmediate', 'clearImmediate'];
const SENTINEL = '__ISO_NODE_GLOBAL_';
const BROWSER_ENTRIES = ['src/index.ts', 'packages/render/src/index.ts'];
const CORE_ENTRY = 'src/index.ts';
const DESIGN_IQ_IMPORTS = ['applyToXml', 'showXml', 'findXml', 'validateXml', 'kindsJson', 'OPS_SCHEMA', 'BpmnError'];
const KILOBYTE = 1024;

const budgets = JSON.parse(readFileSync(join(ROOT, 'budgets.json'), 'utf8'));
const problems = [];

function browserOptions() {
  const define = Object.fromEntries(NODE_GLOBALS.map((name) => [name, `${SENTINEL}${name}`]));
  return { bundle: true, platform: 'browser', format: 'esm', target: 'es2022', absWorkingDir: ROOT, define, write: false, metafile: true, logLevel: 'silent' };
}

function moduleOfOffset(code, offset) {
  const marks = [...code.slice(0, offset).matchAll(/^\s*\/\/ (\S+\.(?:[cm]?[jt]s|json))$/gm)];
  return marks.at(-1)?.[1] ?? '?';
}

function nodeGlobalsIn(entry, code) {
  const uses = [...code.matchAll(new RegExp(`${SENTINEL}(\\w+)`, 'g'))];
  return uses.map((use) => `${entry}: ${moduleOfOffset(code, use.index)} uses the Node-only global ${use[1]}`);
}

async function checkBrowserEntry(entry) {
  try {
    const { outputFiles } = await build({ ...browserOptions(), entryPoints: [entry], outfile: join(ROOT, '.iso-out.js') });
    problems.push(...new Set(nodeGlobalsIn(entry, outputFiles[0].text)));
  } catch (failure) {
    if (!failure.errors) {
      throw failure;
    }
    problems.push(...failure.errors.map(({ text, location }) => `${entry}: ${location?.file ?? '?'}: ${text}`));
  }
}

async function exportedNames(entry) {
  const { metafile } = await build({ ...browserOptions(), entryPoints: [entry], outfile: join(ROOT, '.iso-out.js') });
  return Object.values(metafile.outputs).find((output) => output.entryPoint === entry).exports;
}

function initialBytes(metafile, entryOutput) {
  const seen = new Set();
  const visit = (path) => {
    if (seen.has(path)) {
      return;
    }
    seen.add(path);
    metafile.outputs[path].imports.filter(({ kind }) => kind === 'import-statement').forEach(({ path: imported }) => visit(imported));
  };
  visit(entryOutput);
  return [...seen].reduce((sum, path) => sum + metafile.outputs[path].bytes, 0);
}

async function checkDesignIqImports() {
  const available = new Set(await exportedNames(CORE_ENTRY));
  const imported = DESIGN_IQ_IMPORTS.filter((name) => available.has(name));
  const contents = imported.length > 0 ? `export { ${imported.join(', ')} } from './${CORE_ENTRY}';` : 'export {};';
  const stdin = { contents, resolveDir: ROOT, sourcefile: 'design-iq.ts', loader: 'ts' };
  const { metafile } = await build({ ...browserOptions(), stdin, minify: true, splitting: true, outdir: join(ROOT, '.iso-out') });
  const [entryOutput] = Object.entries(metafile.outputs).find(([, output]) => output.entryPoint === 'design-iq.ts');
  const kilobytes = initialBytes(metafile, entryOutput) / KILOBYTE;
  if (kilobytes > budgets.designIqImportKilobytes) {
    problems.push(`design-iq's import set is ${kilobytes.toFixed(1)} KB, over its ${budgets.designIqImportKilobytes} KB`);
  }
  return { imported: imported.length, kilobytes };
}

for (const entry of BROWSER_ENTRIES) {
  await checkBrowserEntry(entry);
}
const designIq = problems.length === 0 ? await checkDesignIqImports() : undefined;

for (const problem of problems) {
  console.error(`iso: ${problem}`);
}
if (problems.length > 0) {
  process.exit(1);
}
console.log(`iso: ${BROWSER_ENTRIES.join(', ')} run in a browser; design-iq's ${designIq.imported} of ${DESIGN_IQ_IMPORTS.length} imports weigh ${designIq.kilobytes.toFixed(1)} KB`);
