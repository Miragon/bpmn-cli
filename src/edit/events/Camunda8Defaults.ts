import { type BpmnElement, ElementLabels, IdRequests, IdWords, ZeebeDescriptor } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

export class Camunda8Defaults {
  constructor(private readonly edit: EditSession) {}

  userTask(el: BpmnElement): boolean {
    if (this.edit.platform() !== 'c8' || !el.is('bpmn:UserTask')) {
      return false;
    }
    const container = el.get<BpmnElement | undefined>('extensionElements');
    const values = container ? container.list('values') : [];
    if (values.some((extension) => extension.type.endsWith(':userTask') && this.edit.document.namespaces.uriOf(extension.type.slice(0, extension.type.indexOf(':'))) === ZeebeDescriptor.URI)) {
      return false;
    }
    const prefix = this.edit.document.namespaces.prefixFor(ZeebeDescriptor.URI) ?? 'zeebe';
    this.edit.document.namespaces.declare(prefix, ZeebeDescriptor.URI);
    let ext = container;
    if (!ext) {
      ext = this.edit.document.tree.build('bpmn:ExtensionElements');
      ext.parent = el;
      el.set('extensionElements', ext);
    }
    ext.add('values', this.edit.document.tree.buildAny(`${prefix}:userTask`, ZeebeDescriptor.URI, {}));
    return true;
  }

  definitionId(event: BpmnElement, def: BpmnElement): void {
    if (this.edit.platform() !== 'c8' || def.get<string | undefined>('id')) {
      return;
    }
    const eventId = event.get<string | undefined>('id') ?? '';
    const label = (eventId && IdWords.speakingStem(eventId)) || new ElementLabels(event).label();
    def.set('id', this.edit.allocator.allocate(IdRequests.typeRequest(def.type, { context: label })).id);
  }
}
