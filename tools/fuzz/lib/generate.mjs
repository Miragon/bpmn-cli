/**
 * Random but valid-looking edits for the fuzzer, conditioned on the current
 * model.
 *
 * Contract
 *  - `genStep(a, r, step, { semantic, format })` reads an analyse() result and
 *    returns `{ name, ops }` or undefined (nothing applicable after 20 tries):
 *    `ops` is a batch in the JSON format of `bpmn apply` (src/batch.ts), so the
 *    same step runs through the CLI, through `apply` or in-process; `name`
 *    is the generator (statistics, minimisation messages). Generators are
 *    picked by weight; every random choice comes from `r`, so the same model,
 *    seed and step number give the same step.
 *  - `toArgv(ops)` -> the equivalent single CLI command (`['add', '%F', ...]`,
 *    `%F` = the file) for a one-op batch that has one, else undefined (run it
 *    with `apply`).
 *  - New element names start with `Fz<step>`, ids created on purpose with
 *    `<Prefix>_Fz<letter><step>`; a later step may reference them, and when a
 *    minimised sequence drops their creator the reference is simply refused.
 * Semantic generators: add after / into a flow / as a branch, boundary event
 * with handler, connect, remove node / flow, move after / into a flow / to a
 * lane, retype, rename, split, sub-process with content, expand / collapse,
 * lane, data object / store, annotation, order flows. Format generators: place
 * (row and column variants), align, color, route, label, space, tidy, order
 * lanes. Pure; no I/O.
 */

const TASKS = ['task', 'userTask', 'serviceTask', 'scriptTask', 'sendTask', 'manualTask', 'businessRuleTask'];
const WORDS = ['check', 'invoice', 'approve', 'order', 'customer', 'document', 'review', 'contract', 'ship', 'payment', 'archive', 'notify', 'clarify', 'escalate'];
const GATEWAYS = ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway'];

/* ------------------------------------------------------------------ */
/* model facts                                                          */
/* ------------------------------------------------------------------ */

const lowerFirst = (s) => s.replace(/^./, (c) => c.toLowerCase());

/** Flat facts about nodes, flows, lanes and pools of an analyse() result. */
export function info(a) {
  const { sem } = a;
  const nodes = sem.nodes.map((n) => ({
    id: n.id,
    type: lowerFirst(n.$type.replace('bpmn:', '')),
    scope: sem.scopeOf.get(n.id)?.id,
    incoming: (n.incoming ?? []).map((f) => f.id),
    outgoing: (n.outgoing ?? []).map((f) => f.id),
    attachedTo: n.attachedToRef?.id,
    lane: sem.laneOf.get(n.id),
    triggered: !!n.triggeredByEvent,
  }));
  const flows = sem.flows.map((f) => ({ id: f.id, source: f.sourceRef?.id, target: f.targetRef?.id, name: f.name }));
  const shapeOf = (id) => a.planes.map((p) => p.shapes.get(id)).find(Boolean);
  return { nodes, flows, lanes: sem.lanes, leafLanes: sem.lanes.filter((l) => !l.hasChildren), participants: sem.participants, shapeOf };
}

const isActivity = (n) => /Task$|^task$|subProcess|callActivity|transaction|adHocSubProcess/i.test(n.type);
const isGateway = (n) => /Gateway$/.test(n.type);
const isStart = (n) => n.type === 'startEvent';
const isEnd = (n) => n.type === 'endEvent';
const isBoundary = (n) => n.type === 'boundaryEvent';
const isSub = (n) => /subProcess|transaction|adHocSubProcess/i.test(n.type);

/* ------------------------------------------------------------------ */
/* generators: (ctx) => { name, ops } | undefined                        */
/* ------------------------------------------------------------------ */

