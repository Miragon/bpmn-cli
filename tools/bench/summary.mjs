#!/usr/bin/env node
/**
 * Markdown summary of a bench results directory.
 *
 *   node tools/bench/summary.mjs [results-dir] [--arms new-auto,baseline,pr] [--out report.md]
 *
 * Contract: reads <dir>/edits-<arm>.jsonl, <dir>/global-<arm>.jsonl and
 * <dir>/meta.json (default dir tools/bench/results/latest) and prints, per corpus:
 *  - EDITS per edit type (E1..E7 and E1-6 pooled) x arm: n applicable, ok %
 *    (primary run exit 0), forced (bpmn-cli runs that needed --force and then
 *    succeeded), sem ok % (intended change present and the file re-imports
 *    cleanly), runs adding hard defects and the hard defects added,
 *    stability over the flow nodes not moved on purpose (max centre
 *    displacement median / mean, median share moved > 5 px, both also after
 *    removing the median translation), Δ harness score (the metrics library's
 *    score = tools/layout-regress.mjs score) and Δ PR #218 score (only when the
 *    run had BPMN_EDIT_MAIN), invalid results, runtime and the layout modes
 *    the CLI reported (f = full, i = incremental). Stability and quality use
 *    the effective run: the primary run when it succeeded, else the forced one.
 *  - GLOBAL per arm / variant: ok %, score after, Δ, hard defects after, stability, invalid, ms.
 *  - PROBLEMS ADDED per kind (every kind of the metrics library, new kinds
 *    included): the sum over effective edit runs of max(0, after - before).
 *  - VALIDITY: why written files are invalid.
 * Pure reporting; writes nothing but --out.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../fuzz/lib/setup.mjs';
import { ROOT } from './lib/metrics.mjs';

const EDITS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'];
const EDIT_LABEL = { E1: 'E1 insert task', E2: 'E2 new branch', E3: 'E3 remove+bridge', E4: 'E4 boundary path*', E5: 'E5 lane change', E6: 'E6 long rename', E7: 'E7 all, in sequence', 'E1-6': 'E1-6 pooled' };
const ORDER = ['new-auto', 'new-incremental', 'new-full', 'new', 'baseline-auto', 'baseline-incremental', 'baseline', 'pr'];

const med = (xs) => { if (!xs.length) return NaN; const sorted = [...xs].sort((left, right) => left - right); const middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const mean = (xs) => (xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : NaN);
const f0 = (value) => (Number.isFinite(value) ? String(Math.round(value)) : '-');
const f1 = (value) => (Number.isFinite(value) ? (Math.round(value * 10) / 10).toString() : '-');
const pct = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '-');
const sgn = (value) => (Number.isFinite(value) ? (value > 0 ? `+${f1(value)}` : f1(value)) : '-');
const share = (stability) => (stability && stability.n ? stability.moved5 / stability.n : NaN);
const invalid = (record) => !!record.validity && (record.validity.importWarnings > 0 || record.validity.missingDi > 0 || record.validity.emptyEdges > 0 || record.after?.harness.score === null);
const rank = (arm) => (ORDER.includes(arm) ? ORDER.indexOf(arm) : 99);

function loader(dir) {
  return (track, arm) => {
    const resultPath = join(dir, `${track}-${arm}.jsonl`);
    return existsSync(resultPath) ? readFileSync(resultPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
}

/** Primary record plus the effective one (primary if ok, else forced if ok). */
function effective(records) {
  const by = new Map();
  for (const record of records) {
    const groupKey = `${record.corpus}/${record.model}/${record.edit}`;
    if (!by.has(groupKey)) by.set(groupKey, {});
    by.get(groupKey)[record.variant] = record;
  }
  return [...by.values()].filter((group) => group.primary).map((group) => ({ primary: group.primary, eff: group.primary.ok ? group.primary : group.force?.ok ? group.force : undefined, forced: !group.primary.ok && !!group.force?.ok }));
}

/** Layout modes the CLI reported per invocation (f = full, i = incremental). */
function modes(rows) {
  const ms = rows.flatMap((row) => row.primary.steps.map((step) => step.layout?.mode)).filter(Boolean);
  if (!ms.length) return '';
  const fullCount = ms.filter((mode) => mode === 'full').length;
  return `f${fullCount} i${ms.length - fullCount}`;
}

