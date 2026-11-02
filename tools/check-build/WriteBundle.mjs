import { join } from 'node:path';
import { build } from 'esbuild';
import { bundlesOf } from '../build/bundles.mjs';
import { ImportGraph } from './ImportGraph.mjs';

const STATIC = 'import-statement';
const CLI_ENTRY = 'src/cli/index.ts';
const WRITE_COMMANDS = ['src/cli/commands/EditCommand.ts', 'src/cli/commands/ApplyCommand.ts'];
const NEVER_ON_A_WRITE = [
  { name: 'the painter', path: /^packages\/render\/src\/(?!text\/)/ },
  { name: 'project lint', path: /^packages\/lint\// },
  { name: 'camunda-compat', path: /(^|\/)bpmnlint-plugin-camunda-compat(\/|$)/ },
  { name: 'bpmnlint', path: /(^|\/)node_modules\/bpmnlint\/|^bpmnlint(\/|$)/ },
  { name: 'the bpmnlint plugin', path: /(^|\/)@miragon\/bpmnlint-plugin-rules(\/|$)/ },
  { name: 'resvg', path: /(^|\/)@resvg\/resvg-wasm(\/|$)/ },
];

/**
 * edit and apply are the commands agents call most, and every millisecond of their start-up counts.
 * The painter, bpmnlint and resvg are heavy and must load only on demand, never on a write.
 */
export class WriteBundle {
  constructor(root) {
    this.root = root;
  }

  async run() {
    const { library, cli } = bundlesOf(this.root);
    const problems = [...(await this.cliProblems(cli)), ...(await this.libraryProblems(library))];
    return { problems, summary: 'a write loads neither the painter nor bpmnlint nor camunda-compat' };
  }

  async cliProblems(cli) {
    const metafile = await this.metafileOf(cli);
    const writeOutputs = Object.entries(metafile.outputs)
      .filter(([, output]) => output.entryPoint === CLI_ENTRY || WRITE_COMMANDS.some((input) => output.inputs[input]?.bytesInOutput > 0))
      .map(([path]) => path);
    return this.offenders(metafile, writeOutputs, [STATIC], 'the CLI');
  }

  async libraryProblems(library) {
    const stdin = { contents: "export { applyToXml } from './src/index.ts';", resolveDir: this.root, sourcefile: 'write.ts', loader: 'ts' };
    const { entryPoints: _entryPoints, ...options } = library;
    const metafile = await this.metafileOf({ ...options, stdin });
    const [entry] = new ImportGraph(metafile).outputOf('write.ts');
    return this.offenders(metafile, [entry], [STATIC, 'dynamic-import'], 'applyToXml');
  }

  async metafileOf(options) {
    const { metafile } = await build({ ...options, write: false, metafile: true, logLevel: 'silent', outdir: join(this.root, '.bundle-out') });
    return metafile;
  }

  offenders(metafile, starts, kinds, entry) {
    const modules = new Set(this.loaded(metafile, new ImportGraph(metafile).reachable(starts, kinds), kinds));
    return NEVER_ON_A_WRITE.flatMap(({ name, path }) => {
      const hit = [...modules].find((module) => path.test(module));
      return hit ? [`${entry} loads ${name} on a write: ${hit}`] : [];
    });
  }

  loaded(metafile, outputs, kinds) {
    return [...outputs].flatMap((path) => {
      const { inputs, imports } = metafile.outputs[path];
      const bundled = Object.entries(inputs).filter(([, { bytesInOutput }]) => bytesInOutput > 0).map(([input]) => input);
      return [...bundled, ...imports.filter(({ kind, external }) => external && kinds.includes(kind)).map(({ path: imported }) => imported)];
    });
  }
}
