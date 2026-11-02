import { join } from 'node:path';
import { build } from 'esbuild';
import { ImportGraph } from './ImportGraph.mjs';

const CORE_ENTRY = 'src/index.ts';

/**
 * The core's runtime API stays small: every export is a promise to consumers such as design-iq.
 * An extra export has to be a deliberate decision.
 */
export class RuntimeExports {
  constructor(root, budgets) {
    this.root = root;
    this.budget = budgets.runtimeExports;
  }

  async run() {
    const options = { entryPoints: [CORE_ENTRY], bundle: true, format: 'esm', packages: 'external', absWorkingDir: this.root, write: false, metafile: true, logLevel: 'silent' };
    const { metafile } = await build({ ...options, outfile: join(this.root, '.budgets-out.js') });
    const [, { exports }] = new ImportGraph(metafile).outputOf(CORE_ENTRY);
    const problems = exports.length > this.budget ? [`the core has ${exports.length} runtime exports, over its budget of ${this.budget}: ${exports.join(', ')}`] : [];
    return { problems, summary: `${exports.length} runtime exports` };
  }
}
