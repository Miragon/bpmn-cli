import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OLD_ARM = 'baseline';
const NEW_ARM = 'new';
const EDIT_ORDER = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9'];
export const SOFT_BUDGET_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'soft-budget.json');

const readJsonl = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const readMeta = (dir) => (existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : {});
function median(xs) {
  if (!xs.length) {
    return NaN;
  }
  const sorted = [...xs].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : NaN);

function effectiveEdits(records) {
  const by = new Map();
  for (const record of records) {
    const key = `${record.corpus}/${record.model}/${record.edit}`;
    if (!by.has(key)) {
      by.set(key, {});
    }
    by.get(key)[record.variant] = record;
  }
  const out = new Map();
  for (const [key, variants] of by) {
    if (!variants.primary) {
      continue;
    }
    out.set(key, variants.primary.ok ? variants.primary : variants.force?.ok ? variants.force : variants.primary);
  }
  return out;
}

const semanticPass = (record) => !!record.ok && !!record.semanticOk && !(record.validity?.importWarnings > 0);
const hardAdded = (record, kinds) => (record.hard?.addedKinds ? kinds.reduce((sum, kind) => sum + (record.hard.addedKinds[kind] ?? 0), 0) : 0);
const hardAfter = (record, kinds) => (record.after?.harness?.counts ? kinds.reduce((sum, kind) => sum + (record.after.harness.counts[kind] ?? 0), 0) : 0);
const movedShare = (record) => (record.stabilityOthers?.n ? record.stabilityOthers.moved5 / record.stabilityOthers.n : NaN);

function measures(record, kinds) {
  return { sem: semanticPass(record), hard: hardAdded(record, kinds), soft: record.soft?.addedKinds ?? null, dh: record.delta?.harness ?? null, moved: movedShare(record) };
}

const softRuns = (ms, kind) => (ms.some((sideMeasures) => sideMeasures.soft) ? ms.filter((measure) => measure.soft?.[kind] > 0).length : undefined);

function editRow(edit, pairs) {
  const side = (sideName) => {
    const ms = pairs.map((pair) => pair[sideName]);
    return {
      semFail: ms.filter((measure) => !measure.sem).length,
      hardRuns: ms.filter((measure) => measure.hard > 0).length,
      hardSum: ms.reduce((sum, measure) => sum + measure.hard, 0),
      crossRuns: softRuns(ms, 'crossings'),
      backRuns: softRuns(ms, 'backwardFlow'),
      dh: mean(ms.map((measure) => measure.dh).filter((delta) => delta !== null)),
      moved: median(ms.map((measure) => measure.moved).filter(Number.isFinite)),
    };
  };
  return { edit, n: pairs.length, old: side('old'), new: side('new') };
}

function compareEdits(dir, kinds, notes) {
  const oldEdits = effectiveEdits(readJsonl(join(dir, `edits-${OLD_ARM}.jsonl`)));
  const newEdits = effectiveEdits(readJsonl(join(dir, `edits-${NEW_ARM}.jsonl`)));
  const only = [...oldEdits.keys()].filter((key) => !newEdits.has(key)).length + [...newEdits.keys()].filter((key) => !oldEdits.has(key)).length;
  if (only) {
    notes.push(`${only} edit run(s) exist on one side only and are not compared`);
  }
  const pairs = [...oldEdits.keys()].filter((key) => newEdits.has(key)).sort().map((key) => ({ key, edit: key.split('/').pop(), old: measures(oldEdits.get(key), kinds), new: measures(newEdits.get(key), kinds) }));
  const rows = [...EDIT_ORDER, 'all'].map((editType) => editRow(editType, pairs.filter((pair) => editType === 'all' || pair.edit === editType))).filter((row) => row.n);
  const describe = (pair) => `${pair.key}: sem ${pair.old.sem ? 'ok' : 'FAIL'} -> ${pair.new.sem ? 'ok' : 'FAIL'}, +hard ${pair.old.hard} -> ${pair.new.hard}`;
  const worse = pairs.filter((pair) => (pair.old.sem && !pair.new.sem) || pair.new.hard > pair.old.hard).map(describe);
  const better = pairs.filter((pair) => (!pair.old.sem && pair.new.sem) || pair.new.hard < pair.old.hard).map(describe);
  return { rows, worse, better };
}

function compareGlobal(dir, kinds) {
  const index = (arm) => new Map(readJsonl(join(dir, `global-${arm}.jsonl`)).map((record) => [`${record.corpus}/${record.model}/${record.variant}`, record]));
  const oldGlobal = index(OLD_ARM), newGlobal = index(NEW_ARM);
  const variants = new Map();
  for (const [key, oldRecord] of oldGlobal) {
    const newRecord = newGlobal.get(key);
    if (!newRecord) {
      continue;
    }
    const variantTotals = variants.get(oldRecord.variant) ?? { variant: oldRecord.variant, n: 0, old: 0, new: 0, failedOld: 0, failedNew: 0 };
    variantTotals.n++;
    variantTotals.old += hardAfter(oldRecord, kinds);
    variantTotals.new += hardAfter(newRecord, kinds);
    variantTotals.failedOld += oldRecord.ok ? 0 : 1;
    variantTotals.failedNew += newRecord.ok ? 0 : 1;
    variants.set(oldRecord.variant, variantTotals);
  }
  return [...variants.values()];
}

