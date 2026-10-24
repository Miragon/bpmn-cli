/**
 * What the CLI writes for elements it creates in a Camunda 8 file, like
 * Camunda Modeler does (Doc.platform() === 'camunda8'):
 *
 *  - a new user task (add, retype to userTask) gets `<zeebe:userTask />`: a
 *    Camunda user task. Without it Camunda 8 runs a job worker user task (a
 *    job of type io.camunda.zeebe:userTask, not listed by the v2 user task
 *    API; the C8 profile reports W_C8_JOB_WORKER_USER_TASK).
 *  - a new event definition gets a speaking id after its event
 *    (`Event_OrderReady` -> `ConditionalEventDefinition_OrderReady`):
 *    Camunda 8.9 refuses conditional, compensation and link catch event
 *    definitions without an id, and the Modeler gives every definition one.
 *
 * Camunda 7 defaults (camunda:historyTimeToLive of a new process) are
 * Doc.initProcess.
 */
import type { Doc } from '../model/document.js';
import { labelOf, speakingStem, typeRequest } from '../ids/style.js';
import { addTo, is, many, type El } from '../model/utils/moddle.js';
import { ZEEBE_URI } from './ZeebeDescriptor.js';

export class Camunda8Defaults {
  constructor(private readonly doc: Doc) {}

  /** Adds `<zeebe:userTask />` to a user task of a Camunda 8 file that has none; true when it did. */
  userTask(el: El): boolean {
    if (this.doc.platform() !== 'camunda8' || !is(el, 'bpmn:UserTask')) return false;
    const container = el.get<El | undefined>('extensionElements');
    const values = container ? many(container, 'values') : [];
    if (values.some((v) => v.$type.endsWith(':userTask') && this.doc.namespaceUri(v.$type.slice(0, v.$type.indexOf(':'))) === ZEEBE_URI)) return false;
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
   * Gives a new event definition of a Camunda 8 file a speaking id after its
   * event, unless it has one: the definition's type as the prefix (or the one
   * the file uses for that type) and the speaking part of the event's id as
   * the body (its name or a kind word when the id is a hash or a number), in
   * the file's case, through Doc.allocateId (a taken id gets `_2` and
   * W_ID_SUFFIXED).
   */
  definitionId(event: El, def: El): void {
    if (this.doc.platform() !== 'camunda8' || def.get<string | undefined>('id')) return;
    const eventId = event.get<string | undefined>('id') ?? '';
    const label = (eventId && speakingStem(eventId)) || labelOf(event);
    def.set('id', this.doc.allocateId(typeRequest(def.$type, { context: label })).id);
  }
}
