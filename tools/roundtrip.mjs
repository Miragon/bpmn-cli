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
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lib') opts.lib = argv[++i];
    else if (a === '--baseline') opts.baseline = argv[++i];
    else if (a === '--json') opts.json = argv[++i];
    else if (a === '--list') opts.list = true;
    else if (a === '-h' || a === '--help') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
      process.exit(0);
    } else if (a.startsWith('--')) {
      console.error(`unknown option ${a}`);
      process.exit(2);
    } else opts.inputs.push(a);
  }
  return opts;
}

function bpmnFiles(path) {
  if (!statSync(path).isDirectory()) return [path];
  const out = [];
  for (const name of readdirSync(path).sort()) {
    const p = join(path, name);
    if (statSync(p).isDirectory()) out.push(...bpmnFiles(p));
    else if (name.endsWith('.bpmn')) out.push(p);
  }
  return out;
}

function corpusFiles(inputs) {
  const env = (process.env.BPMN_BENCH_CORPUS ?? '').split(':').map((s) => s.trim()).filter(Boolean).map((e) => (e.includes('=') ? e.split('=')[1] : e));
  const roots = inputs.length ? inputs : env.length ? env : [join(ROOT, 'tools', 'scenarios'), join(ROOT, 'test', 'fixtures')];
  return roots.flatMap((r) => bpmnFiles(resolve(r)));
}

/* ------------------------------------------------------------------ */
/* measures                                                             */
/* ------------------------------------------------------------------ */

/** Lines removed + added (longest common subsequence of the lines between the common head and tail). */
function changedLines(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  if (!xs.length || !ys.length) return xs.length + ys.length;
  if (xs.length * ys.length > 25_000_000) return xs.length + ys.length;
  const w = ys.length + 1;
  const dp = new Uint32Array((xs.length + 1) * w);
  for (let i = xs.length - 1; i >= 0; i--) {
    for (let j = ys.length - 1; j >= 0; j--) dp[i * w + j] = xs[i] === ys[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  }
  return xs.length + ys.length - 2 * dp[0];
}

/** The share of the file (deleted characters) one region between the common prefix and suffix replaces. */
function regionShare(a, b) {
  let start = 0;
  const min = Math.min(a.length, b.length);
  while (start < min && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return a.length ? (100 * (endA - start)) / a.length : 0;
}

const quantile = (values, p) => {
  if (!values.length) return '-';
  const s = [...values].sort((m, n) => m - n);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : v);

/* ------------------------------------------------------------------ */
/* running                                                              */
/* ------------------------------------------------------------------ */

function targetsOf(api, doc) {
  const is = (el, type) => el?.$instanceOf?.(type);
  const nodes = [...doc.byId().values()].filter((el) => is(el, 'bpmn:FlowNode'));
  const rename = nodes.find((el) => is(el, 'bpmn:Activity') && el.get('name')) ?? nodes.find((el) => el.get('name'));
  const drawn = new Set();
  for (const d of doc.definitions.get('diagrams') ?? []) for (const s of d.get('plane')?.get('planeElement') ?? []) if (s.get('bpmnElement')) drawn.add(s.get('bpmnElement'));
  const insert = nodes.find((el) => is(el, 'bpmn:Task') && drawn.has(el) && doc.outgoing(el).length === 1);
  return { rename: rename && { id: rename.get('id'), name: rename.get('name') }, insert: insert && { id: insert.get('id') } };
}

const VARIANTS = [
  { name: 'noop', target: 'rename', ops: (t) => [{ op: 'set', id: t.id, values: { name: t.name } }], layout: 'auto' },
  { name: 'noop-nl', target: 'rename', ops: (t) => [{ op: 'set', id: t.id, values: { name: t.name } }], layout: false },
  { name: 'rename', target: 'rename', ops: (t) => [{ op: 'set', id: t.id, values: { name: `${t.name} X` } }], layout: false },
  { name: 'rename-a', target: 'rename', ops: (t) => [{ op: 'set', id: t.id, values: { name: `${t.name} X` } }], layout: 'auto' },
  { name: 'insert', target: 'insert', ops: (t) => [{ op: 'add', kind: 'task', name: 'Audit step', after: t.id }], layout: 'auto' },
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
    } catch (e) {
      rec.refused = e.code ?? 'E_PARSE';
      continue;
    }
    for (const v of VARIANTS) {
      const t = targets[v.target];
      if (!t) continue;
      try {
        const r = await api.mutateDoc(await api.Doc.fromXml(xml, file), v.ops(t), { dryRun: true, layout: v.layout });
        const out = r.xml;
        const notes = r.changes.notes ?? [];
        const lay = r.layout ?? {};
        rec.variants[v.name] = {
          identical: out === xml,
          lines: out === xml ? 0 : changedLines(xml, out),
          region: regionShare(xml, out),
          fallback: notes.some((n) => /formatting was not kept/.test(n)),
          comments: notes.some((n) => /comment\(s\) dropped/.test(n)),
          drew: lay.mode === 'full' || !!(lay.placed?.length || lay.moved?.length || lay.rerouted?.length || lay.pruned?.length),
        };
      } catch (e) {
        rec.variants[v.name] = { refused: e.code ?? 'E_EXCEPTION' };
      }
    }
  }
  return records;
}

function summarise(label, records, list) {
  const lines = [`${label}: ${records.length} file(s)${records.filter((r) => r.refused).length ? `, ${records.filter((r) => r.refused).length} not loaded` : ''}`];
  for (const v of VARIANTS) {
    const rows = records.map((r) => [r, r.variants[v.name]]).filter(([, x]) => x);
    if (!rows.length) continue;
    const ok = rows.filter(([, x]) => !x.refused);
    const refused = {};
    for (const [, x] of rows) if (x.refused) refused[x.refused] = (refused[x.refused] ?? 0) + 1;
    const same = ok.filter(([, x]) => x.identical).length;
    const lineVals = ok.map(([, x]) => x.lines);
    const regions = ok.map(([, x]) => x.region);
    const parts = [
      `  ${v.name.padEnd(9)} run ${String(rows.length).padStart(4)}`,
      Object.keys(refused).length ? ` refused ${JSON.stringify(refused)}` : '',
      ` | identical ${same}/${ok.length} (${ok.length ? ((100 * same) / ok.length).toFixed(1) : '-'}%)`,
      ` | lines median ${fmt(quantile(lineVals, 0.5))} p90 ${fmt(quantile(lineVals, 0.9))} max ${fmt(quantile(lineVals, 1))}`,
      ` | region % median ${fmt(quantile(regions, 0.5))} p90 ${fmt(quantile(regions, 0.9))}, >=50%: ${regions.filter((x) => x >= 50).length}`,
      ` | fall-backs ${ok.filter(([, x]) => x.fallback).length}, comment notes ${ok.filter(([, x]) => x.comments).length}`,
    ];
    lines.push(parts.join(''));
    if (v.name.startsWith('noop')) {
      const causes = {};
      for (const [r, x] of ok) {
        if (x.identical) continue;
        const cause = x.fallback ? 'fall-back to the plain serialisation' : x.drew ? 'the layout drew or moved something' : 'other';
        (causes[cause] ??= []).push(basename(r.file));
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
