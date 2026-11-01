import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { bundlesOf } from './build/bundles.mjs';

const ROOT = realpathSync(resolve(process.argv[2] ?? '.'));
const WRITE_COMMANDS = ['src/cli/commands/EditCommand.ts', 'src/cli/commands/ApplyCommand.ts'];
const NEVER_ON_A_WRITE = [
  { name: 'the painter', path: /^packages\/render\/src\/(?!text\/)/ },
  { name: 'project lint', path: /^packages\/lint\// },
  { name: 'camunda-compat', path: /(^|\/)bpmnlint-plugin-camunda-compat(\/|$)/ },
  { name: 'bpmnlint', path: /(^|\/)node_modules\/bpmnlint\/|^bpmnlint(\/|$)/ },
  { name: 'the bpmnlint plugin', path: /(^|\/)@miragon\/bpmnlint-plugin-rules(\/|$)/ },
  { name: 'resvg', path: /(^|\/)@resvg\/resvg-wasm(\/|$)/ },
];

function reachable(metafile, starts, kinds) {
  const seen = new Set();
  const visit = (path) => {
    if (seen.has(path) || !metafile.outputs[path]) {
      return;
    }
    seen.add(path);
    metafile.outputs[path].imports.filter(({ kind, external }) => kinds.includes(kind) && !external).forEach(({ path: imported }) => visit(imported));
  };
  starts.forEach(visit);
  return seen;
}

function loaded(metafile, outputs) {
  return [...outputs].flatMap((path) => {
    const { inputs, imports } = metafile.outputs[path];
    const bundled = Object.entries(inputs).filter(([, { bytesInOutput }]) => bytesInOutput > 0).map(([input]) => input);
    return [...bundled, ...imports.filter(({ external }) => external).map(({ path: imported }) => imported)];
  });
}

function offenders(metafile, outputs, entry) {
  const modules = new Set(loaded(metafile, outputs));
  return NEVER_ON_A_WRITE.flatMap(({ name, path }) => {
    const hit = [...modules].find((module) => path.test(module));
    return hit ? [`${entry} loads ${name} on a write: ${hit}`] : [];
  });
}

function outputsHolding(metafile, inputs) {
  return Object.entries(metafile.outputs).filter(([, output]) => inputs.some((input) => output.inputs[input]?.bytesInOutput > 0) || (output.entryPoint && output.inputs[output.entryPoint])).map(([path]) => path);
}

async function metafileOf(options) {
  const { metafile } = await build({ ...options, write: false, metafile: true, logLevel: 'silent', outdir: join(ROOT, '.bundle-out') });
  return metafile;
}

async function cliProblems(cli) {
  const metafile = await metafileOf(cli);
  const entries = Object.entries(metafile.outputs).filter(([, { entryPoint }]) => entryPoint).map(([path]) => path);
  const onAWrite = reachable(metafile, [...entries, ...outputsHolding(metafile, WRITE_COMMANDS)], ['import-statement']);
  return offenders(metafile, onAWrite, 'the CLI');
}

async function libraryProblems(library) {
  const stdin = { contents: "export { applyToXml } from './src/index.ts';", resolveDir: ROOT, sourcefile: 'write.ts', loader: 'ts' };
  const { entryPoints: _entryPoints, ...options } = library;
  const metafile = await metafileOf({ ...options, stdin });
  const [entry] = Object.entries(metafile.outputs).find(([, { entryPoint }]) => entryPoint === 'write.ts');
  return offenders(metafile, reachable(metafile, [entry], ['import-statement', 'dynamic-import']), 'applyToXml');
}

const { library, cli } = bundlesOf(ROOT);
const problems = [...(await cliProblems(cli)), ...(await libraryProblems(library))];
for (const problem of problems) {
  console.error(`bundle: ${problem}`);
}
if (problems.length > 0) {
  process.exit(1);
}
console.log('bundle: a write loads neither the painter nor bpmnlint nor camunda-compat');
