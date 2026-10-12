/**
 * Compares two bench result directories (an old run and a new one).
 *
 * Contract: `compareResults(oldDir, newDir)` -> { arms, notes, edits, global, regressed }
 *  - arms: the arm keys with records in both directories (normally new-auto).
 *  - Per (corpus, model, edit) the effective run counts: the primary run when
 *    it succeeded, else the forced one when that succeeded, else the failed
 *    primary. A run passes semantically when it exited 0, the intended change
 *    is present and the file re-imports without warnings. Hard defects added
 *    are summed over the hard kinds both runs knew (meta.json), so a kind the
 *    metrics library gained in between does not count as a regression.
 *  - edits.rows: per arm and edit type n, semantic failures, runs adding hard
 *    defects, hard defects added, runs adding crossings / backward flows (soft
 *    kinds, '-' for results without them), mean harness delta, median share of
 *    other nodes moved > 5 px; old and new. edits.worse / edits.better: the
 *    runs whose semantic result or hard count changed.
 *  - soft: the soft budget (tools/bench/soft-budget.json: per corpus and edit
 *    the largest number of runs that may add each soft kind) checked on the
 *    new runs of this repository's arms (`new`): soft.rows per corpus / edit /
 *    kind with runs, runs adding it and the budget; soft.over the rows above it.
 *  - global: per arm and variant the hard defects after a full layout, summed.
 *  - regressed = more semantic failures, more runs adding hard defects or more
 *    hard defects added (edits), or more hard defects after a global layout,
 *    in any arm, or a soft budget exceeded. Runs present on one side only are
 *    listed in notes, not compared.
 * `formatComparison(result)` renders it as text. Pure apart from reading the files.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EDIT_ORDER = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9'];
export const SOFT_BUDGET_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'soft-budget.json');

const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const readMeta = (dir) => (existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : {});
const armKeys = (dir, track) => (existsSync(dir) ? readdirSync(dir).map((f) => f.match(new RegExp(`^${track}-(.+)\\.jsonl$`))?.[1]).filter(Boolean) : []);
const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Effective edit record per corpus/model/edit. */
function effectiveEdits(records) {
  const by = new Map();
  for (const r of records) {
    const k = `${r.corpus}/${r.model}/${r.edit}`;
    if (!by.has(k)) by.set(k, {});
    by.get(k)[r.variant] = r;
  }
  const out = new Map();
  for (const [k, v] of by) {
    if (!v.primary) continue;
    out.set(k, v.primary.ok ? v.primary : v.force?.ok ? v.force : v.primary);
  }
  return out;
}

const semanticPass = (r) => !!r.ok && !!r.semanticOk && !(r.validity?.importWarnings > 0);
const hardAdded = (r, kinds) => (r.hard?.addedKinds ? kinds.reduce((s, k) => s + (r.hard.addedKinds[k] ?? 0), 0) : 0);
const hardAfter = (r, kinds) => (r.after?.harness?.counts ? kinds.reduce((s, k) => s + (r.after.harness.counts[k] ?? 0), 0) : 0);
const movedShare = (r) => (r.stabilityOthers?.n ? r.stabilityOthers.moved5 / r.stabilityOthers.n : NaN);

function measures(r, kinds) {
  return { sem: semanticPass(r), hard: hardAdded(r, kinds), soft: r.soft?.addedKinds ?? null, dh: r.delta?.harness ?? null, moved: movedShare(r) };
}

/** Runs adding `kind` among the runs that measured soft kinds (undefined when none did). */
const softRuns = (ms, kind) => (ms.some((m) => m.soft) ? ms.filter((m) => m.soft?.[kind] > 0).length : undefined);

function editRow(arm, edit, pairs) {
  const side = (s) => {
    const ms = pairs.map((p) => p[s]);
    return {
      semFail: ms.filter((m) => !m.sem).length,
      hardRuns: ms.filter((m) => m.hard > 0).length,
      hardSum: ms.reduce((a, m) => a + m.hard, 0),
      crossRuns: softRuns(ms, 'crossings'),
      backRuns: softRuns(ms, 'backwardFlow'),
      dh: mean(ms.map((m) => m.dh).filter((x) => x !== null)),
      moved: median(ms.map((m) => m.moved).filter(Number.isFinite)),
    };
  };
  return { arm, edit, n: pairs.length, old: side('old'), new: side('new') };
}

