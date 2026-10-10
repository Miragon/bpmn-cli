/**
 * `remove`: cascade deletion.
 *
 * CONTRACT (implemented in the "mutation" work package):
 *  - flow node: detachNode(bridge) from flows.ts, then remove boundary events
 *    (recursively, with their flows), data associations, associations,
 *    message flows touching it, lane flowNodeRefs, gateway.default refs,
 *    sub-process children (their ids released), the element itself; DI is
 *    left to the layouter (shapes/edges of removed elements are dropped so
 *    the file never carries dangling DI references).
 *  - sequence flow / message flow / association / data association: just that.
 *  - lane: members are un-assigned (laneSet removed when empty).
 *  - participant: participant + its process (unless another participant
 *    still uses it) + message flows; the collaboration is dropped when no
 *    participants remain.
 *  - data object reference: also its bpmn:DataObject when no other reference
 *    uses it (same for the root bpmn:DataStore of a data store reference);
 *    text annotation: its associations.
 *  - op.ifExists: unknown ids are skipped with a note; else E_NOT_FOUND.
 *  - op.withBranch: a flow node or boundary event goes together with its
 *    exclusive downstream path (branchOf): every node it alone leads to
 *    (all incoming flows from the branch; a boundary event with its host;
 *    a compensation handler only its boundary events point to), up to the
 *    next node another path reaches (it stays, the flows into it go) or the
 *    ends. Nothing is bridged; a note names what went and where the branch
 *    stopped. A node that several paths reach (2+ incoming flows) is
 *    refused (E_AMBIGUOUS_BRANCH): its "branch" is not one path.
 *  - op.bridgeAll: a node with several incoming flows and one outgoing
 *    flow (a join or merge) is bridged from every predecessor to the
 *    successor (each incoming flow is re-pointed, keeping its id unless it
 *    named its ends, its label and condition; a predecessor already
 *    connected to the successor, or the successor itself, gets no second
 *    flow); a parallel / inclusive join loses its synchronisation
 *    (W_IMPLICIT_JOIN says so). Several outgoing flows are refused
 *    (E_AMBIGUOUS_BRIDGE: which predecessor to which successor?).
 *  - every removed element -> cs.remove({id, kind, name}); released ids.
 *  - bridging policy (detachWithBridge, shared with `move`): no bridge when
 *    predecessor and successor are the same non-activity (a self-loop
 *    `connect` would refuse; activities may loop to themselves); a condition
 *    carried onto the predecessor's default flow is dropped instead
 *    (W_CONDITION_DROPPED), a default flow has no condition. A bridge from an
 *    event-based gateway to a target the file's rule does not allow fails
 *    with E_INVALID_BRIDGE (eventGatewayTargetProblem in flows.ts), unless
 *    the successor is removed by the same command. Camunda 7 files follow the
 *    engines (only message / timer / signal / conditional catch events, no
 *    other incoming flow, no second branch waiting for the same message or
 *    signal); other files follow BPMN 2.0 (receive tasks allowed, but not
 *    mixed with message catch events).
 *
 * The cascade is reference-driven: after an element (and its containment
 * subtree) is detached, every remaining reference to any of those elements
 * is resolved: connections referencing them are removed in turn, boundary
 * events fall with their host, many-valued references are pruned and
 * single-valued ones cleared (reported as a change).
 */
import type { Doc } from '../document.js';
import { modelError, usageError } from '../errors.js';
import { findReferences, is, many, removeFrom, walk, type El } from '../model.js';
import { ChangeSet } from '../result.js';
import { detachNode, eventGatewayRule, eventGatewayTargetProblem, flowChange, redirectFlow, removeSequenceFlow, renamedNote } from './flows.js';
import { changeOf, descriptorOf, idOf, isEl, ownValue } from './set.js';
import type { RemoveOp } from './types.js';