function context(a, r, step) {
  const inf = info(a);
  const N = inf.nodes;
  const name = () => {
    const base = `Fz${step} ${r.pick(WORDS)}`;
    return r.chance(0.2) ? `${base} ${r.pick(WORDS)} ${r.pick(WORDS)} ${r.pick(WORDS)} ${r.pick(WORDS)} and ${r.pick(WORDS)} ${r.pick(WORDS)}` : base;
  };
  return {
    r, step, inf, N, name,
    inScope: (scope) => N.filter((n) => n.scope === scope),
    appendable: N.filter((n) => !isEnd(n) && !(isBoundary(n) && n.outgoing.length > 1) && n.type !== 'eventBasedGateway'),
    drawn: (n) => !!inf.shapeOf(n.id),
  };
}

const one = (name, op) => ({ name, ops: [op] });

function addAfter(c) {
  const x = c.r.pick(c.appendable);
  if (!x) return undefined;
  const kind = c.r.pick([...TASKS, 'exclusiveGateway', 'intermediateThrowEvent', 'callActivity', 'subProcess', 'intermediateCatchEvent:timer']);
  const extra = kind.endsWith(':timer') ? { timer: 'PT5M' } : kind === 'subProcess' ? { collapsed: true } : {};
  if (x.outgoing.length > 1 && !isGateway(x)) return one('add-flow', { op: 'add', kind, name: c.name(), flow: c.r.pick(x.outgoing), ...extra });
  return one('add-after', { op: 'add', kind, name: c.name(), after: x.id, ...extra });
}

function addIntoFlow(c) {
  const f = c.r.pick(c.inf.flows);
  return f && one('add-flow', { op: 'add', kind: c.r.pick(TASKS), name: c.name(), flow: f.id });
}

function addBranch(c) {
  const g = c.r.pick(c.N.filter((n) => isGateway(n) && n.type !== 'eventBasedGateway'));
  if (!g) return undefined;
  const t = c.r.pick(c.inScope(g.scope).filter((n) => !isStart(n) && !isBoundary(n) && n.id !== g.id));
  return t && one('add-branch', { op: 'add', kind: c.r.pick(TASKS), name: c.name(), after: g.id, to: t.id });
}

function addBoundary(c) {
  const { r, step } = c;
  const host = r.pick(c.N.filter((n) => isActivity(n) && !n.triggered));
  if (!host) return undefined;
  const id = `Event_Fzb${step}`;
  const trigger = r.pick(['timer', 'error', 'message', 'signal']);
  const add = { op: 'add', kind: `boundaryEvent:${trigger}`, name: `Fzb${step}`, id, on: host.id };
  if (trigger === 'timer') add.timer = 'PT1H';
  if (trigger === 'error') add.error = `Err${step}`;
  if (trigger === 'message') add.message = `Msg${step}`;
  if (trigger === 'signal') add.signal = `Sig${step}`;
  if (trigger !== 'error' && r.chance(0.5)) add.nonInterrupting = true;
  const ops = [add];
  if (r.chance(0.6)) ops.push({ op: 'add', kind: r.pick(['endEvent', 'userTask']), name: `Fzb${step} handling`, id: `Activity_Fzbh${step}`, after: id });
  if (ops[1]?.kind === 'userTask') {
    const t = r.pick(c.inScope(host.scope).filter((n) => !isStart(n) && !isBoundary(n) && n.id !== host.id));
    ops.push(t ? { op: 'connect', source: ops[1].id, target: t.id } : { op: 'add', kind: 'endEvent', name: `Fzb${step} done`, after: ops[1].id });
  }
  return { name: 'add-boundary', ops };
}

function connect(c) {
  const src = c.r.pick(c.N.filter((n) => !isEnd(n) && n.type !== 'eventBasedGateway'));
  if (!src) return undefined;
  const existing = new Set(c.inf.flows.filter((f) => f.source === src.id).map((f) => f.target));
  const t = c.r.pick(c.inScope(src.scope).filter((n) => !isStart(n) && !isBoundary(n) && n.id !== src.id && !existing.has(n.id)));
  return t && one('connect', { op: 'connect', source: src.id, target: t.id });
}

