import type { EditSession } from '../../document/EditSession.js';
import { modelError, usageError } from '../../document/utils/errors.js';
import { is, many, removeFrom, walk, type El } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { FlowBridge } from '../connections/FlowBridge.js';
import { idOf } from '../../document/utils/elements.js';
import { contains, detachFromParent, nearestWithId, referencesToAny } from '../utils/containment.js';
import type { RemoveElements } from '../../commands/types.js';
import { SequenceFlows } from '../connections/SequenceFlows.js';
import { Lanes } from './Lanes.js';

/**
 * Runs the `remove` op: deletes elements with everything that references them.
 * The cascade is reference-driven: connections to removed elements go, boundary events
 * fall with their host, other references are pruned or cleared.
 */
export class ElementRemoval {
  constructor(private readonly edit: EditSession) {}

  remove(command: RemoveElements): ChangeSet {
    const changes = new ChangeSet();
    if (!command.ids?.length) {
      throw usageError('remove needs at least one element id');
    }
    const bridge = command.bridge ?? true;
    const removing = new Set(command.ids);
    const gone = new Set<string>();
    if (command.withBranch && (command.bridgeAll || command.bridge === false)) {
      throw usageError(`--with-branch removes the node's whole downstream path and bridges nothing: drop ${command.bridgeAll ? '--bridge-all' : '--no-bridge'}`);
    }
    if (command.bridgeAll && command.bridge === false) {
      throw usageError('--bridge-all and --no-bridge contradict each other');
    }
    if (command.withBranch) {
      for (const id of command.ids) {
        if (gone.has(id)) continue;
        if (!this.edit.doc.get(id) && command.ifExists) {
          changes.note(`${id} does not exist; skipped`);
          continue;
        }
        const branch = this.branchOf(this.edit.require(id, ['bpmn:FlowNode'], 'flow node'));
        for (const el of branch.nodes) {
          removing.add(idOf(el));
        }
        changes.note(
          `branch of ${id}: ${branch.nodes.length} node(s) (${branch.nodes.map(idOf).join(', ')})${branch.stops.length ? `; it stops before ${branch.stops.map(idOf).join(', ')}, which other paths reach (they stay)` : '; it ends there'}`,
        );
        for (const el of branch.nodes) {
          if (gone.has(idOf(el))) continue;
          new FlowBridge(this.edit, changes).single(el, false);
          this.cascade(el, changes);
          for (const removal of changes.removed) {
            gone.add(removal.id);
          }
        }
      }
      this.edit.doc.invalidate();
      return changes;
    }
    for (const id of command.ids) {
      if (gone.has(id)) {
        changes.note(`${id} was already removed together with an earlier element`);
        continue;
      }
      const el = this.edit.doc.get(id);
      if (!el) {
        if (command.ifExists) {
          changes.note(`${id} does not exist; skipped`);
          continue;
        }
        this.edit.require(id);
        continue;
      }
      if (is(el, 'bpmn:Definitions')) {
        throw modelError('E_INVALID_REMOVE', 'The definitions element cannot be removed', { element: id, hint: 'Delete the file instead.' });
      }
      if (is(el, 'bpmn:FlowNode')) {
        new FlowBridge(this.edit, changes).forRemoval(el, bridge, !!command.bridgeAll, removing);
      }
      this.cascade(el, changes);
      for (const removal of changes.removed) {
        gone.add(removal.id);
      }
    }
    this.edit.doc.invalidate();
    return changes;
  }