/** Removes every element named in `op.ids` (cascading), bridging flows around single nodes. */
export function removeElements(doc: Doc, op: RemoveOp): ChangeSet {
  const cs = new ChangeSet();
  if (!op.ids?.length) throw usageError('remove needs at least one element id');
  const bridge = op.bridge ?? true;
  const removing = new Set(op.ids);
  const gone = new Set<string>();
  if (op.withBranch && (op.bridgeAll || op.bridge === false)) {
    throw usageError(`--with-branch removes the node's whole downstream path and bridges nothing: drop ${op.bridgeAll ? '--bridge-all' : '--no-bridge'}`);
  }
  if (op.bridgeAll && op.bridge === false) throw usageError('--bridge-all and --no-bridge contradict each other');
  if (op.withBranch) {
    for (const id of op.ids) {
      if (gone.has(id)) continue;
      if (!doc.get(id) && op.ifExists) {
        cs.note(`${id} does not exist; skipped`);
        continue;
      }
      const branch = branchOf(doc, doc.require(id, ['bpmn:FlowNode'], 'flow node'));
      for (const el of branch.nodes) removing.add(idOf(el));
      cs.note(
        `branch of ${id}: ${branch.nodes.length} node(s) (${branch.nodes.map(idOf).join(', ')})${branch.stops.length ? `; it stops before ${branch.stops.map(idOf).join(', ')}, which other paths reach (they stay)` : '; it ends there'}`,
      );
      for (const el of branch.nodes) {
        if (gone.has(idOf(el))) continue;
        detachNode(doc, el, false, cs);
        cascadeRemove(doc, el, cs);
        for (const r of cs.removed) gone.add(r.id);
      }
    }
    doc.invalidate();
    return cs;
  }
  for (const id of op.ids) {
    if (gone.has(id)) {
      cs.note(`${id} was already removed together with an earlier element`);
      continue;
    }
    const el = doc.get(id);
    if (!el) {
      if (op.ifExists) {
        cs.note(`${id} does not exist; skipped`);
        continue;
      }
      doc.require(id);
      continue;
    }
    if (is(el, 'bpmn:Definitions')) {
      throw modelError('E_INVALID_REMOVE', 'The definitions element cannot be removed', { element: id, hint: 'Delete the file instead.' });
    }
    if (is(el, 'bpmn:FlowNode')) {
      if (op.bridgeAll) bridgeAll(doc, el, cs, removing);
      else detachWithBridge(doc, el, bridge, cs, removing);
    }
    cascadeRemove(doc, el, cs);
    for (const r of cs.removed) gone.add(r.id);
  }
  doc.invalidate();
  return cs;
}

/**
 * The exclusive downstream path of a flow node or boundary event (see the
 * module contract): `nodes` in document order (the root first), `stops` the
 * nodes outside it that it flows into.
 */
export function branchOf(doc: Doc, root: El): { nodes: El[]; stops: El[] } {
  const incoming = doc.incoming(root);
  if (incoming.length > 1) {
    throw modelError('E_AMBIGUOUS_BRANCH', `${idOf(root)} is reached by ${incoming.length} paths (${incoming.map((f) => idOf(f.get<El>('sourceRef'))).join(', ')}); its downstream is not the branch of one path`, {
      element: idOf(root),
      candidates: incoming.map((f) => idOf(f)),
      hint: `Remove the branch from a node only one path reaches (the first node after the split), or remove ${idOf(root)} alone (\`bpmn remove <file> ${idOf(root)} --bridge-all\` reconnects the paths to its successor).`,
    });
  }
  const inBranch = new Set<El>([root]);
  /** what an element of the branch leads to: its targets, the boundary events on it, compensation handlers of a boundary event */
  const next = (n: El): El[] => [
    ...doc.outgoing(n).map((f) => f.get<El>('targetRef')),
    ...(is(n, 'bpmn:Activity') ? doc.boundaryEventsOf(n) : []),
    ...compensationHandlers(doc, n),
  ];
  /** who else leads to it */
  const before = (n: El): El[] => {
    if (is(n, 'bpmn:BoundaryEvent')) return [n.get<El>('attachedToRef')];
    const preds = doc.incoming(n).map((f) => f.get<El>('sourceRef'));
    if (n.get<boolean | undefined>('isForCompensation')) preds.push(...compensationSources(doc, n));
    return preds;
  };
  const stops = new Set<El>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of [...inBranch]) {
      for (const s of next(n)) {
        if (inBranch.has(s)) continue;
        if (before(s).every((p) => inBranch.has(p))) {
          inBranch.add(s);
          stops.delete(s);
          grew = true;
        } else stops.add(s);
      }
    }
  }
  const order = new Map([...doc.byId().values()].map((el, i) => [el, i]));
  const sorted = [...inBranch].sort((a, b) => (a === root ? -1 : b === root ? 1 : (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  return { nodes: sorted, stops: [...stops].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)) };
}

