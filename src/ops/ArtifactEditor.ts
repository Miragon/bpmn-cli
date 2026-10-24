/**
 * Data objects / stores, text annotations and groups.
 *
 *  Ids follow the file's style (src/ids/IdStyle.ts); the bpmn-cli default is
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
 *  - createGroup(): bpmn:Group (Group_<NameSlug>, unnamed: Group_Around<First
 *    member>) in the artifacts of the innermost sub-process holding every
 *    member, else of the collaboration, else of the members' process (where
 *    bpmn-js looks for it on the plane it is drawn on), with a root
 *    bpmn:Category holding one bpmn:CategoryValue (`value` = the name) the
 *    group references; each member (a flow node, data object or data store
 *    reference)
 *    references the value too (FlowElement.categoryValueRef), so membership
 *    needs no coordinates: the layout draws the box around the members
 *    (diagram/groups.ts). No members: E_USAGE, a wrong one: E_INVALID_VALUE.
 *  - setGroupName(): `set <group> name=` writes the category value's
 *    `value` (a group has no `name`) and sizes the group's label in the
 *    drawing to the new name (diagram/groups.ts relabelGroup).
 */
import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { kindByName, kindLabel } from '../model/kinds.js';
import { ElementLabels } from '../ids/ElementLabels.js';
import { kindRequest, typeRequest, type IdRequest } from '../ids/utils/requests.js';
import { speakingStem } from '../ids/utils/id-words.js';
import { addTo, collaboration, is, type El, idOf } from '../model/utils/moddle.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { relabelGroup } from '../diagram/groups.js';
import { allocateId } from './utils/allocate-id.js';
import { artifactContainerOf, isDataReference } from './utils/artifacts.js';

export class ArtifactEditor {
  constructor(private readonly doc: Doc) {}

  /** Creates a data object (reference + backing bpmn:DataObject) in `scope`; returns the reference. */
  createDataObject(scope: El, opts: { id?: string; name?: string }, cs: ChangeSet): El {
    const doc = this.doc;
    this.assertFlowScope(scope, 'data objects');
    const id = allocateId(doc, this.artifactRequest('dataObject', scope, opts), opts.id);
    const dataObject = doc.create('bpmn:DataObject', { id: doc.allocateId(this.backingRequest('bpmn:DataObject', id, opts.name)).id });
    const ref = doc.create('bpmn:DataObjectReference', { id, ...(opts.name ? { name: opts.name } : {}), dataObjectRef: dataObject });
    addTo(scope, 'flowElements', dataObject, ref);
    cs.create({ id, kind: 'dataObject', ...(opts.name ? { name: opts.name } : {}), detail: `in ${idOf(scope)}` });
    cs.note(`backing dataObject ${idOf(dataObject)} created for ${id}`);
    doc.invalidate();
    return ref;
  }

  /** Creates a data store reference in `scope` plus its root bpmn:DataStore. */
  createDataStore(scope: El, opts: { id?: string; name?: string }, cs: ChangeSet): El {
    const doc = this.doc;
    this.assertFlowScope(scope, 'data stores');
    const id = allocateId(doc, this.artifactRequest('dataStore', scope, opts), opts.id);
    const store = doc.create('bpmn:DataStore', { id: doc.allocateId(this.backingRequest('bpmn:DataStore', id, opts.name)).id, ...(opts.name ? { name: opts.name } : {}) });
    addTo(doc.definitions, 'rootElements', store);
    const ref = doc.create('bpmn:DataStoreReference', { id, ...(opts.name ? { name: opts.name } : {}), dataStoreRef: store });
    addTo(scope, 'flowElements', ref);
    cs.create({ id, kind: 'dataStore', ...(opts.name ? { name: opts.name } : {}), detail: `in ${idOf(scope)}` });
    cs.note(`root dataStore ${idOf(store)} created for ${id}`);
    doc.invalidate();
    return ref;
  }

  /** Creates a text annotation in `scope` (process, sub-process or collaboration). */
  createTextAnnotation(scope: El, opts: { id?: string; name?: string; text?: string }, cs: ChangeSet): El {
    const doc = this.doc;
    if (artifactContainerOf(scope) !== scope) {
      throw modelError('E_INVALID_SCOPE', `${idOf(scope)} is a ${kindLabel(scope)}; text annotations can only be created in a process, sub-process or collaboration`, {
        element: idOf(scope),
      });
    }
    const id = allocateId(doc, this.artifactRequest('textAnnotation', scope, opts), opts.id);
    const annotation = doc.create('bpmn:TextAnnotation', { id, ...(opts.text ? { text: opts.text } : {}) });
    addTo(scope, 'artifacts', annotation);
    cs.create({ id, kind: 'textAnnotation', ...(opts.text ? { name: opts.text } : {}), detail: `in ${idOf(scope)}` });
    doc.invalidate();
    return annotation;
  }

