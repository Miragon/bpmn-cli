/**
 * Measurement of one result file against its original: stability, layout
 * quality, hard defects, validity and whether the intended semantic edit is
 * present.
 *
 * Contract
 *  - `quality(xml, ctx)` -> { harness, pr, problems } where ctx = { metrics
 *    (lib/metrics.mjs), pr (lib/pr-metrics.mjs or undefined) }:
 *      harness = { counts: {kind: n} over every kind of the metrics library, score }
 *                or { error, counts: null, score: null } when the library throws;
 *      pr      = { score, sums, planes } | { error } | { skipped: true } (no BPMN_EDIT_MAIN);
 *      problems = the library's problem list (kept in memory, not in the records).
 *  - `hardDelta(before, after, ctx, groups)` -> { before, after, added,
 *    addedKinds: {kind: n}, addedGroup, examples } over the hard kinds: added
 *    problems are matched by the library's problem keys; problems that involve
 *    a bpmn:Group (groups count as overlaps) are counted in addedGroup only.
 *  - `stability(before, after, exclude)` over flow nodes with DI in both models
 *    (same id): centre displacement { n, max, median, mean, moved5 } raw and
 *    `norm` after removing the median translation.
 *  - `validity(after)` -> { importWarnings, warningKinds, lossy, flowNodes,
 *    missingDi, emptyEdges (BPMNEdges with < 2 waypoints) }.
 *  - `checkEdit(expect, after)` -> { ok, ...detail } for one generator expectation.
 * Pure apart from parsing; never throws for a readable file.
 */
import { centre, readModel } from './model.mjs';

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const r1 = (x) => Math.round(x * 10) / 10;
const stats = (ds) => ({ n: ds.length, max: r1(ds.length ? Math.max(...ds) : 0), median: r1(median(ds)), mean: r1(ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0), moved5: ds.filter((d) => d > 5).length });
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

export async function quality(xml, ctx) {
  let harness, problems;
  try {
    const m = await ctx.metrics.measure(xml);
    harness = { counts: m.counts, score: m.score };
    problems = m.problems;
  } catch (e) {
    harness = { error: firstLine(e), counts: null, score: null };
  }
  let pr = { skipped: true };
  if (ctx.pr) {
    try { pr = await ctx.pr.score(xml); } catch (e) { pr = { error: firstLine(e) }; }
  }
  return { harness, pr, problems };
}

export function hardDelta(before, after, ctx, groups = new Set()) {
  const hard = ctx.metrics.hard;
  const count = (q) => (q.harness.counts ? hard.reduce((s, k) => s + (q.harness.counts[k] ?? 0), 0) : null);
  if (!before.problems || !after.problems) return { before: count(before), after: count(after), added: null, addedKinds: {}, addedGroup: null, examples: [] };
  const added = ctx.metrics.diff(before.problems, after.problems).added.filter((p) => hard.includes(p.kind));
  const real = added.filter((p) => !p.ids.some((id) => groups.has(id)));
  const addedKinds = {};
  for (const p of real) addedKinds[p.kind] = (addedKinds[p.kind] ?? 0) + 1;
  return { before: count(before), after: count(after), added: real.length, addedKinds, addedGroup: added.length - real.length, examples: real.slice(0, 3).map((p) => `${p.kind}:${p.ids.join(',')}`) };
}

export function stability(before, after, exclude = new Set()) {
  const pairs = [];
  for (const [id] of before.nodes) {
    if (exclude.has(id)) continue;
    const a = before.shapes.get(id), b = after.shapes.get(id);
    if (!a || !b || !after.nodes.has(id)) continue;
    const ca = centre(a), cb = centre(b);
    pairs.push({ dx: cb.x - ca.x, dy: cb.y - ca.y });
  }
  const raw = pairs.map((p) => Math.hypot(p.dx, p.dy));
  const tx = median(pairs.map((p) => p.dx)), ty = median(pairs.map((p) => p.dy));
  const norm = pairs.map((p) => Math.hypot(p.dx - tx, p.dy - ty));
  return { ...stats(raw), norm: { ...stats(norm), tx: r1(tx), ty: r1(ty) } };
}

/** unresolvedRef (a reference to a removed element), unparsable (e.g. a duplicate id), duplicateId, other */
const warningKind = (msg) => (/unresolved reference/i.test(msg) ? 'unresolvedRef' : /unparsable content/i.test(msg) ? 'unparsable' : /duplicate ID/i.test(msg) ? 'duplicateId' : 'other');

export function validity(m) {
  let missing = 0;
  for (const id of m.nodes.keys()) if (!m.shapes.has(id)) missing++;
  let emptyEdges = 0;
  for (const pts of m.edges.values()) if (pts.length < 2) emptyEdges++;
  const warningKinds = {};
  for (const w of m.warnings) { const k = warningKind(w.message); warningKinds[k] = (warningKinds[k] ?? 0) + 1; }
  return { importWarnings: m.warnings.length, warningKinds, lossy: m.lossy, flowNodes: m.nodes.size, missingDi: missing, emptyEdges };
}

const incomingFrom = (m, id, src) => (m.nodes.get(id)?.incoming || []).some((f) => m.flows.get(f)?.sourceId === src);
const outgoingTo = (m, id, tgt) => (m.nodes.get(id)?.outgoing || []).some((f) => m.flows.get(f)?.targetId === tgt);
const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

export function checkEdit(e, m) {
  const n = (id) => m.nodes.get(id);
  switch (e.kind) {
    case 'inserted': {
      const ok = !!n(e.id) && n(e.id).el.$type === e.type && incomingFrom(m, e.id, e.pred) && outgoingTo(m, e.id, e.succ);
      return { ok, hasDi: m.shapes.has(e.id) };
    }
    case 'branch': {
      const ok = !!n(e.task) && incomingFrom(m, e.task, e.gateway) && n(e.end)?.type === 'EndEvent' && incomingFrom(m, e.end, e.task);
      return { ok, hasDi: m.shapes.has(e.task) && m.shapes.has(e.end) };
    }
    case 'removed': {
      const ok = !n(e.id) && outgoingTo(m, e.pred, e.succ);
      return { ok, hasDi: !m.shapes.has(e.id) };
    }
    case 'boundary': {
      const ev = n(e.event);
      const trigger = ev?.el.eventDefinitions?.[0]?.$type?.replace(/^bpmn:/, '');
      const ok = ev?.type === 'BoundaryEvent' && ev.attachedTo === e.host && n(e.end)?.type === 'EndEvent' && incomingFrom(m, e.end, e.event);
      return { ok: !!ok, trigger, hasDi: m.shapes.has(e.event) && m.shapes.has(e.end) };
    }
    case 'lane': {
      const ok = n(e.id)?.laneId === e.to;
      const lb = m.shapes.get(e.to), sb = m.shapes.get(e.id);
      return { ok, inLaneGeom: lb && sb ? inside(centre(sb), lb) : null, hasDi: !!sb };
    }
    case 'name':
      return { ok: n(e.id)?.name === e.name, hasDi: m.shapes.has(e.id) };
    default:
      return { ok: false, error: `unknown expectation ${e.kind}` };
  }
}

export { readModel };
