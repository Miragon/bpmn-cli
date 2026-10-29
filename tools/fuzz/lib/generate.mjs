/**
 * Random but valid-looking edits for the fuzzer, conditioned on the current
 * model.
 *
 * Contract
 *  - `genStep(a, r, step, { semantic, format })` reads an analyse() result and
 *    returns `{ name, ops }` or undefined (nothing applicable after 20 tries):
 *    `ops` is a batch in the JSON format of `bpmn apply` (src/domain/commands/CommandParser.ts), so the
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
 * (row and column variants), align, color, route, label, space (also closing),
 * tidy, compact, selectors (color --path, align / color --kind, place --branch),
 * order of pools and
 * lanes. Pure; no I/O.
 */

const TASKS = ['task', 'userTask', 'serviceTask', 'scriptTask', 'sendTask', 'manualTask', 'businessRuleTask'];
const WORDS = ['check', 'invoice', 'approve', 'order', 'customer', 'document', 'review', 'contract', 'ship', 'payment', 'archive', 'notify', 'clarify', 'escalate'];
const GATEWAYS = ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway'];

/* ------------------------------------------------------------------ */
/* model facts                                                          */
/* ------------------------------------------------------------------ */

const lowerFirst = (text) => text.replace(/^./, (firstChar) => firstChar.toLowerCase());

/** Flat facts about nodes, flows, lanes and pools of an analyse() result. */
export function info(analysis) {
  const { sem } = analysis;
  const nodes = sem.nodes.map((node) => ({
    id: node.id,
    type: lowerFirst(node.$type.replace('bpmn:', '')),
    scope: sem.scopeOf.get(node.id)?.id,
    incoming: (node.incoming ?? []).map((flow) => flow.id),
    outgoing: (node.outgoing ?? []).map((flow) => flow.id),
    attachedTo: node.attachedToRef?.id,
    lane: sem.laneOf.get(node.id),
    triggered: !!node.triggeredByEvent,
  }));
  const flows = sem.flows.map((flow) => ({ id: flow.id, source: flow.sourceRef?.id, target: flow.targetRef?.id, name: flow.name }));
  const shapeOf = (id) => analysis.planes.map((plane) => plane.shapes.get(id)).find(Boolean);
  return { nodes, flows, lanes: sem.lanes, leafLanes: sem.lanes.filter((lane) => !lane.hasChildren), participants: sem.participants, collab: sem.collab?.id, shapeOf };
}

const isActivity = (node) => /Task$|^task$|subProcess|callActivity|transaction|adHocSubProcess/i.test(node.type);
const isGateway = (node) => /Gateway$/.test(node.type);
const isStart = (node) => node.type === 'startEvent';
const isEnd = (node) => node.type === 'endEvent';
const isBoundary = (node) => node.type === 'boundaryEvent';
const isSub = (node) => /subProcess|transaction|adHocSubProcess/i.test(node.type);

/* ------------------------------------------------------------------ */
/* generators: (ctx) => { name, ops } | undefined                        */
/* ------------------------------------------------------------------ */

function context(analysis, random, step) {
  const inf = info(analysis);
  const nodes = inf.nodes;
  const name = () => {
    const base = `Fz${step} ${random.pick(WORDS)}`;
    return random.chance(0.2) ? `${base} ${random.pick(WORDS)} ${random.pick(WORDS)} ${random.pick(WORDS)} ${random.pick(WORDS)} and ${random.pick(WORDS)} ${random.pick(WORDS)}` : base;
  };
  return {
    r: random, step, inf, N: nodes, name,
    inScope: (scope) => nodes.filter((node) => node.scope === scope),
    appendable: nodes.filter((node) => !isEnd(node) && !(isBoundary(node) && node.outgoing.length > 1) && node.type !== 'eventBasedGateway'),
    drawn: (node) => !!inf.shapeOf(node.id),
  };
}

const one = (name, op) => ({ name, ops: [op] });

function addAfter(ctx) {
  const anchor = ctx.r.pick(ctx.appendable);
  if (!anchor) return undefined;
  const kind = ctx.r.pick([...TASKS, 'exclusiveGateway', 'intermediateThrowEvent', 'callActivity', 'subProcess', 'intermediateCatchEvent:timer']);
  const extra = kind.endsWith(':timer') ? { timer: 'PT5M' } : kind === 'subProcess' ? { collapsed: true } : {};
  if (anchor.outgoing.length > 1 && !isGateway(anchor)) {
    return one('add-flow', { op: 'add', kind, name: ctx.name(), flow: ctx.r.pick(anchor.outgoing), ...extra });
  }
  return one('add-after', { op: 'add', kind, name: ctx.name(), after: anchor.id, ...extra });
}

