#!/usr/bin/env node
/**
 * The isomorphism check of `npm run gate` (and so of CI): the published core
 * entry must run in a browser.
 *
 *   npm run build && node tools/iso/check.mjs [--json]
 *
 * Contract: bundles dist/index.js (the "." export) with esbuild for
 * platform=browser (tools/iso/bundle.mjs) and exits 1 when
 *  - it imports a Node builtin or references a Node-only global (process,
 *    Buffer, global, require, __dirname, ...), naming the module;
 *  - the bundle contains the node layer (dist/node/) or the CLI (dist/cli.js);
 *  - package.json "exports" do not resolve "." to dist/index.js and "./node"
 *    to dist/node/index.js, or their type declarations are missing;
 *  - a strict TypeScript consumer (skipLibCheck false, no @types/node, lib
 *    ES2022 only) of both entries does not compile against dist's types.
 * It prints the minified and gzipped size of the whole entry and of an entry
 * that only imports applyToXml (what a host that tree-shakes pays), split
 * like a host's bundler would: the entry chunk, plus what is loaded on
 * demand (bpmn-auto-layout, only for engine 'auto').
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleCore, kb, ROOT } from './bundle.mjs';

const json = process.argv.includes('--json');
const problems = [];

if (!existsSync(join(ROOT, 'dist', 'index.js'))) {
  console.error('isomorphism check: dist/index.js is missing; run `npm run build` first');
  process.exit(1);
}

/* 1. the core entry in a browser bundle */
const full = await bundleCore({ entry: join('dist', 'index.js'), splitting: true });
for (const v of full.violations) {
  problems.push(v.kind === 'global' ? `${v.file}: uses the Node-only global \`${v.what}\`` : `${v.file}${v.line ? `:${v.line}` : ''}: ${v.kind === 'builtin' ? `imports the Node builtin "${v.what}"` : v.text}`);
}
for (const f of full.inputs) {
  if (/^dist\/(node\/|cli\.js$)/.test(f)) problems.push(`the core bundle contains ${f} (Node only)`);
}

/* 2. what a host pays for the edit engine alone */
const lean = full.violations.length ? undefined : await bundleCore({ stdin: { contents: "export { applyToXml } from './dist/index.js';", sourcefile: 'apply-only.ts' }, splitting: true });

/* 3. the package entries */
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const expected = { '.': join('dist', 'index.js'), './node': join('dist', 'node', 'index.js') };
for (const [sub, file] of Object.entries(expected)) {
  const spec = sub === '.' ? pkg.name : `${pkg.name}/${sub.slice(2)}`;
  let resolved;
  try {
    resolved = fileURLToPath(import.meta.resolve(spec));
  } catch (err) {
    problems.push(`${spec} does not resolve: ${err.message}`);
    continue;
  }
  if (resolved !== join(ROOT, file)) problems.push(`${spec} resolves to ${resolved}, expected ${file}`);
  const types = pkg.exports?.[sub]?.types;
  if (!types || !existsSync(join(ROOT, types))) problems.push(`${spec}: no type declarations (exports["${sub}"].types = ${types})`);
}

/* 4. a strict consumer of the published types (outside the repository, the package linked by name) */
const CONSUMER = `import { applyToXml, newXml, validateXml, viewXml, type EditResult } from '@miragon/bpmn-cli';
import { mutateFile, type FileMutationOptions } from '@miragon/bpmn-cli/node';
export async function demo(): Promise<string> {
  const created: EditResult = await newXml({ processName: 'Order' });
  const edited = await applyToXml(created.xml, [{ op: 'add', kind: 'start', name: 'Received' }], { layout: 'auto' });
  const report = await validateXml(edited.xml, { platform: 'auto' });
  const detail = await viewXml(edited.xml, { id: 'Event_Received' });
  const opts: FileMutationOptions = { dryRun: true };
  void mutateFile;
  return [report.ok, detail.kind, edited.result.created.length, opts.dryRun].join();
}
`;
const tmp = mkdtempSync(join(tmpdir(), 'bpmn-iso-consumer-'));
try {
  mkdirSync(join(tmp, 'node_modules', '@miragon'), { recursive: true });
  symlinkSync(ROOT, join(tmp, 'node_modules', '@miragon', 'bpmn-cli'), 'dir');
  writeFileSync(join(tmp, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(join(tmp, 'consumer.ts'), CONSUMER);
  const options = { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022'], strict: true, skipLibCheck: false, noEmit: true, types: [] };
  writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify({ compilerOptions: options, files: ['consumer.ts'] }));
  const tsc = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(tmp, 'tsconfig.json')], { encoding: 'utf8', cwd: tmp });
  if (tsc.status !== 0) problems.push(`a strict TypeScript consumer does not compile against the published types:\n${(tsc.stdout + tsc.stderr).trim().split(tmp).join('<consumer>')}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/** Size of what loads with the entry (its chunk and the chunks it imports statically) and of what loads on demand (named by its packages). */
function sizeOf(b) {
  const byPath = new Map(b.chunks.map((c) => [c.path, c]));
  const initial = new Set();
  const visit = (c) => {
    if (!c || initial.has(c)) return;
    initial.add(c);
    for (const p of c.imports) visit(byPath.get(p));
  };
  visit(b.chunks.find((c) => c.entry) ?? b.chunks[0]);
  const lazy = b.chunks.filter((c) => !initial.has(c));
  const entry = { bytes: [...initial].reduce((n, c) => n + c.bytes, 0), gzip: [...initial].reduce((n, c) => n + c.gzip, 0) };
  const packages = [...new Set(lazy.flatMap((c) => c.inputs).map((f) => /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(f)?.[1] ?? f))];
  return { bytes: entry?.bytes ?? 0, gzip: entry?.gzip ?? 0, modules: b.inputs.length, onDemand: { bytes: lazy.reduce((n, c) => n + c.bytes, 0), gzip: lazy.reduce((n, c) => n + c.gzip, 0), packages } };
}

function sizeLine(label, s) {
  const lazy = s.onDemand.bytes ? ` + ${kb(s.onDemand.bytes)} on demand (${s.onDemand.packages.join(', ')})` : '';
  return `  ${label}: minified ${kb(s.bytes)}, gzip ${kb(s.gzip)}${lazy}`;
}

const sizes = { core: sizeOf(full), ...(lean ? { applyToXmlOnly: sizeOf(lean) } : {}) };
if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems, sizes }, null, 2));
} else {
  if (!problems.length) {
    console.log(`isomorphic: dist/index.js bundles for the browser without Node builtins or globals (${full.inputs.length} modules); the exports and their types resolve for a strict consumer`);
    console.log(sizeLine('whole entry', sizes.core));
    if (sizes.applyToXmlOnly) console.log(sizeLine('applyToXml only', sizes.applyToXmlOnly));
  }
  for (const p of problems) console.error(`isomorphism check: ${p}`);
}
process.exit(problems.length ? 1 : 0);
