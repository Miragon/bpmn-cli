
import { join } from 'node:path';
import { BrowserBundle } from './BrowserBundle.mjs';
import { ImportGraph } from './ImportGraph.mjs';

const CORE_ENTRY = 'src/index.ts';
const BROWSER_START_IMPORTS = ['applyToXml', 'showXml', 'findXml', 'validateXml', 'kindsJson', 'OPS_SCHEMA', 'BpmnError'];
const KILOBYTE = 1024;

/**
 * A browser editor loads these imports on page start.
 * Their initial bundle size is what its users wait for, so it has a budget.
 */
export class BrowserStartImports {
  constructor(root, budgets) {
    this.root = root;
    this.budget = budgets.browserStartImportKilobytes;
    this.bundle = new BrowserBundle(root);
  }

  async run() {
    const imported = await this.importedNames();
    const kilobytes = (await this.initialBytesOf(imported)) / KILOBYTE;
    const problems = kilobytes > this.budget ? [`the browser start imports are ${kilobytes.toFixed(1)} KB, over their ${this.budget} KB`] : [];
    return { problems, summary: `browser start: ${imported.length} of ${BROWSER_START_IMPORTS.length} imports weigh ${kilobytes.toFixed(1)} KB` };
  }

  async importedNames() {
    const { metafile } = await this.bundle.build({ entryPoints: [CORE_ENTRY] });
    const [, core] = new ImportGraph(metafile).outputOf(CORE_ENTRY);
    const available = new Set(core.exports);
    return BROWSER_START_IMPORTS.filter((name) => available.has(name));
  }

  async initialBytesOf(imported) {
    const contents = imported.length > 0 ? `export { ${imported.join(', ')} } from './${CORE_ENTRY}';` : 'export {};';
    const stdin = { contents, resolveDir: this.root, sourcefile: 'browser-start.ts', loader: 'ts' };
    const { metafile } = await this.bundle.build({ stdin, minify: true, splitting: true, outdir: join(this.root, '.iso-out') });
    const graph = new ImportGraph(metafile);
    const [entryOutput] = graph.outputOf('browser-start.ts');
    return [...graph.reachable([entryOutput], ['import-statement'])].reduce((sum, path) => sum + metafile.outputs[path].bytes, 0);
  }
}
