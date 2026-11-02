import { analyse, bbox, drawingInvariants, geometry, reportedIds, stability } from './analyse.mjs';
import { genStep } from './generate.mjs';
import { rng } from './rng.mjs';

export const SOFT = new Set(['unreportedReroute', 'bboxJump', 'drift']);
export const severityOf = (kind, hardSeverity = 'error') => {
  if (kind.startsWith('group:') || SOFT.has(kind)) {
    return 'warn';
  }
  return kind.startsWith('hard:') ? hardSeverity : 'error';
};

const KEEPING_OPERATIONS = new Set(['place', 'color', 'label', 'route', 'space', 'tidy', 'compact']);

const sortedKeys = (problems) => problems.map((problem) => `${problem.kind}:${problem.ids.join(',')}`).sort();

function failureViolations(res, before, readBack) {
  const violations = [];
  if (res.status === 'crash') {
    violations.push({ kind: 'crash', detail: `${res.code}: ${res.message}` });
  }
  if (res.status === 'usage') {
    violations.push({ kind: 'usage', detail: `${res.code}: ${res.message}` });
  }
  if (readBack !== undefined && readBack !== before) {
    violations.push({ kind: 'writtenOnFailure', detail: res.code });
  }
  return violations;
}

function hardViolations(added, hard, after) {
  const isGroup = (id) => after.sem?.byId.get(id)?.$type === 'bpmn:Group';
  return added.filter((problem) => hard.includes(problem.kind)).map((problem) => ({
    kind: `${problem.ids.some(isGroup) ? 'group' : 'hard'}:${problem.kind}`,
    detail: `${problem.ids.join(',')}${problem.detail ? ` (${problem.detail})` : ''}`,
  }));
}

function consistencyViolations(result, now, addedHard, hard) {
  const violations = [];
  const reported = result?.score;
  if (!reported?.after?.counts) {
    return violations;
  }
  const shared = Object.keys(now.counts).filter((kind) => kind in reported.after.counts);
  const diff = shared.filter((kind) => reported.after.counts[kind] !== now.counts[kind]);
  if (diff.length) {
    violations.push({ kind: 'metricsMismatch', detail: diff.map((kind) => `${kind}: result ${reported.after.counts[kind]} vs metrics ${now.counts[kind]}`).join('; ') });
  }
  const known = (problem) => hard.includes(problem.kind) && shared.includes(problem.kind);
  const theirs = sortedKeys((reported.added ?? []).filter(known));
  const mine = sortedKeys(addedHard.filter(known));
  if (JSON.stringify(theirs) !== JSON.stringify(mine)) {
    violations.push({ kind: 'addedMismatch', detail: `result [${theirs.join(' ')}] vs measured [${mine.join(' ')}]` });
  }
  return violations;
}

function stabilityViolations(prev, next, ops, result) {
  if (!result || !ops.every((operation) => KEEPING_OPERATIONS.has(operation.op))) {
    return [];
  }
  const st = stability(geometry(prev), geometry(next), reportedIds(result.format));
  const violations = [];
  if (st.unreportedShapes.length) {
    violations.push({ kind: 'unreportedMove', n: st.unreportedShapes.length, detail: st.unreportedShapes.slice(0, 5).map((unreported) => `${unreported.id} ${unreported.from.join(',')} -> ${unreported.to.join(',')}`).join(' | ') });
  }
  if (st.unreportedEdges.length) {
    violations.push({ kind: 'unreportedReroute', n: st.unreportedEdges.length, detail: st.unreportedEdges.slice(0, 3).map((unreported) => `${unreported.id}: ${unreported.from} -> ${unreported.to}`).join(' | ') });
  }
  return violations;
}

function extentViolations(prev, next, start) {
  const nextBox = bbox(next), pb = bbox(prev);
  if (![nextBox.w, nextBox.h, pb.w, pb.h, start.x1, start.y1].every(Number.isFinite)) {
    return [];
  }
  const violations = [];
  if (nextBox.w - pb.w > 1500 || nextBox.h - pb.h > 1000) {
    violations.push({ kind: 'bboxJump', detail: `${Math.round(pb.w)}x${Math.round(pb.h)} -> ${Math.round(nextBox.w)}x${Math.round(nextBox.h)}` });
  }
  if (nextBox.x1 < start.x1 - 2000 || nextBox.y1 < start.y1 - 2000 || nextBox.x1 < -5000 || nextBox.y1 < -5000) {
    violations.push({ kind: 'drift', detail: `origin ${Math.round(nextBox.x1)},${Math.round(nextBox.y1)} (start ${Math.round(start.x1)},${Math.round(start.y1)})` });
  }
  return violations;
}

