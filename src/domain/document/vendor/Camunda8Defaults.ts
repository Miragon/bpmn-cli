import type { Doc } from '../Doc.js';
import type { EditContext } from '../EditContext.js';
import { ElementLabels } from '../ids/ElementLabels.js';
import { typeRequest } from '../utils/requests.js';
import { speakingStem } from '../utils/id-words.js';
import { addTo, is, many, type El } from '../utils/moddle.js';
import { ZEEBE_URI } from './ZeebeDescriptor.js';

/**
 * What the CLI writes for elements it creates in a Camunda 8 file, like Camunda Modeler does:
 * `<zeebe:userTask />` on new user tasks and speaking ids on new event definitions.
 */
export class Camunda8Defaults {
  constructor(
    private readonly doc: Doc,
    private readonly edit: EditContext,
  ) {}

  /**
   * Without `<zeebe:userTask />` Camunda 8 runs a job worker user task,
   * which the v2 user task API does not list.
   */
  userTask(el: El): boolean {
    if (this.edit.platform() !== 'camunda8' || !is(el, 'bpmn:UserTask')) return false;
    const container = el.get<El | undefined>('extensionElements');
    const values = container ? many(container, 'values') : [];
    if (values.some((extension) => extension.$type.endsWith(':userTask') && this.doc.namespaceUri(extension.$type.slice(0, extension.$type.indexOf(':'))) === ZEEBE_URI)) return false;
    const prefix = this.doc.prefixFor(ZEEBE_URI) ?? 'zeebe';
    this.doc.declareNamespace(prefix, ZEEBE_URI);
    let ext = container;
    if (!ext) {
      ext = this.doc.moddle.create('bpmn:ExtensionElements');
      ext.$parent = el;
      el.set('extensionElements', ext);
    }
    addTo(ext, 'values', this.doc.moddle.createAny(`${prefix}:userTask`, ZEEBE_URI, {}) as unknown as El);
    return true;
  }

  /**
   * Camunda 8.9 refuses conditional, compensation and link catch event
   * definitions without an id; the Modeler gives every definition one.
   */
  definitionId(event: El, def: El): void {
    if (this.edit.platform() !== 'camunda8' || def.get<string | undefined>('id')) return;
    const eventId = event.get<string | undefined>('id') ?? '';
    const label = (eventId && speakingStem(eventId)) || new ElementLabels(event).label();
    def.set('id', this.edit.allocator.allocate(typeRequest(def.$type, { context: label })).id);
  }
}