  /**
   * The nodes only this node leads to, up to the next node another path reaches.
   * `nodes` is in document order with the root first, `stops` are the nodes it flows into. @internal
   */
  branchOf(root: El): { nodes: El[]; stops: El[] } {
    const incoming = this.edit.doc.incoming(root);
    if (incoming.length > 1) {
      throw modelError('E_AMBIGUOUS_BRANCH', `${idOf(root)} is reached by ${incoming.length} paths (${incoming.map((flow) => idOf(flow.get<El>('sourceRef'))).join(', ')}); its downstream is not the branch of one path`, {
        element: idOf(root),
        candidates: incoming.map((flow) => idOf(flow)),
        hint: `Remove the branch from a node only one path reaches (the first node after the split), or remove ${idOf(root)} alone (\`bpmn remove <file> ${idOf(root)} --bridge-all\` reconnects the paths to its successor).`,
      });
    }
    const inBranch = new Set<El>([root]);
    const next = (node: El): El[] => [
      ...this.edit.doc.outgoing(node).map((flow) => flow.get<El>('targetRef')),
      ...(is(node, 'bpmn:Activity') ? this.edit.doc.boundaryEventsOf(node) : []),
      ...this.compensationHandlers(node),
    ];
    const before = (node: El): El[] => {
      if (is(node, 'bpmn:BoundaryEvent')) return [node.get<El>('attachedToRef')];
      const preds = this.edit.doc.incoming(node).map((flow) => flow.get<El>('sourceRef'));
      if (node.get<boolean | undefined>('isForCompensation')) {
        preds.push(...this.compensationSources(node));
      }
      return preds;
    };
    const stops = new Set<El>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const member of [...inBranch]) {
        for (const successor of next(member)) {
          if (inBranch.has(successor)) continue;
          if (before(successor).every((predecessor) => inBranch.has(predecessor))) {
            inBranch.add(successor);
            stops.delete(successor);
            grew = true;
          } else {
            stops.add(successor);
          }
        }
      }
    }
    const order = new Map([...this.edit.doc.byId().values()].map((el, position) => [el, position]));
    const sorted = [...inBranch].sort((left, right) => (left === root ? -1 : right === root ? 1 : (order.get(left) ?? 0) - (order.get(right) ?? 0)));
    return { nodes: sorted, stops: [...stops].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0)) };
  }

  private compensationHandlers(node: El): El[] {
    if (!is(node, 'bpmn:BoundaryEvent')) return [];
    return [...this.edit.doc.byId().values()].filter((association) => is(association, 'bpmn:Association') && association.get<El | undefined>('sourceRef') === node).map((association) => association.get<El>('targetRef')).filter((target) => !!target && !!target.get<boolean | undefined>('isForCompensation'));
  }

  private compensationSources(handler: El): El[] {
    return [...this.edit.doc.byId().values()].filter((association) => is(association, 'bpmn:Association') && association.get<El | undefined>('targetRef') === handler).map((association) => association.get<El>('sourceRef')).filter((source): source is El => !!source && is(source, 'bpmn:BoundaryEvent'));
  }

  private isAttached(el: El): boolean {
    let cur: El = el;
    while (cur !== this.edit.doc.definitions) {
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

  /**
   * Cascade-removes one element without bridging. The ids of vendor extension content are not
   * part of the id space and are never released.
   */
  cascade(el: El, changes: ChangeSet): void {
    if (!this.isAttached(el)) return;
    if (is(el, 'bpmn:SequenceFlow')) {
      new SequenceFlows(this.edit).remove(el);
      changes.remove(ChangeSet.flowEntryOf(el));
      this.cleanupReferences(new Set([el]), changes);
      return;
    }
    if (is(el, 'bpmn:Participant')) {
      this.removeParticipant(el, changes);
      return;
    }
    const subtree = [...walk(el, { bpmnOnly: true })];
    const removed = new Set(subtree);
    const handover = is(el, 'bpmn:Lane') ? ElementRemoval.laneHandover(el, subtree) : undefined;
    const parent = detachFromParent(el);
    for (const element of subtree) {
      const id = element.get<string | undefined>('id');
      if (id) this.edit.doc.ids.release(id);
    }
    if (ElementRemoval.reportable(el) || el.get<string | undefined>('id')) {
      changes.remove(ElementRemoval.removedEntry(el));
    }
    for (const element of subtree) {
      if (element !== el && ElementRemoval.reportable(element)) {
        changes.remove(ElementRemoval.removedEntry(element));
      }
    }
    this.edit.doc.invalidate();
    this.afterDetach(el, parent, changes);
    if (handover) {
      this.handOver(el, handover, changes);
    }
    this.cleanupReferences(removed, changes);
    this.edit.doc.invalidate();
  }

  /** The lane drawn over the removed band once it is gone, and the members it takes over. */
  private static laneHandover(lane: El, subtree: El[]): { heir: El; members: El[] } | undefined {
    const laneSet = lane.$parent as El | undefined;
    if (!laneSet) {
      return undefined;
    }
    const siblings = many(laneSet, 'lanes');
    const position = siblings.indexOf(lane);
    const heir = ElementRemoval.heirOf(laneSet, siblings[position - 1], siblings[position + 1]);
    if (!heir) {
      return undefined;
    }
    const members = subtree.filter((element) => is(element, 'bpmn:Lane')).flatMap((member) => [...many(member, 'flowNodeRef')]);
    return members.length ? { heir, members } : undefined;
  }

  private static heirOf(laneSet: El, above: El | undefined, below: El | undefined): El | undefined {
    if (above) {
      return ElementRemoval.edgeLeaf(above, 'last');
    }
    if (below) {
      return ElementRemoval.edgeLeaf(below, 'first');
    }
    const owner = laneSet.$parent as El | undefined;
    return owner && is(owner, 'bpmn:Lane') ? owner : undefined;
  }

  private static edgeLeaf(lane: El, edge: 'first' | 'last'): El {
    const childLaneSet = lane.get<El | undefined>('childLaneSet');
    const children = childLaneSet ? many(childLaneSet, 'lanes') : [];
    const next = edge === 'first' ? children[0] : children[children.length - 1];
    return next ? ElementRemoval.edgeLeaf(next, edge) : lane;
  }

  private handOver(lane: El, { heir, members }: { heir: El; members: El[] }, changes: ChangeSet): void {
    this.edit.doc.invalidate();
    const lanes = new Lanes(this.edit);
    const remaining = members.filter((node) => this.isAttached(node));
    if (!remaining.length) {
      return;
    }
    for (const node of remaining) {
      lanes.assign(node, heir, changes);
    }
    changes.note(`${remaining.length} member(s) of ${idOf(lane)} moved to ${idOf(heir)}`);
  }

  private afterDetach(el: El, parent: El | undefined, changes: ChangeSet): void {
    if (is(el, 'bpmn:Lane') && parent && is(parent, 'bpmn:LaneSet')) {
      if (!many(parent, 'lanes').length) {
        const owner = parent.$parent as El | undefined;
        if (owner && is(owner, 'bpmn:Lane')) {
          owner.set('childLaneSet', undefined);
        } else if (owner) {
          removeFrom(owner, 'laneSets', parent);
        }
        const lsId = parent.get<string | undefined>('id');
        if (lsId) this.edit.doc.ids.release(lsId);
        changes.note(`lane set${lsId ? ` ${lsId}` : ''} removed: no lanes left`);
      }
      return;
    }
    if (is(el, 'bpmn:DataInputAssociation') && parent) {
      const target = el.get<El | undefined>('targetRef');
      if (target && is(target, 'bpmn:Property') && target.$parent === parent && !referencesToAny(this.edit.doc.definitions, new Set([target])).length) {
        removeFrom(parent, 'properties', target);
        const pid = target.get<string | undefined>('id');
        if (pid) this.edit.doc.ids.release(pid);
      }
      return;
    }
    if (is(el, 'bpmn:DataObjectReference')) {
      const backing = el.get<El | undefined>('dataObjectRef');
      if (backing && this.isAttached(backing) && !referencesToAny(this.edit.doc.definitions, new Set([backing])).length) {
        this.cascade(backing, changes);
      }
      return;
    }
    if (is(el, 'bpmn:DataStoreReference')) {
      const backing = el.get<El | undefined>('dataStoreRef');
      if (backing && this.isAttached(backing) && !referencesToAny(this.edit.doc.definitions, new Set([backing])).length) {
        this.cascade(backing, changes);
      }
      return;
    }
    if (is(el, 'bpmn:Group')) {
      const value = el.get<El | undefined>('categoryValueRef');
      if (!value || !this.isAttached(value) || referencesToAny(this.edit.doc.definitions, new Set([value])).some((reference) => is(reference.holder, 'bpmn:Group'))) {
        return;
      }
      const category = value.$parent as El;
      this.cascade(value, changes);
      if (is(category, 'bpmn:Category') && !many(category, 'categoryValue').length) {
        this.cascade(category, changes);
      }
      return;
    }
    if (is(el, 'bpmn:Process')) {
      const pid = idOf(el);
      for (const element of walk(this.edit.doc.definitions)) {
        if (is(element, 'bpmn:CallActivity') && element.get<string | undefined>('calledElement') === pid) {
          changes.warn({
            code: 'W_DANGLING_CALLED_ELEMENT',
            message: `${idOf(element)} still calls the removed process ${pid}`,
            element: idOf(element),
            related: [pid],
            hint: `Set another process with \`bpmn set <file> ${idOf(element)} calledElement=<processId>\` or remove the call activity.`,
          });
        }
      }
    }
  }

  private removeParticipant(participant: El, changes: ChangeSet): void {
    const collaboration = participant.$parent as El | undefined;
    const process = participant.get<El | undefined>('processRef');
    detachFromParent(participant);
    this.edit.doc.ids.release(idOf(participant));
    changes.remove(ChangeSet.entryOf(participant));
    this.edit.doc.invalidate();
    this.cleanupReferences(new Set([participant]), changes);
    if (process && this.isAttached(process) && !this.edit.doc.participants().some((otherParticipant) => otherParticipant.get<El | undefined>('processRef') === process)) {
      this.cascade(process, changes);
    }
    if (collaboration && is(collaboration, 'bpmn:Collaboration') && this.isAttached(collaboration) && !many(collaboration, 'participants').length) {
      this.cascade(collaboration, changes);
      changes.note(`collaboration ${idOf(collaboration)} removed: no participants left`);
    }
  }

  /**
   * Drops the references to removed elements. The ids of a diagram dropped with them are released,
   * so a later `set id=` of the batch can take the derived DI id along.
   */
  private cleanupReferences(removed: Set<El>, changes: ChangeSet): void {
    for (const { holder, prop, isMany, target } of referencesToAny(this.edit.doc.definitions, removed)) {
      if (!this.isAttached(holder)) continue;
      const targetId = idOf(target);
      if (holder.$type.startsWith('bpmndi:')) {
        const gone = is(holder, 'bpmndi:BPMNPlane') ? (holder.$parent as El) : holder;
        detachFromParent(gone);
        for (const element of walk(gone, { bpmnOnly: true })) {
          const id = idOf(element);
          if (id) this.edit.doc.ids.release(id);
        }
        continue;
      }
      if (is(holder, 'bpmn:SequenceFlow') || is(holder, 'bpmn:MessageFlow') || is(holder, 'bpmn:Association') || is(holder, 'bpmn:DataAssociation')) {
        this.cascade(holder, changes);
        continue;
      }
      if (is(holder, 'bpmn:BoundaryEvent') && prop === 'attachedToRef') {
        this.cascade(holder, changes);
        continue;
      }
      if (is(holder, 'bpmn:Participant') && prop === 'processRef') {
        holder.set(prop, undefined);
        changes.warn({
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
        if (is(holder, 'bpmn:Lane')) {
          changes.change(ChangeSet.entryOf(holder, `member ${targetId} removed`));
        }
        continue;
      }
      holder.set(prop, undefined);
      const owner = nearestWithId(holder);
      if (owner && prop !== 'default') {
        changes.change(ChangeSet.entryOf(owner, `${prop} cleared (${targetId} removed)`));
      }
    }
    this.edit.doc.invalidate();
  }
}
