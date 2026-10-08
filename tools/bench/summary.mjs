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
 *    cleanly), runs adding hard defects and the hard defects added (groups
 *    excluded), stability over the flow nodes not moved on purpose (max centre
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

const med = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f0 = (x) => (Number.isFinite(x) ? String(Math.round(x)) : '-');
const f1 = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toString() : '-');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const sgn = (x) => (Number.isFinite(x) ? (x > 0 ? `+${f1(x)}` : f1(x)) : '-');
const share = (s) => (s && s.n ? s.moved5 / s.n : NaN);
const invalid = (r) => !!r.validity && (r.validity.importWarnings > 0 || r.validity.missingDi > 0 || r.validity.emptyEdges > 0 || r.after?.harness.score === null);
const rank = (a) => (ORDER.includes(a) ? ORDER.indexOf(a) : 99);

function loader(dir) {
  return (track, arm) => {
    const f = join(dir, `${track}-${arm}.jsonl`);
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
}

/** Primary record plus the effective one (primary if ok, else forced if ok). */
function effective(records) {
  const by = new Map();
  for (const r of records) {
    const k = `${r.corpus}/${r.model}/${r.edit}`;
    if (!by.has(k)) by.set(k, {});
    by.get(k)[r.variant] = r;
  }
  return [...by.values()].filter((v) => v.primary).map((v) => ({ primary: v.primary, eff: v.primary.ok ? v.primary : v.force?.ok ? v.force : undefined, forced: !v.primary.ok && !!v.force?.ok }));
}

/** Layout modes the CLI reported per invocation (f = full, i = incremental). */
function modes(rows) {
  const ms = rows.flatMap((x) => x.primary.steps.map((s) => s.layout?.mode)).filter(Boolean);
  if (!ms.length) return '';
  const f = ms.filter((m) => m === 'full').length;
  return `f${f} i${ms.length - f}`;
}

function editRow(label, arm, rows, withPr) {
  const n = rows.length;
  const eff = rows.map((x) => x.eff).filter(Boolean);
  const sem = eff.filter((r) => r.semanticOk && !(r.validity?.importWarnings > 0)).length;
  const st = eff.filter((r) => r.stabilityOthers);
  const dh = st.map((r) => r.delta.harness).filter((x) => x !== null), dp = st.map((r) => r.delta.pr).filter((x) => x !== null);
  const hardRuns = eff.filter((r) => r.hard?.added > 0).length, hardSum = eff.reduce((s, r) => s + (r.hard?.added ?? 0), 0);
  const so = st.map((r) => r.stabilityOthers);
  const cells = [label, arm, n, pct(rows.filter((x) => x.primary.ok).length, n), rows.filter((x) => x.forced).length || '', pct(sem, n), hardRuns || '', hardSum || '',
    `${f0(med(so.map((s) => s.max)))} / ${f0(mean(so.map((s) => s.max)))}`, pct(med(so.map(share)) * 100, 100),
    `${f0(med(so.map((s) => s.norm.max)))} / ${f0(mean(so.map((s) => s.norm.max)))}`, pct(med(so.map((s) => share(s.norm))) * 100, 100),
    `${sgn(med(dh))} / ${sgn(mean(dh))}`, ...(withPr ? [`${sgn(med(dp))} / ${sgn(mean(dp))}`] : []),
    eff.filter(invalid).length || '', f0(med(rows.map((x) => x.primary.ms))), modes(rows)];
  return `| ${cells.join(' | ')} |`;
}

function editsSection(ctx, corpus) {
  const head = ['edit', 'arm', 'n', 'ok', 'forced', 'sem ok', 'runs +hard', '+hard', 'max disp px med / mean', 'moved>5px med share', 'norm. max disp med / mean', 'norm. moved>5px med share', 'Δ harness med / mean', ...(ctx.withPr ? ['Δ PR score med / mean'] : []), 'invalid', 'ms med', 'layout mode'];
  const out = [`### ${corpus}: edits`, '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  const byArm = Object.fromEntries(ctx.arms.map((a) => [a, effective(ctx.load('edits', a).filter((r) => r.corpus === corpus))]));
  for (const edit of [...EDITS, 'E1-6']) {
    for (const arm of ctx.arms) {
      const rows = byArm[arm].filter((x) => (edit === 'E1-6' ? x.primary.edit !== 'E7' : x.primary.edit === edit));
      if (rows.length) out.push(editRow(EDIT_LABEL[edit], arm, rows, ctx.withPr));
    }
  }
  return out.join('\n');
}

function globalSection(ctx, corpus) {
  const hardAfter = (r) => (r.after?.harness.counts ? ctx.hard.reduce((s, k) => s + (r.after.harness.counts[k] ?? 0), 0) : NaN);
  const head = ['arm / variant', 'n', 'ok', 'harness after med / mean', 'Δ harness med / mean', 'hard after (sum)', ...(ctx.withPr ? ['PR score after med / mean', 'Δ PR med / mean'] : []), 'max disp px med', 'norm. max disp med', 'invalid', 'ms med'];
  const out = [`### ${corpus}: global layout (no edit)`, '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const arm of ctx.arms) {
    const recs = ctx.load('global', arm).filter((r) => r.corpus === corpus);
    for (const variant of [...new Set(recs.map((r) => r.variant))].sort()) {
      const rs = recs.filter((r) => r.variant === variant);
      const ok = rs.filter((r) => r.ok && r.after);
      const ha = ok.map((r) => r.after.harness.score).filter(Number.isFinite), pa = ok.map((r) => r.after.pr?.score).filter(Number.isFinite);
      const dh = ok.map((r) => r.delta.harness).filter((x) => x !== null), dp = ok.map((r) => r.delta.pr).filter((x) => x !== null);
      out.push(`| ${[`${arm} ${variant}`, rs.length, pct(ok.length, rs.length), `${f1(med(ha))} / ${f1(mean(ha))}`, `${sgn(med(dh))} / ${sgn(mean(dh))}`, f0(ok.map(hardAfter).filter(Number.isFinite).reduce((a, b) => a + b, 0)),
        ...(ctx.withPr ? [`${f0(med(pa))} / ${f0(mean(pa))}`, `${sgn(med(dp))} / ${sgn(mean(dp))}`] : []),
        f0(med(ok.map((r) => r.stability.max))), f0(med(ok.map((r) => r.stability.norm.max))), ok.filter(invalid).length || '', f0(med(rs.map((r) => r.ms)))].join(' | ')} |`);
    }
  }
  return out.join('\n');
}

/** Sum over effective edit runs of max(0, after - before) per problem kind. */
function problemsSection(ctx) {
  const head = ['corpus', 'arm', 'runs', ...ctx.keys.map((k) => (ctx.hard.includes(k) ? `**${k}**` : k))];
  const out = ['### layout problems added by the edits (per kind, bold = hard)', '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const corpus of ctx.corpora) {
    for (const arm of ctx.arms) {
      const eff = effective(ctx.load('edits', arm).filter((r) => r.corpus === corpus)).map((x) => x.eff).filter((r) => r?.before?.harness.counts && r.after?.harness.counts);
      if (!eff.length) continue;
      const sums = ctx.keys.map((k) => eff.reduce((s, r) => s + Math.max(0, (r.after.harness.counts[k] ?? 0) - (r.before.harness.counts[k] ?? 0)), 0));
      out.push(`| ${[corpus, arm, eff.length, ...sums.map((x) => x || '')].join(' | ')} |`);
    }
  }
  return out.join('\n');
}

function validitySection(ctx) {
  const out = ['### validity of the written files', '', '| corpus | track | arm | runs | import warnings | of which unresolved ref | unparsable (dup id) | missing DI | edges w/o waypoints | metrics crashed |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const corpus of ctx.corpora) for (const track of ['edits', 'global']) for (const arm of ctx.arms) {
    const recs = ctx.load(track, arm).filter((r) => r.corpus === corpus);
    const rs = track === 'edits' ? effective(recs).map((x) => x.eff).filter(Boolean) : recs.filter((r) => r.ok);
    if (!rs.length) continue;
    const c = (f) => rs.filter(f).length || '';
    out.push(`| ${corpus} | ${track} | ${arm} | ${rs.length} | ${c((r) => r.validity?.importWarnings > 0)} | ${c((r) => r.validity?.warningKinds?.unresolvedRef > 0)} | ${c((r) => r.validity?.warningKinds?.unparsable > 0)} | ${c((r) => r.validity?.missingDi > 0)} | ${c((r) => r.validity?.emptyEdges > 0)} | ${c((r) => r.after?.harness.score === null)} |`);
  }
  return out.join('\n');
}

export function summarize(dir, armsOpt) {
  const meta = existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : {};
  const present = [...new Set(readdirSync(dir).map((f) => f.match(/^(?:edits|global)-(.+)\.jsonl$/)?.[1]).filter(Boolean))];
  const arms = (armsOpt?.split(',') ?? present).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const load = loader(dir);
  const all = arms.flatMap((a) => [...load('edits', a), ...load('global', a)]);
  const corpora = [...new Set(all.map((r) => r.corpus))].sort((a, b) => (a === 'scenarios' ? -1 : b === 'scenarios' ? 1 : a.localeCompare(b)));
  const keys = meta.metricKeys ?? Object.keys(all.find((r) => r.after?.harness.counts)?.after.harness.counts ?? {});
  const ctx = { arms, load, corpora, keys, hard: meta.hardKinds ?? [], withPr: !!meta.prScore || all.some((r) => Number.isFinite(r.after?.pr?.score)) };
  const legend = `Arms: ${arms.join(', ')}. Corpora: ${corpora.map((c) => `${c} (${meta.corpora?.[c] ?? '?'} files)`).join(', ')}. Hard kinds: ${ctx.hard.join(', ')}${meta.newKinds?.length ? ` (kinds new since the audit: ${meta.newKinds.join(', ')})` : ''}.
Stability over flow nodes present before and after (edits: without the task E5 moves on purpose): per run the max centre displacement and the share of nodes moved > 5 px; "norm." after removing the median translation. Δ = after - before (lower is better; harness = the metrics library's score, the tools/layout-regress.mjs score${ctx.withPr ? '; PR = the PR #218 tool\'s plane score summed over planes' : ''}). sem ok = intended change present and the result re-imports without warnings. +hard = hard problems added (groups excluded). invalid = result with import warnings, flow nodes without DI, edges without waypoints or a crashing metrics run. *E4: bpmn-cli adds a timer boundary event + end event, the PR tool an error boundary + end event (it has no timer op).`;
  return ['## Bench summary', '', legend, '', ...corpora.flatMap((c) => [editsSection(ctx, c), '', globalSection(ctx, c), '']), problemsSection(ctx), '', validitySection(ctx), ''].join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2), { arms: undefined, out: undefined });
  const dir = resolve(o._[0] ?? join(ROOT, 'tools', 'bench', 'results', 'latest'));
  if (!existsSync(dir)) {
    console.error(`${dir} does not exist: run tools/bench/run.mjs first`);
    process.exit(2);
  }
  const md = summarize(dir, o.arms);
  if (o.out) writeFileSync(o.out, md);
  console.log(md);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
