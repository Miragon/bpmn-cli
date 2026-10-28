import type { EditSession } from '../../document/EditSession.js';
import { modelError } from '../../document/utils/errors.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { kindLabel, triggerOf } from '../../document/Kinds.js';
import { addTo, is, many, type El, idOf, removeFrom } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { artifactContainerOf, isDataReference } from '../utils/artifacts.js';
import { typeRequest } from '../../document/utils/requests.js';

/** @internal */
export const PLACEHOLDER_PROPERTY = '__targetRef_placeholder';

/**
 * Creates and removes associations and data associations.
 * A data input association targets a placeholder bpmn:Property on the node (bpmn-js convention).
 */
export class Associations {
  constructor(private readonly edit: EditSession) {}

  /**
   * One end must be a text annotation, or the pair is a compensate boundary event ->
   * compensation handler (associationDirection=One, the handler gets isForCompensation).
   */
  createAssociation(source: El, target: El, opts: { id?: string }, changes: ChangeSet): El {
    const doc = this.edit.doc;
    const sourceIsNote = is(source, 'bpmn:TextAnnotation');
    const targetIsNote = is(target, 'bpmn:TextAnnotation');
    const compensation = !sourceIsNote && !targetIsNote && Associations.isCompensationPair(source, target);
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
    const id = this.edit.allocator.explicitOr(opts.id, typeRequest('bpmn:Association', { context: Associations.between(source, target) }));
    const association = doc.create('bpmn:Association', {
      id,
      sourceRef: source,
      targetRef: target,
      ...(compensation ? { associationDirection: 'One' } : {}),
    });
    addTo(container, 'artifacts', association);
    changes.create({ id, kind: 'association', detail: `${idOf(source)} -> ${idOf(target)}` });
    if (compensation && !target.get<boolean | undefined>('isForCompensation')) {
      target.set('isForCompensation', true);
      changes.change({ id: idOf(target), kind: kindLabel(target), detail: 'isForCompensation=true (compensation handler)' });
    }
    doc.invalidate();
    return association;
  }

  createDataAssociation(source: El, target: El, opts: { id?: string }, changes: ChangeSet): El {
    const doc = this.edit.doc;
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
      Associations.assertDataNode(target, 'input', source);
      const id = this.edit.allocator.explicitOr(opts.id, typeRequest('bpmn:DataInputAssociation', { context: Associations.between(source, target) }));
      association = doc.create('bpmn:DataInputAssociation', { id, sourceRef: [source], targetRef: this.placeholderProperty(target) });
      addTo(target, 'dataInputAssociations', association);
    } else {
      Associations.assertDataNode(source, 'output', target);
      const id = this.edit.allocator.explicitOr(opts.id, typeRequest('bpmn:DataOutputAssociation', { context: Associations.between(source, target) }));
      association = doc.create('bpmn:DataOutputAssociation', { id, targetRef: target });
      addTo(source, 'dataOutputAssociations', association);
    }
    changes.create({ id: idOf(association), kind: 'dataAssociation', detail: `${idOf(source)} -> ${idOf(target)}` });
    doc.invalidate();
    return association;
  }

  /** @internal */
  removeDataAssociation(association: El): void {
    const doc = this.edit.doc;
    const node = association.$parent as El | undefined;
    if (node) {
      if (is(association, 'bpmn:DataInputAssociation')) {
        removeFrom(node, 'dataInputAssociations', association);
        const property = association.get<El | undefined>('targetRef');
        const stillUsed = many(node, 'dataInputAssociations').some((inputAssociation) => inputAssociation.get<El | undefined>('targetRef') === property);
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

  private static between(source: El, target: El): string {
    return `${new ElementLabels(source).label()} To ${new ElementLabels(target).label()}`;
  }

  private static isCompensationPair(source: El, target: El): boolean {
    return is(source, 'bpmn:BoundaryEvent') && triggerOf(source) === 'compensate' && is(target, 'bpmn:Activity');
  }

  private placeholderProperty(node: El): El {
    const existing = many(node, 'properties').find((candidate) => candidate.get<string | undefined>('name') === PLACEHOLDER_PROPERTY);
    if (existing) return existing;
    const property = this.edit.doc.create('bpmn:Property', { id: this.edit.allocator.allocate(typeRequest('bpmn:Property', { context: new ElementLabels(node).label() })).id, name: PLACEHOLDER_PROPERTY });
    addTo(node, 'properties', property);
    return property;
  }

  private static assertDataNode(node: El, direction: 'input' | 'output', data: El): void {
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