function addIntoFlow(ctx) {
  const flow = ctx.r.pick(ctx.inf.flows);
  return flow && one('add-flow', { op: 'add', kind: ctx.r.pick(TASKS), name: ctx.name(), flow: flow.id });
}

function addBranch(ctx) {
  const gateway = ctx.r.pick(ctx.N.filter((node) => isGateway(node) && node.type !== 'eventBasedGateway'));
  if (!gateway) return undefined;
  const target = ctx.r.pick(ctx.inScope(gateway.scope).filter((node) => !isStart(node) && !isBoundary(node) && node.id !== gateway.id));
  return target && one('add-branch', { op: 'add', kind: ctx.r.pick(TASKS), name: ctx.name(), after: gateway.id, to: target.id });
}

function addBoundary(ctx) {
  const { r: random, step } = ctx;
  const host = random.pick(ctx.N.filter((node) => isActivity(node) && !node.triggered));
  if (!host) return undefined;
  const id = `Event_Fzb${step}`;
  const trigger = random.pick(['timer', 'error', 'message', 'signal']);
  const add = { op: 'add', kind: `boundaryEvent:${trigger}`, name: `Fzb${step}`, id, on: host.id };
  if (trigger === 'timer') add.timer = 'PT1H';
  if (trigger === 'error') add.error = `Err${step}`;
  if (trigger === 'message') add.message = `Msg${step}`;
  if (trigger === 'signal') add.signal = `Sig${step}`;
  if (trigger !== 'error' && random.chance(0.5)) add.nonInterrupting = true;
  const ops = [add];
  if (random.chance(0.6)) {
    ops.push({ op: 'add', kind: random.pick(['endEvent', 'userTask']), name: `Fzb${step} handling`, id: `Activity_Fzbh${step}`, after: id });
  }
  if (ops[1]?.kind === 'userTask') {
    const target = random.pick(ctx.inScope(host.scope).filter((node) => !isStart(node) && !isBoundary(node) && node.id !== host.id));
    ops.push(target ? { op: 'connect', source: ops[1].id, target: target.id } : { op: 'add', kind: 'endEvent', name: `Fzb${step} done`, after: ops[1].id });
  }
  return { name: 'add-boundary', ops };
}

function connect(ctx) {
  const src = ctx.r.pick(ctx.N.filter((node) => !isEnd(node) && node.type !== 'eventBasedGateway'));
  if (!src) return undefined;
  const existing = new Set(ctx.inf.flows.filter((flow) => flow.source === src.id).map((flow) => flow.target));
  const target = ctx.r.pick(ctx.inScope(src.scope).filter((node) => !isStart(node) && !isBoundary(node) && node.id !== src.id && !existing.has(node.id)));
  return target && one('connect', { op: 'connect', source: src.id, target: target.id });
}

function removeNode(ctx) {
  if (ctx.N.length < 8) return undefined;
  const starts = ctx.N.filter(isStart);
  const removed = ctx.r.pick(ctx.N.filter((node) => !(isStart(node) && starts.filter((start) => start.scope === node.scope).length < 2)));
  return removed && one('remove-node', { op: 'remove', ids: [removed.id] });
}

function removeFlow(ctx) {
  const flow = ctx.r.pick(ctx.inf.flows);
  return flow && one('remove-flow', { op: 'remove', ids: [flow.id] });
}

function move(ctx) {
  const moved = ctx.r.pick(ctx.N.filter((node) => (isActivity(node) || isGateway(node) || /intermediate/.test(node.type)) && !node.triggered));
  if (!moved) return undefined;
  const target = ctx.r.pick(ctx.inScope(moved.scope).filter((node) => node.id !== moved.id && !isEnd(node) && !isBoundary(node) && node.type !== 'eventBasedGateway'));
  if (!target) return undefined;
  if (target.outgoing.length > 1 && !isGateway(target)) {
    return one('move-flow', { op: 'move', ids: [moved.id], flow: ctx.r.pick(target.outgoing) });
  }
  return one('move-after', { op: 'move', ids: [moved.id], after: target.id });
}

