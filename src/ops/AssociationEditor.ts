import type { Doc } from '../model/Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { kindLabel, triggerOf } from '../model/utils/kinds.js';
import { ElementLabels } from '../ids/ElementLabels.js';
import { typeRequest } from '../ids/utils/requests.js';
import { addTo, is, many, removeFrom, type El, idOf } from '../model/utils/moddle.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { allocateId } from './utils/allocate-id.js';
import { artifactContainerOf, isDataReference } from './utils/artifacts.js';

export const PLACEHOLDER_PROPERTY = '__targetRef_placeholder';

/**
 * Creates and removes associations and data associations.
 * A data input association targets a placeholder bpmn:Property on the node (bpmn-js convention).
 */
export class AssociationEditor {
  constructor(private readonly doc: Doc) {}

  /**
   * One end must be a text annotation, or the pair is a compensate boundary event ->
   * compensation handler (associationDirection=One, the handler gets isForCompensation).
   */
  createAssociation(source: El, target: El, opts: { id?: string }, cs: ChangeSet): El {
    const doc = this.doc;
    const sourceIsNote = is(source, 'bpmn:TextAnnotation');
    const targetIsNote = is(target, 'bpmn:TextAnnotation');
    const compensation = !sourceIsNote && !targetIsNote && this.isCompensationPair(source, target);
    if (sourceIsNote && targetIsNote) {
      throw modelError('E_INVALID_ENDPOINT', `Cannot associate two text annotations (${idOf(source)}, ${idOf(target)})`, {
        element: idOf(source),
        related: [idOf(target)],
        hint: 'Associate a text annotation with a flow node, data element or participant.',
      });
    }
    if (!sourceIsNote && !targetIsNote && !compensation) {
      throw modelError('E_INVALID_ENDPOINT', `An association needs a text annotation on one side (${idOf(source)} -> ${idOf(target)})`, {
        element: idOf(source),
        related: [idOf(target)],
        hint: 'Use `connect` with flow nodes for sequence flows, or a compensate boundary event -> activity for compensation.',
      });
    }
    const note = sourceIsNote ? source : target;
    const container = artifactContainerOf(note) ?? artifactContainerOf(sourceIsNote ? target : source);
    if (!container) {
      throw modelError('E_INVALID_SCOPE', `Cannot find a process or collaboration to hold the association of ${idOf(note)}`, { element: idOf(note) });
    }
    const id = allocateId(doc, typeRequest('bpmn:Association', { context: this.between(source, target) }), opts.id);
    const association = doc.create('bpmn:Association', {
      id,
      sourceRef: source,
      targetRef: target,
      ...(compensation ? { associationDirection: 'One' } : {}),
    });
    addTo(container, 'artifacts', association);
    cs.create({ id, kind: 'association', detail: `${idOf(source)} -> ${idOf(target)}` });
    if (compensation && !target.get<boolean | undefined>('isForCompensation')) {
      target.set('isForCompensation', true);
      cs.change({ id: idOf(target), kind: kindLabel(target), detail: 'isForCompensation=true (compensation handler)' });
    }
    doc.invalidate();
    return association;
  }

  createDataAssociation(source: El, target: El, opts: { id?: string }, cs: ChangeSet): El {
    const doc = this.doc;
    const sourceIsData = isDataReference(source);
    const targetIsData = isDataReference(target);
    if (sourceIsData === targetIsData) {
      throw modelError('E_INVALID_ENDPOINT', `A data association needs a data object/store on exactly one side (${idOf(source)} -> ${idOf(target)})`, {
        element: idOf(source),
        related: [idOf(target)],
      });
    }
    let association: El;
    if (sourceIsData) {
      this.assertDataNode(target, 'input', source);
      const id = allocateId(doc, typeRequest('bpmn:DataInputAssociation', { context: this.between(source, target) }), opts.id);
      association = doc.create('bpmn:DataInputAssociation', { id, sourceRef: [source], targetRef: this.placeholderProperty(target) });
      addTo(target, 'dataInputAssociations', association);
    } else {
      this.assertDataNode(source, 'output', target);
      const id = allocateId(doc, typeRequest('bpmn:DataOutputAssociation', { context: this.between(source, target) }), opts.id);
      association = doc.create('bpmn:DataOutputAssociation', { id, targetRef: target });
      addTo(source, 'dataOutputAssociations', association);
    }
    cs.create({ id: idOf(association), kind: 'dataAssociation', detail: `${idOf(source)} -> ${idOf(target)}` });
    doc.invalidate();
    return association;
  }

  dataAssociationEnds(association: El): { source?: El; target?: El } {
    const node = association.$parent as El | undefined;
    if (is(association, 'bpmn:DataInputAssociation')) {
      return { source: many(association, 'sourceRef')[0], target: node };
    }
    return { source: node, target: association.get<El | undefined>('targetRef') };
  }

  removeAssociation(association: El): void {
    const container = association.$parent as El | undefined;
    if (container) removeFrom(container, 'artifacts', association);
    this.doc.ids.release(idOf(association));
    this.doc.invalidate();
  }

  removeDataAssociation(association: El): void {
    const doc = this.doc;
    const node = association.$parent as El | undefined;
    if (node) {
      if (is(association, 'bpmn:DataInputAssociation')) {
        removeFrom(node, 'dataInputAssociations', association);
        const property = association.get<El | undefined>('targetRef');
        const stillUsed = many(node, 'dataInputAssociations').some((a) => a.get<El | undefined>('targetRef') === property);
        if (property && !stillUsed && property.get<string | undefined>('name') === PLACEHOLDER_PROPERTY) {
          removeFrom(node, 'properties', property);
          doc.ids.release(idOf(property));
        }
      } else {
        removeFrom(node, 'dataOutputAssociations', association);
      }
    }
    doc.ids.release(idOf(association));
    doc.invalidate();
  }

  private between(source: El, target: El): string {
    return `${new ElementLabels(source).label()} To ${new ElementLabels(target).label()}`;
  }

  private isCompensationPair(source: El, target: El): boolean {
    return is(source, 'bpmn:BoundaryEvent') && triggerOf(source) === 'compensate' && is(target, 'bpmn:Activity');
  }

  private placeholderProperty(node: El): El {
    const existing = many(node, 'properties').find((p) => p.get<string | undefined>('name') === PLACEHOLDER_PROPERTY);
    if (existing) return existing;
    const property = this.doc.create('bpmn:Property', { id: this.doc.allocateId(typeRequest('bpmn:Property', { context: new ElementLabels(node).label() })).id, name: PLACEHOLDER_PROPERTY });
    addTo(node, 'properties', property);
    return property;
  }

  private assertDataNode(node: El, direction: 'input' | 'output', data: El): void {
    const ok = direction === 'input' ? is(node, 'bpmn:Activity') || is(node, 'bpmn:ThrowEvent') : is(node, 'bpmn:Activity') || is(node, 'bpmn:CatchEvent');
    if (ok) return;
    throw modelError(
      'E_INVALID_ENDPOINT',
      direction === 'input'
        ? `${idOf(node)} (${kindLabel(node)}) cannot read ${idOf(data)}: only activities and throw events take data inputs`
        : `${idOf(node)} (${kindLabel(node)}) cannot write ${idOf(data)}: only activities and catch events produce data outputs`,
      { element: idOf(node), related: [idOf(data)], hint: 'Connect data objects/stores to tasks, sub-processes or events, not to gateways.' },
    );
  }
}
