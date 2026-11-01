import { type BpmnElement, BpmnError, ChangeEntries, ChangeSet, ElementWalk, IdRequests } from '../model/index.js';
import type { RemoveOperation } from '../operations/index.js';
import { ElementContainment } from './containers/ElementContainment.js';
import { FlowBridge } from './flows/FlowBridge.js';
import { SequenceFlows } from './flows/SequenceFlows.js';
import { LaneMembership } from './LaneMembership.js';
import type { EditSession } from './session/EditSession.js';

export class ElementRemoval {
  constructor(private readonly edit: EditSession) {}

  remove(command: RemoveOperation): ChangeSet {
    const changes = new ChangeSet();
    const bridge = command.bridge !== 'none';
    const bridgeAll = command.bridge === 'all';
    const removing = new Set(command.ids);
    const gone = new Set<string>();
    if (command.withBranch && command.bridge) {
      throw BpmnError.usage(`--with-branch removes the node's whole downstream path and bridges nothing: drop ${bridgeAll ? '--bridge-all' : '--no-bridge'}`);
    }
    if (command.withBranch) {
      for (const id of command.ids) {
        if (gone.has(id)) {
          continue;
        }
        if (!this.edit.document.tree.byId(id) && command.ifExists) {
          changes.note(`${id} does not exist; skipped`);
          continue;
        }
        const branch = this.branchOf(this.edit.require(id, ['bpmn:FlowNode'], 'flow node'));
        for (const el of branch.nodes) {
          removing.add(el.id);
        }
        changes.note(
          `branch of ${id}: ${branch.nodes.length} node(s) (${branch.nodes.map((element) => element.id).join(', ')})${branch.stops.length ? `; it stops before ${branch.stops.map((element) => element.id).join(', ')}, which other paths reach (they stay)` : '; it ends there'}`,
        );
        for (const el of branch.nodes) {
          if (gone.has(el.id)) {
            continue;
          }
          new FlowBridge(this.edit, changes).single(el, false);
          this.cascade(el, changes);
          for (const removal of changes.removed) {
            gone.add(removal.id);
          }
        }
      }
      this.edit.document.tree.invalidate();
      return changes;
    }
    for (const id of command.ids) {
      if (gone.has(id)) {
        changes.note(`${id} was already removed together with an earlier element`);
        continue;
      }
      const el = this.edit.document.tree.byId(id);
      if (!el) {
        if (command.ifExists) {
          changes.note(`${id} does not exist; skipped`);
          continue;
        }
        this.edit.require(id);
        continue;
      }
      if (el.is('bpmn:Definitions')) {
        throw BpmnError.model('E_INVALID_REMOVE', 'The definitions element cannot be removed', { element: id, hint: 'Delete the file instead.' });
      }
      if (el.is('bpmn:FlowNode')) {
        new FlowBridge(this.edit, changes).forRemoval(el, bridge, bridgeAll, removing);
      }
      this.cascade(el, changes);
      for (const removal of changes.removed) {
        gone.add(removal.id);
      }
    }
    this.edit.document.tree.invalidate();
    return changes;
  }