/** Compensation handlers a compensate boundary event points to (bpmn:Association). */
function compensationHandlers(doc: Doc, n: El): El[] {
  if (!is(n, 'bpmn:BoundaryEvent')) return [];
  return [...doc.byId().values()].filter((a) => is(a, 'bpmn:Association') && a.get<El | undefined>('sourceRef') === n).map((a) => a.get<El>('targetRef')).filter((t) => !!t && !!t.get<boolean | undefined>('isForCompensation'));
}

/** The boundary events whose compensation associations point to a handler. */
function compensationSources(doc: Doc, handler: El): El[] {
  return [...doc.byId().values()].filter((a) => is(a, 'bpmn:Association') && a.get<El | undefined>('targetRef') === handler).map((a) => a.get<El>('sourceRef')).filter((s): s is El => !!s && is(s, 'bpmn:BoundaryEvent'));
}

/**
 * --bridge-all (see the module contract): every predecessor of a join gets
 * the join's successor. One incoming flow is the ordinary bridge.
 */
function bridgeAll(doc: Doc, node: El, cs: ChangeSet, removing: ReadonlySet<string>): void {
  const incoming = doc.incoming(node);
  const outgoing = doc.outgoing(node);
  if (outgoing.length > 1) {
    throw modelError('E_AMBIGUOUS_BRIDGE', `${idOf(node)} has ${outgoing.length} outgoing flows (${outgoing.map(idOf).join(', ')}): --bridge-all connects the predecessors of a join to its one successor, and here it is not clear which predecessor goes to which successor`, {
      element: idOf(node),
      candidates: outgoing.map(idOf),
      hint: `Remove the branches you do not need first (\`bpmn remove <file> <firstNodeOfBranch> --with-branch\`), or remove ${idOf(node)} without bridging (\`--no-bridge\`) and connect what should stay with \`bpmn connect\`.`,
    });
  }
  if (incoming.length <= 1 || !outgoing.length) {
    detachWithBridge(doc, node, true, cs, removing);
    return;
  }
  const outFlow = outgoing[0]!;
  const successor = outFlow.get<El>('targetRef');
  for (const inFlow of incoming) assertBridgeAllowed(doc, node, inFlow, outFlow, removing);
  const outName = outFlow.get<string | undefined>('name');
  if (outName) cs.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${idOf(outFlow)} was dropped while bridging ${idOf(node)} from ${incoming.length} predecessors`, element: idOf(outFlow) });
  if (outFlow.get<El | undefined>('conditionExpression')) cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(outFlow)} was dropped while bridging ${idOf(node)} from ${incoming.length} predecessors`, element: idOf(outFlow) });
  removeSequenceFlow(doc, outFlow, cs);
  cs.remove(flowChange(outFlow));
  const bridged: string[] = [];
  for (const inFlow of incoming) {
    const predecessor = inFlow.get<El>('sourceRef');
    const already = doc.outgoing(predecessor).some((f) => f !== inFlow && f.get<El | undefined>('targetRef') === successor);
    if (predecessor === successor || predecessor === node || already) {
      removeSequenceFlow(doc, inFlow, cs);
      cs.remove(flowChange(inFlow));
      cs.note(`not bridged: ${idOf(predecessor)} ${predecessor === successor ? 'is the successor itself' : predecessor === node ? 'is the removed node' : `already flows to ${idOf(successor)}`}`);
      continue;
    }
    const renamed = redirectFlow(doc, inFlow, { target: successor });
    cs.change({ ...flowChange(inFlow), detail: `${idOf(predecessor)} -> ${idOf(successor)} (bridged ${idOf(node)})${renamedNote(renamed)}` });
    bridged.push(idOf(predecessor));
  }
  cs.note(`bridged all: ${bridged.join(', ')} -> ${idOf(successor)}`);
  const sync = is(node, 'bpmn:ParallelGateway') || is(node, 'bpmn:InclusiveGateway') || is(node, 'bpmn:ComplexGateway');
  if (sync) cs.note(`${idOf(node)} synchronised ${bridged.join(', ')}; now each of them runs on to ${idOf(successor)} on its own`);
  const count = doc.incoming(successor).length;
  if (count > 1 && (sync || !is(successor, 'bpmn:Gateway'))) {
    cs.warn({
      code: 'W_IMPLICIT_JOIN',
      message: sync
        ? `${idOf(successor)} now has ${count} incoming flows: the ${is(node, 'bpmn:ParallelGateway') ? 'parallel' : 'inclusive'} join ${idOf(node)} synchronised them, now each path runs on to ${idOf(successor)} on its own`
        : `${idOf(successor)} now has ${count} incoming flows (implicit join)`,
      element: idOf(successor),
      hint: sync ? `Keep a ${is(node, 'bpmn:ParallelGateway') ? 'parallel' : 'inclusive'} join in front of ${idOf(successor)} if the paths must wait for each other.` : 'Consider joining through a gateway.',
    });
  }
}

