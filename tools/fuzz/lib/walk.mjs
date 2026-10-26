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
 *   diff(before, after) -> {added}, hard: kinds }), render (optional:
 *   { draw(xml) -> renderPng's result, maxSize }, setup.mjs loadRender),
 *   semantic / format (which
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
 *     bpmn:Group are reported as `group:<kind>` (a group is no leaf shape for
 *     the metrics, so what is left is rare, e.g. a group outside its pool)
 *   - the result's layout.metrics equals a standalone measurement
 *     (`metricsMismatch`) and reports the same added hard problems (`addedMismatch`)
 *   - incremental / format-only steps: every shape whose bounds changed is
 *     reported (`unreportedMove`); reshaped connections that are not reported
 *     and not a uniform shift are `unreportedReroute`
 *   - `nondeterministic` when the spot-check re-run gives other bytes
 *   - `bboxJump` (> 1500 x 1000 px growth in one step) and `drift`
 *   - with `render`: the result renders (`bpmn render --problems --tiles`
 *     as PNG): `render` when it throws (E_RENDER, a crash), an image exceeds
 *     maxSize, or it lists another number of problems than the metrics
 *     (import warnings aside)
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

const sortedKeys = (problems) => problems.map((problem) => `${problem.kind}:${problem.ids.join(',')}`).sort();

function failureViolations(res, before, readBack) {
  const violations = [];
  if (res.status === 'crash') violations.push({ kind: 'crash', detail: `${res.code}: ${res.message}` });
  if (res.status === 'usage') violations.push({ kind: 'usage', detail: `${res.code}: ${res.message}` });
  if (readBack !== undefined && readBack !== before) violations.push({ kind: 'writtenOnFailure', detail: res.code });
  return violations;
}

function hardViolations(added, hard, after) {
  const isGroup = (id) => after.sem?.byId.get(id)?.$type === 'bpmn:Group';
  return added.filter((problem) => hard.includes(problem.kind)).map((problem) => ({
    kind: `${problem.ids.some(isGroup) ? 'group' : 'hard'}:${problem.kind}`,
    detail: `${problem.ids.join(',')}${problem.detail ? ` (${problem.detail})` : ''}`,
  }));
}

function consistencyViolations(layout, now, addedHard, hard) {
  const violations = [];
  const reported = layout?.metrics;
  if (!reported?.after?.counts) return violations;
  // only kinds both sides know: a CLI build under test may predate kinds of the measuring library
  const shared = Object.keys(now.counts).filter((kind) => kind in reported.after.counts);
  const diff = shared.filter((kind) => reported.after.counts[kind] !== now.counts[kind]);
  if (diff.length) violations.push({ kind: 'metricsMismatch', detail: diff.map((kind) => `${kind}: result ${reported.after.counts[kind]} vs metrics ${now.counts[kind]}`).join('; ') });
  const known = (problem) => hard.includes(problem.kind) && shared.includes(problem.kind);
  const theirs = sortedKeys((reported.added ?? []).filter(known));
  const mine = sortedKeys(addedHard.filter(known));
  if (JSON.stringify(theirs) !== JSON.stringify(mine)) violations.push({ kind: 'addedMismatch', detail: `result [${theirs.join(' ')}] vs measured [${mine.join(' ')}]` });
  return violations;
}

function stabilityViolations(prev, next, layout) {
  const keeps = layout?.mode === 'incremental' || (layout?.format?.length && layout?.mode !== 'full');
  if (!keeps) return [];
  const st = stability(geometry(prev), geometry(next), reportedIds(layout));
  const violations = [];
  if (st.unreportedShapes.length) violations.push({ kind: 'unreportedMove', n: st.unreportedShapes.length, detail: st.unreportedShapes.slice(0, 5).map((unreported) => `${unreported.id} ${unreported.from.join(',')} -> ${unreported.to.join(',')}`).join(' | ') });
  if (st.unreportedEdges.length) violations.push({ kind: 'unreportedReroute', n: st.unreportedEdges.length, detail: st.unreportedEdges.slice(0, 3).map((unreported) => `${unreported.id}: ${unreported.from} -> ${unreported.to}`).join(' | ') });
  return violations;
}

function extentViolations(prev, next, start) {
  const nextBox = bbox(next), pb = bbox(prev);
  // a model drawn for the first time has no extent to compare with
  if (![nextBox.w, nextBox.h, pb.w, pb.h, start.x1, start.y1].every(Number.isFinite)) return [];
  const violations = [];
  if (nextBox.w - pb.w > 1500 || nextBox.h - pb.h > 1000) violations.push({ kind: 'bboxJump', detail: `${Math.round(pb.w)}x${Math.round(pb.h)} -> ${Math.round(nextBox.w)}x${Math.round(nextBox.h)}` });
  if (nextBox.x1 < start.x1 - 2000 || nextBox.y1 < start.y1 - 2000 || nextBox.x1 < -5000 || nextBox.y1 < -5000) violations.push({ kind: 'drift', detail: `origin ${Math.round(nextBox.x1)},${Math.round(nextBox.y1)} (start ${Math.round(start.x1)},${Math.round(start.y1)})` });
  return violations;
}

/** The result renders like `bpmn render --problems --tiles` (see contract). */
async function renderViolations(render, xml, met) {
  if (!render) return [];
  try {
    const rendered = await render.draw(xml);
    const violations = [];
    const big = rendered.images.find((image) => Math.max(image.width, image.height) > render.maxSize);
    if (big) violations.push({ kind: 'render', detail: `an image of ${big.width}x${big.height} px exceeds ${render.maxSize}` });
    const expected = met?.problems ? met.problems.filter((problem) => problem.kind !== 'failed').length : undefined;
    if (expected !== undefined && rendered.problems.length !== expected) violations.push({ kind: 'render', detail: `${rendered.problems.length} problems listed, the metrics have ${expected}` });
    return violations;
  } catch (error) {
    return [{ kind: 'render', detail: `${error?.code ?? 'exception'}: ${String(error?.message ?? error).split('\n')[0].slice(0, 300)}` }];
  }
}

async function measureSafe(metrics, xml) {
  try {
    return await metrics.measure(xml);
  } catch (error) {
    return { error: String(error?.message ?? error).split('\n')[0] };
  }
}

const hardCount = (measured, hard) => hard.reduce((sum, kind) => sum + (measured.counts?.[kind] ?? 0), 0);

/** Checks of one successful step; returns the violations and the new state. */
async function checkSuccess(cfg, st, res) {
  const next = await analyse(res.xml);
  const inv = diInvariants(next);
  const violations = inv.filter((invariant) => !st.inv.has(invariant)).map((invariant) => ({ kind: `di:${invariant.split('|')[0]}`, detail: invariant.slice(invariant.indexOf('|') + 1) }));
  const now = await measureSafe(cfg.metrics, res.xml);
  if (now.error) violations.push({ kind: 'metricsFailed', detail: now.error });
  else {
    const added = st.met.problems ? cfg.metrics.diff(st.met.problems, now.problems).added : [];
    const hardV = hardViolations(added, cfg.metrics.hard, next);
    violations.push(...hardV, ...consistencyViolations(res.layout, now, added.filter((problem) => cfg.metrics.hard.includes(problem.kind)), cfg.metrics.hard));
  }
  if (!next.parseError) violations.push(...stabilityViolations(st.a, next, res.layout), ...extentViolations(st.a, next, st.box0));
  if (!next.parseError) violations.push(...(await renderViolations(cfg.render, res.xml, now.error ? undefined : now)));
  return { v: violations, state: { ...st, xml: res.xml, a: next, inv: new Set(inv), met: now.error ? st.met : now } };
}

async function determinism(cfg, prevXml, ops, res) {
  const again = await cfg.exec.run(prevXml, ops, { mode: cfg.mode });
  if (again.status !== 'ok') return [{ kind: 'nondeterministic', detail: `re-run ${again.status} ${again.code ?? ''}` }];
  return again.xml === res.xml ? [] : [{ kind: 'nondeterministic', detail: 'same input and step, different bytes' }];
}

async function initialState(xml, metrics) {
  const analysed = await analyse(xml);
  const met = await measureSafe(metrics, xml);
  return { xml, a: analysed, inv: new Set(diInvariants(analysed)), met: met.error ? { counts: {}, problems: undefined } : met, box0: bbox(analysed) };
}

export async function runWalk(cfg) {
  const t0 = Date.now();
  const random = rng(cfg.seed >>> 0);
  let st = await initialState(cfg.xml, cfg.metrics);
  const hard = cfg.metrics.hard;
  const summary = {
    model: cfg.model, seed: cfg.seed, mode: cfg.mode, exec: cfg.exec.label, steps: 0, ok: 0, refused: {}, modes: {},
    initialInvariants: st.inv.size, initialHard: hardCount(st.met, hard), violations: [], ops: [],
  };
  const total = cfg.replay ? cfg.replay.length : cfg.steps;
  for (let step = 0; step < total; step++) {
    const gen = cfg.replay ? cfg.replay[step] : genStep(st.a, random, step, { semantic: cfg.semantic !== false, format: cfg.format !== false });
    if (!gen) break;
    summary.ops.push(gen);
    summary.steps++;
    const res = await cfg.exec.run(st.xml, gen.ops, { mode: cfg.mode });
    const entry = { step, name: gen.name, status: res.status, ms: res.ms };
    let violations;
    if (res.status !== 'ok') {
      entry.code = res.code;
      summary.refused[res.code] = (summary.refused[res.code] ?? 0) + 1;
      violations = failureViolations(res, st.xml, res.readBack);
    } else {
      summary.ok++;
      entry.mode = res.layout?.mode ?? res.layout?.status;
      summary.modes[entry.mode] = (summary.modes[entry.mode] ?? 0) + 1;
      const prevXml = st.xml;
      ({ v: violations, state: st } = await checkSuccess(cfg, st, res));
      if (cfg.detEvery && step % cfg.detEvery === cfg.detEvery - 1) violations.push(...(await determinism(cfg, prevXml, gen.ops, res)));
    }
    entry.violations = violations.map((violation) => ({ ...violation, severity: severityOf(violation.kind, cfg.hardSeverity) }));
    for (const violation of entry.violations) summary.violations.push({ step, op: gen.name, ...violation });
    cfg.onStep?.(entry, st.xml);
  }
  summary.errors = summary.violations.filter((violation) => violation.severity === 'error').length;
  summary.warnings = summary.violations.length - summary.errors;
  summary.finalHard = hardCount(st.met, hard);
  summary.finalScore = st.met.score;
  summary.ms = Date.now() - t0;
  return summary;
}