function compareEdits(oldDir, newDir, arm, kinds, notes) {
  const a = effectiveEdits(readJsonl(join(oldDir, `edits-${arm}.jsonl`)));
  const b = effectiveEdits(readJsonl(join(newDir, `edits-${arm}.jsonl`)));
  const only = [...a.keys()].filter((k) => !b.has(k)).length + [...b.keys()].filter((k) => !a.has(k)).length;
  if (only) notes.push(`${arm}: ${only} edit run(s) exist on one side only and are not compared`);
  const pairs = [...a.keys()].filter((k) => b.has(k)).sort().map((k) => ({ key: k, edit: k.split('/').pop(), old: measures(a.get(k), kinds), new: measures(b.get(k), kinds) }));
  const rows = [...EDIT_ORDER, 'all'].map((e) => editRow(arm, e, pairs.filter((p) => e === 'all' || p.edit === e))).filter((r) => r.n);
  const describe = (p) => `${arm} ${p.key}: sem ${p.old.sem ? 'ok' : 'FAIL'} -> ${p.new.sem ? 'ok' : 'FAIL'}, +hard ${p.old.hard} -> ${p.new.hard}`;
  const worse = pairs.filter((p) => (p.old.sem && !p.new.sem) || p.new.hard > p.old.hard).map(describe);
  const better = pairs.filter((p) => (!p.old.sem && p.new.sem) || p.new.hard < p.old.hard).map(describe);
  return { rows, worse, better };
}

function compareGlobal(oldDir, newDir, arm, kinds) {
  const index = (dir) => new Map(readJsonl(join(dir, `global-${arm}.jsonl`)).map((r) => [`${r.corpus}/${r.model}/${r.variant}`, r]));
  const a = index(oldDir), b = index(newDir);
  const variants = new Map();
  for (const [k, r] of a) {
    const s = b.get(k);
    if (!s) continue;
    const v = variants.get(r.variant) ?? { arm, variant: r.variant, n: 0, old: 0, new: 0, failedOld: 0, failedNew: 0 };
    v.n++;
    v.old += hardAfter(r, kinds); v.new += hardAfter(s, kinds);
    v.failedOld += r.ok ? 0 : 1; v.failedNew += s.ok ? 0 : 1;
    variants.set(r.variant, v);
  }
  return [...variants.values()];
}

/** The soft budget checked on the new runs of the `new` arms (see contract). */
function checkSoft(newDir, arms, meta, budgetFile) {
  const budget = existsSync(budgetFile) ? JSON.parse(readFileSync(budgetFile, 'utf8')).corpora ?? {} : {};
  const rows = [];
  for (const arm of arms.filter((a) => (meta.arms?.[a]?.name ?? a.split('-')[0]) === 'new')) {
    const runs = [...effectiveEdits(readJsonl(join(newDir, `edits-${arm}.jsonl`))).values()];
    for (const [corpus, edits] of Object.entries(budget)) {
      for (const [edit, limits] of Object.entries(edits)) {
        const these = runs.filter((r) => r.corpus === corpus && r.edit === edit && r.soft?.addedKinds);
        if (!these.length) continue;
        for (const [kind, max] of Object.entries(limits)) {
          if (typeof max !== 'number') continue;
          const adding = these.filter((r) => r.soft.addedKinds[kind] > 0).length;
          rows.push({ arm, corpus, edit, kind, n: these.length, adding, budget: max, over: adding > max });
        }
      }
    }
  }
  return { rows, over: rows.filter((r) => r.over) };
}