  /** Creates a group around `members` with its category and category value (see the module contract). */
  createGroup(opts: { id?: string; name?: string; members?: string[] }, cs: ChangeSet): El {
    const doc = this.doc;
    if (!opts.members?.length) throw usageError('A group needs --members <id,...>: the elements it is drawn around');
    const members = opts.members.map((id) => doc.require(id));
    const wrong = members.find((m) => !is(m, 'bpmn:FlowNode') && !isDataReference(m));
    if (wrong) {
      throw modelError('E_INVALID_VALUE', `${idOf(wrong)} is a ${kindLabel(wrong)}; group members are flow nodes, data objects and data stores`, { element: idOf(wrong) });
    }
    const around = `Around ${new ElementLabels(members[0]!).label()}`;
    const id = allocateId(doc, kindRequest(kindByName('group')!, opts.name ? { name: opts.name } : { context: around }), opts.id);
    const value = this.createCategoryValue(speakingStem(id) ?? around, opts.name);
    const group = doc.create('bpmn:Group', { id, categoryValueRef: value });
    addTo(this.groupContainer(members), 'artifacts', group);
    for (const member of members) addTo(member, 'categoryValueRef', value);
    cs.create({ id, kind: 'group', ...(opts.name ? { name: opts.name } : {}), detail: `around ${members.map(idOf).join(', ')}` });
    doc.invalidate();
    return group;
  }

  /** `set <group> name=`: the value of its category value (created with its category when it has none; an empty name keeps the value, membership hangs on it). */
  setGroupName(group: El, name: string): void {
    const value = group.get<El | undefined>('categoryValueRef');
    if (value) value.set('value', name || undefined);
    else if (name) group.set('categoryValueRef', this.createCategoryValue(speakingStem(idOf(group)) ?? '', name));
    relabelGroup(this.doc.moddle, this.doc.definitions, group, name);
  }

  /** The id request of a data object / data store / annotation added by `add`: its name, else its text, else `In <scope>`. */
  private artifactRequest(kind: 'dataObject' | 'dataStore' | 'textAnnotation', scope: El, opts: { name?: string; text?: string }): IdRequest {
    return kindRequest(kindByName(kind)!, { ...(opts.name ? { name: opts.name } : {}), context: opts.text?.trim() ? opts.text : new ElementLabels(scope).context('In') });
  }

  private assertFlowScope(scope: El, what: string): void {
    if (!is(scope, 'bpmn:Process') && !is(scope, 'bpmn:SubProcess')) {
      throw modelError('E_INVALID_SCOPE', `${idOf(scope)} is a ${kindLabel(scope)}; ${what} can only be created in a process or sub-process`, {
        element: idOf(scope),
      });
    }
  }

  /**
   * The id request of the element a data reference stands for (bpmn:DataObject,
   * bpmn:DataStore): the reference's name, else its context. The two need
   * distinct speaking ids: where the file's prefix for both is the same (the
   * id would be the reference's own and take `_2`), the element's id also
   * says what it is (`data_invoiceObject`, `Data_InvoiceStore`); where the
   * name's 40 characters leave no room for that word, it goes after the body
   * and the body is cut for it (IdRequest.tailWord:
   * `processDataArtefactItem_lieferung_vollstaendig_object`).
   */
  private backingRequest(type: 'bpmn:DataObject' | 'bpmn:DataStore', refId: string, name: string | undefined): IdRequest {
    const doc = this.doc;
    const context = speakingStem(refId) ?? '';
    const req = typeRequest(type, { ...(name ? { name } : {}), context });
    if (doc.idStyle.derivedBase(req) !== refId) return req;
    const word = type === 'bpmn:DataObject' ? 'Object' : 'Store';
    const worded = typeRequest(type, name ? { name: `${name} ${word}` } : { context: `${context} ${word}` });
    // the word must survive the name's cut too (a name that ends on a filler word loses both: ..._variante, not ..._object)
    const id = doc.idStyle.derivedBase(worded);
    return id !== refId && id.toLowerCase().endsWith(word.toLowerCase()) ? worded : { ...req, tailWord: word };
  }

  /** A root bpmn:Category with one bpmn:CategoryValue for the group `groupId`; returns the value. */
  private createCategoryValue(context: string, name: string | undefined): El {
    const doc = this.doc;
    const request = { ...(name ? { name } : {}), context };
    const value = doc.create('bpmn:CategoryValue', { id: doc.allocateId(typeRequest('bpmn:CategoryValue', request)).id, ...(name ? { value: name } : {}) });
    const category = doc.create('bpmn:Category', { id: doc.allocateId(typeRequest('bpmn:Category', request)).id });
    addTo(category, 'categoryValue', value);
    addTo(doc.definitions, 'rootElements', category);
    return value;
  }

  /**
   * Where a new group goes, so that a modeler finds it on the plane it is drawn
   * on: the innermost sub-process holding every member (a collapsed one has a
   * plane of its own), else the collaboration, else the members' process.
   */
  private groupContainer(members: El[]): El {
    const doc = this.doc;
    const within = (el: El, scope: El): boolean => {
      for (let p = el.$parent as El | undefined; p; p = p.$parent as El | undefined) if (p === scope) return true;
      return false;
    };
    for (let scope = doc.scopeOf(members[0]!); scope && is(scope, 'bpmn:SubProcess'); scope = doc.scopeOf(scope)) if (members.every((m) => within(m, scope!))) return scope;
    return collaboration(doc.definitions) ?? doc.processOf(members[0]!)!;
  }
}
