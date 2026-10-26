import type { Doc } from '../document/Doc.js';
import type { EditContext } from '../document/EditContext.js';
import { modelError, usageError } from '../document/utils/errors.js';
import { kindByName, kindLabel } from '../document/utils/kinds.js';
import { ElementLabels } from '../document/ids/ElementLabels.js';
import { kindRequest, typeRequest, type IdRequest } from '../document/utils/requests.js';
import { speakingStem } from '../document/utils/id-words.js';
import { addTo, collaboration, is, type El, idOf } from '../document/utils/moddle.js';
import type { ChangeSet } from '../document/ChangeSet.js';
import { Groups } from '../diagram/di/Groups.js';
import { allocateId } from './utils/allocate-id.js';
import { artifactContainerOf, isDataReference } from './utils/artifacts.js';

/**
 * Creates data objects, data stores, text annotations and groups.
 * Group members share the group's bpmn:CategoryValue, so membership needs no coordinates.
 */
export class ArtifactService {
  constructor(
    private readonly doc: Doc,
    private readonly edit: EditContext,
  ) {}

  createDataObject(scope: El, opts: { id?: string; name?: string }, cs: ChangeSet): El {
    const doc = this.doc;
    this.assertFlowScope(scope, 'data objects');
    const id = allocateId(this.edit, this.artifactRequest('dataObject', scope, opts), opts.id);
    const dataObject = doc.create('bpmn:DataObject', { id: this.edit.allocator.allocate(this.backingRequest('bpmn:DataObject', id, opts.name)).id });
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
    const id = allocateId(this.edit, this.artifactRequest('dataStore', scope, opts), opts.id);
    const store = doc.create('bpmn:DataStore', { id: this.edit.allocator.allocate(this.backingRequest('bpmn:DataStore', id, opts.name)).id, ...(opts.name ? { name: opts.name } : {}) });
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
    const id = allocateId(this.edit, this.artifactRequest('textAnnotation', scope, opts), opts.id);
    const annotation = doc.create('bpmn:TextAnnotation', { id, ...(opts.text ? { text: opts.text } : {}) });
    addTo(scope, 'artifacts', annotation);
    cs.create({ id, kind: 'textAnnotation', ...(opts.text ? { name: opts.text } : {}), detail: `in ${idOf(scope)}` });
    doc.invalidate();
    return annotation;
  }

  createGroup(opts: { id?: string; name?: string; members?: string[] }, cs: ChangeSet): El {
    const doc = this.doc;
    if (!opts.members?.length) throw usageError('A group needs --members <id,...>: the elements it is drawn around');
    const members = opts.members.map((id) => this.edit.require(id));
    const wrong = members.find((member) => !is(member, 'bpmn:FlowNode') && !isDataReference(member));
    if (wrong) {
      throw modelError('E_INVALID_VALUE', `${idOf(wrong)} is a ${kindLabel(wrong)}; group members are flow nodes, data objects and data stores`, { element: idOf(wrong) });
    }
    const around = `Around ${new ElementLabels(members[0]!).label()}`;
    const id = allocateId(this.edit, kindRequest(kindByName('group')!, opts.name ? { name: opts.name } : { context: around }), opts.id);
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
    if (this.edit.idStyle.derivedBase(req) !== refId) return req;
    const word = type === 'bpmn:DataObject' ? 'Object' : 'Store';
    const worded = typeRequest(type, name ? { name: `${name} ${word}` } : { context: `${context} ${word}` });
    const id = this.edit.idStyle.derivedBase(worded);
    return id !== refId && id.toLowerCase().endsWith(word.toLowerCase()) ? worded : { ...req, tailWord: word };
  }

  private createCategoryValue(context: string, name: string | undefined): El {
    const doc = this.doc;
    const request = { ...(name ? { name } : {}), context };
    const value = doc.create('bpmn:CategoryValue', { id: this.edit.allocator.allocate(typeRequest('bpmn:CategoryValue', request)).id, ...(name ? { value: name } : {}) });
    const category = doc.create('bpmn:Category', { id: this.edit.allocator.allocate(typeRequest('bpmn:Category', request)).id });
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
      for (let ancestor = el.$parent as El | undefined; ancestor; ancestor = ancestor.$parent as El | undefined) if (ancestor === scope) return true;
      return false;
    };
    for (let scope = doc.scopeOf(members[0]!); scope && is(scope, 'bpmn:SubProcess'); scope = doc.scopeOf(scope)) if (members.every((member) => within(member, scope!))) return scope;
    return collaboration(doc.definitions) ?? doc.processOf(members[0]!)!;
  }
}
