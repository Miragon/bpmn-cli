/**
 * Data objects / stores, text annotations, associations, data associations.
 *
 *  Ids follow the file's style (src/idstyle.ts); the bpmn-cli default is
 *  given here.
 *  - createDataObject(): bpmn:DataObject (id DataObject_<Slug>) + a
 *    bpmn:DataObjectReference (id DataObjectReference_<Slug>, the element the
 *    AI sees) in the scope; returns the reference.
 *  - createDataStore(): bpmn:DataStoreReference (DataStoreReference_<Slug>)
 *    in the scope; a root bpmn:DataStore (DataStore_<Slug>) is created and
 *    referenced via dataStoreRef.
 *  - createTextAnnotation(): bpmn:TextAnnotation in scope.artifacts with
 *    `text`; id TextAnnotation_<NameSlug> from `name` (the positional name of
 *    `add`), TextAnnotation_<TextSlug> when only `text` was given; an
 *    unnamed data object / store: DataObjectReference_In<Scope>.
 *  - createAssociation(): bpmn:Association (Association_<Source>To<Target>,
 *    the labels of the ends)
 *    in the scope's artifacts between an element and a text annotation
 *    (either direction); also compensation associations (compensate boundary
 *    event -> handler).
 *  - createDataAssociation(): node -> data = bpmn:DataOutputAssociation
 *    (DataOutputAssociation_<Node>To<Data>, targetRef = data) in node.dataOutputAssociations;
 *    data -> node = bpmn:DataInputAssociation (sourceRef=[data], targetRef =
 *    a bpmn:Property "__targetRef_placeholder" on the node, bpmn-js
 *    convention) in node.dataInputAssociations.
 *  - removeDataAssociation() / removeAssociation(): inverse, incl. placeholder
 *    property cleanup when unused.
 */
import type { Doc } from '../document.js';
import { modelError } from '../errors.js';
import { kindByName, kindLabel, triggerOf } from '../kinds.js';
import { contextOf, kindRequest, labelOf, speakingStem, typeRequest, type IdRequest } from '../idstyle.js';
import { addTo, is, many, removeFrom, type El } from '../model.js';
import type { ChangeSet } from '../result.js';

export const PLACEHOLDER_PROPERTY = '__targetRef_placeholder';

function idOf(el: El): string {
  return el.get<string>('id');
}

function allocateId(doc: Doc, req: IdRequest, explicit: string | undefined): string {
  if (explicit) {
    doc.claimId(explicit);
    return explicit;
  }
  return doc.allocateId(req).id;
}

/** The id request of a data object / data store / annotation added by `add`: its name, else its text, else `In <scope>`. */
export function artifactRequest(kind: 'dataObject' | 'dataStore' | 'textAnnotation', scope: El, opts: { name?: string; text?: string }): IdRequest {
  return kindRequest(kindByName(kind)!, { ...(opts.name ? { name: opts.name } : {}), context: opts.text?.trim() ? opts.text : contextOf('In', scope) });
}

/** The context of an element that belongs to another one (`To` between the ends of a connection). */
const between = (source: El, target: El): string => `${labelOf(source)} To ${labelOf(target)}`;

function assertFlowScope(scope: El, what: string): void {
  if (!is(scope, 'bpmn:Process') && !is(scope, 'bpmn:SubProcess')) {
    throw modelError('E_INVALID_SCOPE', `${idOf(scope)} is a ${kindLabel(scope)}; ${what} can only be created in a process or sub-process`, {
      element: idOf(scope),
    });
  }
}

/** True for the elements the AI addresses as "data": data object / data store references. */
export function isDataReference(el: El): boolean {
  return is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference');
}

/* ------------------------------------------------------------------ */
/* data                                                                 */
/* ------------------------------------------------------------------ */

/** Creates a data object (reference + backing bpmn:DataObject) in `scope`; returns the reference. */
export function createDataObject(doc: Doc, scope: El, opts: { id?: string; name?: string }, cs: ChangeSet): El {
  assertFlowScope(scope, 'data objects');
  const id = allocateId(doc, artifactRequest('dataObject', scope, opts), opts.id);
  const dataObject = doc.create('bpmn:DataObject', { id: doc.allocateId(typeRequest('bpmn:DataObject', { ...(opts.name ? { name: opts.name } : {}), context: speakingStem(id) ?? '' })).id });
  const ref = doc.create('bpmn:DataObjectReference', { id, ...(opts.name ? { name: opts.name } : {}), dataObjectRef: dataObject });
  addTo(scope, 'flowElements', dataObject, ref);
  cs.create({ id, kind: 'dataObject', ...(opts.name ? { name: opts.name } : {}), detail: `in ${idOf(scope)}` });
  cs.note(`backing dataObject ${idOf(dataObject)} created for ${id}`);
  doc.invalidate();
  return ref;
}

/** Creates a data store reference in `scope` plus its root bpmn:DataStore. */
export function createDataStore(doc: Doc, scope: El, opts: { id?: string; name?: string }, cs: ChangeSet): El {
  assertFlowScope(scope, 'data stores');
  const id = allocateId(doc, artifactRequest('dataStore', scope, opts), opts.id);
  const store = doc.create('bpmn:DataStore', { id: doc.allocateId(typeRequest('bpmn:DataStore', { ...(opts.name ? { name: opts.name } : {}), context: speakingStem(id) ?? '' })).id, ...(opts.name ? { name: opts.name } : {}) });
  addTo(doc.definitions, 'rootElements', store);
  const ref = doc.create('bpmn:DataStoreReference', { id, ...(opts.name ? { name: opts.name } : {}), dataStoreRef: store });
  addTo(scope, 'flowElements', ref);
  cs.create({ id, kind: 'dataStore', ...(opts.name ? { name: opts.name } : {}), detail: `in ${idOf(scope)}` });
  cs.note(`root dataStore ${idOf(store)} created for ${id}`);
  doc.invalidate();
  return ref;
}