export function compareResults(oldDir, newDir, budgetFile = SOFT_BUDGET_FILE) {
  const mo = readMeta(oldDir), mn = readMeta(newDir);
  const kinds = (mn.hardKinds ?? []).filter((k) => (mo.hardKinds ?? mn.hardKinds ?? []).includes(k));
  const notes = [];
  const onlyNew = (mn.hardKinds ?? []).filter((k) => !kinds.includes(k));
  if (onlyNew.length) notes.push(`hard kinds only in the new run, not compared: ${onlyNew.join(' ')}`);
  const arms = [...new Set([...armKeys(oldDir, 'edits'), ...armKeys(oldDir, 'global')])].filter((k) => armKeys(newDir, 'edits').includes(k) || armKeys(newDir, 'global').includes(k));
  if (!arms.length) notes.push('no arm has records in both directories');
  const edits = { rows: [], worse: [], better: [] };
  const global = [];
  for (const arm of arms) {
    const e = compareEdits(oldDir, newDir, arm, kinds, notes);
    edits.rows.push(...e.rows); edits.worse.push(...e.worse); edits.better.push(...e.better);
    global.push(...compareGlobal(oldDir, newDir, arm, kinds));
  }
  const totals = edits.rows.filter((r) => r.edit === 'all');
  const soft = checkSoft(newDir, armKeys(newDir, 'edits'), mn, budgetFile);
  const regressed = totals.some((r) => r.new.semFail > r.old.semFail || r.new.hardRuns > r.old.hardRuns || r.new.hardSum > r.old.hardSum)
    || global.some((g) => g.new > g.old || g.failedNew > g.failedOld)
    || soft.over.length > 0;
  return { oldDir, newDir, kinds, arms, notes, edits, global, soft, regressed };
}

const f1 = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toString() : '-');
const pct = (x) => (Number.isFinite(x) ? `${Math.round(100 * x)}%` : '-');
const arrow = (a, b, fmt = String) => (fmt(a) === fmt(b) ? fmt(a) : `${fmt(a)} -> ${fmt(b)}`);

export function formatComparison(c) {
  const lines = [`COMPARE ${c.oldDir}  ->  ${c.newDir}`, `hard kinds compared: ${c.kinds.join(' ') || '(none)'}`];
  for (const n of c.notes) lines.push(`note: ${n}`);
  const opt = (x) => (x === undefined ? '-' : String(x));
  lines.push('', '| arm | edit | n | sem fail | runs +hard | +hard | runs +crossings | runs +backward | mean Δ harness | median moved>5px |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of c.edits.rows) {
    lines.push(`| ${r.arm} | ${r.edit} | ${r.n} | ${arrow(r.old.semFail, r.new.semFail)} | ${arrow(r.old.hardRuns, r.new.hardRuns)} | ${arrow(r.old.hardSum, r.new.hardSum)} | ${arrow(r.old.crossRuns, r.new.crossRuns, opt)} | ${arrow(r.old.backRuns, r.new.backRuns, opt)} | ${arrow(r.old.dh, r.new.dh, f1)} | ${arrow(r.old.moved, r.new.moved, pct)} |`);
  }
  if (c.soft?.rows.length) {
    lines.push('', '| arm | corpus | edit | soft kind | runs | runs adding it | budget |', '|---|---|---|---|---|---|---|');
    for (const r of c.soft.rows) lines.push(`| ${r.arm} | ${r.corpus} | ${r.edit} | ${r.kind} | ${r.n} | ${r.adding} (${pct(r.adding / r.n)})${r.over ? ' OVER' : ''} | ${r.budget} |`);
  }
  if (c.global.length) {
    lines.push('', '| arm | global variant | n | hard after | failed |', '|---|---|---|---|---|');
    for (const g of c.global) lines.push(`| ${g.arm} | ${g.variant} | ${g.n} | ${arrow(g.old, g.new)} | ${arrow(g.failedOld, g.failedNew)} |`);
  }
  const list = (title, xs) => {
    lines.push('', `${title} (${xs.length})`);
    for (const x of xs.slice(0, 40)) lines.push(`  ${x}`);
    if (xs.length > 40) lines.push(`  ... ${xs.length - 40} more`);
  };
  list('WORSE', c.edits.worse);
  list('BETTER', c.edits.better);
  lines.push('', c.regressed ? `RESULT: regression (${c.soft?.over.length ? 'a soft budget exceeded, or ' : ''}more semantic failures or hard defects)` : 'RESULT: no regression');
  return lines.join('\n');
}