  branchOf(root: BpmnElement): { nodes: BpmnElement[]; stops: BpmnElement[] } {
    const incoming = this.edit.document.flows.incoming(root);
    if (incoming.length > 1) {
      throw BpmnError.model('E_AMBIGUOUS_BRANCH', `${root.id} is reached by ${incoming.length} paths (${incoming.map((flow) => flow.get<BpmnElement>('sourceRef').id).join(', ')}); its downstream is not the branch of one path`, {
        element: root.id,
        candidates: incoming.map((flow) => flow.id),
        hint: `Remove the branch from a node only one path reaches (the first node after the split), or remove ${root.id} alone (\`bpmn remove <file> ${root.id} --bridge-all\` reconnects the paths to its successor).`,
      });
    }
    const inBranch = new Set<BpmnElement>([root]);
    const next = (node: BpmnElement): BpmnElement[] => [
      ...this.edit.document.flows.outgoing(node).map((flow) => flow.get<BpmnElement>('targetRef')),
      ...(node.is('bpmn:Activity') ? this.edit.document.scopes.boundaryEventsOf(node) : []),
      ...this.compensationHandlers(node),
    ];
    const before = (node: BpmnElement): BpmnElement[] => {
      if (node.is('bpmn:BoundaryEvent')) {
        return [node.get<BpmnElement>('attachedToRef')];
      }
      const preds = this.edit.document.flows.incoming(node).map((flow) => flow.get<BpmnElement>('sourceRef'));
      if (node.get<boolean | undefined>('isForCompensation')) {
        preds.push(...this.compensationSources(node));
      }
      return preds;
    };
    const stops = new Set<BpmnElement>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const member of [...inBranch]) {
        for (const successor of next(member)) {
          if (inBranch.has(successor)) {
            continue;
          }
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
    const order = new Map([...this.edit.document.tree.all().values()].map((el, position) => [el, position]));
    const sorted = [...inBranch].sort((left, right) => (left === root ? -1 : right === root ? 1 : (order.get(left) ?? 0) - (order.get(right) ?? 0)));
    return { nodes: sorted, stops: [...stops].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0)) };
  }

  private compensationHandlers(node: BpmnElement): BpmnElement[] {
    if (!node.is('bpmn:BoundaryEvent')) {
      return [];
    }
    return [...this.edit.document.tree.all().values()].filter((association) => association.is('bpmn:Association') && association.get<BpmnElement | undefined>('sourceRef') === node).map((association) => association.get<BpmnElement>('targetRef')).filter((target) => !!target && !!target.get<boolean | undefined>('isForCompensation'));
  }

  private compensationSources(handler: BpmnElement): BpmnElement[] {
    return [...this.edit.document.tree.all().values()].filter((association) => association.is('bpmn:Association') && association.get<BpmnElement | undefined>('targetRef') === handler).map((association) => association.get<BpmnElement>('sourceRef')).filter((source): source is BpmnElement => !!source && source.is('bpmn:BoundaryEvent'));
  }

  private isAttached(el: BpmnElement): boolean {
    let cur: BpmnElement = el;
    while (cur !== this.edit.document.tree.definitions) {
      const parent = cur.parent;
      if (!parent || !ElementContainment.contains(parent, cur)) {
        return false;
      }
      cur = parent;
    }
    return true;
  }

  private static reportable(el: BpmnElement): boolean {
    return (
      !!el.get<string | undefined>('id') &&
      (el.is('bpmn:FlowElement') ||
        el.is('bpmn:Artifact') ||
        el.is('bpmn:Lane') ||
        el.is('bpmn:Participant') ||
        el.is('bpmn:RootElement') ||
        el.is('bpmn:DataAssociation'))
    );
  }

  private static removedEntry(el: BpmnElement) {
    return el.is('bpmn:SequenceFlow') ? ChangeEntries.ofFlow(el) : ChangeEntries.of(el);
  }

  cascade(el: BpmnElement, changes: ChangeSet): void {
    if (!this.isAttached(el)) {
      return;
    }
    if (el.is('bpmn:SequenceFlow')) {
      new SequenceFlows(this.edit).remove(el);
      changes.remove(ChangeEntries.ofFlow(el));
      this.cleanupReferences(new Set([el]), changes);
      return;
    }
    if (el.is('bpmn:Participant')) {
      this.removeParticipant(el, changes);
      return;
    }
    const subtree = [...new ElementWalk(el).depthFirst({ bpmnOnly: true })];
    const removed = new Set(subtree);
    const handover = el.is('bpmn:Lane') ? ElementRemoval.laneHandover(el, subtree) : undefined;
    const parent = ElementContainment.detach(el);
    for (const element of subtree) {
      const id = element.get<string | undefined>('id');
      if (id) {
        this.edit.document.ids.registry.release(id);
      }
    }
    if (ElementRemoval.reportable(el) || el.get<string | undefined>('id')) {
      changes.remove(ElementRemoval.removedEntry(el));
    }
    for (const element of subtree) {
      if (element !== el && ElementRemoval.reportable(element)) {
        changes.remove(ElementRemoval.removedEntry(element));
      }
    }
    this.edit.document.tree.invalidate();
    this.afterDetach(el, parent, changes);
    if (handover) {
      this.handOver(el, handover, changes);
    }
    this.cleanupReferences(removed, changes);
    this.edit.document.tree.invalidate();
  }

  private static laneHandover(lane: BpmnElement, subtree: BpmnElement[]): { heir: BpmnElement; members: BpmnElement[] } | undefined {
    const laneSet = lane.parent;
    if (!laneSet) {
      return undefined;
    }
    const siblings = laneSet.list('lanes');
    const position = siblings.indexOf(lane);
    const heir = ElementRemoval.heirOf(laneSet, siblings[position - 1], siblings[position + 1]);
    if (!heir) {
      return undefined;
    }
    const members = subtree.filter((element) => element.is('bpmn:Lane')).flatMap((member) => [...member.list('flowNodeRef')]);
    return members.length ? { heir, members } : undefined;
  }

  private static heirOf(laneSet: BpmnElement, above: BpmnElement | undefined, below: BpmnElement | undefined): BpmnElement | undefined {
    if (above) {
      return ElementRemoval.edgeLeaf(above, 'last');
    }
    if (below) {
      return ElementRemoval.edgeLeaf(below, 'first');
    }
    const owner = laneSet.parent;
    return owner && owner.is('bpmn:Lane') ? owner : undefined;
  }

  private static edgeLeaf(lane: BpmnElement, edge: 'first' | 'last'): BpmnElement {
    const childLaneSet = lane.get<BpmnElement | undefined>('childLaneSet');
    const children = childLaneSet ? childLaneSet.list('lanes') : [];
    const next = edge === 'first' ? children[0] : children[children.length - 1];
    return next ? ElementRemoval.edgeLeaf(next, edge) : lane;
  }

  private handOver(lane: BpmnElement, { heir, members }: { heir: BpmnElement; members: BpmnElement[] }, changes: ChangeSet): void {
    this.edit.document.tree.invalidate();
    const lanes = new LaneMembership(this.edit);
    const remaining = members.filter((node) => this.isAttached(node));
    if (!remaining.length) {
      return;
    }
    for (const node of remaining) {
      lanes.assign(node, heir, changes);
    }
    changes.note(`${remaining.length} member(s) of ${lane.id} moved to ${heir.id}`);
  }

  private afterDetach(el: BpmnElement, parent: BpmnElement | undefined, changes: ChangeSet): void {
    if (el.is('bpmn:Lane') && parent && parent.is('bpmn:LaneSet')) {
      if (!parent.list('lanes').length) {
        const owner = parent.parent;
        if (owner && owner.is('bpmn:Lane')) {
          owner.set('childLaneSet', undefined);
        } else if (owner) {
          owner.remove('laneSets', parent);
        }
        const lsId = parent.get<string | undefined>('id');
        if (lsId) {
          this.edit.document.ids.registry.release(lsId);
        }
        changes.note(`lane set${lsId ? ` ${lsId}` : ''} removed: no lanes left`);
      }
      return;
    }
    if (el.is('bpmn:DataInputAssociation') && parent) {
      const target = el.get<BpmnElement | undefined>('targetRef');
      if (target && target.is('bpmn:Property') && target.parent === parent && !ElementContainment.referencesToAny(this.edit.document.tree.definitions, new Set([target])).length) {
        parent.remove('properties', target);
        const pid = target.get<string | undefined>('id');
        if (pid) {
          this.edit.document.ids.registry.release(pid);
        }
      }
      return;
    }
    if (el.is('bpmn:DataObjectReference')) {
      const backing = el.get<BpmnElement | undefined>('dataObjectRef');
      if (backing && this.isAttached(backing) && !ElementContainment.referencesToAny(this.edit.document.tree.definitions, new Set([backing])).length) {
        this.cascade(backing, changes);
      }
      return;
    }
    if (el.is('bpmn:DataStoreReference')) {
      const backing = el.get<BpmnElement | undefined>('dataStoreRef');
      if (backing && this.isAttached(backing) && !ElementContainment.referencesToAny(this.edit.document.tree.definitions, new Set([backing])).length) {
        this.cascade(backing, changes);
      }
      return;
    }
    if (el.is('bpmn:Group')) {
      const value = el.get<BpmnElement | undefined>('categoryValueRef');
      if (!value || !this.isAttached(value) || ElementContainment.referencesToAny(this.edit.document.tree.definitions, new Set([value])).some((reference) => reference.holder.is('bpmn:Group'))) {
        return;
      }
      const category = value.parent as BpmnElement;
      this.cascade(value, changes);
      if (category.is('bpmn:Category') && !category.list('categoryValue').length) {
        this.cascade(category, changes);
      }
      return;
    }
    if (el.is('bpmn:Process')) {
      const pid = el.id;
      for (const element of new ElementWalk(this.edit.document.tree.definitions).depthFirst()) {
        if (element.is('bpmn:CallActivity') && element.get<string | undefined>('calledElement') === pid) {
          changes.warn({
            code: 'W_DANGLING_CALLED_ELEMENT',
            message: `${element.id} still calls the removed process ${pid}`,
            element: element.id,
            related: [pid],
            hint: `Set another process with \`bpmn set <file> ${element.id} calledElement=<processId>\` or remove the call activity.`,
          });
        }
      }
    }
  }

  private removeParticipant(participant: BpmnElement, changes: ChangeSet): void {
    const collaboration = participant.parent;
    const process = participant.get<BpmnElement | undefined>('processRef');
    const collaborationIndex = collaboration ? this.edit.document.tree.definitions.list('rootElements').indexOf(collaboration) : -1;
    ElementContainment.detach(participant);
    this.edit.document.ids.registry.release(participant.id);
    changes.remove(ChangeEntries.of(participant));
    this.edit.document.tree.invalidate();
    this.cleanupReferences(new Set([participant]), changes);
    if (process && this.isAttached(process) && !this.edit.document.flows.participants().some((otherParticipant) => otherParticipant.get<BpmnElement | undefined>('processRef') === process)) {
      this.cascade(process, changes);
    }
    if (collaboration && collaboration.is('bpmn:Collaboration') && this.isAttached(collaboration) && !collaboration.list('participants').length) {
      this.cascade(collaboration, changes);
      changes.note(`collaboration ${collaboration.id} removed: no participants left`);
    }
    if (!this.edit.document.flows.participants().length && !this.edit.document.tree.processes().length) {
      this.replaceRemovedLastPool(process ?? participant, Math.max(collaborationIndex, 0), changes);
    }
  }

  private replaceRemovedLastPool(removed: BpmnElement, rootIndex: number, changes: ChangeSet): void {
    const name = removed.get<string | undefined>('name');
    const isExecutable = removed.is('bpmn:Process') && removed.get<boolean | undefined>('isExecutable') === true;
    const id = this.edit.allocator.allocate(IdRequests.typeRequest('bpmn:Process', { ...(name ? { name } : {}), context: '' })).id;
    const replacement = this.edit.document.tree.create('bpmn:Process', { id, ...(name ? { name } : {}), isExecutable });
    this.edit.document.tree.definitions.insert('rootElements', rootIndex, replacement);
    changes.create({ id, kind: 'process', ...(name ? { name } : {}), detail: `empty process: the last pool was removed (${isExecutable ? 'executable' : 'not executable'})` });
    changes.note(`process ${id} created: the last pool was removed, so the file keeps an empty process`);
    this.edit.document.tree.invalidate();
  }

  private cleanupReferences(removed: Set<BpmnElement>, changes: ChangeSet): void {
    for (const { holder, prop, isMany, target } of ElementContainment.referencesToAny(this.edit.document.tree.definitions, removed)) {
      if (!this.isAttached(holder)) {
        continue;
      }
      const targetId = target.id;
      if (holder.type.startsWith('bpmndi:')) {
        const gone = holder.is('bpmndi:BPMNPlane') ? (holder.parent as BpmnElement) : holder;
        ElementContainment.detach(gone);
        for (const element of new ElementWalk(gone).depthFirst({ bpmnOnly: true })) {
          const id = element.id;
          if (id) {
            this.edit.document.ids.registry.release(id);
          }
        }
        continue;
      }
      if (holder.is('bpmn:SequenceFlow') || holder.is('bpmn:MessageFlow') || holder.is('bpmn:Association') || holder.is('bpmn:DataAssociation')) {
        this.cascade(holder, changes);
        continue;
      }
      if (holder.is('bpmn:BoundaryEvent') && prop === 'attachedToRef') {
        this.cascade(holder, changes);
        continue;
      }
      if (holder.is('bpmn:Participant') && prop === 'processRef') {
        holder.set(prop, undefined);
        changes.warn({
          code: 'W_BLACK_BOX',
          message: `Participant ${holder.id} lost its process ${targetId} and is now a black box`,
          element: holder.id,
          related: [targetId],
          hint: 'Remove the participant too, or add a new process for it.',
        });
        continue;
      }
      if (isMany) {
        holder.remove(prop, target);
        if (holder.is('bpmn:Lane')) {
          changes.change(ChangeEntries.of(holder, `member ${targetId} removed`));
        }
        continue;
      }
      holder.set(prop, undefined);
      const owner = ElementContainment.nearestWithId(holder);
      if (owner && prop !== 'default') {
        changes.change(ChangeEntries.of(owner, `${prop} cleared (${targetId} removed)`));
      }
    }
    this.edit.document.tree.invalidate();
  }
}