/** The self-loop rule of `connect`: only activities may loop back to themselves with a sequence flow. */
export function canLoopToItself(node: El): boolean {
  return is(node, 'bpmn:Activity');
}

/**
 * detachNode() with the bridging policy of the module contract: a bridge that
 * would create a self-loop `connect` refuses (non-activities) is skipped (both
 * flows removed, noted), and a condition that bridging carried onto the
 * predecessor's default flow is dropped again with W_CONDITION_DROPPED (a
 * default flow has no condition).
 */
export function detachWithBridge(doc: Doc, node: El, bridge: boolean, cs: ChangeSet, removing?: ReadonlySet<string>, command: BridgeCommand = 'remove'): void {
  const incoming = doc.incoming(node);
  const outgoing = doc.outgoing(node);
  if (!bridge || incoming.length !== 1 || outgoing.length !== 1) {
    detachNode(doc, node, bridge, cs);
    return;
  }
  const inFlow = incoming[0]!;
  const outFlow = outgoing[0]!;
  const predecessor = inFlow.get<El>('sourceRef');
  const successor = outFlow.get<El>('targetRef');
  if (predecessor === successor && !canLoopToItself(predecessor)) {
    detachNode(doc, node, false, cs);
    if (predecessor !== node) cs.note(`not bridged: ${idOf(predecessor)} is both predecessor and successor of ${idOf(node)} and cannot loop back to itself`);
    return;
  }
  assertBridgeAllowed(doc, node, inFlow, outFlow, removing, command);
  const outCond = outFlow.get<El | undefined>('conditionExpression');
  const inFlowIsDefault = predecessor.get<El | undefined>('default') === inFlow;
  const inHadCondition = !!inFlow.get<El | undefined>('conditionExpression');
  detachNode(doc, node, true, cs);
  if (outCond && inFlowIsDefault && !inHadCondition && inFlow.get<El | undefined>('conditionExpression') === outCond && predecessor.get<El | undefined>('default') === inFlow) {
    inFlow.set('conditionExpression', undefined);
    cs.warn({
      code: 'W_CONDITION_DROPPED',
      message: `Condition of ${idOf(outFlow)} was dropped while bridging ${idOf(node)}: ${idOf(inFlow)} is the default flow of ${idOf(predecessor)}`,
      element: idOf(outFlow),
      related: [idOf(inFlow)],
      hint: `A default flow has no condition; use \`bpmn set ${idOf(inFlow)} condition=...\` if the condition should replace the default marker.`,
    });
  }
}

