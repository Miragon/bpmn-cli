/**
 * Deterministic graph helpers on a readModel() result.
 *
 * Contract: `longestPath(m)` returns the node ids of the longest start->end path over the top-level process(es)
 * (sequence flows only, loop returns removed by a DFS from the start nodes in declaration order; ties keep the
 * first found). `pickNearMedian(m, path, ok)` returns the candidate passing `ok` that is closest to the
 * middle of `path` (lower index on ties); without one on the path, the median of all passing nodes in declaration
 * order (top-level scopes first), else undefined. Pure; no I/O.
 */
const TASKISH = new Set(['Task', 'UserTask', 'ServiceTask', 'ScriptTask', 'SendTask', 'ReceiveTask', 'ManualTask', 'BusinessRuleTask', 'CallActivity']);
export const isTaskish = (n) => TASKISH.has(n.type);
export const isGateway = (n) => n.type.endsWith('Gateway');

function topScopes(m) {
  return new Set(m.processes.map((p) => p.id));
}

function pathIn(m, scopeId) {
  const nodes = [...m.nodes.values()].filter((n) => n.scope === scopeId && n.type !== 'BoundaryEvent');
  if (!nodes.length) return [];
  const succ = (n) => n.outgoing.map((f) => m.flows.get(f)?.targetId).filter((id) => id && m.nodes.get(id)?.scope === scopeId);
  let starts = nodes.filter((n) => n.type === 'StartEvent' && !n.incoming.length);
  if (!starts.length) starts = nodes.filter((n) => !n.incoming.length);
  if (!starts.length) starts = [nodes[0]];
  // DFS: classify back edges (target on the stack)
  const state = new Map();
  const back = new Set();
  for (const s of starts) {
    if (state.has(s.id)) continue;
    const stack = [[s.id, 0]];
    state.set(s.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const out = succ(m.nodes.get(top[0]));
      if (top[1] >= out.length) { state.set(top[0], 2); stack.pop(); continue; }
      const t = out[top[1]++];
      if (state.get(t) === 1) back.add(`${top[0]}>${t}`);
      else if (!state.has(t)) { state.set(t, 1); stack.push([t, 0]); }
    }
  }
  const reach = [...state.keys()];
  const indeg = new Map(reach.map((id) => [id, 0]));
  const fwd = (id) => succ(m.nodes.get(id)).filter((t) => !back.has(`${id}>${t}`) && indeg.has(t));
  for (const id of reach) for (const t of fwd(id)) indeg.set(t, indeg.get(t) + 1);
  const dist = new Map(reach.map((id) => [id, 0]));
  const pred = new Map();
  const queue = reach.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift();
    for (const t of fwd(id)) {
      if (dist.get(id) + 1 > dist.get(t)) { dist.set(t, dist.get(id) + 1); pred.set(t, id); }
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  const sinks = reach.filter((id) => !fwd(id).length);
  const ends = sinks.filter((id) => m.nodes.get(id).type === 'EndEvent');
  const pool = ends.length ? ends : sinks.length ? sinks : reach;
  let best = pool[0];
  for (const id of pool) if (dist.get(id) > dist.get(best)) best = id;
  const path = [best];
  while (pred.has(path[0])) path.unshift(pred.get(path[0]));
  return path;
}

export function longestPath(m) {
  let best = [];
  for (const scope of topScopes(m)) { const p = pathIn(m, scope); if (p.length > best.length) best = p; }
  return best;
}

export function pickNearMedian(m, path, ok) {
  const mid = (path.length - 1) / 2;
  let pick;
  path.forEach((id, i) => {
    const n = m.nodes.get(id);
    if (!n || !ok(n)) return;
    if (!pick || Math.abs(i - mid) < Math.abs(pick.i - mid)) pick = { id, i };
  });
  if (pick) return { id: pick.id, onPath: true };
  const top = topScopes(m);
  const all = [...m.nodes.values()].filter(ok);
  const ordered = [...all.filter((n) => top.has(n.scope)), ...all.filter((n) => !top.has(n.scope))];
  if (!ordered.length) return undefined;
  const topOnly = ordered.filter((n) => top.has(n.scope));
  const list = topOnly.length ? topOnly : ordered;
  return { id: list[Math.floor((list.length - 1) / 2)].id, onPath: false };
}

export const successorOf = (m, n) => m.flows.get(n.outgoing[0])?.targetId;
export const predecessorOf = (m, n) => m.flows.get(n.incoming[0])?.sourceId;
export const boundariesOf = (m, id) => [...m.nodes.values()].filter((n) => n.attachedTo === id).map((n) => n.id);
