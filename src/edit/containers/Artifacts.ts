import { type BpmnElement, BpmnError, type ChangeSet, ElementLabels, type IdRequest, IdRequests, IdWords, Kinds } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { ElementContainment } from './ElementContainment.js';

export class Artifacts {
  constructor(private readonly edit: EditSession) {}

  createDataObject(scope: BpmnElement, opts: { id?: string; name?: string }, changes: ChangeSet): BpmnElement {
    const document = this.edit.document;
    Artifacts.assertFlowScope(scope, 'data objects');
    const id = this.edit.allocator.explicitOr(opts.id, Artifacts.artifactRequest('dataObject', scope, opts));
    const dataObject = document.tree.create('bpmn:DataObject', { id: this.edit.allocator.allocate(this.backingRequest('bpmn:DataObject', id, opts.name)).id });
    const ref = document.tree.create('bpmn:DataObjectReference', { id, ...(opts.name ? { name: opts.name } : {}), dataObjectRef: dataObject });
    scope.add('flowElements', dataObject, ref);
    changes.create({ id, kind: 'dataObject', ...(opts.name ? { name: opts.name } : {}), detail: `in ${scope.id}` });
    changes.note(`backing dataObject ${dataObject.id} created for ${id}`);
    document.tree.invalidate();
    return ref;
  }

  createDataStore(scope: BpmnElement, opts: { id?: string; name?: string }, changes: ChangeSet): BpmnElement {
    const document = this.edit.document;
    Artifacts.assertFlowScope(scope, 'data stores');
    const id = this.edit.allocator.explicitOr(opts.id, Artifacts.artifactRequest('dataStore', scope, opts));
    const store = document.tree.create('bpmn:DataStore', { id: this.edit.allocator.allocate(this.backingRequest('bpmn:DataStore', id, opts.name)).id, ...(opts.name ? { name: opts.name } : {}) });
    document.tree.definitions.add('rootElements', store);
    const ref = document.tree.create('bpmn:DataStoreReference', { id, ...(opts.name ? { name: opts.name } : {}), dataStoreRef: store });
    scope.add('flowElements', ref);
    changes.create({ id, kind: 'dataStore', ...(opts.name ? { name: opts.name } : {}), detail: `in ${scope.id}` });
    changes.note(`root dataStore ${store.id} created for ${id}`);
    document.tree.invalidate();
    return ref;
  }

  createTextAnnotation(scope: BpmnElement, opts: { id?: string; name?: string; text?: string }, changes: ChangeSet): BpmnElement {
    const document = this.edit.document;
    if (new ElementContainment(scope).artifactContainer() !== scope) {
      throw BpmnError.model('E_INVALID_SCOPE', `${scope.id} is a ${Kinds.label(scope)}; text annotations can only be created in a process, sub-process or collaboration`, {
        element: scope.id,
      });
    }
    const id = this.edit.allocator.explicitOr(opts.id, Artifacts.artifactRequest('textAnnotation', scope, opts));
    const annotation = document.tree.create('bpmn:TextAnnotation', { id, ...(opts.text ? { text: opts.text } : {}) });
    scope.add('artifacts', annotation);
    changes.create({ id, kind: 'textAnnotation', ...(opts.text ? { name: opts.text } : {}), detail: `in ${scope.id}` });
    document.tree.invalidate();
    return annotation;
  }

  createGroup(opts: { id?: string; name?: string; members?: string[] }, changes: ChangeSet): BpmnElement {
    const document = this.edit.document;
    if (!opts.members?.length) {
      throw BpmnError.usage('A group needs --members <id,...>: the elements it is drawn around');
    }
    const members = opts.members.map((id) => this.edit.require(id));
    const wrong = members.find((member) => !member.is('bpmn:FlowNode') && !new ElementContainment(member).isDataReference());
    if (wrong) {
      throw BpmnError.model('E_INVALID_VALUE', `${wrong.id} is a ${Kinds.label(wrong)}; group members are flow nodes, data objects and data stores`, { element: wrong.id });
    }
    const around = `Around ${new ElementLabels(members[0]!).label()}`;
    const id = this.edit.allocator.explicitOr(opts.id, IdRequests.kindRequest(Kinds.byName('group')!, opts.name ? { name: opts.name } : { context: around }));
    const value = this.createCategoryValue(IdWords.speakingStem(id) ?? around, opts.name);
    const group = document.tree.create('bpmn:Group', { id, categoryValueRef: value });
    this.groupContainer(members).add('artifacts', group);
    for (const member of members) {
      member.add('categoryValueRef', value);
    }
    changes.create({ id, kind: 'group', ...(opts.name ? { name: opts.name } : {}), detail: `around ${members.map((element) => element.id).join(', ')}` });
    document.tree.invalidate();
    return group;
  }

  setGroupName(group: BpmnElement, name: string): void {
    const value = group.get<BpmnElement | undefined>('categoryValueRef');
    if (value) {
      value.set('value', name || undefined);
    } else if (name) {
      group.set('categoryValueRef', this.createCategoryValue(IdWords.speakingStem(group.id) ?? '', name));
    }
  }

  private static artifactRequest(kind: 'dataObject' | 'dataStore' | 'textAnnotation', scope: BpmnElement, opts: { name?: string; text?: string }): IdRequest {
    return IdRequests.kindRequest(Kinds.byName(kind)!, { ...(opts.name ? { name: opts.name } : {}), context: opts.text?.trim() ? opts.text : new ElementLabels(scope).context('In') });
  }

  private static assertFlowScope(scope: BpmnElement, what: string): void {
    if (!scope.is('bpmn:Process') && !scope.is('bpmn:SubProcess')) {
      throw BpmnError.model('E_INVALID_SCOPE', `${scope.id} is a ${Kinds.label(scope)}; ${what} can only be created in a process or sub-process`, {
        element: scope.id,
      });
    }
  }

  private backingRequest(type: 'bpmn:DataObject' | 'bpmn:DataStore', refId: string, name: string | undefined): IdRequest {
    return IdRequests.typeRequest(type, { ...(name ? { name } : {}), context: IdWords.speakingStem(refId) ?? '' });
  }

  private createCategoryValue(context: string, name: string | undefined): BpmnElement {
    const document = this.edit.document;
    const request = { ...(name ? { name } : {}), context };
    const value = document.tree.create('bpmn:CategoryValue', { id: this.edit.allocator.allocate(IdRequests.typeRequest('bpmn:CategoryValue', request)).id, ...(name ? { value: name } : {}) });
    const category = document.tree.create('bpmn:Category', { id: this.edit.allocator.allocate(IdRequests.typeRequest('bpmn:Category', request)).id });
    category.add('categoryValue', value);
    document.tree.definitions.add('rootElements', category);
    return value;
  }

  private groupContainer(members: BpmnElement[]): BpmnElement {
    const document = this.edit.document;
    const within = (el: BpmnElement, scope: BpmnElement): boolean => {
      for (let ancestor = el.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor === scope) {
          return true;
        }
      }
      return false;
    };
    for (let scope = document.scopes.scopeOf(members[0]!); scope && scope.is('bpmn:SubProcess'); scope = document.scopes.scopeOf(scope)) {
      if (members.every((member) => within(member, scope!))) {
        return scope;
      }
    }
    return document.tree.collaboration() ?? document.scopes.processOf(members[0]!)!;
  }
}
