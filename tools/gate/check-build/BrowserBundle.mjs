import { join } from 'node:path';
import { build } from 'esbuild';

const NODE_GLOBALS = ['process', 'Buffer', 'global', 'require', '__dirname', '__filename', 'setImmediate', 'clearImmediate'];
const SENTINEL = '__ISO_NODE_GLOBAL_';

export class BrowserBundle {
  constructor(root) {
    this.root = root;
  }

  build(options) {
    const define = Object.fromEntries(NODE_GLOBALS.map((name) => [name, `${SENTINEL}${name}`]));
    const browser = { bundle: true, platform: 'browser', format: 'esm', target: 'es2022', absWorkingDir: this.root, define, write: false, metafile: true, logLevel: 'silent' };
    const output = options.outdir ? {} : { outfile: join(this.root, '.iso-out.js') };
    return build({ ...browser, ...output, ...options });
  }

  nodeGlobalsIn(code) {
    return [...code.matchAll(new RegExp(`${SENTINEL}(\\w+)`, 'g'))].map((use) => ({ name: use[1], module: this.moduleAt(code, use.index) }));
  }

  moduleAt(code, offset) {
    const marks = [...code.slice(0, offset).matchAll(/^\s*\/\/ (\S+\.(?:[cm]?[jt]s|json))$/gm)];
    return marks.at(-1)?.[1] ?? '?';
  }
}
