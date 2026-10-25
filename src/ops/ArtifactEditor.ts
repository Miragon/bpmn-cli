import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { kindByName, kindLabel } from '../model/utils/kinds.js';
import { ElementLabels } from '../ids/ElementLabels.js';
import { kindRequest, typeRequest, type IdRequest } from '../ids/utils/requests.js';
import { speakingStem } from '../ids/utils/id-words.js';
import { addTo, collaboration, is, type El, idOf } from '../model/utils/moddle.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { Groups } from '../drawing/Groups.js';
import { allocateId } from './utils/allocate-id.js';
import { artifactContainerOf, isDataReference } from './utils/artifacts.js';

/**
 * Creates data objects, data stores, text annotations and groups.
 * Group members share the group's bpmn:CategoryValue, so membership needs no coordinates.
 */
export class ArtifactEditor {
  constructor(private readonly doc: Doc) {}

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

  /**
   * A group has no `name`: its name is its category value's `value`. An empty name keeps
   * the value, because membership hangs on it.
   */
  setGroupName(group: El, name: string): void {
    const value = group.get<El | undefined>('categoryValueRef');
    if (value) value.set('value', name || undefined);
    else if (name) group.set('categoryValueRef', this.createCategoryValue(speakingStem(idOf(group)) ?? '', name));
    new Groups(this.doc.definitions).relabel(this.doc.moddle, group, name);
  }

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
   * Where the file's id prefix is the same for reference and backing element, the
   * backing id gets `Object` / `Store` (as a tail word when the name gets cut).
   */
  private backingRequest(type: 'bpmn:DataObject' | 'bpmn:DataStore', refId: string, name: string | undefined): IdRequest {
    const doc = this.doc;
    const context = speakingStem(refId) ?? '';
    const req = typeRequest(type, { ...(name ? { name } : {}), context });
    if (doc.idStyle.derivedBase(req) !== refId) return req;
    const word = type === 'bpmn:DataObject' ? 'Object' : 'Store';
    const worded = typeRequest(type, name ? { name: `${name} ${word}` } : { context: `${context} ${word}` });
    const id = doc.idStyle.derivedBase(worded);
    return id !== refId && id.toLowerCase().endsWith(word.toLowerCase()) ? worded : { ...req, tailWord: word };
  }

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
   * A modeler finds a group only on the plane it is drawn on: the innermost sub-process
   * holding every member, else the collaboration, else the members' process.
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