/** The command that detaches (its hint differs: `move` has no --no-bridge). */
export type BridgeCommand = 'remove' | 'move';

/**
 * Refuses a bridge that would give an event-based gateway a target the
 * engines reject (eventGatewayTargetProblem): E_INVALID_BRIDGE. A successor
 * that the same command removes as well is not checked (its own removal
 * decides). `via` names what is bridged (the node, or a moved group).
 */
export function assertBridgeAllowed(doc: Doc, node: El, inFlow: El, outFlow: El, removing?: ReadonlySet<string>, command: BridgeCommand = 'remove', via: string = idOf(node)): void {
  const predecessor = inFlow.get<El>('sourceRef');
  const successor = outFlow.get<El>('targetRef');
  if (!is(predecessor, 'bpmn:EventBasedGateway') || successor === node) return;
  if (removing?.has(idOf(successor))) return;
  const problem = eventGatewayTargetProblem(doc, predecessor, successor, [outFlow, inFlow]);
  if (!problem) return;
  const catchFirst = `put an intermediate catch event (message / timer / signal / conditional) in front of ${idOf(successor)} first (\`bpmn add <file> intermediateCatchEvent:timer "<name>" --flow ${idOf(outFlow)} --timer PT1H\`)`;
  const rejectedBy = eventGatewayRule(doc) === 'engines' ? 'which the engines reject' : 'which BPMN 2.0 does not allow';
  throw modelError('E_INVALID_BRIDGE', `${command === 'move' ? 'Moving' : 'Bridging'} ${via} would connect the event-based gateway ${idOf(predecessor)} to ${idOf(successor)}, ${rejectedBy}: ${problem}`, {
    element: idOf(node),
    related: [idOf(predecessor), idOf(successor)],
    hint:
      command === 'move'
        ? `A move always bridges its old place: ${catchFirst}, or take ${via} out without a bridge (\`bpmn remove <file> ${via.split(', ').join(' ')} --no-bridge\`) and add it again at the new place.`
        : `Remove without bridging (\`bpmn remove <file> ${idOf(node)} --no-bridge\`; the gateway loses that branch) and wire the gateway yourself, or ${catchFirst}, or remove ${idOf(successor)} in the same command.`,
  });
}

/* ------------------------------------------------------------------ */
/* containment helpers                                                  */
/* ------------------------------------------------------------------ */

/** True when `parent` contains `child` in one of its containment properties. */
function contains(parent: El, child: El): boolean {
  const d = descriptorOf(parent);
  if (d.isGeneric) {
    const kids = (parent as unknown as { $children?: unknown[] }).$children;
    return Array.isArray(kids) && kids.includes(child);
  }
  for (const p of d.properties ?? []) {
    if (p.isReference) continue;
    const v = ownValue(parent, p.name);
    if (Array.isArray(v) ? v.includes(child) : v === child) return true;
  }
  return false;
}

/** True when the element is still reachable from the definitions through containment. */
export function isAttached(doc: Doc, el: El): boolean {
  let cur: El = el;
  while (cur !== doc.definitions) {
    const parent = cur.$parent as El | undefined;
    if (!parent || !contains(parent, cur)) return false;
    cur = parent;
  }
  return true;
}

/** Detaches an element from whichever containment property of its parent holds it. */
function detachFromParent(el: El): El | undefined {
  const parent = el.$parent as El | undefined;
  if (!parent) return undefined;
  for (const p of descriptorOf(parent).properties ?? []) {
    if (p.isReference) continue;
    const v = ownValue(parent, p.name);
    if (Array.isArray(v)) {
      const i = v.indexOf(el);
      if (i !== -1) {
        v.splice(i, 1);
        return parent;
      }
    } else if (v === el) {
      parent.set(p.name, undefined);
      return parent;
    }
  }
  return parent;
}

