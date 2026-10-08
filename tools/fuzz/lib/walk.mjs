/**
 * One seeded random walk: generate a step, run it, check every invariant,
 * repeat. Shared by the fuzz tool (tools/fuzz/walk.mjs, through the CLI or the
 * built library) and the property test (test/fuzz.test.ts, in-process on src/).
 *
 * Contract: `runWalk(cfg)` resolves to a summary and never throws for a
 * failing step. cfg:
 *   xml, model (a name for reports), seed, mode ('auto' | 'incremental' | 'full'),
 *   steps, exec ({ label, run(xml, ops, { mode }) }: cliExecutor or
 *   libExecutor of exec.mjs), metrics ({ measure(xml) -> {counts, problems, score},
 *   diff(before, after) -> {added}, hard: kinds }), semantic / format (which
 *   generators, default both), replay (a list of steps `{ name, ops }` to run
 *   instead of generating), detEvery (re-run every n-th step on the same input
 *   and compare the bytes; 0 = never), hardSeverity ('error' default, or
 *   'warn' to report new hard layout defects as warnings), onStep(entry, xml)
 *   (logging).
 * After every successful step:
 *   - reimport / DI: no new diInvariants() problem (clean bpmn-moddle
 *     re-import, DI complete on the right plane, no duplicate / dangling /
 *     stale DI, finite sizes, >= 2 waypoints, no frame intrusion) -> `di:<kind>`
 *   - no new problem of a hard kind (metric-kinds.mjs, so kinds added to the
 *     metrics library are included) -> `hard:<kind>`; problems involving a
 *     bpmn:Group are reported as `group:<kind>` (groups count as overlaps)
 *   - the result's layout.metrics equals a standalone measurement
 *     (`metricsMismatch`) and reports the same added hard problems (`addedMismatch`)
 *   - incremental / format-only steps: every shape whose bounds changed is
 *     reported (`unreportedMove`); reshaped connections that are not reported
 *     and not a uniform shift are `unreportedReroute`
 *   - `nondeterministic` when the spot-check re-run gives other bytes
 *   - `bboxJump` (> 1500 x 1000 px growth in one step) and `drift`
 * After every failing step: `crash` (internal error, signal, timeout), `usage`
 * (the op itself is malformed: a generator bug) and `writtenOnFailure`.
 * Severity: SOFT kinds and `group:*` are warnings, `hard:*` follows hardSeverity,
 * everything else is an error.
 */
import { analyse, bbox, diInvariants, geometry, reportedIds, stability } from './analyse.mjs';
import { genStep } from './generate.mjs';
import { rng } from './rng.mjs';

/** Violation kinds that are reported but do not fail a walk (unless strict). */
export const SOFT = new Set(['unreportedReroute', 'bboxJump', 'drift']);
export const severityOf = (kind, hardSeverity = 'error') => {
  if (kind.startsWith('group:') || SOFT.has(kind)) return 'warn';
  return kind.startsWith('hard:') ? hardSeverity : 'error';
};

const sortedKeys = (problems) => problems.map((p) => `${p.kind}:${p.ids.join(',')}`).sort();

function failureViolations(res, before, readBack) {
  const v = [];
  if (res.status === 'crash') v.push({ kind: 'crash', detail: `${res.code}: ${res.message}` });
  if (res.status === 'usage') v.push({ kind: 'usage', detail: `${res.code}: ${res.message}` });
  if (readBack !== undefined && readBack !== before) v.push({ kind: 'writtenOnFailure', detail: res.code });
  return v;
}

function hardViolations(added, hard, after) {
  const isGroup = (id) => after.sem?.byId.get(id)?.$type === 'bpmn:Group';
  return added.filter((p) => hard.includes(p.kind)).map((p) => ({
    kind: `${p.ids.some(isGroup) ? 'group' : 'hard'}:${p.kind}`,
    detail: `${p.ids.join(',')}${p.detail ? ` (${p.detail})` : ''}`,
  }));
}

function consistencyViolations(layout, now, addedHard, hard) {
  const v = [];
  const reported = layout?.metrics;
  if (!reported?.after?.counts) return v;
  // only kinds both sides know: a CLI build under test may predate kinds of the measuring library
  const shared = Object.keys(now.counts).filter((k) => k in reported.after.counts);
  const diff = shared.filter((k) => reported.after.counts[k] !== now.counts[k]);
  if (diff.length) v.push({ kind: 'metricsMismatch', detail: diff.map((k) => `${k}: result ${reported.after.counts[k]} vs metrics ${now.counts[k]}`).join('; ') });
  const known = (p) => hard.includes(p.kind) && shared.includes(p.kind);
  const theirs = sortedKeys((reported.added ?? []).filter(known));
  const mine = sortedKeys(addedHard.filter(known));
  if (JSON.stringify(theirs) !== JSON.stringify(mine)) v.push({ kind: 'addedMismatch', detail: `result [${theirs.join(' ')}] vs measured [${mine.join(' ')}]` });
  return v;
}

function stabilityViolations(prev, next, layout) {
  const keeps = layout?.mode === 'incremental' || (layout?.format?.length && layout?.mode !== 'full');
  if (!keeps) return [];
  const st = stability(geometry(prev), geometry(next), reportedIds(layout));
  const v = [];
  if (st.unreportedShapes.length) v.push({ kind: 'unreportedMove', n: st.unreportedShapes.length, detail: st.unreportedShapes.slice(0, 5).map((u) => `${u.id} ${u.from.join(',')} -> ${u.to.join(',')}`).join(' | ') });
  if (st.unreportedEdges.length) v.push({ kind: 'unreportedReroute', n: st.unreportedEdges.length, detail: st.unreportedEdges.slice(0, 3).map((u) => `${u.id}: ${u.from} -> ${u.to}`).join(' | ') });
  return v;
}

