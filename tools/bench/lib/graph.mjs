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
export const isTaskish = (node) => TASKISH.has(node.type);
export const isGateway = (node) => node.type.endsWith('Gateway');

function topScopes(model) {
  return new Set(model.processes.map((topProcess) => topProcess.id));
}

function pathIn(model, scopeId) {
  const nodes = [...model.nodes.values()].filter((node) => node.scope === scopeId && node.type !== 'BoundaryEvent');
  if (!nodes.length) return [];
  const succ = (node) => node.outgoing.map((flowId) => model.flows.get(flowId)?.targetId).filter((id) => id && model.nodes.get(id)?.scope === scopeId);
  let starts = nodes.filter((node) => node.type === 'StartEvent' && !node.incoming.length);
  if (!starts.length) starts = nodes.filter((node) => !node.incoming.length);
  if (!starts.length) starts = [nodes[0]];
  // DFS: classify back edges (target on the stack)
  const state = new Map();
  const back = new Set();
  for (const start of starts) {
    if (state.has(start.id)) continue;
    const stack = [[start.id, 0]];
    state.set(start.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const out = succ(model.nodes.get(top[0]));
      if (top[1] >= out.length) { state.set(top[0], 2); stack.pop(); continue; }
      const successorId = out[top[1]++];
      if (state.get(successorId) === 1) back.add(`${top[0]}>${successorId}`);
      else if (!state.has(successorId)) { state.set(successorId, 1); stack.push([successorId, 0]); }
    }
  }
  const reach = [...state.keys()];
  const indeg = new Map(reach.map((id) => [id, 0]));
  const fwd = (id) => succ(model.nodes.get(id)).filter((targetId) => !back.has(`${id}>${targetId}`) && indeg.has(targetId));
  for (const id of reach) for (const targetId of fwd(id)) indeg.set(targetId, indeg.get(targetId) + 1);
  const dist = new Map(reach.map((id) => [id, 0]));
  const pred = new Map();
  const queue = reach.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift();
    for (const targetId of fwd(id)) {
      if (dist.get(id) + 1 > dist.get(targetId)) { dist.set(targetId, dist.get(id) + 1); pred.set(targetId, id); }
      indeg.set(targetId, indeg.get(targetId) - 1);
      if (indeg.get(targetId) === 0) queue.push(targetId);
    }
  }
  const sinks = reach.filter((id) => !fwd(id).length);
  const ends = sinks.filter((id) => model.nodes.get(id).type === 'EndEvent');
  const pool = ends.length ? ends : sinks.length ? sinks : reach;
  let best = pool[0];
  for (const id of pool) if (dist.get(id) > dist.get(best)) best = id;
  const path = [best];
  while (pred.has(path[0])) path.unshift(pred.get(path[0]));
  return path;
}

export function longestPath(model) {
  let best = [];
  for (const scope of topScopes(model)) { const scopePath = pathIn(model, scope); if (scopePath.length > best.length) best = scopePath; }
  return best;
}

export function pickNearMedian(model, path, ok) {
  const mid = (path.length - 1) / 2;
  let pick;
  path.forEach((id, pathIndex) => {
    const node = model.nodes.get(id);
    if (!node || !ok(node)) return;
    if (!pick || Math.abs(pathIndex - mid) < Math.abs(pick.i - mid)) pick = { id, i: pathIndex };
  });
  if (pick) return { id: pick.id, onPath: true };
  const top = topScopes(model);
  const all = [...model.nodes.values()].filter(ok);
  const ordered = [...all.filter((node) => top.has(node.scope)), ...all.filter((node) => !top.has(node.scope))];
  if (!ordered.length) return undefined;
  const topOnly = ordered.filter((node) => top.has(node.scope));
  const list = topOnly.length ? topOnly : ordered;
  return { id: list[Math.floor((list.length - 1) / 2)].id, onPath: false };
}

export const successorOf = (model, node) => model.flows.get(node.outgoing[0])?.targetId;
export const predecessorOf = (model, node) => model.flows.get(node.incoming[0])?.sourceId;
export const boundariesOf = (model, id) => [...model.nodes.values()].filter((node) => node.attachedTo === id).map((node) => node.id);