/** All references from the (remaining) tree to any element of `targets`. */
function referencesToAny(root: El, targets: Set<El>): Array<{ holder: El; prop: string; isMany: boolean; target: El }> {
  const refs: Array<{ holder: El; prop: string; isMany: boolean; target: El }> = [];
  for (const el of walk(root)) {
    const d = descriptorOf(el);
    if (d.isGeneric) continue;
    for (const p of d.properties ?? []) {
      if (!p.isReference) continue;
      const v = ownValue(el, p.name);
      if (p.isMany) {
        if (Array.isArray(v)) for (const t of v) if (isEl(t) && targets.has(t)) refs.push({ holder: el, prop: p.name, isMany: true, target: t });
      } else if (isEl(v) && targets.has(v)) {
        refs.push({ holder: el, prop: p.name, isMany: false, target: v });
      }
    }
  }
  return refs;
}

function nearestWithId(el: El): El | undefined {
  let cur: El | undefined = el;
  while (cur && !cur.get<string | undefined>('id')) cur = cur.$parent as El | undefined;
  return cur;
}

function reportable(el: El): boolean {
  return (
    !!el.get<string | undefined>('id') &&
    (is(el, 'bpmn:FlowElement') ||
      is(el, 'bpmn:Artifact') ||
      is(el, 'bpmn:Lane') ||
      is(el, 'bpmn:Participant') ||
      is(el, 'bpmn:RootElement') ||
      is(el, 'bpmn:DataAssociation'))
  );
}

function removedEntry(el: El) {
  return is(el, 'bpmn:SequenceFlow') ? flowChange(el) : changeOf(el);
}

/* ------------------------------------------------------------------ */
/* cascade                                                              */
/* ------------------------------------------------------------------ */

/** Cascade-removes one element (no bridging). Used by retype/move internally. */
export function cascadeRemove(doc: Doc, el: El, cs: ChangeSet): void {
  if (!isAttached(doc, el)) return;
  if (is(el, 'bpmn:SequenceFlow')) {
    removeSequenceFlow(doc, el);
    cs.remove(flowChange(el));
    cleanupReferences(doc, new Set([el]), cs);
    return;
  }
  if (is(el, 'bpmn:Participant')) {
    removeParticipant(doc, el, cs);
    return;
  }
  // vendor extension content is not part of the id space: its ids are never released
  const subtree = [...walk(el, { bpmnOnly: true })];
  const removed = new Set(subtree);
  const parent = detachFromParent(el);
  for (const e of subtree) {
    const id = e.get<string | undefined>('id');
    if (id) doc.ids.release(id);
  }
  if (reportable(el) || el.get<string | undefined>('id')) cs.remove(removedEntry(el));
  for (const e of subtree) if (e !== el && reportable(e)) cs.remove(removedEntry(e));
  doc.invalidate();
  afterDetach(doc, el, parent, cs);
  cleanupReferences(doc, removed, cs);
  doc.invalidate();
}