function moveLane(ctx) {
  if (ctx.inf.leafLanes.length < 2) return undefined;
  const moved = ctx.r.pick(ctx.N.filter((node) => node.lane && !isBoundary(node)));
  if (!moved) return undefined;
  const proc = ctx.inf.lanes.find((candidate) => candidate.id === moved.lane)?.processId;
  const lane = ctx.r.pick(ctx.inf.leafLanes.filter((candidate) => candidate.processId === proc && candidate.id !== moved.lane));
  return lane && one('move-lane', { op: 'move', ids: [moved.id], lane: lane.id });
}

function retype(ctx) {
  const { r: random } = ctx;
  const element = random.pick(ctx.N);
  if (!element) return undefined;
  if (TASKS.includes(element.type)) {
    return one('retype', { op: 'retype', id: element.id, kind: random.pick([...TASKS.filter((taskType) => taskType !== element.type), 'callActivity', 'subProcess']) });
  }
  if (GATEWAYS.includes(element.type)) {
    return one('retype', { op: 'retype', id: element.id, kind: random.pick(GATEWAYS.filter((gatewayType) => gatewayType !== element.type)) });
  }
  if (isEnd(element)) {
    const kind = random.pick(['endEvent:terminate', 'endEvent:none', 'endEvent:signal']);
    return one('retype', { op: 'retype', id: element.id, kind, ...(kind.endsWith('signal') ? { signal: 'S1' } : {}) });
  }
  if (element.type === 'subProcess' && !element.triggered) {
    return one('retype', { op: 'retype', id: element.id, kind: random.pick(['transaction', 'adHocSubProcess']) });
  }
  return undefined;
}

function rename(ctx) {
  const element = ctx.r.pick([...ctx.N, ...ctx.inf.flows]);
  return element && one('rename', { op: 'set', id: element.id, values: { name: ctx.name() } });
}

/** Splice targets: no gateway, at most one outgoing flow, not a boundary event. */
const spliceable = (ctx) => ctx.appendable.filter((node) => !isGateway(node) && node.outgoing.length <= 1 && !isBoundary(node));

function split(ctx) {
  const { r: random, step } = ctx;
  const anchor = random.pick(spliceable(ctx));
  if (!anchor) return undefined;
  const kind = random.pick(GATEWAYS);
  const branches = [];
  for (let branchIndex = 0, nb = 2 + random.int(2); branchIndex < nb; branchIndex++) {
    const nodes = [];
    for (let nodeIndex = 0, len = 1 + random.int(2); nodeIndex < len; nodeIndex++) {
      nodes.push({ kind: random.pick(TASKS), name: `Fz${step} b${branchIndex} n${nodeIndex}` });
    }
    const br = { nodes };
    if (kind !== 'parallelGateway') br.flowName = `opt ${branchIndex}`;
    if (kind === 'exclusiveGateway' && branchIndex === 0) {
      br.default = true;
    } else if (kind !== 'parallelGateway') {
      br.condition = `\${v == ${branchIndex}}`;
    }
    branches.push(br);
  }
  return one('split', { op: 'split', after: anchor.id, kind, name: `Fz${step} split?`, branches });
}

function addSubProcess(ctx) {
  const { r: random, step } = ctx;
  const anchor = random.pick(spliceable(ctx));
  if (!anchor) return undefined;
  const sub = `Activity_Fzs${step}`;
  const ops = [
    { op: 'add', kind: 'subProcess', name: `Fzs${step} sub`, id: sub, after: anchor.id },
    { op: 'add', kind: 'startEvent', name: `Fzs${step} start`, id: `Event_Fzs${step}s`, in: sub },
    { op: 'add', kind: random.pick(TASKS), name: `Fzs${step} inner`, id: `Activity_Fzs${step}i`, after: `Event_Fzs${step}s` },
  ];
  if (random.chance(0.5)) {
    ops.push({ op: 'add', kind: random.pick(TASKS), name: `Fzs${step} inner2`, id: `Activity_Fzs${step}j`, after: `Activity_Fzs${step}i` });
  }
  ops.push({ op: 'add', kind: 'endEvent', name: `Fzs${step} end`, id: `Event_Fzs${step}e`, after: ops[ops.length - 1].id });
  return { name: 'add-subprocess', ops };
}

function toggleExpanded(ctx) {
  const subProcess = ctx.r.pick(ctx.N.filter((node) => isSub(node) && !node.triggered));
  if (!subProcess) return undefined;
  return one('expand-toggle', { op: 'set', id: subProcess.id, values: { expanded: ctx.inf.shapeOf(subProcess.id)?.expanded ? 'false' : 'true' } });
}

