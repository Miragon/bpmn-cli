#!/usr/bin/env node
/**
 * The isomorphism check of `npm run gate` (and so of CI): the published core
 * entry must run in a browser, and its bundles stay within their budgets.
 *
 *   npm run build && node tools/iso/check.mjs [--json | --table]
 *
 * Contract: bundles dist/index.js (the "." export) with esbuild for
 * platform=browser (tools/iso/bundle.mjs) and exits 1 when
 *  - it imports a Node builtin or references a Node-only global (process,
 *    Buffer, global, require, __dirname, ...), naming the module;
 *  - the bundle contains the node layer (dist/node/) or the CLI (dist/cli.js);
 *  - a module of the engine rules that load on demand (ON_DEMAND: the
 *    Camunda 7 and Camunda 8 profile, src/platform/profiles/profile.ts LOADERS) is
 *    in the initial chunks of the whole entry or of the applyToXml-only
 *    entry, naming the module, or is no chunk of its own;
 *  - a module of those rules imports (statically, also through another
 *    rule module) a module the entry loads, naming both: Rollup / Vite put
 *    such a module into the host's entry chunk and make the rule chunk
 *    import the entry chunk back, so a host whose entry module awaits a
 *    Camunda 7 / 8 call at top level would wait forever (the rules get
 *    what they use of the core from src/platform/profiles/rule-kit.ts instead);
 *  - a size is over its budget in tools/iso/budget.json (KB = 1024 bytes,
 *    minified and gzip: the initial chunks of both entries, the on-demand
 *    rule chunks of both); raising a budget is an explicit diff of that file;
 *  - package.json "exports" do not resolve "." to dist/index.js and "./node"
 *    to dist/node/index.js, or their type declarations are missing;
 *  - a strict TypeScript consumer (skipLibCheck false, no @types/node, lib
 *    ES2022 only) of both entries does not compile against dist's types.
 * It prints the minified and gzipped size of the whole entry and of an entry
 * that only imports applyToXml (what a host that tree-shakes pays), split
 * like a host's bundler would: the initial chunks (the entry chunk and what
 * it imports statically), and what is loaded on demand (the Camunda 7 /
 * Camunda 8 rules, the first time a document of that platform is
 * validated; bpmn-auto-layout, only for engine 'auto'). `--table` prints the
 * "Browser bundles" table of docs/library.md instead, `--json` everything as JSON.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleCore, kb, ROOT } from './bundle.mjs';

const json = process.argv.includes('--json');
const table = process.argv.includes('--table');
const problems = [];

/** What loads on demand, by the module that marks its chunk; `rules`: modules that must never be in the initial chunks. */
const ON_DEMAND = [
  { name: 'c7', label: 'Camunda 7 rules', marker: 'dist/platform/profiles/C7Profile.js', rules: ['dist/platform/profiles/C7Profile.js', 'dist/platform/profiles/EngineProfile.js', 'dist/platform/profiles/utils/element.js', 'dist/platform/profiles/utils/hint.js'], when: "the first Camunda 7 document a call validates (`loadProfile('c7')` prefetches it)" },
  { name: 'c8', label: 'Camunda 8 rules', marker: 'dist/platform/profiles/C8Profile.js', rules: ['dist/platform/profiles/C8Profile.js', 'dist/platform/profiles/EngineProfile.js', 'dist/platform/profiles/utils/element.js', 'dist/platform/profiles/utils/hint.js', 'dist/platform/profiles/FeelExpression.js', 'dist/platform/profiles/FeelParser.js', 'dist/platform/profiles/FeelError.js', 'dist/platform/profiles/TimerValue.js', 'dist/platform/profiles/SchemaText.js', 'dist/platform/profiles/BpmnSchema.js'], when: "the first Camunda 8 document a call validates (`loadProfile('c8')` prefetches it)" },
  { name: 'bpmn-auto-layout', label: 'bpmn-auto-layout', marker: /node_modules\/bpmn-auto-layout\//, rules: [], when: "only for `engine: 'auto'`" },
];
const ENTRIES = [
  { key: 'core', label: 'whole entry', name: 'the whole entry', title: 'everything `@miragon/bpmn-cli` exports' },
  { key: 'applyToXmlOnly', label: 'applyToXml only', name: 'the applyToXml-only entry', title: '`applyToXml` only (tree-shaken)' },
];
const BUDGET_FILE = join('tools', 'iso', 'budget.json');
const budget = JSON.parse(readFileSync(join(ROOT, BUDGET_FILE), 'utf8'));

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
const CONSUMER = `import { applyToXml, loadProfile, newXml, renderSvg, validateXml, viewXml, type EditResult, type RenderResult } from '@miragon/bpmn-cli';
import { mutateFile, renderPng, type FileMutationOptions, type PngRenderResult } from '@miragon/bpmn-cli/node';
export async function demo(): Promise<string> {
  await loadProfile('c7');
  const created: EditResult = await newXml({ processName: 'Order' });
  const edited = await applyToXml(created.xml, [{ op: 'add', kind: 'start', name: 'Received' }], { layout: 'auto' });
  const report = await validateXml(edited.xml, { platform: 'auto' });
  const detail = await viewXml(edited.xml, { id: 'Event_Received' });
  const image: RenderResult = await renderSvg(edited.xml, { maxSize: 800, around: { id: 'Event_Received', depth: 1 }, problems: true, highlight: { created: ['Event_Received'] } });
  const png: PngRenderResult = await renderPng(edited.xml, { plane: image.plane, tiles: true });
  const opts: FileMutationOptions = { dryRun: true };
  void mutateFile;
  return [report.ok, detail.kind, edited.result.created.length, opts.dryRun, image.tokens, image.problems.length, image.nodes?.length, png.images[0]?.png.byteLength].join();
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

/**
 * Size of what loads with the entry (its chunk and the chunks it imports
 * statically) and of each part that loads on demand (ON_DEMAND: the chunk
 * with its marker module and the on-demand chunks it imports statically;
 * the rest named by its packages).
 */
function sizeOf(b) {
  if (!b.entry) throw new Error('isomorphism check: the bundle has no entry chunk');
  const byPath = new Map(b.chunks.map((c) => [c.path, c]));
  const closure = (start, skip = new Set()) => {
    const seen = new Set();
    const visit = (c) => {
      if (!c || seen.has(c) || skip.has(c)) return;
      seen.add(c);
      for (const p of c.imports) visit(byPath.get(p));
    };
    visit(start);
    return seen;
  };
  const initial = closure(b.entry);
  // the modules the entry loads statically, and what a rule module imports of them
  const reach = (start) => {
    const seen = new Set();
    const visit = (f) => {
      if (seen.has(f) || !b.graph[f]) return;
      seen.add(f);
      for (const g of b.graph[f]) visit(g);
    };
    visit(start);
    return seen;
  };
  const entryModules = reach(b.entry.entryPoint);
  const importsOfEntry = (marker) => [...reach(marker)].filter((f) => !entryModules.has(f)).flatMap((f) => b.graph[f].filter((g) => entryModules.has(g)).map((g) => ({ from: f, to: g })));
  const sum = (chunks) => ({ bytes: [...chunks].reduce((n, c) => n + c.bytes, 0), gzip: [...chunks].reduce((n, c) => n + c.gzip, 0) });
  const lazy = b.chunks.filter((c) => !initial.has(c));
  const counted = new Set();
  const onDemand = [];
  for (const part of ON_DEMAND) {
    const has = (f) => (typeof part.marker === 'string' ? f === part.marker : part.marker.test(f));
    const root = lazy.find((c) => c.inputs.some(has));
    if (!root) continue;
    const chunks = closure(root, initial);
    for (const c of chunks) counted.add(c);
    onDemand.push({ name: part.name, label: part.label, ...sum(chunks), modules: [...chunks].flatMap((c) => c.inputs), importsOfEntry: part.rules.length ? importsOfEntry(part.marker) : [] });
  }
  const rest = lazy.filter((c) => !counted.has(c));
  if (rest.length) {
    const packages = [...new Set(rest.flatMap((c) => c.inputs).map((f) => /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(f)?.[1] ?? f))];
    onDemand.push({ name: 'other', label: packages.join(', '), ...sum(rest), modules: rest.flatMap((c) => c.inputs) });
  }
  return { ...sum(initial), modules: b.inputs.length, initialModules: [...initial].flatMap((c) => c.inputs), onDemand };
}

const sizes = Object.fromEntries([['core', full], ['applyToXmlOnly', lean]].filter(([, b]) => b && !b.violations.length).map(([key, b]) => [key, sizeOf(b)]));

/* 5. the engine rules load on demand, and every size is within its budget */
const KB = 1024;
const overBudget = (what, size, limit) => {
  if (!limit) return problems.push(`${BUDGET_FILE} has no budget for ${what}`);
  for (const unit of ['minified', 'gzip']) {
    const bytes = unit === 'minified' ? size.bytes : size.gzip;
    if (bytes > limit[unit] * KB) problems.push(`${what} is ${kb(bytes)} ${unit}, over its budget of ${limit[unit]} KB (${BUDGET_FILE}; raise it only in the change that needs it, with the reason)`);
  }
};
for (const entry of ENTRIES) {
  const s = sizes[entry.key];
  if (!s) continue;
  for (const part of ON_DEMAND) {
    for (const f of part.rules) {
      if (s.initialModules.includes(f)) problems.push(`the initial chunks of ${entry.name} contain ${f}: the ${part.label} load on demand (only src/platform/profiles/profile.ts imports them, with import())`);
    }
    if (part.rules.length && !s.onDemand.some((d) => d.name === part.name)) problems.push(`${entry.name} has no on-demand chunk with ${part.marker} (the ${part.label})`);
    for (const { from, to } of s.onDemand.find((d) => d.name === part.name)?.importsOfEntry ?? []) {
      problems.push(`${from} imports ${to}, which ${entry.name} loads too: a host's bundler (Rollup / Vite) puts it into the entry chunk and makes the ${part.label} chunk import the entry chunk back, so a host whose entry module awaits a call at top level waits forever; hand it to the rules in src/platform/profiles/rule-kit.ts (RULE_KIT) instead of importing it`);
    }
  }
  overBudget(entry.name, s, budget.entries?.[entry.label]);
  for (const d of s.onDemand) {
    if (budget.onDemand?.[d.name] !== undefined || ON_DEMAND.find((p) => p.name === d.name)?.rules.length) overBudget(`the ${d.label} chunk of ${entry.name}`, d, budget.onDemand?.[d.name]);
  }
}