function removeNode(c) {
  if (c.N.length < 8) return undefined;
  const starts = c.N.filter(isStart);
  const x = c.r.pick(c.N.filter((n) => !(isStart(n) && starts.filter((s) => s.scope === n.scope).length < 2)));
  return x && one('remove-node', { op: 'remove', ids: [x.id] });
}

function removeFlow(c) {
  const f = c.r.pick(c.inf.flows);
  return f && one('remove-flow', { op: 'remove', ids: [f.id] });
}

function move(c) {
  const x = c.r.pick(c.N.filter((n) => (isActivity(n) || isGateway(n) || /intermediate/.test(n.type)) && !n.triggered));
  if (!x) return undefined;
  const y = c.r.pick(c.inScope(x.scope).filter((n) => n.id !== x.id && !isEnd(n) && !isBoundary(n) && n.type !== 'eventBasedGateway'));
  if (!y) return undefined;
  if (y.outgoing.length > 1 && !isGateway(y)) return one('move-flow', { op: 'move', ids: [x.id], flow: c.r.pick(y.outgoing) });
  return one('move-after', { op: 'move', ids: [x.id], after: y.id });
}

function moveLane(c) {
  if (c.inf.leafLanes.length < 2) return undefined;
  const x = c.r.pick(c.N.filter((n) => n.lane && !isBoundary(n)));
  if (!x) return undefined;
  const proc = c.inf.lanes.find((l) => l.id === x.lane)?.processId;
  const lane = c.r.pick(c.inf.leafLanes.filter((l) => l.processId === proc && l.id !== x.lane));
  return lane && one('move-lane', { op: 'move', ids: [x.id], lane: lane.id });
}

function retype(c) {
  const { r } = c;
  const x = r.pick(c.N);
  if (!x) return undefined;
  if (TASKS.includes(x.type)) return one('retype', { op: 'retype', id: x.id, kind: r.pick([...TASKS.filter((t) => t !== x.type), 'callActivity', 'subProcess']) });
  if (GATEWAYS.includes(x.type)) return one('retype', { op: 'retype', id: x.id, kind: r.pick(GATEWAYS.filter((t) => t !== x.type)) });
  if (isEnd(x)) {
    const kind = r.pick(['endEvent:terminate', 'endEvent:none', 'endEvent:signal']);
    return one('retype', { op: 'retype', id: x.id, kind, ...(kind.endsWith('signal') ? { signal: 'S1' } : {}) });
  }
  if (x.type === 'subProcess' && !x.triggered) return one('retype', { op: 'retype', id: x.id, kind: r.pick(['transaction', 'adHocSubProcess']) });
  return undefined;
}

function rename(c) {
  const x = c.r.pick([...c.N, ...c.inf.flows]);
  return x && one('rename', { op: 'set', id: x.id, values: { name: c.name() } });
}

/** Splice targets: no gateway, at most one outgoing flow, not a boundary event. */
const spliceable = (c) => c.appendable.filter((n) => !isGateway(n) && n.outgoing.length <= 1 && !isBoundary(n));

function split(c) {
  const { r, step } = c;
  const x = r.pick(spliceable(c));
  if (!x) return undefined;
  const kind = r.pick(GATEWAYS);
  const branches = [];
  for (let i = 0, nb = 2 + r.int(2); i < nb; i++) {
    const nodes = [];
    for (let j = 0, len = 1 + r.int(2); j < len; j++) nodes.push({ kind: r.pick(TASKS), name: `Fz${step} b${i} n${j}` });
    const br = { nodes };
    if (kind !== 'parallelGateway') br.flowName = `opt ${i}`;
    if (kind === 'exclusiveGateway' && i === 0) br.default = true;
    else if (kind !== 'parallelGateway') br.condition = `\${v == ${i}}`;
    branches.push(br);
  }
  return one('split', { op: 'split', after: x.id, kind, name: `Fz${step} split?`, branches });
}