function addLane(ctx) {
  const participant = ctx.r.pick(ctx.inf.participants.filter((candidate) => candidate.processId));
  return participant && one('add-lane', { op: 'add', kind: 'lane', name: `Fz${ctx.step} lane`, in: ctx.r.chance(0.5) ? participant.id : participant.processId });
}

function addData(ctx) {
  const act = ctx.r.pick(ctx.N.filter((node) => isActivity(node) && ctx.drawn(node)));
  if (!act) return undefined;
  const id = `DataObjectReference_Fzd${ctx.step}`;
  const ops = [{ op: 'add', kind: ctx.r.chance(0.3) ? 'dataStore' : 'dataObject', name: `Fzd${ctx.step}`, id, in: act.scope }];
  ops.push(ctx.r.chance(0.5) ? { op: 'connect', source: act.id, target: id } : { op: 'connect', source: id, target: act.id });
  return { name: 'add-data', ops };
}

function addAnnotation(ctx) {
  const annotated = ctx.r.pick(ctx.N.filter(ctx.drawn));
  if (!annotated) return undefined;
  const id = `TextAnnotation_Fzt${ctx.step}`;
  return { name: 'add-annotation', ops: [{ op: 'add', kind: 'textAnnotation', text: `note ${ctx.step} ${ctx.r.pick(WORDS)}`, id, in: annotated.scope }, { op: 'connect', source: id, target: annotated.id }] };
}

function orderFlows(ctx) {
  const branching = ctx.r.pick(ctx.N.filter((node) => node.outgoing.length >= 2));
  return branching && one('order-flows', { op: 'order', id: branching.id, flows: ctx.r.shuffle(branching.outgoing) });
}

/* format ------------------------------------------------------------- */

const placeable = (ctx) => ctx.N.filter((node) => !isBoundary(node) && ctx.drawn(node));
const sameFrame = (ctx, anchor) => placeable(ctx).filter((node) => node.id !== anchor.id && node.scope === anchor.scope && node.lane === anchor.lane);
const PLACE_KEY = { below: 'below', above: 'above', 'row-of': 'rowOf', after: 'after', before: 'before', 'column-of': 'columnOf' };

function place(ctx) {
  const { r: random } = ctx;
  const all = placeable(ctx);
  const placed = random.pick(all);
  if (!placed) return undefined;
  const peers = sameFrame(ctx, placed);
  const reference = random.chance(0.8) ? random.pick(peers) : random.pick(all.filter((node) => node.id !== placed.id));
  if (!reference) return undefined;
  const ids = [placed.id];
  const succ = ctx.inf.flows.filter((flow) => flow.source === placed.id).map((flow) => flow.target).filter((targetId) => targetId !== reference.id && all.some((node) => node.id === targetId));
  if (succ.length && random.chance(0.3)) ids.push(succ[0]);
  const mode = random.pick(['below', 'above', 'row-of', 'after', 'before', 'row-of+after', 'below+column-of']);
  const parts = mode.split('+');
  const op = { op: 'place', ids };
  for (const part of parts) {
    const ref = part === 'after' && parts.length > 1 ? random.pick(peers.filter((node) => node.id !== reference.id)) ?? reference : part === 'column-of' ? random.pick(all.filter((node) => !ids.includes(node.id))) ?? reference : reference;
    op[PLACE_KEY[part]] = ref.id;
  }
  return one(`place-${mode}`, op);
}

function align(ctx) {
  const anchor = ctx.r.pick(placeable(ctx));
  if (!anchor) return undefined;
  const peers = ctx.r.shuffle(sameFrame(ctx, anchor)).slice(0, 1 + ctx.r.int(2));
  return peers.length ? one('align', { op: 'align', ids: [anchor.id, ...peers.map((peer) => peer.id)], axis: ctx.r.pick(['row', 'column']) }) : undefined;
}

function color(ctx) {
  const ids = ctx.r.shuffle([...placeable(ctx).map((node) => node.id), ...ctx.inf.flows.map((flow) => flow.id)]).slice(0, 1 + ctx.r.int(4));
  return ids.length ? one('color', { op: 'color', ids, color: ctx.r.pick(['blue', 'orange', 'green', 'red', 'purple', 'default']) }) : undefined;
}