function sizeLine(label, s) {
  const lazy = s.onDemand.length ? ` + on demand: ${s.onDemand.map((d) => `${d.label} ${kb(d.bytes)} / ${kb(d.gzip)}`).join(', ')}` : '';
  return `  ${label}: minified ${kb(s.bytes)}, gzip ${kb(s.gzip)}${lazy}`;
}

/** The "Browser bundles" table of docs/library.md (KB = 1024 bytes). */
function sizeTable() {
  const fmt = (bytes) => `${(bytes / KB).toFixed(1)} KB`;
  const limit = (b) => (b ? `${b.minified} / ${b.gzip} KB` : 'none');
  const rows = ['| bundle | minified | gzip | budget (tools/iso/budget.json) | loads |', '| --- | ---: | ---: | ---: | --- |'];
  for (const entry of ENTRIES) {
    const s = sizes[entry.key];
    if (s) rows.push(`| ${entry.title} | ${fmt(s.bytes)} | ${fmt(s.gzip)} | ${limit(budget.entries?.[entry.label])} | with the entry |`);
  }
  // the on-demand chunks are the same for both entries (the measured ones of the applyToXml-only entry)
  const lazy = (sizes.applyToXmlOnly ?? sizes.core)?.onDemand ?? [];
  for (const d of lazy) {
    const part = ON_DEMAND.find((p) => p.name === d.name);
    const modules = part?.rules.length ? ` (${part.rules.map((f) => `\`${f.replace(/^dist\//, '').replace(/\.js$/, '')}\``).join(', ')})` : '';
    rows.push(`| ${d.label}${modules} | ${fmt(d.bytes)} | ${fmt(d.gzip)} | ${limit(budget.onDemand?.[d.name])} | on demand: ${part?.when ?? 'on demand'} |`);
  }
  return rows.join('\n');
}

const publicSizes = Object.fromEntries(Object.entries(sizes).map(([k, { initialModules: _m, onDemand, ...s }]) => [k, { ...s, onDemand: onDemand.map(({ modules, importsOfEntry: _i, ...d }) => ({ ...d, modules: modules.length })) }]));
if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems, sizes: publicSizes, budget }, null, 2));
} else if (table && !problems.length) {
  console.log(sizeTable());
} else {
  if (!problems.length) {
    console.log(`isomorphic: dist/index.js bundles for the browser without Node builtins or globals (${full.inputs.length} modules); the exports and their types resolve for a strict consumer; the engine rules load on demand and import nothing the entry loads; every size is within ${BUDGET_FILE}`);
    for (const entry of ENTRIES) if (sizes[entry.key]) console.log(sizeLine(entry.label, sizes[entry.key]));
  }
  for (const p of problems) console.error(`isomorphism check: ${p}`);
}
process.exit(problems.length ? 1 : 0);