function checkSoft(dir, budgetFile) {
  const budget = existsSync(budgetFile) ? JSON.parse(readFileSync(budgetFile, 'utf8')).corpora ?? {} : {};
  const runs = [...effectiveEdits(readJsonl(join(dir, `edits-${NEW_ARM}.jsonl`))).values()];
  const rows = [];
  for (const [corpus, edits] of Object.entries(budget)) {
    for (const [edit, limits] of Object.entries(edits)) {
      const these = runs.filter((run) => run.corpus === corpus && run.edit === edit && run.soft?.addedKinds);
      if (!these.length) {
        continue;
      }
      for (const [kind, max] of Object.entries(limits)) {
        const adding = these.filter((run) => run.soft.addedKinds[kind] > 0).length;
        rows.push({ corpus, edit, kind, n: these.length, adding, budget: max, over: adding > max });
      }
    }
  }
  return { rows, over: rows.filter((row) => row.over) };
}

export function compareResults(dir, budgetFile = SOFT_BUDGET_FILE) {
  const { hardKinds: kinds = [] } = readMeta(dir);
  const notes = [];
  const edits = compareEdits(dir, kinds, notes);
  const global = compareGlobal(dir, kinds);
  const totals = edits.rows.filter((row) => row.edit === 'all');
  const soft = checkSoft(dir, budgetFile);
  const regressed = totals.some((row) => row.new.semFail > row.old.semFail || row.new.hardRuns > row.old.hardRuns || row.new.hardSum > row.old.hardSum)
    || global.some((globalRow) => globalRow.new > globalRow.old || globalRow.failedNew > globalRow.failedOld)
    || soft.over.length > 0;
  return { dir, kinds, notes, edits, global, soft, regressed };
}

const f1 = (value) => (Number.isFinite(value) ? (Math.round(value * 10) / 10).toString() : '-');
const pct = (share) => (Number.isFinite(share) ? `${Math.round(100 * share)}%` : '-');
const arrow = (before, after, fmt = String) => (fmt(before) === fmt(after) ? fmt(before) : `${fmt(before)} -> ${fmt(after)}`);

export function formatComparison(comparison) {
  const lines = [`COMPARE main  ->  rebuild in ${comparison.dir}`, `hard kinds compared: ${comparison.kinds.join(' ') || '(none)'}`];
  for (const note of comparison.notes) {
    lines.push(`note: ${note}`);
  }
  const opt = (value) => (value === undefined ? '-' : String(value));
  lines.push('', '| edit | n | sem fail | runs +hard | +hard | runs +crossings | runs +backward | mean Δ harness | median moved>5px |', '|---|---|---|---|---|---|---|---|---|');
  for (const row of comparison.edits.rows) {
    lines.push(`| ${row.edit} | ${row.n} | ${arrow(row.old.semFail, row.new.semFail)} | ${arrow(row.old.hardRuns, row.new.hardRuns)} | ${arrow(row.old.hardSum, row.new.hardSum)} | ${arrow(row.old.crossRuns, row.new.crossRuns, opt)} | ${arrow(row.old.backRuns, row.new.backRuns, opt)} | ${arrow(row.old.dh, row.new.dh, f1)} | ${arrow(row.old.moved, row.new.moved, pct)} |`);
  }
  if (comparison.soft?.rows.length) {
    lines.push('', '| corpus | edit | soft kind | runs | runs adding it | budget |', '|---|---|---|---|---|---|');
    for (const row of comparison.soft.rows) {
      lines.push(`| ${row.corpus} | ${row.edit} | ${row.kind} | ${row.n} | ${row.adding} (${pct(row.adding / row.n)})${row.over ? ' OVER' : ''} | ${row.budget} |`);
    }
  }
  if (comparison.global.length) {
    lines.push('', '| global variant | n | hard after | failed |', '|---|---|---|---|');
    for (const globalRow of comparison.global) {
      lines.push(`| ${globalRow.variant} | ${globalRow.n} | ${arrow(globalRow.old, globalRow.new)} | ${arrow(globalRow.failedOld, globalRow.failedNew)} |`);
    }
  }
  const list = (title, xs) => {
    lines.push('', `${title} (${xs.length})`);
    for (const entry of xs.slice(0, 40)) {
      lines.push(`  ${entry}`);
    }
    if (xs.length > 40) {
      lines.push(`  ... ${xs.length - 40} more`);
    }
  };
  list('WORSE', comparison.edits.worse);
  list('BETTER', comparison.edits.better);
  lines.push('', comparison.regressed ? `RESULT: regression (${comparison.soft?.over.length ? 'a soft budget exceeded, or ' : ''}more semantic failures or hard defects)` : 'RESULT: no regression');
  return lines.join('\n');
}