function editRow(label, arm, rows, withPr) {
  const runCount = rows.length;
  const eff = rows.map((row) => row.eff).filter(Boolean);
  const sem = eff.filter((record) => record.semanticOk && !(record.validity?.importWarnings > 0)).length;
  const st = eff.filter((record) => record.stabilityOthers);
  const dh = st.map((record) => record.delta.harness).filter((delta) => delta !== null), dp = st.map((record) => record.delta.pr).filter((delta) => delta !== null);
  const hardRuns = eff.filter((record) => record.hard?.added > 0).length, hardSum = eff.reduce((sum, record) => sum + (record.hard?.added ?? 0), 0);
  const so = st.map((record) => record.stabilityOthers);
  const cells = [label, arm, runCount, pct(rows.filter((row) => row.primary.ok).length, runCount), rows.filter((row) => row.forced).length || '', pct(sem, runCount), hardRuns || '', hardSum || '',
    `${f0(med(so.map((stability) => stability.max)))} / ${f0(mean(so.map((stability) => stability.max)))}`, pct(med(so.map(share)) * 100, 100),
    `${f0(med(so.map((stability) => stability.norm.max)))} / ${f0(mean(so.map((stability) => stability.norm.max)))}`, pct(med(so.map((stability) => share(stability.norm))) * 100, 100),
    `${sgn(med(dh))} / ${sgn(mean(dh))}`, ...(withPr ? [`${sgn(med(dp))} / ${sgn(mean(dp))}`] : []),
    eff.filter(invalid).length || '', f0(med(rows.map((row) => row.primary.ms))), modes(rows)];
  return `| ${cells.join(' | ')} |`;
}