/* ------------------------------------------------------------------ */
/* annotations & associations                                           */
/* ------------------------------------------------------------------ */

/** The nearest ancestor (or the element itself) that owns an `artifacts` collection. */
export function artifactContainerOf(el: El): El | undefined {
  let p: El | undefined = el;
  while (p) {
    if (is(p, 'bpmn:Process') || is(p, 'bpmn:SubProcess') || is(p, 'bpmn:Collaboration')) return p;
    p = p.$parent as El | undefined;
  }
  return undefined;
}

/** Creates a text annotation in `scope` (process, sub-process or collaboration). */
export function createTextAnnotation(doc: Doc, scope: El, opts: { id?: string; name?: string; text?: string }, cs: ChangeSet): El {
  if (artifactContainerOf(scope) !== scope) {
    throw modelError('E_INVALID_SCOPE', `${idOf(scope)} is a ${kindLabel(scope)}; text annotations can only be created in a process, sub-process or collaboration`, {
      element: idOf(scope),
    });
  }
  const id = allocateId(doc, artifactRequest('textAnnotation', scope, opts), opts.id);
  const annotation = doc.create('bpmn:TextAnnotation', { id, ...(opts.text ? { text: opts.text } : {}) });
  addTo(scope, 'artifacts', annotation);
  cs.create({ id, kind: 'textAnnotation', ...(opts.text ? { name: opts.text } : {}), detail: `in ${idOf(scope)}` });
  doc.invalidate();
  return annotation;
}

function isCompensationPair(source: El, target: El): boolean {
  return is(source, 'bpmn:BoundaryEvent') && triggerOf(source) === 'compensate' && is(target, 'bpmn:Activity');
}

/**
 * Creates an association. One endpoint must be a text annotation, or the pair
 * must be a compensation boundary event -> compensation handler activity
 * (associationDirection=One, the handler is marked isForCompensation).
 */
export function createAssociation(doc: Doc, source: El, target: El, opts: { id?: string }, cs: ChangeSet): El {
  const sourceIsNote = is(source, 'bpmn:TextAnnotation');
  const targetIsNote = is(target, 'bpmn:TextAnnotation');
  const compensation = !sourceIsNote && !targetIsNote && isCompensationPair(source, target);
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
  const id = allocateId(doc, typeRequest('bpmn:Association', { context: between(source, target) }), opts.id);
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

/* ------------------------------------------------------------------ */
/* data associations                                                    */
/* ------------------------------------------------------------------ */

function placeholderProperty(doc: Doc, node: El): El {
  const existing = many(node, 'properties').find((p) => p.get<string | undefined>('name') === PLACEHOLDER_PROPERTY);
  if (existing) return existing;
  const property = doc.create('bpmn:Property', { id: doc.allocateId(typeRequest('bpmn:Property', { context: labelOf(node) })).id, name: PLACEHOLDER_PROPERTY });
  addTo(node, 'properties', property);
  return property;
}

function assertDataNode(node: El, direction: 'input' | 'output', data: El): void {
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

/**
 * Creates a data association. node -> data is an output association on the
 * node, data -> node an input association (bpmn-js placeholder convention).
 */
export function createDataAssociation(doc: Doc, source: El, target: El, opts: { id?: string }, cs: ChangeSet): El {
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
    assertDataNode(target, 'input', source);
    const id = allocateId(doc, typeRequest('bpmn:DataInputAssociation', { context: between(source, target) }), opts.id);
    association = doc.create('bpmn:DataInputAssociation', { id, sourceRef: [source], targetRef: placeholderProperty(doc, target) });
    addTo(target, 'dataInputAssociations', association);
  } else {
    assertDataNode(source, 'output', target);
    const id = allocateId(doc, typeRequest('bpmn:DataOutputAssociation', { context: between(source, target) }), opts.id);
    association = doc.create('bpmn:DataOutputAssociation', { id, targetRef: target });
    addTo(source, 'dataOutputAssociations', association);
  }
  cs.create({ id: idOf(association), kind: 'dataAssociation', detail: `${idOf(source)} -> ${idOf(target)}` });
  doc.invalidate();
  return association;
}

/** The [source, target] the AI sees for a data association (node <-> data reference). */
export function dataAssociationEnds(association: El): { source?: El; target?: El } {
  const node = association.$parent as El | undefined;
  if (is(association, 'bpmn:DataInputAssociation')) {
    return { source: many(association, 'sourceRef')[0], target: node };
  }
  return { source: node, target: association.get<El | undefined>('targetRef') };
}

/** Removes an association from its artifacts container and releases its id. */
export function removeAssociation(doc: Doc, association: El): void {
  const container = association.$parent as El | undefined;
  if (container) removeFrom(container, 'artifacts', association);
  doc.ids.release(idOf(association));
  doc.invalidate();
}

/** Removes a data association from its node; the placeholder property goes when unused. */
export function removeDataAssociation(doc: Doc, association: El): void {
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
