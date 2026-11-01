import { type BpmnElement, BpmnError, type ChangeSet, ElementLabels, IdRequests, Kinds, Triggers } from '../../model/index.js';
import { ElementContainment } from '../containers/ElementContainment.js';
import type { EditSession } from '../session/EditSession.js';

export class Associations {
  private static readonly PLACEHOLDER_PROPERTY = '__targetRef_placeholder';

  constructor(private readonly edit: EditSession) {}

  createAssociation(source: BpmnElement, target: BpmnElement, opts: { id?: string }, changes: ChangeSet): BpmnElement {
    const document = this.edit.document;
    const sourceIsNote = source.is('bpmn:TextAnnotation');
    const targetIsNote = target.is('bpmn:TextAnnotation');
    const compensation = !sourceIsNote && !targetIsNote && Associations.isCompensationPair(source, target);
    if (sourceIsNote && targetIsNote) {
      throw BpmnError.model('E_INVALID_ENDPOINT', `Cannot associate two text annotations (${source.id}, ${target.id})`, {
        element: source.id,
        related: [target.id],
        hint: 'Associate a text annotation with a flow node, data element or participant.',
      });
    }
    if (!sourceIsNote && !targetIsNote && !compensation) {
      throw BpmnError.model('E_INVALID_ENDPOINT', `An association needs a text annotation on one side (${source.id} -> ${target.id})`, {
        element: source.id,
        related: [target.id],
        hint: 'Use `connect` with flow nodes for sequence flows, or a compensate boundary event -> activity for compensation.',
      });
    }
    const note = sourceIsNote ? source : target;
    const container = new ElementContainment(note).artifactContainer()!;
    const id = this.edit.allocator.explicitOr(opts.id, IdRequests.typeRequest('bpmn:Association', { context: Associations.contextBetween(source, target) }));
    const association = document.tree.create('bpmn:Association', {
      id,
      sourceRef: source,
      targetRef: target,
      ...(compensation ? { associationDirection: 'One' } : {}),
    });
    container.add('artifacts', association);
    changes.create({ id, kind: 'association', detail: `${source.id} -> ${target.id}` });
    if (compensation && !target.get<boolean | undefined>('isForCompensation')) {
      target.set('isForCompensation', true);
      changes.change({ id: target.id, kind: Kinds.label(target), detail: 'isForCompensation=true (compensation handler)' });
    }
    document.tree.invalidate();
    return association;
  }

  createDataAssociation(source: BpmnElement, target: BpmnElement, opts: { id?: string }, changes: ChangeSet): BpmnElement {
    const document = this.edit.document;
    const sourceIsData = new ElementContainment(source).isDataReference();
    const targetIsData = new ElementContainment(target).isDataReference();
    if (sourceIsData === targetIsData) {
      throw BpmnError.model('E_INVALID_ENDPOINT', `A data association needs a data object/store on exactly one side (${source.id} -> ${target.id})`, {
        element: source.id,
        related: [target.id],
      });
    }
    let association: BpmnElement;
    if (sourceIsData) {
      Associations.assertDataNode(target, 'input', source);
      const id = this.edit.allocator.explicitOr(opts.id, IdRequests.typeRequest('bpmn:DataInputAssociation', { context: Associations.contextBetween(source, target) }));
      association = document.tree.create('bpmn:DataInputAssociation', { id, sourceRef: [source], targetRef: this.placeholderProperty(target) });
      target.add('dataInputAssociations', association);
    } else {
      Associations.assertDataNode(source, 'output', target);
      const id = this.edit.allocator.explicitOr(opts.id, IdRequests.typeRequest('bpmn:DataOutputAssociation', { context: Associations.contextBetween(source, target) }));
      association = document.tree.create('bpmn:DataOutputAssociation', { id, targetRef: target });
      source.add('dataOutputAssociations', association);
    }
    changes.create({ id: association.id, kind: 'dataAssociation', detail: `${source.id} -> ${target.id}` });
    document.tree.invalidate();
    return association;
  }

  removeDataAssociation(association: BpmnElement): void {
    const document = this.edit.document;
    const node = association.parent!;
    if (association.is('bpmn:DataInputAssociation')) {
      node.remove('dataInputAssociations', association);
      const property = association.get<BpmnElement | undefined>('targetRef');
      const stillUsed = node.list('dataInputAssociations').some((inputAssociation) => inputAssociation.get<BpmnElement | undefined>('targetRef') === property);
      if (property && !stillUsed && property.get<string | undefined>('name') === Associations.PLACEHOLDER_PROPERTY) {
        node.remove('properties', property);
        document.ids.registry.release(property.id);
      }
    } else {
      node.remove('dataOutputAssociations', association);
    }
    document.ids.registry.release(association.id);
    document.tree.invalidate();
  }

  private static contextBetween(source: BpmnElement, target: BpmnElement): string {
    return `${new ElementLabels(source).label()} To ${new ElementLabels(target).label()}`;
  }

  static isCompensationPair(source: BpmnElement, target: BpmnElement): boolean {
    return source.is('bpmn:BoundaryEvent') && Triggers.of(source) === 'compensate' && target.is('bpmn:Activity');
  }

  private placeholderProperty(node: BpmnElement): BpmnElement {
    const existing = node.list('properties').find((candidate) => candidate.get<string | undefined>('name') === Associations.PLACEHOLDER_PROPERTY);
    if (existing) {
      return existing;
    }
    const property = this.edit.document.tree.create('bpmn:Property', { id: this.edit.allocator.allocate(IdRequests.typeRequest('bpmn:Property', { context: new ElementLabels(node).label() })).id, name: Associations.PLACEHOLDER_PROPERTY });
    node.add('properties', property);
    return property;
  }

  private static assertDataNode(node: BpmnElement, direction: 'input' | 'output', data: BpmnElement): void {
    const ok = direction === 'input' ? node.is('bpmn:Activity') || node.is('bpmn:ThrowEvent') : node.is('bpmn:Activity') || node.is('bpmn:CatchEvent');
    if (ok) {
      return;
    }
    throw BpmnError.model(
      'E_INVALID_ENDPOINT',
      direction === 'input'
        ? `${node.id} (${Kinds.label(node)}) cannot read ${data.id}: only activities and throw events take data inputs`
        : `${node.id} (${Kinds.label(node)}) cannot write ${data.id}: only activities and catch events produce data outputs`,
      { element: node.id, related: [data.id], hint: 'Connect data objects/stores to tasks, sub-processes or events, not to gateways.' },
    );
  }
}
