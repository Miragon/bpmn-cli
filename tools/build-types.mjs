#!/usr/bin/env node
/**
 * Second step of `npm run build`: ships the hand-written type shims
 * (src/types/*.d.ts: bpmn-moddle and bpmn-auto-layout ship no usable
 * declarations) with dist, which tsc does not copy, and points the
 * `/// <reference path=... preserve="true" />` of dist/index.d.ts at the
 * copy (tsc writes it relative to the source, ../src/types/...). Without it
 * a consumer's strict typecheck (skipLibCheck false) fails with TS7016 on
 * every declaration that names a bpmn-moddle type; tools/iso/check.mjs
 * compiles such a consumer.
 */
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
cpSync(join(ROOT, 'src', 'types'), join(ROOT, 'dist', 'types'), { recursive: true });
const index = join(ROOT, 'dist', 'index.d.ts');
const text = readFileSync(index, 'utf8');
const fixed = text.replace(/(\/\/\/ <reference path=")\.\.\/src\/types\//g, '$1./types/');
if (!/\/\/\/ <reference path="\.\/types\/vendor\.d\.ts"/.test(fixed)) {
  console.error('build-types: dist/index.d.ts has no reference to ./types/vendor.d.ts');
  process.exit(1);
}
writeFileSync(index, fixed);
