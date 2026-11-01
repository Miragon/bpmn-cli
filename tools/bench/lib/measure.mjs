import { centre, readModel } from './model.mjs';

function median(xs) {
  if (!xs.length) {
    return 0;
  }
  const sorted = [...xs].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const r1 = (value) => Math.round(value * 10) / 10;
const stats = (ds) => ({ n: ds.length, max: r1(ds.length ? Math.max(...ds) : 0), median: r1(median(ds)), mean: r1(ds.length ? ds.reduce((sum, distance) => sum + distance, 0) / ds.length : 0), moved5: ds.filter((distance) => distance > 5).length });
const firstLine = (error) => String(error?.message ?? error).split('\n')[0];

export async function quality(xml, ctx) {
  try {
    const { counts, score, problems } = await ctx.metrics.measure(xml);
    return { harness: { counts, score }, problems };
  } catch (error) {
    return { harness: { error: firstLine(error), counts: null, score: null } };
  }
}

export function hardDelta(before, after, ctx) {
  const hard = ctx.metrics.hard;
  const count = (quality) => (quality.harness.counts ? hard.reduce((sum, kind) => sum + (quality.harness.counts[kind] ?? 0), 0) : null);
  if (!before.problems || !after.problems) {
    return { before: count(before), after: count(after), added: null, addedKinds: {}, examples: [] };
  }
  const added = ctx.metrics.diff(before.problems, after.problems).added.filter((problem) => hard.includes(problem.kind));
  const addedKinds = {};
  for (const problem of added) {
    addedKinds[problem.kind] = (addedKinds[problem.kind] ?? 0) + 1;
  }
  return { before: count(before), after: count(after), added: added.length, addedKinds, examples: added.slice(0, 3).map((problem) => `${problem.kind}:${problem.ids.join(',')}`) };
}

export const SOFT_KINDS = ['crossings', 'backwardFlow'];

export function softDelta(before, after, ctx) {
  if (!before.problems || !after.problems) {
    return { addedKinds: null };
  }
  const added = ctx.metrics.diff(before.problems, after.problems).added.filter((problem) => SOFT_KINDS.includes(problem.kind));
  const addedKinds = Object.fromEntries(SOFT_KINDS.map((kind) => [kind, added.filter((problem) => problem.kind === kind).length]));
  return { addedKinds };
}

export function stability(before, after, exclude = new Set()) {
  const pairs = [];
  for (const [id] of before.nodes) {
    if (exclude.has(id)) {
      continue;
    }
    const beforeBounds = before.shapes.get(id), afterBounds = after.shapes.get(id);
    if (!beforeBounds || !afterBounds || !after.nodes.has(id)) {
      continue;
    }
    const ca = centre(beforeBounds), cb = centre(afterBounds);
    pairs.push({ dx: cb.x - ca.x, dy: cb.y - ca.y });
  }
  const raw = pairs.map((pair) => Math.hypot(pair.dx, pair.dy));
  const tx = median(pairs.map((pair) => pair.dx)), ty = median(pairs.map((pair) => pair.dy));
  const norm = pairs.map((pair) => Math.hypot(pair.dx - tx, pair.dy - ty));
  return { ...stats(raw), norm: { ...stats(norm), tx: r1(tx), ty: r1(ty) } };
}

const warningKind = (msg) => (/unresolved reference/i.test(msg) ? 'unresolvedRef' : /unparsable content/i.test(msg) ? 'unparsable' : /duplicate ID/i.test(msg) ? 'duplicateId' : 'other');

export function validity(model) {
  let missing = 0;
  for (const id of model.nodes.keys()) {
    if (!model.shapes.has(id)) {
      missing++;
    }
  }
  let emptyEdges = 0;
  for (const pts of model.edges.values()) {
    if (pts.length < 2) {
      emptyEdges++;
    }
  }
  const warningKinds = {};
  for (const warning of model.warnings) {
    const kind = warningKind(warning.message);
    warningKinds[kind] = (warningKinds[kind] ?? 0) + 1;
  }
  return { importWarnings: model.warnings.length, warningKinds, lossy: model.lossy, flowNodes: model.nodes.size, missingDi: missing, emptyEdges };
}

const incomingFrom = (model, id, src) => (model.nodes.get(id)?.incoming || []).some((flowId) => model.flows.get(flowId)?.sourceId === src);
const outgoingTo = (model, id, tgt) => (model.nodes.get(id)?.outgoing || []).some((flowId) => model.flows.get(flowId)?.targetId === tgt);
const inside = (point, bounds) => point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;

export function checkEdit(expectation, model) {
  const node = (id) => model.nodes.get(id);
  switch (expectation.kind) {
    case 'inserted': {
      const ok = !!node(expectation.id) && node(expectation.id).el.$type === expectation.type && incomingFrom(model, expectation.id, expectation.pred) && outgoingTo(model, expectation.id, expectation.succ);
      return { ok, hasDi: model.shapes.has(expectation.id) };
    }
    case 'branch': {
      const ok = !!node(expectation.task) && incomingFrom(model, expectation.task, expectation.gateway) && node(expectation.end)?.type === 'EndEvent' && incomingFrom(model, expectation.end, expectation.task);
      return { ok, hasDi: model.shapes.has(expectation.task) && model.shapes.has(expectation.end) };
    }
    case 'removed': {
      const ok = !node(expectation.id) && outgoingTo(model, expectation.pred, expectation.succ);
      return { ok, hasDi: !model.shapes.has(expectation.id) };
    }
    case 'boundary': {
      const ev = node(expectation.event);
      const trigger = ev?.el.eventDefinitions?.[0]?.$type?.replace(/^bpmn:/, '');
      const ok = ev?.type === 'BoundaryEvent' && ev.attachedTo === expectation.host && node(expectation.end)?.type === 'EndEvent' && incomingFrom(model, expectation.end, expectation.event);
      return { ok: !!ok, trigger, hasDi: model.shapes.has(expectation.event) && model.shapes.has(expectation.end) };
    }
    case 'lane': {
      const ok = node(expectation.id)?.laneId === expectation.to;
      const lb = model.shapes.get(expectation.to), sb = model.shapes.get(expectation.id);
      return { ok, inLaneGeom: lb && sb ? inside(centre(sb), lb) : null, hasDi: !!sb };
    }
    case 'name':
      return { ok: node(expectation.id)?.name === expectation.name, hasDi: model.shapes.has(expectation.id) };
    case 'decision': {
      const timer = expectation.timer;
      const ev = timer ? node(timer.event) : undefined;
      const timerOk = !timer || (ev?.type === 'BoundaryEvent' && ev.attachedTo === expectation.task && ev.el.cancelActivity === false && incomingFrom(model, timer.task, timer.event) && node(timer.end)?.type === 'EndEvent' && incomingFrom(model, timer.end, timer.task));
      const ok = incomingFrom(model, expectation.task, expectation.gateway) && outgoingTo(model, expectation.task, expectation.decision) && outgoingTo(model, expectation.decision, expectation.succ) && outgoingTo(model, expectation.decision, expectation.no) && node(expectation.noEnd)?.type === 'EndEvent' && incomingFrom(model, expectation.noEnd, expectation.no) && timerOk;
      const ids = [expectation.task, expectation.decision, expectation.no, expectation.noEnd, ...(timer ? [timer.event, timer.task, timer.end] : [])];
      return { ok: !!ok, hasDi: ids.every((id) => model.shapes.has(id)) };
    }
    default:
      return { ok: false, error: `unknown expectation ${expectation.kind}` };
  }
}

export { readModel };