function addSubProcess(c) {
  const { r, step } = c;
  const x = r.pick(spliceable(c));
  if (!x) return undefined;
  const sub = `Activity_Fzs${step}`;
  const ops = [
    { op: 'add', kind: 'subProcess', name: `Fzs${step} sub`, id: sub, after: x.id },
    { op: 'add', kind: 'startEvent', name: `Fzs${step} start`, id: `Event_Fzs${step}s`, in: sub },
    { op: 'add', kind: r.pick(TASKS), name: `Fzs${step} inner`, id: `Activity_Fzs${step}i`, after: `Event_Fzs${step}s` },
  ];
  if (r.chance(0.5)) ops.push({ op: 'add', kind: r.pick(TASKS), name: `Fzs${step} inner2`, id: `Activity_Fzs${step}j`, after: `Activity_Fzs${step}i` });
  ops.push({ op: 'add', kind: 'endEvent', name: `Fzs${step} end`, id: `Event_Fzs${step}e`, after: ops[ops.length - 1].id });
  return { name: 'add-subprocess', ops };
}

function toggleExpanded(c) {
  const x = c.r.pick(c.N.filter((n) => isSub(n) && !n.triggered));
  if (!x) return undefined;
  return one('expand-toggle', { op: 'set', id: x.id, values: { expanded: c.inf.shapeOf(x.id)?.expanded ? 'false' : 'true' } });
}

function addLane(c) {
  const p = c.r.pick(c.inf.participants.filter((x) => x.processId));
  return p && one('add-lane', { op: 'add', kind: 'lane', name: `Fz${c.step} lane`, in: c.r.chance(0.5) ? p.id : p.processId });
}

function addData(c) {
  const act = c.r.pick(c.N.filter((n) => isActivity(n) && c.drawn(n)));
  if (!act) return undefined;
  const id = `DataObjectReference_Fzd${c.step}`;
  const ops = [{ op: 'add', kind: c.r.chance(0.3) ? 'dataStore' : 'dataObject', name: `Fzd${c.step}`, id, in: act.scope }];
  ops.push(c.r.chance(0.5) ? { op: 'connect', source: act.id, target: id } : { op: 'connect', source: id, target: act.id });
  return { name: 'add-data', ops };
}

function addAnnotation(c) {
  const x = c.r.pick(c.N.filter(c.drawn));
  if (!x) return undefined;
  const id = `TextAnnotation_Fzt${c.step}`;
  return { name: 'add-annotation', ops: [{ op: 'add', kind: 'textAnnotation', text: `note ${c.step} ${c.r.pick(WORDS)}`, id, in: x.scope }, { op: 'connect', source: id, target: x.id }] };
}

function orderFlows(c) {
  const x = c.r.pick(c.N.filter((n) => n.outgoing.length >= 2));
  return x && one('order-flows', { op: 'order', id: x.id, flows: c.r.shuffle(x.outgoing) });
}

/* format ------------------------------------------------------------- */

const placeable = (c) => c.N.filter((n) => !isBoundary(n) && c.drawn(n));
const sameFrame = (c, x) => placeable(c).filter((n) => n.id !== x.id && n.scope === x.scope && n.lane === x.lane);
const PLACE_KEY = { below: 'below', above: 'above', 'row-of': 'rowOf', after: 'after', before: 'before', 'column-of': 'columnOf' };

function place(c) {
  const { r } = c;
  const all = placeable(c);
  const x = r.pick(all);
  if (!x) return undefined;
  const peers = sameFrame(c, x);
  const y = r.chance(0.8) ? r.pick(peers) : r.pick(all.filter((n) => n.id !== x.id));
  if (!y) return undefined;
  const ids = [x.id];
  const succ = c.inf.flows.filter((f) => f.source === x.id).map((f) => f.target).filter((t) => t !== y.id && all.some((n) => n.id === t));
  if (succ.length && r.chance(0.3)) ids.push(succ[0]);
  const mode = r.pick(['below', 'above', 'row-of', 'after', 'before', 'row-of+after', 'below+column-of']);
  const parts = mode.split('+');
  const op = { op: 'place', ids };
  for (const p of parts) {
    const ref = p === 'after' && parts.length > 1 ? r.pick(peers.filter((n) => n.id !== y.id)) ?? y : p === 'column-of' ? r.pick(all.filter((n) => !ids.includes(n.id))) ?? y : y;
    op[PLACE_KEY[p]] = ref.id;
  }
  return one(`place-${mode}`, op);
}