function route(ctx) {
  const flow = ctx.r.pick(ctx.inf.flows);
  if (!flow) return undefined;
  const op = { op: 'route', id: flow.id };
  if (ctx.r.chance(0.6)) op.exit = ctx.r.pick(['right', 'top', 'bottom', 'left']);
  if (ctx.r.chance(0.6)) {
    op.entry = ctx.r.pick(['left', 'top', 'bottom', 'right']);
  }
  return one('route', op);
}

function label(ctx) {
  const labelled = ctx.r.pick([...ctx.N.filter((node) => (/Event$/.test(node.type) || isGateway(node)) && ctx.drawn(node)), ...ctx.inf.flows.filter((flow) => flow.name)]);
  return labelled && one('label', { op: 'label', id: labelled.id, side: ctx.r.pick(['above', 'below', 'left', 'right']) });
}

function space(ctx) {
  const target = ctx.r.chance(0.8) ? ctx.r.pick(placeable(ctx)) : ctx.r.pick(ctx.inf.leafLanes);
  if (!target) return undefined;
  const dir = ctx.r.chance(0.6) ? 'after' : 'below';
  const op = { op: 'space', [dir]: target.id };
  if (ctx.r.chance(0.4)) {
    op.by = ctx.r.pick(['column', 'row', 20 + ctx.r.int(200)]);
    // closing space (negative amounts)
  } else if (ctx.r.chance(0.3)) {
    op.by = ctx.r.pick(['-column', '-row', -(20 + ctx.r.int(200))]);
  }
  return one(`space-${dir}${typeof op.by === 'string' && op.by.startsWith('-') || op.by < 0 ? '-close' : ''}`, op);
}

function compact(ctx) {
  const frames = [...ctx.inf.participants.filter((participant) => ctx.inf.shapeOf(participant.id)).map((participant) => participant.id), ...ctx.inf.leafLanes.map((lane) => lane.id), ...ctx.N.filter((node) => isSub(node) && ctx.inf.shapeOf(node.id)?.container).map((node) => node.id)];
  if (!frames.length || ctx.r.chance(0.5)) {
    return one('compact', { op: 'compact' });
  }
  return one('compact-ids', { op: 'compact', ids: ctx.r.shuffle(frames).slice(0, 1 + ctx.r.int(2)) });
}

function orderPools(ctx) {
  const { inf } = ctx;
  const drawn = inf.participants.filter((participant) => inf.shapeOf(participant.id));
  return inf.collab && drawn.length >= 2 ? one('order-pools', { op: 'order', id: inf.collab, pools: ctx.r.shuffle(drawn.map((participant) => participant.id)) }) : undefined;
}

/** format ops with selectors: a path, a kind, a branch */
function select(ctx) {
  const { r: random } = ctx;
  const nodes = placeable(ctx);
  const pick = random.int(3);
  if (pick === 0) {
    const [pathStart, pathEnd] = random.shuffle(nodes.filter((node) => !isBoundary(node)));
    return pathStart && pathEnd ? one('color-path', { op: 'color', path: [pathStart.id, pathEnd.id], color: random.pick(['blue', 'green', 'red']) }) : undefined;
  }
  if (pick === 1) {
    const kind = random.pick(['endEvent', 'startEvent', 'exclusiveGateway', 'userTask', 'task']);
    return random.chance(0.5) ? one('align-kind', { op: 'align', kind, axis: random.pick(['row', 'column']) }) : one('color-kind', { op: 'color', kind, color: random.pick(['orange', 'purple', 'default']) });
  }
  const split = random.pick(ctx.N.filter((node) => isGateway(node) && node.outgoing.length >= 2 && ctx.drawn(node)));
  if (!split) return undefined;
  const flow = random.pick(split.outgoing);
  const ref = random.pick(sameFrame(ctx, split)) ?? split;
  return one('place-branch', { op: 'place', branch: flow, [random.pick(['below', 'above'])]: ref.id });
}

function tidy(ctx) {
  if (ctx.r.chance(0.5)) return one('tidy', { op: 'tidy' });
  const ids = ctx.r.shuffle(placeable(ctx).map((node) => node.id)).slice(0, 2 + ctx.r.int(4));
  return ids.length ? one('tidy-ids', { op: 'tidy', ids }) : undefined;
}

