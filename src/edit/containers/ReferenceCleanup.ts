import { type BpmnElement, ChangeEntries, type ChangeSet, ElementWalk } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { ElementContainment, type ElementReference } from './ElementContainment.js';

type Cascade = (element: BpmnElement, changes: ChangeSet) => void;

export class ReferenceCleanup {
  constructor(
    private readonly edit: EditSession,
    private readonly cascade: Cascade,
  ) {}

  releaseIds(elements: readonly BpmnElement[]): void {
    for (const element of elements) {
      const id = element.get<string | undefined>('id');
      if (id) {
        this.edit.document.ids.registry.release(id);
      }
    }
  }

  isAttached(el: BpmnElement): boolean {
    return new ElementContainment(el).isAttachedTo(this.edit.document.tree.definitions);
  }

  afterDetach(el: BpmnElement, parent: BpmnElement | undefined, changes: ChangeSet): void {
    if (el.is('bpmn:Lane') && parent && parent.is('bpmn:LaneSet')) {
      this.dropEmptyLaneSet(parent, changes);
      return;
    }
    if (el.is('bpmn:DataInputAssociation') && parent) {
      this.dropUnusedTargetProperty(el, parent);
      return;
    }
    if (el.is('bpmn:DataObjectReference')) {
      this.dropUnusedBacking(el.get<BpmnElement | undefined>('dataObjectRef'), changes);
      return;
    }
    if (el.is('bpmn:DataStoreReference')) {
      this.dropUnusedBacking(el.get<BpmnElement | undefined>('dataStoreRef'), changes);
      return;
    }
    if (el.is('bpmn:Group')) {
      this.dropUnusedCategoryValue(el, changes);
      return;
    }
    if (el.is('bpmn:Process')) {
      this.warnDanglingCalls(el.id, changes);
    }
  }

  clearReferences(removed: Set<BpmnElement>, changes: ChangeSet): void {
    for (const reference of new ElementContainment(this.edit.document.tree.definitions).referencesToAny(removed)) {
      if (this.isAttached(reference.holder)) {
        this.clearReference(reference, changes);
      }
    }
    this.edit.document.tree.invalidate();
  }

  private referencesTo(target: BpmnElement): ElementReference[] {
    return new ElementContainment(this.edit.document.tree.definitions).referencesToAny(new Set([target]));
  }

  private dropEmptyLaneSet(laneSet: BpmnElement, changes: ChangeSet): void {
    if (laneSet.list('lanes').length) {
      return;
    }
    new ElementContainment(laneSet).detach();
    this.releaseIds([laneSet]);
    const lsId = laneSet.get<string | undefined>('id');
    changes.note(`lane set${lsId ? ` ${lsId}` : ''} removed: no lanes left`);
  }

  private dropUnusedTargetProperty(association: BpmnElement, parent: BpmnElement): void {
    const target = association.get<BpmnElement | undefined>('targetRef');
    if (!target || !target.is('bpmn:Property') || target.parent !== parent || this.referencesTo(target).length) {
      return;
    }
    parent.remove('properties', target);
    this.releaseIds([target]);
  }

  private dropUnusedBacking(backing: BpmnElement | undefined, changes: ChangeSet): void {
    if (backing && this.isAttached(backing) && !this.referencesTo(backing).length) {
      this.cascade(backing, changes);
    }
  }

  private dropUnusedCategoryValue(group: BpmnElement, changes: ChangeSet): void {
    const value = group.get<BpmnElement | undefined>('categoryValueRef');
    if (!value || !this.isAttached(value) || this.referencesTo(value).some((reference) => reference.holder.is('bpmn:Group'))) {
      return;
    }
    const category = value.parent!;
    this.cascade(value, changes);
    if (!category.list('categoryValue').length) {
      this.cascade(category, changes);
    }
  }

  private warnDanglingCalls(processId: string, changes: ChangeSet): void {
    for (const element of new ElementWalk(this.edit.document.tree.definitions).depthFirst()) {
      if (element.is('bpmn:CallActivity') && element.get<string | undefined>('calledElement') === processId) {
        changes.warn({
          code: 'W_DANGLING_CALLED_ELEMENT',
          message: `${element.id} still calls the removed process ${processId}`,
          element: element.id,
          related: [processId],
          hint: `Set another process with \`bpmn set <file> ${element.id} calledElement=<processId>\` or remove the call activity.`,
        });
      }
    }
  }

  private clearReference(reference: ElementReference, changes: ChangeSet): void {
    const { holder, prop, isMany } = reference;
    if (holder.type.startsWith('bpmndi:')) {
      this.dropDiagramHolder(holder);
      return;
    }
    if (ReferenceCleanup.fallsWithTarget(holder, prop)) {
      this.cascade(holder, changes);
      return;
    }
    if (holder.is('bpmn:Participant') && prop === 'processRef') {
      ReferenceCleanup.makeBlackBox(reference, changes);
      return;
    }
    if (isMany) {
      ReferenceCleanup.removeEntry(reference, changes);
      return;
    }
    ReferenceCleanup.clearSingle(reference, changes);
  }

  private static fallsWithTarget(holder: BpmnElement, prop: string): boolean {
    return holder.is('bpmn:SequenceFlow') || holder.is('bpmn:MessageFlow') || holder.is('bpmn:Association') || holder.is('bpmn:DataAssociation') || (holder.is('bpmn:BoundaryEvent') && prop === 'attachedToRef');
  }

  private dropDiagramHolder(holder: BpmnElement): void {
    const gone = holder.is('bpmndi:BPMNPlane') ? (holder.parent as BpmnElement) : holder;
    new ElementContainment(gone).detach();
    this.releaseIds([...new ElementWalk(gone).depthFirst({ bpmnOnly: true })]);
  }

  private static makeBlackBox({ holder, prop, target }: ElementReference, changes: ChangeSet): void {
    holder.set(prop, undefined);
    changes.warn({
      code: 'W_BLACK_BOX',
      message: `Participant ${holder.id} lost its process ${target.id} and is now a black box`,
      element: holder.id,
      related: [target.id],
      hint: 'Remove the participant too, or add a new process for it.',
    });
  }

  private static removeEntry({ holder, prop, target }: ElementReference, changes: ChangeSet): void {
    holder.remove(prop, target);
    if (holder.is('bpmn:Lane')) {
      changes.change(ChangeEntries.of(holder, `member ${target.id} removed`));
    }
  }

  private static clearSingle({ holder, prop, target }: ElementReference, changes: ChangeSet): void {
    holder.set(prop, undefined);
    const owner = new ElementContainment(holder).nearestWithId();
    if (owner && prop !== 'default') {
      changes.change(ChangeEntries.of(owner, `${prop} cleared (${target.id} removed)`));
    }
  }
}