function align(c) {
  const x = c.r.pick(placeable(c));
  if (!x) return undefined;
  const peers = c.r.shuffle(sameFrame(c, x)).slice(0, 1 + c.r.int(2));
  return peers.length ? one('align', { op: 'align', ids: [x.id, ...peers.map((p) => p.id)], axis: c.r.pick(['row', 'column']) }) : undefined;
}

function color(c) {
  const ids = c.r.shuffle([...placeable(c).map((n) => n.id), ...c.inf.flows.map((f) => f.id)]).slice(0, 1 + c.r.int(4));
  return ids.length ? one('color', { op: 'color', ids, color: c.r.pick(['blue', 'orange', 'green', 'red', 'purple', 'default']) }) : undefined;
}

function route(c) {
  const f = c.r.pick(c.inf.flows);
  if (!f) return undefined;
  const op = { op: 'route', id: f.id };
  if (c.r.chance(0.6)) op.exit = c.r.pick(['right', 'top', 'bottom', 'left']);
  if (c.r.chance(0.6)) op.entry = c.r.pick(['left', 'top', 'bottom', 'right']);
  return one('route', op);
}

function label(c) {
  const x = c.r.pick([...c.N.filter((n) => (/Event$/.test(n.type) || isGateway(n)) && c.drawn(n)), ...c.inf.flows.filter((f) => f.name)]);
  return x && one('label', { op: 'label', id: x.id, side: c.r.pick(['above', 'below', 'left', 'right']) });
}

function space(c) {
  const x = c.r.chance(0.8) ? c.r.pick(placeable(c)) : c.r.pick(c.inf.leafLanes);
  if (!x) return undefined;
  const dir = c.r.chance(0.6) ? 'after' : 'below';
  const op = { op: 'space', [dir]: x.id };
  if (c.r.chance(0.4)) op.by = c.r.pick(['column', 'row', 20 + c.r.int(200)]);
  return one(`space-${dir}`, op);
}

function tidy(c) {
  if (c.r.chance(0.5)) return one('tidy', { op: 'tidy' });
  const ids = c.r.shuffle(placeable(c).map((n) => n.id)).slice(0, 2 + c.r.int(4));
  return ids.length ? one('tidy-ids', { op: 'tidy', ids }) : undefined;
}

function orderLanes(c) {
  const { inf } = c;
  const p = c.r.pick(inf.participants.filter((x) => inf.lanes.filter((l) => l.processId === x.processId).length >= 2));
  if (!p) return undefined;
  const isChild = (l) => inf.lanes.some((o) => o.el.childLaneSet?.lanes?.some((ch) => ch.id === l.id));
  const top = inf.lanes.filter((l) => l.processId === p.processId && !isChild(l));
  return top.length >= 2 ? one('order-lanes', { op: 'order', id: p.id, lanes: c.r.shuffle(top.map((l) => l.id)) }) : undefined;
}

const SEMANTIC = [
  [10, addAfter], [8, addIntoFlow], [6, addBranch], [5, addBoundary], [5, connect], [6, removeNode], [2, removeFlow],
  [5, move], [5, moveLane], [5, retype], [5, rename], [4, split], [3, addSubProcess], [2, toggleExpanded], [1, addLane],
  [2, addData], [1, addAnnotation], [1, orderFlows],
];
const FORMAT = [[6, place], [3, align], [3, color], [4, route], [3, label], [3, space], [2, tidy], [1, orderLanes]];

