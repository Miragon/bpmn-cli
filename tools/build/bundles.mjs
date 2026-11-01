import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..');

const { dependencies } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const BOTH = { absWorkingDir: ROOT, bundle: true, splitting: true, format: 'esm', external: Object.keys(dependencies), outdir: 'dist', logLevel: 'warning' };
const MODULE_FIRST = ['module', 'main'];

export const LIBRARY = { ...BOTH, entryPoints: { index: 'src/index.ts' }, platform: 'neutral', mainFields: MODULE_FIRST, chunkNames: 'library/[name]-[hash]' };
export const CLI = { ...BOTH, entryPoints: { cli: 'src/cli/index.ts' }, platform: 'node', mainFields: MODULE_FIRST, target: 'node24', chunkNames: 'cli/[name]-[hash]' };
