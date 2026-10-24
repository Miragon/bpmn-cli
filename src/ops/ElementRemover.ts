/**
 * `remove`: cascade deletion.
 *
 * CONTRACT (implemented in the "mutation" work package):
 *  - flow node: bridged (ops/Bridge.ts), then remove boundary events
 *    (recursively, with their flows), data associations, associations,
 *    message flows touching it, lane flowNodeRefs, gateway.default refs,
 *    sub-process children (their ids released), the element itself; DI is
 *    left to the layouter (shapes/edges of removed elements are dropped so
 *    the file never carries dangling DI references; their ids released).
 *  - sequence flow / message flow / association / data association: just that.
 *  - lane: members are un-assigned (laneSet removed when empty).
 *  - participant: participant + its process (unless another participant
 *    still uses it) + message flows; the collaboration is dropped when no
 *    participants remain.
 *  - data object reference: also its bpmn:DataObject when no other reference
 *    uses it (same for the root bpmn:DataStore of a data store reference);
 *    text annotation: its associations; group: its category value when no
 *    other group references it (the members' references to it go too),
 *    then its category when no value is left.
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
 *    flow); a parallel / inclusive / complex join loses its synchronisation
 *    (W_IMPLICIT_JOIN says so). Several outgoing flows are refused
 *    (E_AMBIGUOUS_BRIDGE: which predecessor to which successor?).
 *  - a plain remove (bridging on) of such a node (several incoming flows,
 *    one outgoing; audit #53): a merge that does not synchronise (an
 *    exclusive or event-based gateway, any other node) is bridged like
 *    --bridge-all, since every path ran on alone before as well; a
 *    synchronising join (parallel, inclusive, complex gateway) is refused
 *    (E_AMBIGUOUS_BRIDGE): bridging ends the synchronisation, not bridging
 *    disconnects the successor; the hint names `--bridge-all` and
 *    `--no-bridge` with the node's id.
 *  - every removed element -> cs.remove({id, kind, name}); released ids.
 *  - bridging policy (Bridge.single, shared with `move`): no bridge when
 *    predecessor and successor are the same non-activity (a self-loop
 *    `connect` would refuse; activities may loop to themselves); a condition
 *    carried onto the predecessor's default flow is dropped instead
 *    (W_CONDITION_DROPPED), a default flow has no condition. A bridge from an
 *    event-based gateway to a target the file's rule does not allow fails
 *    with E_INVALID_BRIDGE (EventGatewayRule.targetProblem), unless
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
import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { findReferences, is, many, removeFrom, walk, type El } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { Bridge } from './Bridge.js';
import { idOf } from './utils/elements.js';
import { contains, detachFromParent, nearestWithId, referencesToAny } from './utils/containment.js';
import type { RemoveOp } from './types.js';
import { SequenceFlows } from './SequenceFlows.js';

export class ElementRemover {
  constructor(private readonly doc: Doc) {}

  /** Removes every element named in `op.ids` (cascading), bridging flows around single nodes. */
  remove(op: RemoveOp): ChangeSet {
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
        if (!this.doc.get(id) && op.ifExists) {
          cs.note(`${id} does not exist; skipped`);
          continue;
        }
        const branch = this.branchOf(this.doc.require(id, ['bpmn:FlowNode'], 'flow node'));
        for (const el of branch.nodes) removing.add(idOf(el));
        cs.note(
          `branch of ${id}: ${branch.nodes.length} node(s) (${branch.nodes.map(idOf).join(', ')})${branch.stops.length ? `; it stops before ${branch.stops.map(idOf).join(', ')}, which other paths reach (they stay)` : '; it ends there'}`,
        );
        for (const el of branch.nodes) {
          if (gone.has(idOf(el))) continue;
          new Bridge(this.doc, cs).single(el, false);
          this.cascade(el, cs);
          for (const r of cs.removed) gone.add(r.id);
        }
      }
      this.doc.invalidate();
      return cs;
    }
    for (const id of op.ids) {
      if (gone.has(id)) {
        cs.note(`${id} was already removed together with an earlier element`);
        continue;
      }
      const el = this.doc.get(id);
      if (!el) {
        if (op.ifExists) {
          cs.note(`${id} does not exist; skipped`);
          continue;
        }
        this.doc.require(id);
        continue;
      }
      if (is(el, 'bpmn:Definitions')) {
        throw modelError('E_INVALID_REMOVE', 'The definitions element cannot be removed', { element: id, hint: 'Delete the file instead.' });
      }
      if (is(el, 'bpmn:FlowNode')) {
        new Bridge(this.doc, cs).forRemoval(el, bridge, !!op.bridgeAll, removing);
      }
      this.cascade(el, cs);
      for (const r of cs.removed) gone.add(r.id);
    }
    this.doc.invalidate();
    return cs;
  }

  /**
   * The exclusive downstream path of a flow node or boundary event (see the
   * module contract): `nodes` in document order (the root first), `stops` the
   * nodes outside it that it flows into.
   */
  branchOf(root: El): { nodes: El[]; stops: El[] } {
    const incoming = this.doc.incoming(root);
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
      ...this.doc.outgoing(n).map((f) => f.get<El>('targetRef')),
      ...(is(n, 'bpmn:Activity') ? this.doc.boundaryEventsOf(n) : []),
      ...this.compensationHandlers(n),
    ];
    /** who else leads to it */
    const before = (n: El): El[] => {
      if (is(n, 'bpmn:BoundaryEvent')) return [n.get<El>('attachedToRef')];
      const preds = this.doc.incoming(n).map((f) => f.get<El>('sourceRef'));
      if (n.get<boolean | undefined>('isForCompensation')) preds.push(...this.compensationSources(n));
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
    const order = new Map([...this.doc.byId().values()].map((el, i) => [el, i]));
    const sorted = [...inBranch].sort((a, b) => (a === root ? -1 : b === root ? 1 : (order.get(a) ?? 0) - (order.get(b) ?? 0)));
    return { nodes: sorted, stops: [...stops].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)) };
  }

  /** Compensation handlers a compensate boundary event points to (bpmn:Association). */
  private compensationHandlers(n: El): El[] {
    if (!is(n, 'bpmn:BoundaryEvent')) return [];
    return [...this.doc.byId().values()].filter((a) => is(a, 'bpmn:Association') && a.get<El | undefined>('sourceRef') === n).map((a) => a.get<El>('targetRef')).filter((t) => !!t && !!t.get<boolean | undefined>('isForCompensation'));
  }

  /** The boundary events whose compensation associations point to a handler. */
  private compensationSources(handler: El): El[] {
    return [...this.doc.byId().values()].filter((a) => is(a, 'bpmn:Association') && a.get<El | undefined>('targetRef') === handler).map((a) => a.get<El>('sourceRef')).filter((s): s is El => !!s && is(s, 'bpmn:BoundaryEvent'));
  }

  /** True when the element is still reachable from the definitions through containment. */
  private isAttached(el: El): boolean {
    let cur: El = el;
    while (cur !== this.doc.definitions) {
      const parent = cur.$parent as El | undefined;
      if (!parent || !contains(parent, cur)) return false;
      cur = parent;
    }
    return true;
  }

  private static reportable(el: El): boolean {
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

  private static removedEntry(el: El) {
    return is(el, 'bpmn:SequenceFlow') ? ChangeSet.flowEntryOf(el) : ChangeSet.entryOf(el);
  }

  /** Cascade-removes one element (no bridging). Used by retype/move internally. */
  cascade(el: El, cs: ChangeSet): void {
    if (!this.isAttached(el)) return;
    if (is(el, 'bpmn:SequenceFlow')) {
      new SequenceFlows(this.doc).remove(el);
      cs.remove(ChangeSet.flowEntryOf(el));
      this.cleanupReferences(new Set([el]), cs);
      return;
    }
    if (is(el, 'bpmn:Participant')) {
      this.removeParticipant(el, cs);
      return;
    }
    // vendor extension content is not part of the id space: its ids are never released
    const subtree = [...walk(el, { bpmnOnly: true })];
    const removed = new Set(subtree);
    const parent = detachFromParent(el);
    for (const e of subtree) {
      const id = e.get<string | undefined>('id');
      if (id) this.doc.ids.release(id);
    }
    if (ElementRemover.reportable(el) || el.get<string | undefined>('id')) cs.remove(ElementRemover.removedEntry(el));
    for (const e of subtree) if (e !== el && ElementRemover.reportable(e)) cs.remove(ElementRemover.removedEntry(e));
    this.doc.invalidate();
    this.afterDetach(el, parent, cs);
    this.cleanupReferences(removed, cs);
    this.doc.invalidate();
  }

  /** Type-specific follow-ups once an element left the tree. */
  private afterDetach(el: El, parent: El | undefined, cs: ChangeSet): void {
    if (is(el, 'bpmn:Lane') && parent && is(parent, 'bpmn:LaneSet')) {
      if (!many(parent, 'lanes').length) {
        const owner = parent.$parent as El | undefined;
        if (owner && is(owner, 'bpmn:Lane')) owner.set('childLaneSet', undefined);
        else if (owner) removeFrom(owner, 'laneSets', parent);
        const lsId = parent.get<string | undefined>('id');
        if (lsId) this.doc.ids.release(lsId);
        cs.note(`lane set${lsId ? ` ${lsId}` : ''} removed: no lanes left`);
      }
      return;
    }
    if (is(el, 'bpmn:DataInputAssociation') && parent) {
      const target = el.get<El | undefined>('targetRef');
      if (target && is(target, 'bpmn:Property') && target.$parent === parent && !findReferences(this.doc.definitions, target).length) {
        removeFrom(parent, 'properties', target);
        const pid = target.get<string | undefined>('id');
        if (pid) this.doc.ids.release(pid);
      }
      return;
    }
    if (is(el, 'bpmn:DataObjectReference')) {
      const backing = el.get<El | undefined>('dataObjectRef');
      if (backing && this.isAttached(backing) && !findReferences(this.doc.definitions, backing).length) this.cascade(backing, cs);
      return;
    }
    if (is(el, 'bpmn:DataStoreReference')) {
      const backing = el.get<El | undefined>('dataStoreRef');
      if (backing && this.isAttached(backing) && !findReferences(this.doc.definitions, backing).length) this.cascade(backing, cs);
      return;
    }
    if (is(el, 'bpmn:Group')) {
      const value = el.get<El | undefined>('categoryValueRef');
      if (!value || !this.isAttached(value) || findReferences(this.doc.definitions, value).some((r) => is(r.holder, 'bpmn:Group'))) return;
      const category = value.$parent as El;
      this.cascade(value, cs);
      if (is(category, 'bpmn:Category') && !many(category, 'categoryValue').length) this.cascade(category, cs);
      return;
    }
    if (is(el, 'bpmn:Process')) {
      const pid = idOf(el);
      for (const e of walk(this.doc.definitions)) {
        if (is(e, 'bpmn:CallActivity') && e.get<string | undefined>('calledElement') === pid) {
          cs.warn({
            code: 'W_DANGLING_CALLED_ELEMENT',
            message: `${idOf(e)} still calls the removed process ${pid}`,
            element: idOf(e),
            related: [pid],
            hint: `Set another process with \`bpmn set <file> ${idOf(e)} calledElement=<processId>\` or remove the call activity.`,
          });
        }
      }
    }
  }

  private removeParticipant(participant: El, cs: ChangeSet): void {
    const collaboration = participant.$parent as El | undefined;
    const process = participant.get<El | undefined>('processRef');
    detachFromParent(participant);
    this.doc.ids.release(idOf(participant));
    cs.remove(ChangeSet.entryOf(participant));
    this.doc.invalidate();
    this.cleanupReferences(new Set([participant]), cs);
    if (process && this.isAttached(process) && !this.doc.participants().some((p) => p.get<El | undefined>('processRef') === process)) {
      this.cascade(process, cs);
    }
    if (collaboration && is(collaboration, 'bpmn:Collaboration') && this.isAttached(collaboration) && !many(collaboration, 'participants').length) {
      this.cascade(collaboration, cs);
      cs.note(`collaboration ${idOf(collaboration)} removed: no participants left`);
    }
  }

  /** Resolves every reference from the remaining tree to a removed element. */
  private cleanupReferences(removed: Set<El>, cs: ChangeSet): void {
    for (const { holder, prop, isMany, target } of referencesToAny(this.doc.definitions, removed)) {
      if (!this.isAttached(holder)) continue;
      const targetId = idOf(target);
      if (holder.$type.startsWith('bpmndi:')) {
        const gone = is(holder, 'bpmndi:BPMNPlane') ? (holder.$parent as El) : holder;
        detachFromParent(gone);
        // its ids are free again: a later `set id=` of the batch takes the derived DI id along as a command of its own does (diagram/utils/di-ids.ts followDiIds)
        for (const e of walk(gone, { bpmnOnly: true })) {
          const id = idOf(e);
          if (id) this.doc.ids.release(id);
        }
        continue;
      }
      if (is(holder, 'bpmn:SequenceFlow') || is(holder, 'bpmn:MessageFlow') || is(holder, 'bpmn:Association') || is(holder, 'bpmn:DataAssociation')) {
        this.cascade(holder, cs);
        continue;
      }
      if (is(holder, 'bpmn:BoundaryEvent') && prop === 'attachedToRef') {
        this.cascade(holder, cs);
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
        if (is(holder, 'bpmn:Lane')) cs.change(ChangeSet.entryOf(holder, `member ${targetId} removed`));
        continue;
      }
      holder.set(prop, undefined);
      const owner = nearestWithId(holder);
      if (owner && prop !== 'default') cs.change(ChangeSet.entryOf(owner, `${prop} cleared (${targetId} removed)`));
    }
    this.doc.invalidate();
  }
}
