import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { findReferences, is, many, removeFrom, walk, type El } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { Bridge } from './Bridge.js';
import { idOf } from './utils/elements.js';
import { contains, detachFromParent, nearestWithId, referencesToAny } from './utils/containment.js';
import type { RemoveOp } from './types.js';
import { SequenceFlows } from './SequenceFlows.js';

/**
 * Runs the `remove` op: deletes elements with everything that references them.
 * The cascade is reference-driven: connections to removed elements go, boundary events
 * fall with their host, other references are pruned or cleared.
 */
export class ElementRemover {
  constructor(private readonly doc: Doc) {}

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
   * The nodes only this node leads to, up to the next node another path reaches.
   * `nodes` is in document order with the root first, `stops` are the nodes it flows into.
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
    const next = (n: El): El[] => [
      ...this.doc.outgoing(n).map((f) => f.get<El>('targetRef')),
      ...(is(n, 'bpmn:Activity') ? this.doc.boundaryEventsOf(n) : []),
      ...this.compensationHandlers(n),
    ];
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

  private compensationHandlers(n: El): El[] {
    if (!is(n, 'bpmn:BoundaryEvent')) return [];
    return [...this.doc.byId().values()].filter((a) => is(a, 'bpmn:Association') && a.get<El | undefined>('sourceRef') === n).map((a) => a.get<El>('targetRef')).filter((t) => !!t && !!t.get<boolean | undefined>('isForCompensation'));
  }

  private compensationSources(handler: El): El[] {
    return [...this.doc.byId().values()].filter((a) => is(a, 'bpmn:Association') && a.get<El | undefined>('targetRef') === handler).map((a) => a.get<El>('sourceRef')).filter((s): s is El => !!s && is(s, 'bpmn:BoundaryEvent'));
  }

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

  /** Cascade-removes one element without bridging. */
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

  private cleanupReferences(removed: Set<El>, cs: ChangeSet): void {
    for (const { holder, prop, isMany, target } of referencesToAny(this.doc.definitions, removed)) {
      if (!this.isAttached(holder)) continue;
      const targetId = idOf(target);
      if (holder.$type.startsWith('bpmndi:')) {
        const gone = is(holder, 'bpmndi:BPMNPlane') ? (holder.$parent as El) : holder;
        detachFromParent(gone);
        // released so a later `set id=` of the batch can take the derived DI id along
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
