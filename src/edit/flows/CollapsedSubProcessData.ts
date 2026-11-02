import { type BpmnElement, BpmnError, type ChangeSet, DataAssociationEnds, ElementWalk } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { Associations } from './Associations.js';

interface CrossingAssociation {
  association: BpmnElement;
  inner: BpmnElement;
  data: BpmnElement;
}

type Merge = (association: BpmnElement, changes: ChangeSet) => void;

export class CollapsedSubProcessData {
  constructor(private readonly edit: EditSession) {}

  private dataAssociations(): BpmnElement[] {
    return [...new ElementWalk(this.edit.document.tree.definitions).depthFirst({ bpmnOnly: true })].filter((element) => element.is('bpmn:DataAssociation'));
  }

  assertConnectable(source: BpmnElement, target: BpmnElement): void {
    for (const [end, other] of [[source, target], [target, source]] as const) {
      const hiding = DataAssociationEnds.collapsedAround(end, other, (subProcess) => this.edit.isCollapsed(subProcess));
      if (hiding) {
        throw BpmnError.model('E_INVALID_ENDPOINT', `${end.id} is inside the collapsed ${hiding.id}; its data association could not be drawn`, {
          element: end.id,
          related: [hiding.id, other.id],
          hint: `Connect ${other.id} to ${hiding.id} instead, or expand it first: \`bpmn set <file> ${hiding.id} expanded=true\`.`,
        });
      }
    }
  }

  attachToCollapsed(subProcess: BpmnElement, changes: ChangeSet, merge: Merge): void {
    for (const association of this.dataAssociations()) {
      const ends = new DataAssociationEnds(association);
      const { node: inner, data } = ends;
      if (!inner || !data) {
        continue;
      }
      if (DataAssociationEnds.isInside(inner, subProcess) && !DataAssociationEnds.isInside(data, subProcess)) {
        this.attach(subProcess, { association, inner, data }, changes, merge);
      } else if (DataAssociationEnds.isInside(data, subProcess) && !DataAssociationEnds.isInside(inner, subProcess)) {
        CollapsedSubProcessData.warnDataHidden(subProcess, association, data, changes);
      }
    }
    this.edit.document.tree.invalidate();
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

  private attach(subProcess: BpmnElement, crossing: CrossingAssociation, changes: ChangeSet, merge: Merge): void {
    const { association, inner, data } = crossing;
    if (this.alreadyLinked(subProcess, crossing)) {
      merge(association, changes);
      changes.note(`${association.id} removed: the collapsed ${subProcess.id} already ${association.is('bpmn:DataInputAssociation') ? 'reads' : 'writes'} ${data.id}`);
      return;
    }
    this.moveOnto(subProcess, crossing);
    changes.change({ id: association.id, kind: 'dataAssociation', detail: `moved from ${inner.id} to ${subProcess.id}` });
    changes.note(`${association.id} moved from ${inner.id} to the collapsed ${subProcess.id}`);
  }

  private alreadyLinked(subProcess: BpmnElement, { association, data }: CrossingAssociation): boolean {
    if (association.is('bpmn:DataInputAssociation')) {
      return subProcess.list('dataInputAssociations').some((existing) => existing.list('sourceRef').includes(data));
    }
    return subProcess.list('dataOutputAssociations').some((existing) => existing.get('targetRef') === data);
  }

  private moveOnto(subProcess: BpmnElement, { association, inner }: CrossingAssociation): void {
    if (association.is('bpmn:DataOutputAssociation')) {
      inner.remove('dataOutputAssociations', association);
      subProcess.add('dataOutputAssociations', association);
      return;
    }
    inner.remove('dataInputAssociations', association);
    this.dropUnusedPlaceholder(inner, association.get<BpmnElement | undefined>('targetRef'));
    association.set('targetRef', new Associations(this.edit).placeholderProperty(subProcess));
    subProcess.add('dataInputAssociations', association);
  }

  private dropUnusedPlaceholder(inner: BpmnElement, placeholder: BpmnElement | undefined): void {
    if (!placeholder?.is('bpmn:Property') || placeholder.parent !== inner || inner.list('dataInputAssociations').some((other) => other.get('targetRef') === placeholder)) {
      return;
    }
    inner.remove('properties', placeholder);
    this.edit.releaseIdsBelow(placeholder);
  }
}
