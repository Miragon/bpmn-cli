import { type BpmnElement, BpmnError, ChangeEntries, ChangeSet, ElementWalk, IdRequests } from '../model/index.js';
import type { RemoveOperation } from '../operations/index.js';
import { BranchReach } from './containers/BranchReach.js';
import { ElementContainment } from './containers/ElementContainment.js';
import { ReferenceCleanup } from './containers/ReferenceCleanup.js';
import { FlowBridge } from './flows/FlowBridge.js';
import { JoinBridge } from './flows/JoinBridge.js';
import { SequenceFlows } from './flows/SequenceFlows.js';
import { LaneMembership } from './LaneMembership.js';
import type { EditSession } from './session/EditSession.js';

export class ElementRemoval {
  private readonly references: ReferenceCleanup;

  constructor(private readonly edit: EditSession) {
    this.references = new ReferenceCleanup(edit, (element, changes) => this.cascade(element, changes));
  }

  remove(command: RemoveOperation): ChangeSet {
    const changes = new ChangeSet();
    if (command.withBranch && command.bridge) {
      throw BpmnError.usage(`--with-branch removes the node's whole downstream path and bridges nothing: drop ${command.bridge === 'all' ? '--bridge-all' : '--no-bridge'}`);
    }
    if (command.withBranch) {
      this.removeBranches(command, changes);
    } else {
      this.removeListed(command, changes);
    }
    this.edit.document.tree.invalidate();
    return changes;
  }

  private removeBranches(command: RemoveOperation, changes: ChangeSet): void {
    const gone = new Set<string>();
    for (const id of command.ids) {
      if (gone.has(id)) {
        continue;
      }
      if (!this.edit.document.tree.byId(id) && command.ifExists) {
        changes.note(`${id} does not exist; skipped`);
        continue;
      }
      this.removeBranch(id, gone, changes);
    }
  }

  private removeBranch(id: string, gone: Set<string>, changes: ChangeSet): void {
    const branch = new BranchReach(this.edit).branchOf(this.edit.require(id, ['bpmn:FlowNode'], 'flow node'));
    changes.note(
      `branch of ${id}: ${branch.nodes.length} node(s) (${branch.nodes.map((element) => element.id).join(', ')})${branch.stops.length ? `; it stops before ${branch.stops.map((element) => element.id).join(', ')}, which other paths reach (they stay)` : '; it ends there'}`,
    );
    for (const el of branch.nodes) {
      if (gone.has(el.id)) {
        continue;
      }
      new FlowBridge(this.edit, changes).bridgeNode(el, false);
      this.cascade(el, changes);
      ElementRemoval.collectRemoved(changes, gone);
    }
  }

  private removeListed(command: RemoveOperation, changes: ChangeSet): void {
    const bridge = command.bridge !== 'none';
    const bridgeAll = command.bridge === 'all';
    const removing = new Set(command.ids);
    const gone = new Set<string>();
    for (const id of command.ids) {
      if (gone.has(id)) {
        changes.note(`${id} was already removed together with an earlier element`);
        continue;
      }
      const el = this.edit.document.tree.byId(id);
      if (!el) {
        this.skipMissing(id, command, changes);
        continue;
      }
      if (el.is('bpmn:Definitions')) {
        throw BpmnError.model('E_INVALID_REMOVE', 'The definitions element cannot be removed', { element: id, hint: 'Delete the file instead.' });
      }
      if (el.is('bpmn:FlowNode')) {
        new JoinBridge(this.edit, changes).bridgeRemoval(el, bridge, bridgeAll, removing);
      }
      this.cascade(el, changes);
      ElementRemoval.collectRemoved(changes, gone);
    }
  }

  private skipMissing(id: string, command: RemoveOperation, changes: ChangeSet): void {
    if (command.ifExists) {
      changes.note(`${id} does not exist; skipped`);
      return;
    }
    this.edit.require(id);
  }

  private static collectRemoved(changes: ChangeSet, gone: Set<string>): void {
    for (const removal of changes.removed) {
      gone.add(removal.id);
    }
  }

  private static isReportable(el: BpmnElement): boolean {
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
    if (!this.references.isAttached(el)) {
      return;
    }
    if (el.is('bpmn:SequenceFlow')) {
      new SequenceFlows(this.edit).remove(el);
      changes.remove(ChangeEntries.ofFlow(el));
      this.references.clearReferences(new Set([el]), changes);
      return;
    }
    if (el.is('bpmn:Participant')) {
      this.removeParticipant(el, changes);
      return;
    }
    const subtree = [...new ElementWalk(el).depthFirst({ bpmnOnly: true })];
    const removed = new Set(subtree);
    const handover = el.is('bpmn:Lane') ? ElementRemoval.laneHandover(el, subtree) : undefined;
    const parent = new ElementContainment(el).detach();
    this.edit.releaseIdsBelow(el);
    if (el.get<string | undefined>('id')) {
      changes.remove(ElementRemoval.removedEntry(el));
    }
    for (const element of subtree) {
      if (element !== el && ElementRemoval.isReportable(element)) {
        changes.remove(ElementRemoval.removedEntry(element));
      }
    }
    this.edit.document.tree.invalidate();
    this.references.afterDetach(el, parent, changes);
    if (handover) {
      this.handOver(el, handover, changes);
    }
    this.references.clearReferences(removed, changes);
    this.edit.document.tree.invalidate();
  }

  private static laneHandover(lane: BpmnElement, subtree: BpmnElement[]): { heir: BpmnElement; members: BpmnElement[] } | undefined {
    const laneSet = lane.parent!;
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
    for (const node of members) {
      lanes.assign(node, heir, changes);
    }
    changes.note(`${members.length} member(s) of ${lane.id} moved to ${heir.id}`);
  }

  private removeParticipant(participant: BpmnElement, changes: ChangeSet): void {
    const collaboration = participant.parent!;
    const process = participant.get<BpmnElement | undefined>('processRef');
    const collaborationIndex = this.edit.document.tree.definitions.list('rootElements').indexOf(collaboration);
    new ElementContainment(participant).detach();
    this.edit.document.ids.registry.release(participant.id);
    changes.remove(ChangeEntries.of(participant));
    this.edit.document.tree.invalidate();
    this.references.clearReferences(new Set([participant]), changes);
    if (process && this.references.isAttached(process) && !this.edit.document.flows.participants().some((otherParticipant) => otherParticipant.get<BpmnElement | undefined>('processRef') === process)) {
      this.cascade(process, changes);
    }
    if (!collaboration.list('participants').length) {
      this.cascade(collaboration, changes);
      changes.note(`collaboration ${collaboration.id} removed: no participants left`);
    }
    if (!this.edit.document.flows.participants().length && !this.edit.document.tree.processes().length) {
      this.replaceRemovedLastPool(process ?? participant, collaborationIndex, changes);
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
}
