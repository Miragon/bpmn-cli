import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODULE_FIRST = ['module', 'main'];

export function bundlesOf(root) {
  const { dependencies = {} } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const both = { absWorkingDir: root, bundle: true, splitting: true, format: 'esm', mainFields: MODULE_FIRST, external: Object.keys(dependencies), outdir: 'dist', logLevel: 'warning' };
  return {
    library: { ...both, entryPoints: { index: 'src/index.ts' }, platform: 'neutral', chunkNames: 'library/[name]-[hash]' },
    cli: { ...both, entryPoints: { cli: 'src/cli/index.ts' }, platform: 'node', target: 'node24', chunkNames: 'cli/[name]-[hash]' },
  };
}