async function renderViolations(render, xml, met) {
  if (!render) {
    return [];
  }
  try {
    const rendered = await render.draw(xml);
    const expected = met?.problems ? met.problems.filter((problem) => problem.kind !== 'failed').length : undefined;
    return expected !== undefined && rendered.problems.length !== expected ? [{ kind: 'render', detail: `${rendered.problems.length} problems listed, the metrics have ${expected}` }] : [];
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

async function checkSuccess(cfg, st, res, ops) {
  const next = await analyse(res.xml);
  const inv = drawingInvariants(next);
  const violations = inv.filter((invariant) => !st.inv.has(invariant)).map((invariant) => ({ kind: `di:${invariant.split('|')[0]}`, detail: invariant.slice(invariant.indexOf('|') + 1) }));
  const now = await measureSafe(cfg.metrics, res.xml);
  if (now.error) {
    violations.push({ kind: 'metricsFailed', detail: now.error });
  } else {
    const added = st.met.problems ? cfg.metrics.diff(st.met.problems, now.problems).added : [];
    const hardV = hardViolations(added, cfg.metrics.hard, next);
    violations.push(...hardV, ...consistencyViolations(res.result, now, added.filter((problem) => cfg.metrics.hard.includes(problem.kind)), cfg.metrics.hard));
  }
  if (!next.parseError) {
    violations.push(...stabilityViolations(st.a, next, ops, res.result), ...extentViolations(st.a, next, st.box0));
  }
  if (!next.parseError) {
    violations.push(...(await renderViolations(cfg.render, res.xml, now.error ? undefined : now)));
  }
  return { v: violations, state: { ...st, xml: res.xml, a: next, inv: new Set(inv), met: now.error ? st.met : now } };
}

async function determinism(cfg, prevXml, ops, res) {
  const again = await cfg.exec.run(prevXml, ops);
  if (again.status !== 'ok') {
    return [{ kind: 'nondeterministic', detail: `re-run ${again.status} ${again.code ?? ''}` }];
  }
  return again.xml === res.xml ? [] : [{ kind: 'nondeterministic', detail: 'same input and step, different bytes' }];
}

async function initialState(xml, metrics) {
  const analysed = await analyse(xml);
  const met = await measureSafe(metrics, xml);
  return { xml, a: analysed, inv: new Set(drawingInvariants(analysed)), met: met.error ? { counts: {}, problems: undefined } : met, box0: bbox(analysed) };
}

export async function runWalk(cfg) {
  const t0 = Date.now();
  const random = rng(cfg.seed >>> 0);
  let st = await initialState(cfg.xml, cfg.metrics);
  const hard = cfg.metrics.hard;
  const summary = {
    model: cfg.model, seed: cfg.seed, exec: cfg.exec.label, steps: 0, ok: 0, refused: {},
    initialInvariants: st.inv.size, initialHard: hardCount(st.met, hard), violations: [], ops: [],
  };
  const total = cfg.replay ? cfg.replay.length : cfg.steps;
  for (let step = 0; step < total; step++) {
    const gen = cfg.replay ? cfg.replay[step] : genStep(st.a, random, step, { semantic: cfg.semantic !== false, format: cfg.format !== false });
    if (!gen) {
      break;
    }
    summary.ops.push(gen);
    summary.steps++;
    const res = await cfg.exec.run(st.xml, gen.ops);
    const entry = { step, name: gen.name, status: res.status, ms: res.ms };
    let violations;
    if (res.status !== 'ok') {
      entry.code = res.code;
      summary.refused[res.code] = (summary.refused[res.code] ?? 0) + 1;
      violations = failureViolations(res, st.xml, res.readBack);
    } else {
      summary.ok++;
      const prevXml = st.xml;
      ({ v: violations, state: st } = await checkSuccess(cfg, st, res, gen.ops));
      if (cfg.detEvery && step % cfg.detEvery === cfg.detEvery - 1) {
        violations.push(...(await determinism(cfg, prevXml, gen.ops, res)));
      }
    }
    entry.violations = violations.map((violation) => ({ ...violation, severity: severityOf(violation.kind, cfg.hardSeverity) }));
    for (const violation of entry.violations) {
      summary.violations.push({ step, op: gen.name, ...violation });
    }
    cfg.onStep?.(entry, st.xml);
  }
  summary.errors = summary.violations.filter((violation) => violation.severity === 'error').length;
  summary.warnings = summary.violations.length - summary.errors;
  summary.finalHard = hardCount(st.met, hard);
  summary.finalScore = st.met.score;
  summary.ms = Date.now() - t0;
  return summary;
}