/** Type-specific follow-ups once an element left the tree. */
function afterDetach(doc: Doc, el: El, parent: El | undefined, cs: ChangeSet): void {
  if (is(el, 'bpmn:Lane') && parent && is(parent, 'bpmn:LaneSet')) {
    if (!many(parent, 'lanes').length) {
      const owner = parent.$parent as El | undefined;
      if (owner && is(owner, 'bpmn:Lane')) owner.set('childLaneSet', undefined);
      else if (owner) removeFrom(owner, 'laneSets', parent);
      const lsId = parent.get<string | undefined>('id');
      if (lsId) doc.ids.release(lsId);
      cs.note(`lane set${lsId ? ` ${lsId}` : ''} removed: no lanes left`);
    }
    return;
  }
  if (is(el, 'bpmn:DataInputAssociation') && parent) {
    const target = el.get<El | undefined>('targetRef');
    if (target && is(target, 'bpmn:Property') && target.$parent === parent && !findReferences(doc.definitions, target).length) {
      removeFrom(parent, 'properties', target);
      const pid = target.get<string | undefined>('id');
      if (pid) doc.ids.release(pid);
    }
    return;
  }
  if (is(el, 'bpmn:DataObjectReference')) {
    const backing = el.get<El | undefined>('dataObjectRef');
    if (backing && isAttached(doc, backing) && !findReferences(doc.definitions, backing).length) cascadeRemove(doc, backing, cs);
    return;
  }
  if (is(el, 'bpmn:DataStoreReference')) {
    const backing = el.get<El | undefined>('dataStoreRef');
    if (backing && isAttached(doc, backing) && !findReferences(doc.definitions, backing).length) cascadeRemove(doc, backing, cs);
    return;
  }
  if (is(el, 'bpmn:Process')) {
    const pid = idOf(el);
    for (const e of walk(doc.definitions)) {
      if (is(e, 'bpmn:CallActivity') && e.get<string | undefined>('calledElement') === pid) {
        cs.warn({
          code: 'W_DANGLING_CALLED_ELEMENT',
          message: `${idOf(e)} still calls the removed process ${pid}`,
          element: idOf(e),
          related: [pid],
          hint: `Set another process with \`bpmn set ${idOf(e)} calledElement=<processId>\` or remove the call activity.`,
        });
      }
    }
  }
}

function removeParticipant(doc: Doc, participant: El, cs: ChangeSet): void {
  const collaboration = participant.$parent as El | undefined;
  const process = participant.get<El | undefined>('processRef');
  detachFromParent(participant);
  doc.ids.release(idOf(participant));
  cs.remove(changeOf(participant));
  doc.invalidate();
  cleanupReferences(doc, new Set([participant]), cs);
  if (process && isAttached(doc, process) && !doc.participants().some((p) => p.get<El | undefined>('processRef') === process)) {
    cascadeRemove(doc, process, cs);
  }
  if (collaboration && is(collaboration, 'bpmn:Collaboration') && isAttached(doc, collaboration) && !many(collaboration, 'participants').length) {
    cascadeRemove(doc, collaboration, cs);
    cs.note(`collaboration ${idOf(collaboration)} removed: no participants left`);
  }
}

/** Resolves every reference from the remaining tree to a removed element. */
function cleanupReferences(doc: Doc, removed: Set<El>, cs: ChangeSet): void {
  for (const { holder, prop, isMany, target } of referencesToAny(doc.definitions, removed)) {
    if (!isAttached(doc, holder)) continue;
    const targetId = idOf(target);
    if (holder.$type.startsWith('bpmndi:')) {
      detachFromParent(is(holder, 'bpmndi:BPMNPlane') ? (holder.$parent as El) : holder);
      continue;
    }
    if (is(holder, 'bpmn:SequenceFlow') || is(holder, 'bpmn:MessageFlow') || is(holder, 'bpmn:Association') || is(holder, 'bpmn:DataAssociation')) {
      cascadeRemove(doc, holder, cs);
      continue;
    }
    if (is(holder, 'bpmn:BoundaryEvent') && prop === 'attachedToRef') {
      cascadeRemove(doc, holder, cs);
      continue;
    }
    if (is(holder, 'bpmn:Participant') && prop === 'processRef') {
      holder.set(prop, undefined);
      cs.warn({
        code: 'W_BLACK_BOX',
        message: `Participant ${idOf(holder)} lost its process ${targetId} and is now a black box`,
        element: idOf(holder),
        related: [targetId],
        hint: 'Remove the participant too, or add a new process for it.',
      });
      continue;
    }
    if (isMany) {
      removeFrom(holder, prop, target);
      if (is(holder, 'bpmn:Lane')) cs.change(changeOf(holder, `member ${targetId} removed`));
      continue;
    }
    holder.set(prop, undefined);
    const owner = nearestWithId(holder);
    if (owner && prop !== 'default') cs.change(changeOf(owner, `${prop} cleared (${targetId} removed)`));
  }
  doc.invalidate();
}