function extentViolations(prev, next, start) {
  const b = bbox(next), pb = bbox(prev);
  // a model drawn for the first time has no extent to compare with
  if (![b.w, b.h, pb.w, pb.h, start.x1, start.y1].every(Number.isFinite)) return [];
  const v = [];
  if (b.w - pb.w > 1500 || b.h - pb.h > 1000) v.push({ kind: 'bboxJump', detail: `${Math.round(pb.w)}x${Math.round(pb.h)} -> ${Math.round(b.w)}x${Math.round(b.h)}` });
  if (b.x1 < start.x1 - 2000 || b.y1 < start.y1 - 2000 || b.x1 < -5000 || b.y1 < -5000) v.push({ kind: 'drift', detail: `origin ${Math.round(b.x1)},${Math.round(b.y1)} (start ${Math.round(start.x1)},${Math.round(start.y1)})` });
  return v;
}

async function measureSafe(metrics, xml) {
  try {
    return await metrics.measure(xml);
  } catch (e) {
    return { error: String(e?.message ?? e).split('\n')[0] };
  }
}

const hardCount = (m, hard) => hard.reduce((s, k) => s + (m.counts?.[k] ?? 0), 0);

/** Checks of one successful step; returns the violations and the new state. */
async function checkSuccess(cfg, st, res) {
  const next = await analyse(res.xml);
  const inv = diInvariants(next);
  const v = inv.filter((x) => !st.inv.has(x)).map((x) => ({ kind: `di:${x.split('|')[0]}`, detail: x.slice(x.indexOf('|') + 1) }));
  const now = await measureSafe(cfg.metrics, res.xml);
  if (now.error) v.push({ kind: 'metricsFailed', detail: now.error });
  else {
    const added = st.met.problems ? cfg.metrics.diff(st.met.problems, now.problems).added : [];
    const hardV = hardViolations(added, cfg.metrics.hard, next);
    v.push(...hardV, ...consistencyViolations(res.layout, now, added.filter((p) => cfg.metrics.hard.includes(p.kind)), cfg.metrics.hard));
  }
  if (!next.parseError) v.push(...stabilityViolations(st.a, next, res.layout), ...extentViolations(st.a, next, st.box0));
  return { v, state: { ...st, xml: res.xml, a: next, inv: new Set(inv), met: now.error ? st.met : now } };
}

async function determinism(cfg, prevXml, ops, res) {
  const again = await cfg.exec.run(prevXml, ops, { mode: cfg.mode });
  if (again.status !== 'ok') return [{ kind: 'nondeterministic', detail: `re-run ${again.status} ${again.code ?? ''}` }];
  return again.xml === res.xml ? [] : [{ kind: 'nondeterministic', detail: 'same input and step, different bytes' }];
}

async function initialState(xml, metrics) {
  const a = await analyse(xml);
  const met = await measureSafe(metrics, xml);
  return { xml, a, inv: new Set(diInvariants(a)), met: met.error ? { counts: {}, problems: undefined } : met, box0: bbox(a) };
}

export async function runWalk(cfg) {
  const t0 = Date.now();
  const r = rng(cfg.seed >>> 0);
  let st = await initialState(cfg.xml, cfg.metrics);
  const hard = cfg.metrics.hard;
  const summary = {
    model: cfg.model, seed: cfg.seed, mode: cfg.mode, exec: cfg.exec.label, steps: 0, ok: 0, refused: {}, modes: {},
    initialInvariants: st.inv.size, initialHard: hardCount(st.met, hard), violations: [], ops: [],
  };
  const total = cfg.replay ? cfg.replay.length : cfg.steps;
  for (let step = 0; step < total; step++) {
    const gen = cfg.replay ? cfg.replay[step] : genStep(st.a, r, step, { semantic: cfg.semantic !== false, format: cfg.format !== false });
    if (!gen) break;
    summary.ops.push(gen);
    summary.steps++;
    const res = await cfg.exec.run(st.xml, gen.ops, { mode: cfg.mode });
    const entry = { step, name: gen.name, status: res.status, ms: res.ms };
    let v;
    if (res.status !== 'ok') {
      entry.code = res.code;
      summary.refused[res.code] = (summary.refused[res.code] ?? 0) + 1;
      v = failureViolations(res, st.xml, res.readBack);
    } else {
      summary.ok++;
      entry.mode = res.layout?.mode ?? res.layout?.status;
      summary.modes[entry.mode] = (summary.modes[entry.mode] ?? 0) + 1;
      const prevXml = st.xml;
      ({ v, state: st } = await checkSuccess(cfg, st, res));
      if (cfg.detEvery && step % cfg.detEvery === cfg.detEvery - 1) v.push(...(await determinism(cfg, prevXml, gen.ops, res)));
    }
    entry.violations = v.map((x) => ({ ...x, severity: severityOf(x.kind, cfg.hardSeverity) }));
    for (const x of entry.violations) summary.violations.push({ step, op: gen.name, ...x });
    cfg.onStep?.(entry, st.xml);
  }
  summary.errors = summary.violations.filter((x) => x.severity === 'error').length;
  summary.warnings = summary.violations.length - summary.errors;
  summary.finalHard = hardCount(st.met, hard);
  summary.finalScore = st.met.score;
  summary.ms = Date.now() - t0;
  return summary;
}