function editsSection(ctx, corpus) {
  const head = ['edit', 'arm', 'n', 'ok', 'forced', 'sem ok', 'runs +hard', '+hard', 'max disp px med / mean', 'moved>5px med share', 'norm. max disp med / mean', 'norm. moved>5px med share', 'Δ harness med / mean', ...(ctx.withPr ? ['Δ PR score med / mean'] : []), 'invalid', 'ms med', 'layout mode'];
  const out = [`### ${corpus}: edits`, '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  const byArm = Object.fromEntries(ctx.arms.map((arm) => [arm, effective(ctx.load('edits', arm).filter((record) => record.corpus === corpus))]));
  for (const edit of [...EDITS, 'E1-6']) {
    for (const arm of ctx.arms) {
      const rows = byArm[arm].filter((row) => (edit === 'E1-6' ? row.primary.edit !== 'E7' : row.primary.edit === edit));
      if (rows.length) out.push(editRow(EDIT_LABEL[edit], arm, rows, ctx.withPr));
    }
  }
  return out.join('\n');
}

function globalSection(ctx, corpus) {
  const hardAfter = (record) => (record.after?.harness.counts ? ctx.hard.reduce((sum, kind) => sum + (record.after.harness.counts[kind] ?? 0), 0) : NaN);
  const head = ['arm / variant', 'n', 'ok', 'harness after med / mean', 'Δ harness med / mean', 'hard after (sum)', ...(ctx.withPr ? ['PR score after med / mean', 'Δ PR med / mean'] : []), 'max disp px med', 'norm. max disp med', 'invalid', 'ms med'];
  const out = [`### ${corpus}: global layout (no edit)`, '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const arm of ctx.arms) {
    const recs = ctx.load('global', arm).filter((record) => record.corpus === corpus);
    for (const variant of [...new Set(recs.map((record) => record.variant))].sort()) {
      const rs = recs.filter((record) => record.variant === variant);
      const ok = rs.filter((record) => record.ok && record.after);
      const ha = ok.map((record) => record.after.harness.score).filter(Number.isFinite), pa = ok.map((record) => record.after.pr?.score).filter(Number.isFinite);
      const dh = ok.map((record) => record.delta.harness).filter((delta) => delta !== null), dp = ok.map((record) => record.delta.pr).filter((delta) => delta !== null);
      out.push(`| ${[`${arm} ${variant}`, rs.length, pct(ok.length, rs.length), `${f1(med(ha))} / ${f1(mean(ha))}`, `${sgn(med(dh))} / ${sgn(mean(dh))}`, f0(ok.map(hardAfter).filter(Number.isFinite).reduce((sum, score) => sum + score, 0)),
        ...(ctx.withPr ? [`${f0(med(pa))} / ${f0(mean(pa))}`, `${sgn(med(dp))} / ${sgn(mean(dp))}`] : []),
        f0(med(ok.map((record) => record.stability.max))), f0(med(ok.map((record) => record.stability.norm.max))), ok.filter(invalid).length || '', f0(med(rs.map((record) => record.ms)))].join(' | ')} |`);
    }
  }
  return out.join('\n');
}

/** Sum over effective edit runs of max(0, after - before) per problem kind. */
function problemsSection(ctx) {
  const head = ['corpus', 'arm', 'runs', ...ctx.keys.map((kind) => (ctx.hard.includes(kind) ? `**${kind}**` : kind))];
  const out = ['### layout problems added by the edits (per kind, bold = hard)', '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const corpus of ctx.corpora) {
    for (const arm of ctx.arms) {
      const eff = effective(ctx.load('edits', arm).filter((record) => record.corpus === corpus)).map((row) => row.eff).filter((record) => record?.before?.harness.counts && record.after?.harness.counts);
      if (!eff.length) continue;
      const sums = ctx.keys.map((kind) => eff.reduce((sum, record) => sum + Math.max(0, (record.after.harness.counts[kind] ?? 0) - (record.before.harness.counts[kind] ?? 0)), 0));
      out.push(`| ${[corpus, arm, eff.length, ...sums.map((kindSum) => kindSum || '')].join(' | ')} |`);
    }
  }
  return out.join('\n');
}

function validitySection(ctx) {
  const out = ['### validity of the written files', '', '| corpus | track | arm | runs | import warnings | of which unresolved ref | unparsable (dup id) | missing DI | edges w/o waypoints | metrics crashed |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const corpus of ctx.corpora) {
    for (const track of ['edits', 'global']) {
      for (const arm of ctx.arms) {
        const recs = ctx.load(track, arm).filter((record) => record.corpus === corpus);
        const rs = track === 'edits' ? effective(recs).map((row) => row.eff).filter(Boolean) : recs.filter((record) => record.ok);
        if (!rs.length) continue;
        const countWhere = (predicate) => rs.filter(predicate).length || '';
        out.push(`| ${corpus} | ${track} | ${arm} | ${rs.length} | ${countWhere((record) => record.validity?.importWarnings > 0)} | ${countWhere((record) => record.validity?.warningKinds?.unresolvedRef > 0)} | ${countWhere((record) => record.validity?.warningKinds?.unparsable > 0)} | ${countWhere((record) => record.validity?.missingDi > 0)} | ${countWhere((record) => record.validity?.emptyEdges > 0)} | ${countWhere((record) => record.after?.harness.score === null)} |`);
      }
    }
  }
  return out.join('\n');
}

export function summarize(dir, armsOpt) {
  const meta = existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : {};
  const present = [...new Set(readdirSync(dir).map((fileName) => fileName.match(/^(?:edits|global)-(.+)\.jsonl$/)?.[1]).filter(Boolean))];
  const arms = (armsOpt?.split(',') ?? present).sort((left, right) => rank(left) - rank(right) || left.localeCompare(right));
  const load = loader(dir);
  const all = arms.flatMap((arm) => [...load('edits', arm), ...load('global', arm)]);
  const corpora = [...new Set(all.map((record) => record.corpus))].sort((left, right) => (left === 'scenarios' ? -1 : right === 'scenarios' ? 1 : left.localeCompare(right)));
  const keys = meta.metricKeys ?? Object.keys(all.find((record) => record.after?.harness.counts)?.after.harness.counts ?? {});
  const ctx = { arms, load, corpora, keys, hard: meta.hardKinds ?? [], withPr: !!meta.prScore || all.some((record) => Number.isFinite(record.after?.pr?.score)) };
  const legend = `Arms: ${arms.join(', ')}. Corpora: ${corpora.map((corpus) => `${corpus} (${meta.corpora?.[corpus] ?? '?'} files)`).join(', ')}. Hard kinds: ${ctx.hard.join(', ')}${meta.newKinds?.length ? ` (kinds new since the audit: ${meta.newKinds.join(', ')})` : ''}.
Stability over flow nodes present before and after (edits: without the task E5 moves on purpose): per run the max centre displacement and the share of nodes moved > 5 px; "norm." after removing the median translation. Δ = after - before (lower is better; harness = the metrics library's score, the tools/layout-regress.mjs score${ctx.withPr ? '; PR = the PR #218 tool\'s plane score summed over planes' : ''}). sem ok = intended change present and the result re-imports without warnings. +hard = hard problems added. invalid = result with import warnings, flow nodes without DI, edges without waypoints or a crashing metrics run. *E4: bpmn-cli adds a timer boundary event + end event, the PR tool an error boundary + end event (it has no timer op).`;
  return ['## Bench summary', '', legend, '', ...corpora.flatMap((corpus) => [editsSection(ctx, corpus), '', globalSection(ctx, corpus), '']), problemsSection(ctx), '', validitySection(ctx), ''].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { arms: undefined, out: undefined });
  const dir = resolve(options._[0] ?? join(ROOT, 'tools', 'bench', 'results', 'latest'));
  if (!existsSync(dir)) {
    console.error(`${dir} does not exist: run tools/bench/run.mjs first`);
    process.exit(2);
  }
  const md = summarize(dir, options.arms);
  if (options.out) writeFileSync(options.out, md);
  console.log(md);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
