#!/usr/bin/env node
/**
 * Roundtrip fidelity on a corpus: how much of a file a write changes.
 *
 *   npm run build
 *   node tools/roundtrip.mjs                         # tools/scenarios + test/fixtures
 *   node tools/roundtrip.mjs <dir|file>...           # e.g. a private corpus (never commit it)
 *   BPMN_BENCH_CORPUS="hand=$HOME/corpora/hand" node tools/roundtrip.mjs
 *   node tools/roundtrip.mjs --baseline <other>/dist/index.js <dir>   # the same against another build
 *   node tools/roundtrip.mjs --json /tmp/roundtrip.json --list <dir>  # per-file records / non-identical no-ops
 *
 * Every file runs in-process (dist/index.js, dry runs: nothing is written):
 *   noop      set <first named activity> name=<its name>   (layout auto)
 *   noop-nl   the same with --no-layout
 *   rename    set <it> name="<name> X"                     (--no-layout)
 *   rename-a  the same in layout auto
 *   insert    add task --after <first task with one outgoing flow>   (layout auto)
 * and reports per variant: files run / refused (by code), results equal to
 * the file byte for byte, changed lines (`diff` style, lines removed +
 * added), the single text region a host that syncs one region per save
 * (design-iq's Y.Text diffRegion) replaces, as a share of the file, and the
 * notes about dropped comments or a fall-back to the plain serialisation.
 * A no-op that is not byte-identical is listed with its cause (the layout
 * drew something, a fall-back, other).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = { inputs: [], lib: join(ROOT, 'dist', 'index.js'), baseline: undefined, json: undefined, list: false };
  for (let argIndex = 0; argIndex < argv.length; argIndex++) {
    const arg = argv[argIndex];
    if (arg === '--lib') opts.lib = argv[++argIndex];
    else if (arg === '--baseline') opts.baseline = argv[++argIndex];
    else if (arg === '--json') opts.json = argv[++argIndex];
    else if (arg === '--list') opts.list = true;
    else if (arg === '-h' || arg === '--help') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
      process.exit(0);
    } else if (arg.startsWith('--')) {
      console.error(`unknown option ${arg}`);
      process.exit(2);
    } else opts.inputs.push(arg);
  }
  return opts;
}

function bpmnFiles(path) {
  if (!statSync(path).isDirectory()) return [path];
  const out = [];
  for (const name of readdirSync(path).sort()) {
    const entryPath = join(path, name);
    if (statSync(entryPath).isDirectory()) out.push(...bpmnFiles(entryPath));
    else if (name.endsWith('.bpmn')) out.push(entryPath);
  }
  return out;
}

function corpusFiles(inputs) {
  const env = (process.env.BPMN_BENCH_CORPUS ?? '').split(':').map((rawEntry) => rawEntry.trim()).filter(Boolean).map((entry) => (entry.includes('=') ? entry.split('=')[1] : entry));
  const roots = inputs.length ? inputs : env.length ? env : [join(ROOT, 'tools', 'scenarios'), join(ROOT, 'test', 'fixtures')];
  return roots.flatMap((root) => bpmnFiles(resolve(root)));
}

/* ------------------------------------------------------------------ */
/* measures                                                             */
/* ------------------------------------------------------------------ */

/** Lines removed + added (longest common subsequence of the lines between the common head and tail). */
function changedLines(before, after) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let head = 0;
  while (head < beforeLines.length && head < afterLines.length && beforeLines[head] === afterLines[head]) head++;
  let tail = 0;
  while (tail < beforeLines.length - head && tail < afterLines.length - head && beforeLines[beforeLines.length - 1 - tail] === afterLines[afterLines.length - 1 - tail]) tail++;
  const xs = beforeLines.slice(head, beforeLines.length - tail);
  const ys = afterLines.slice(head, afterLines.length - tail);
  if (!xs.length || !ys.length) return xs.length + ys.length;
  if (xs.length * ys.length > 25_000_000) return xs.length + ys.length;
  const rowWidth = ys.length + 1;
  const dp = new Uint32Array((xs.length + 1) * rowWidth);
  for (let beforeIndex = xs.length - 1; beforeIndex >= 0; beforeIndex--) {
    for (let afterIndex = ys.length - 1; afterIndex >= 0; afterIndex--) dp[beforeIndex * rowWidth + afterIndex] = xs[beforeIndex] === ys[afterIndex] ? dp[(beforeIndex + 1) * rowWidth + afterIndex + 1] + 1 : Math.max(dp[(beforeIndex + 1) * rowWidth + afterIndex], dp[beforeIndex * rowWidth + afterIndex + 1]);
  }
  return xs.length + ys.length - 2 * dp[0];
}

/** The share of the file (deleted characters) one region between the common prefix and suffix replaces. */
function regionShare(before, after) {
  let start = 0;
  const min = Math.min(before.length, after.length);
  while (start < min && before[start] === after[start]) start++;
  let endA = before.length;
  let endB = after.length;
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) {
    endA--;
    endB--;
  }
  return before.length ? (100 * (endA - start)) / before.length : 0;
}

const quantile = (values, fraction) => {
  if (!values.length) return '-';
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
};
const fmt = (value) => (typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(1)) : value);

/* ------------------------------------------------------------------ */
/* running                                                              */
/* ------------------------------------------------------------------ */