function orderLanes(ctx) {
  const { inf } = ctx;
  const participant = ctx.r.pick(inf.participants.filter((candidate) => inf.lanes.filter((lane) => lane.processId === candidate.processId).length >= 2));
  if (!participant) return undefined;
  const isChild = (lane) => inf.lanes.some((otherLane) => otherLane.el.childLaneSet?.lanes?.some((ch) => ch.id === lane.id));
  const top = inf.lanes.filter((lane) => lane.processId === participant.processId && !isChild(lane));
  return top.length >= 2 ? one('order-lanes', { op: 'order', id: participant.id, lanes: ctx.r.shuffle(top.map((lane) => lane.id)) }) : undefined;
}

const SEMANTIC = [
  [10, addAfter], [8, addIntoFlow], [6, addBranch], [5, addBoundary], [5, connect], [6, removeNode], [2, removeFlow],
  [5, move], [5, moveLane], [5, retype], [5, rename], [4, split], [3, addSubProcess], [2, toggleExpanded], [1, addLane],
  [2, addData], [1, addAnnotation], [1, orderFlows],
];
const FORMAT = [[6, place], [3, align], [3, color], [4, route], [3, label], [3, space], [2, tidy], [1, orderLanes], [2, compact], [1, orderPools], [3, select]];

export function genStep(analysis, random, step, { semantic = true, format = true } = {}) {
  const generatorContext = context(analysis, random, step);
  const gens = [...(semantic ? SEMANTIC : []), ...(format ? FORMAT : [])];
  const total = gens.reduce((sum, generator) => sum + generator[0], 0);
  for (let attempt = 0; attempt < 20 && total > 0; attempt++) {
    let remaining = random.next() * total;
    const gen = gens.find(([weight]) => (remaining -= weight) <= 0) ?? gens[gens.length - 1];
    const out = gen[1](generatorContext);
    if (out) return out;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* the equivalent CLI command                                           */
/* ------------------------------------------------------------------ */

const flags = (op, table) => table.flatMap(([key, flag]) => {
  const value = op[key];
  if (value === undefined || value === false) return [];
  return value === true ? [flag] : [flag, String(value)];
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
/** selectors last: --path / --via take every value up to the next flag */
const selectorArgv = (op) => [...(op.path ? ['--path', ...op.path] : []), ...(op.via ? ['--via', ...op.via] : []), ...flags(op, [['kind', '--kind'], ['branch', '--branch']])];

const ARGV = {
  add: (op) => ['add', '%F', op.kind, ...(op.name !== undefined ? [op.name] : []), ...flags(op, ADD_FLAGS)],
  connect: (op) => ['connect', '%F', op.source, op.target, ...flags(op, [['name', '--name'], ['id', '--id'], ['condition', '--condition'], ['default', '--default']])],
  set: (op) => ['set', '%F', op.id, ...Object.entries(op.values).map(([key, value]) => `${key}=${value}`)],
  remove: (op) => ['remove', '%F', ...op.ids, ...(op.bridge === false ? ['--no-bridge'] : [])],
  retype: (op) => ['retype', '%F', op.id, op.kind, ...flags(op, TRIGGER_FLAGS)],
  move: (op) => ['move', '%F', ...op.ids, ...flags(op, MOVE_FLAGS)],
  order: (op) => ['order', '%F', op.id, ...(op.flows ?? op.lanes ?? op.pools)],
  place: (op) => ['place', '%F', ...(op.ids ?? []), ...flags(op, PLACE_FLAGS), ...selectorArgv(op)],
  align: (op) => ['align', '%F', ...(op.ids ?? []), '--axis', op.axis, ...flags(op, [['to', '--to']]), ...selectorArgv(op)],
  color: (op) => ['color', '%F', ...(op.ids ?? []), '--color', op.color, ...selectorArgv(op)],
  compact: (op) => ['compact', '%F', ...(op.ids ?? [])],
  label: (op) => ['label', '%F', op.id, '--side', op.side],
  route: (op) => ['route', '%F', op.id, ...flags(op, [['exit', '--exit'], ['entry', '--entry']])],
  space: (op) => ['space', '%F', ...flags(op, [['after', '--after'], ['below', '--below'], ['by', '--by']])],
  tidy: (op) => ['tidy', '%F', ...(op.ids ?? [])],
};

/** A key=value positional would be misread when a name contains '=' at the start: such ops go through apply. */
const safeName = (op) => op.op !== 'add' || op.name === undefined || !/^[A-Za-z_][\w:.-]*=/.test(op.name);

export function toArgv(ops) {
  if (ops.length !== 1) return undefined;
  const [op] = ops;
  return ARGV[op.op] && safeName(op) ? ARGV[op.op](op) : undefined;
}
