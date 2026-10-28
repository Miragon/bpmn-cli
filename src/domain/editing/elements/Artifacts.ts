import type { EditSession } from '../../document/EditSession.js';
import { modelError, usageError } from '../../document/utils/errors.js';
import { kindByName, kindLabel } from '../../document/Kinds.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { kindRequest, typeRequest, type IdRequest } from '../../document/utils/requests.js';
import { speakingStem } from '../../document/utils/id-words.js';
import { addTo, collaboration, is, type El, idOf } from '../../document/utils/moddle.js';
import type { ChangeSet } from '../../document/ChangeSet.js';
import { Groups } from '../../diagram/di/Groups.js';
import { artifactContainerOf, isDataReference } from '../utils/artifacts.js';

/**
 * Creates data objects, data stores, text annotations and groups.
 * Group members share the group's bpmn:CategoryValue, so membership needs no coordinates.
 */
export class Artifacts {
  constructor(private readonly edit: EditSession) {}

  createDataObject(scope: El, opts: { id?: string; name?: string }, changes: ChangeSet): El {
    const doc = this.edit.doc;
    Artifacts.assertFlowScope(scope, 'data objects');
    const id = this.edit.allocator.explicitOr(opts.id, Artifacts.artifactRequest('dataObject', scope, opts));
    const dataObject = doc.create('bpmn:DataObject', { id: this.edit.allocator.allocate(this.backingRequest('bpmn:DataObject', id, opts.name)).id });
    const ref = doc.create('bpmn:DataObjectReference', { id, ...(opts.name ? { name: opts.name } : {}), dataObjectRef: dataObject });
    addTo(scope, 'flowElements', dataObject, ref);
    changes.create({ id, kind: 'dataObject', ...(opts.name ? { name: opts.name } : {}), detail: `in ${idOf(scope)}` });
    changes.note(`backing dataObject ${idOf(dataObject)} created for ${id}`);
    doc.invalidate();
    return ref;
  }

  createDataStore(scope: El, opts: { id?: string; name?: string }, changes: ChangeSet): El {
    const doc = this.edit.doc;
    Artifacts.assertFlowScope(scope, 'data stores');
    const id = this.edit.allocator.explicitOr(opts.id, Artifacts.artifactRequest('dataStore', scope, opts));
    const store = doc.create('bpmn:DataStore', { id: this.edit.allocator.allocate(this.backingRequest('bpmn:DataStore', id, opts.name)).id, ...(opts.name ? { name: opts.name } : {}) });
    addTo(doc.definitions, 'rootElements', store);
    const ref = doc.create('bpmn:DataStoreReference', { id, ...(opts.name ? { name: opts.name } : {}), dataStoreRef: store });
    addTo(scope, 'flowElements', ref);
    changes.create({ id, kind: 'dataStore', ...(opts.name ? { name: opts.name } : {}), detail: `in ${idOf(scope)}` });
    changes.note(`root dataStore ${idOf(store)} created for ${id}`);
    doc.invalidate();
    return ref;
  }

  createTextAnnotation(scope: El, opts: { id?: string; name?: string; text?: string }, changes: ChangeSet): El {
    const doc = this.edit.doc;
    if (artifactContainerOf(scope) !== scope) {
      throw modelError('E_INVALID_SCOPE', `${idOf(scope)} is a ${kindLabel(scope)}; text annotations can only be created in a process, sub-process or collaboration`, {
        element: idOf(scope),
      });
    }
    const id = this.edit.allocator.explicitOr(opts.id, Artifacts.artifactRequest('textAnnotation', scope, opts));
    const annotation = doc.create('bpmn:TextAnnotation', { id, ...(opts.text ? { text: opts.text } : {}) });
    addTo(scope, 'artifacts', annotation);
    changes.create({ id, kind: 'textAnnotation', ...(opts.text ? { name: opts.text } : {}), detail: `in ${idOf(scope)}` });
    doc.invalidate();
    return annotation;
  }

  createGroup(opts: { id?: string; name?: string; members?: string[] }, changes: ChangeSet): El {
    const doc = this.edit.doc;
    if (!opts.members?.length) throw usageError('A group needs --members <id,...>: the elements it is drawn around');
    const members = opts.members.map((id) => this.edit.require(id));
    const wrong = members.find((member) => !is(member, 'bpmn:FlowNode') && !isDataReference(member));
    if (wrong) {
      throw modelError('E_INVALID_VALUE', `${idOf(wrong)} is a ${kindLabel(wrong)}; group members are flow nodes, data objects and data stores`, { element: idOf(wrong) });
    }
    const around = `Around ${new ElementLabels(members[0]!).label()}`;
    const id = this.edit.allocator.explicitOr(opts.id, kindRequest(kindByName('group')!, opts.name ? { name: opts.name } : { context: around }));
    const value = this.createCategoryValue(speakingStem(id) ?? around, opts.name);
    const group = doc.create('bpmn:Group', { id, categoryValueRef: value });
    addTo(this.groupContainer(members), 'artifacts', group);
    for (const member of members) addTo(member, 'categoryValueRef', value);
    changes.create({ id, kind: 'group', ...(opts.name ? { name: opts.name } : {}), detail: `around ${members.map(idOf).join(', ')}` });
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
    new Groups(this.edit.doc.definitions).relabel(this.edit.doc.moddle, group, name);
  }

  private static artifactRequest(kind: 'dataObject' | 'dataStore' | 'textAnnotation', scope: El, opts: { name?: string; text?: string }): IdRequest {
    return kindRequest(kindByName(kind)!, { ...(opts.name ? { name: opts.name } : {}), context: opts.text?.trim() ? opts.text : new ElementLabels(scope).context('In') });
  }

  private static assertFlowScope(scope: El, what: string): void {
    if (!is(scope, 'bpmn:Process') && !is(scope, 'bpmn:SubProcess')) {
      throw modelError('E_INVALID_SCOPE', `${idOf(scope)} is a ${kindLabel(scope)}; ${what} can only be created in a process or sub-process`, {
        element: idOf(scope),
      });
    }
  }

  /** The backing element is named like its reference: dataObjectItem_invoice for dataObject_invoice. */
  private backingRequest(type: 'bpmn:DataObject' | 'bpmn:DataStore', refId: string, name: string | undefined): IdRequest {
    return typeRequest(type, { ...(name ? { name } : {}), context: speakingStem(refId) ?? '' });
  }

  private createCategoryValue(context: string, name: string | undefined): El {
    const doc = this.edit.doc;
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
    const doc = this.edit.doc;
    const within = (el: El, scope: El): boolean => {
      for (let ancestor = el.$parent as El | undefined; ancestor; ancestor = ancestor.$parent as El | undefined) if (ancestor === scope) return true;
      return false;
    };
    for (let scope = doc.scopeOf(members[0]!); scope && is(scope, 'bpmn:SubProcess'); scope = doc.scopeOf(scope)) if (members.every((member) => within(member, scope!))) return scope;
    return collaboration(doc.definitions) ?? doc.processOf(members[0]!)!;
  }
}