function targetsOf(api, doc) {
  const is = (el, type) => el?.$instanceOf?.(type);
  const nodes = [...doc.byId().values()].filter((el) => is(el, 'bpmn:FlowNode'));
  const rename = nodes.find((el) => is(el, 'bpmn:Activity') && el.get('name')) ?? nodes.find((el) => el.get('name'));
  const drawn = new Set();
  for (const diagram of doc.definitions.get('diagrams') ?? []) for (const diShape of diagram.get('plane')?.get('planeElement') ?? []) if (diShape.get('bpmnElement')) drawn.add(diShape.get('bpmnElement'));
  const insert = nodes.find((el) => is(el, 'bpmn:Task') && drawn.has(el) && doc.outgoing(el).length === 1);
  return { rename: rename && { id: rename.get('id'), name: rename.get('name') }, insert: insert && { id: insert.get('id') } };
}

const VARIANTS = [
  { name: 'noop', target: 'rename', ops: (element) => [{ op: 'set', id: element.id, values: { name: element.name } }], layout: 'auto' },
  { name: 'noop-nl', target: 'rename', ops: (element) => [{ op: 'set', id: element.id, values: { name: element.name } }], layout: false },
  { name: 'rename', target: 'rename', ops: (element) => [{ op: 'set', id: element.id, values: { name: `${element.name} X` } }], layout: false },
  { name: 'rename-a', target: 'rename', ops: (element) => [{ op: 'set', id: element.id, values: { name: `${element.name} X` } }], layout: 'auto' },
  { name: 'insert', target: 'insert', ops: (element) => [{ op: 'add', kind: 'task', name: 'Audit step', after: element.id }], layout: 'auto' },
];

async function runBuild(lib, files) {
  const api = await import(pathToFileURL(resolve(lib)).href);
  const records = [];
  for (const file of files) {
    const xml = readFileSync(file, 'utf8');
    const rec = { file, variants: {} };
    records.push(rec);
    let targets;
    try {
      const doc = await api.Doc.fromXml(xml, file);
      if (doc.lossyImportWarnings?.length) {
        rec.refused = 'E_IMPORT_LOSSY';
        continue;
      }
      targets = targetsOf(api, doc);
    } catch (error) {
      rec.refused = error.code ?? 'E_PARSE';
      continue;
    }
    for (const variant of VARIANTS) {
      const element = targets[variant.target];
      if (!element) continue;
      try {
        const result = await api.mutateDoc(await api.Doc.fromXml(xml, file), variant.ops(element), { dryRun: true, layout: variant.layout });
        const out = result.xml;
        const notes = result.changes.notes ?? [];
        const lay = result.layout ?? {};
        rec.variants[variant.name] = {
          identical: out === xml,
          lines: out === xml ? 0 : changedLines(xml, out),
          region: regionShare(xml, out),
          fallback: notes.some((note) => /formatting was not kept/.test(note)),
          comments: notes.some((note) => /comment\(s\) dropped/.test(note)),
          drew: lay.mode === 'full' || !!(lay.placed?.length || lay.moved?.length || lay.rerouted?.length || lay.pruned?.length),
        };
      } catch (error) {
        rec.variants[variant.name] = { refused: error.code ?? 'E_EXCEPTION' };
      }
    }
  }
  return records;
}

function summarise(label, records, list) {
  const lines = [`${label}: ${records.length} file(s)${records.filter((record) => record.refused).length ? `, ${records.filter((record) => record.refused).length} not loaded` : ''}`];
  for (const variant of VARIANTS) {
    const rows = records.map((record) => [record, record.variants[variant.name]]).filter(([, outcome]) => outcome);
    if (!rows.length) continue;
    const ok = rows.filter(([, outcome]) => !outcome.refused);
    const refused = {};
    for (const [, outcome] of rows) if (outcome.refused) refused[outcome.refused] = (refused[outcome.refused] ?? 0) + 1;
    const same = ok.filter(([, outcome]) => outcome.identical).length;
    const lineVals = ok.map(([, outcome]) => outcome.lines);
    const regions = ok.map(([, outcome]) => outcome.region);
    const parts = [
      `  ${variant.name.padEnd(9)} run ${String(rows.length).padStart(4)}`,
      Object.keys(refused).length ? ` refused ${JSON.stringify(refused)}` : '',
      ` | identical ${same}/${ok.length} (${ok.length ? ((100 * same) / ok.length).toFixed(1) : '-'}%)`,
      ` | lines median ${fmt(quantile(lineVals, 0.5))} p90 ${fmt(quantile(lineVals, 0.9))} max ${fmt(quantile(lineVals, 1))}`,
      ` | region % median ${fmt(quantile(regions, 0.5))} p90 ${fmt(quantile(regions, 0.9))}, >=50%: ${regions.filter((regionPercent) => regionPercent >= 50).length}`,
      ` | fall-backs ${ok.filter(([, outcome]) => outcome.fallback).length}, comment notes ${ok.filter(([, outcome]) => outcome.comments).length}`,
    ];
    lines.push(parts.join(''));
    if (variant.name.startsWith('noop')) {
      const causes = {};
      for (const [record, outcome] of ok) {
        if (outcome.identical) continue;
        const cause = outcome.fallback ? 'fall-back to the plain serialisation' : outcome.drew ? 'the layout drew or moved something' : 'other';
        (causes[cause] ??= []).push(basename(record.file));
      }
      for (const [cause, names] of Object.entries(causes)) lines.push(`      not identical: ${names.length} ${cause}${list ? `: ${names.join(' ')}` : ''}`);
    }
  }
  return lines.join('\n');
}

const opts = parseArgs(process.argv.slice(2));
const files = corpusFiles(opts.inputs);
const results = { files: files.length, builds: {} };
for (const [label, lib] of [['new', opts.lib], ...(opts.baseline ? [['baseline', opts.baseline]] : [])]) {
  const records = await runBuild(lib, files);
  results.builds[label] = records;
  console.log(summarise(`${label} (${lib})`, records, opts.list));
}
if (opts.json) writeFileSync(opts.json, JSON.stringify(results, null, 1));
