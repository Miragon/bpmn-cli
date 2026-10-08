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
 *  - every removed element -> cs.remove({id, kind, name}); released ids.
 *  - bridging policy (detachWithBridge, shared with `move`): no bridge when
 *    predecessor and successor are the same non-activity (a self-loop
 *    `connect` would refuse; activities may loop to themselves); a condition
 *    carried onto the predecessor's default flow is dropped instead
 *    (W_CONDITION_DROPPED), a default flow has no condition.
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
import { detachNode, flowChange, removeSequenceFlow } from './flows.js';
import { changeOf, descriptorOf, idOf, isEl, ownValue } from './set.js';
import type { RemoveOp } from './types.js';

/** Removes every element named in `op.ids` (cascading), bridging flows around single nodes. */
export function removeElements(doc: Doc, op: RemoveOp): ChangeSet {
  const cs = new ChangeSet();
  if (!op.ids?.length) throw usageError('remove needs at least one element id');
  const bridge = op.bridge ?? true;
  const gone = new Set<string>();
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
    if (is(el, 'bpmn:FlowNode')) detachWithBridge(doc, el, bridge, cs);
    cascadeRemove(doc, el, cs);
    for (const r of cs.removed) gone.add(r.id);
  }
  doc.invalidate();
  return cs;
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
export function detachWithBridge(doc: Doc, node: El, bridge: boolean, cs: ChangeSet): void {
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
