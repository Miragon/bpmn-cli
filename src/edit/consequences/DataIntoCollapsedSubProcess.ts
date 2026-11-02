import { type BpmnElement, type ChangeSet, DataAssociationEnds, ElementWalk, type HiddenEnd } from '../../model/index.js';
import { Associations } from '../flows/Associations.js';
import type { EditSession } from '../session/EditSession.js';
import { EditConsequence } from './EditConsequence.js';

export interface ElementDeletion {
  cascade(element: BpmnElement, changes: ChangeSet): void;
}

/**
 * A data association cannot be drawn when one of its ends sits inside a collapsed sub-process and the other outside.
 * After any operation that causes this (collapse, move, add), it hangs the association on the sub-process, merges it
 * into one the sub-process already has, or warns when the data itself is the hidden end.
 * A sub-process the batch collapses counts as new, so collapsing it again repairs a file that was collapsed before.
 */
export class DataIntoCollapsedSubProcess extends EditConsequence<BpmnElement> {
  constructor(
    private readonly edit: EditSession,
    private readonly deletion: ElementDeletion,
  ) {
    super();
  }

  findProblems(): Set<BpmnElement> {
    const definitions = this.edit.document.tree.definitions;
    const dataAssociations = [...new ElementWalk(definitions).depthFirst({ bpmnOnly: true })].filter((element) => element.is('bpmn:DataAssociation'));
    return new Set(dataAssociations.filter((association) => this.hiddenEndOf(association)));
  }

  repair(association: BpmnElement, changes: ChangeSet): void {
    const hidden = this.hiddenEndOf(association);
    const { node, data } = new DataAssociationEnds(association);
    if (!hidden || !node || !data) {
      return;
    }
    if (hidden.end === data) {
      DataIntoCollapsedSubProcess.warnDataHidden(hidden.subProcess, association, data, changes);
      return;
    }
    if (DataIntoCollapsedSubProcess.alreadyLinked(hidden.subProcess, association, data)) {
      this.deletion.cascade(association, changes);
      changes.note(`${association.id} removed: the collapsed ${hidden.subProcess.id} already ${association.is('bpmn:DataInputAssociation') ? 'reads' : 'writes'} ${data.id}`);
      return;
    }
    this.moveOnto(hidden.subProcess, association, node);
    this.edit.document.tree.invalidate();
    changes.change({ id: association.id, kind: 'dataAssociation', detail: `moved from ${node.id} to ${hidden.subProcess.id}` });
    changes.note(`${association.id} moved from ${node.id} to the collapsed ${hidden.subProcess.id}`);
  }

  protected override isCausedByBatch(association: BpmnElement, problemsAtStart: ReadonlySet<BpmnElement>): boolean {
    const hidden = this.hiddenEndOf(association);
    const collapsedByBatch = !!hidden && this.edit.expansionOf(hidden.subProcess) === 'collapsed by batch';
    return collapsedByBatch || super.isCausedByBatch(association, problemsAtStart);
  }

  private hiddenEndOf(association: BpmnElement): HiddenEnd | undefined {
    return new DataAssociationEnds(association).hiddenEnd((subProcess) => this.edit.expansionOf(subProcess) !== 'expanded');
  }

  private static warnDataHidden(subProcess: BpmnElement, association: BpmnElement, data: BpmnElement, changes: ChangeSet): void {
    changes.warn({
      code: 'W_DATA_IN_COLLAPSED',
      message: `${association.id} reaches ${data.id} inside the collapsed ${subProcess.id} and stays undrawn`,
      element: association.id,
      related: [data.id, subProcess.id],
      hint: `Move ${data.id} out of ${subProcess.id}, or keep ${subProcess.id} expanded.`,
    });
  }

  private static alreadyLinked(subProcess: BpmnElement, association: BpmnElement, data: BpmnElement): boolean {
    if (association.is('bpmn:DataInputAssociation')) {
      return subProcess.list('dataInputAssociations').some((existing) => existing.list('sourceRef').includes(data));
    }
    return subProcess.list('dataOutputAssociations').some((existing) => existing.get('targetRef') === data);
  }

  private moveOnto(subProcess: BpmnElement, association: BpmnElement, node: BpmnElement): void {
    if (association.is('bpmn:DataOutputAssociation')) {
      node.remove('dataOutputAssociations', association);
      subProcess.add('dataOutputAssociations', association);
      return;
    }
    node.remove('dataInputAssociations', association);
    this.dropUnusedPlaceholder(node, association.get<BpmnElement | undefined>('targetRef'));
    association.set('targetRef', new Associations(this.edit).placeholderProperty(subProcess));
    subProcess.add('dataInputAssociations', association);
  }

  private dropUnusedPlaceholder(node: BpmnElement, placeholder: BpmnElement | undefined): void {
    if (!placeholder?.is('bpmn:Property') || placeholder.parent !== node || node.list('dataInputAssociations').some((other) => other.get('targetRef') === placeholder)) {
      return;
    }
    node.remove('properties', placeholder);
    this.edit.releaseIdsBelow(placeholder);
  }
}