export function genStep(a, r, step, { semantic = true, format = true } = {}) {
  const c = context(a, r, step);
  const gens = [...(semantic ? SEMANTIC : []), ...(format ? FORMAT : [])];
  const total = gens.reduce((s, g) => s + g[0], 0);
  for (let attempt = 0; attempt < 20 && total > 0; attempt++) {
    let x = r.next() * total;
    const gen = gens.find(([w]) => (x -= w) <= 0) ?? gens[gens.length - 1];
    const out = gen[1](c);
    if (out) return out;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* the equivalent CLI command                                           */
/* ------------------------------------------------------------------ */

const flags = (op, table) => table.flatMap(([key, flag]) => {
  const v = op[key];
  if (v === undefined || v === false) return [];
  return v === true ? [flag] : [flag, String(v)];
});

const ADD_FLAGS = [
  ['id', '--id'], ['after', '--after'], ['before', '--before'], ['flow', '--flow'], ['in', '--in'], ['on', '--on'], ['to', '--to'],
  ['lane', '--lane'], ['flowName', '--flow-name'], ['condition', '--condition'], ['default', '--default'], ['collapsed', '--collapsed'],
  ['text', '--text'], ['timer', '--timer'], ['message', '--message'], ['error', '--error'], ['signal', '--signal'],
  ['nonInterrupting', '--non-interrupting'],
];
const MOVE_FLAGS = [['after', '--after'], ['before', '--before'], ['flow', '--flow'], ['in', '--in'], ['on', '--on'], ['lane', '--lane']];
const PLACE_FLAGS = [['rowOf', '--row-of'], ['below', '--below'], ['above', '--above'], ['columnOf', '--column-of'], ['after', '--after'], ['before', '--before']];
const TRIGGER_FLAGS = [['timer', '--timer'], ['message', '--message'], ['error', '--error'], ['signal', '--signal']];

const ARGV = {
  add: (o) => ['add', '%F', o.kind, ...(o.name !== undefined ? [o.name] : []), ...flags(o, ADD_FLAGS)],
  connect: (o) => ['connect', '%F', o.source, o.target, ...flags(o, [['name', '--name'], ['id', '--id'], ['condition', '--condition'], ['default', '--default']])],
  set: (o) => ['set', '%F', o.id, ...Object.entries(o.values).map(([k, v]) => `${k}=${v}`)],
  remove: (o) => ['remove', '%F', ...o.ids, ...(o.bridge === false ? ['--no-bridge'] : [])],
  retype: (o) => ['retype', '%F', o.id, o.kind, ...flags(o, TRIGGER_FLAGS)],
  move: (o) => ['move', '%F', ...o.ids, ...flags(o, MOVE_FLAGS)],
  order: (o) => ['order', '%F', o.id, ...(o.flows ?? o.lanes)],
  place: (o) => ['place', '%F', ...o.ids, ...flags(o, PLACE_FLAGS)],
  align: (o) => ['align', '%F', ...o.ids, '--axis', o.axis, ...flags(o, [['to', '--to']])],
  color: (o) => ['color', '%F', ...o.ids, '--color', o.color],
  label: (o) => ['label', '%F', o.id, '--side', o.side],
  route: (o) => ['route', '%F', o.id, ...flags(o, [['exit', '--exit'], ['entry', '--entry']])],
  space: (o) => ['space', '%F', ...flags(o, [['after', '--after'], ['below', '--below'], ['by', '--by']])],
  tidy: (o) => ['tidy', '%F', ...(o.ids ?? [])],
};

/** A key=value positional would be misread when a name contains '=' at the start: such ops go through apply. */
const safeName = (o) => o.op !== 'add' || o.name === undefined || !/^[A-Za-z_][\w:.-]*=/.test(o.name);

export function toArgv(ops) {
  if (ops.length !== 1) return undefined;
  const [o] = ops;
  return ARGV[o.op] && safeName(o) ? ARGV[o.op](o) : undefined;
}
