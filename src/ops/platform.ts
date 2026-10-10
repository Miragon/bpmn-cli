/**
 * What the CLI writes for elements it creates in a Camunda 8 file, like
 * Camunda Modeler does (Doc.platform() === 'camunda8'):
 *
 *  - a new user task (add, retype to userTask) gets `<zeebe:userTask />`: a
 *    Camunda user task. Without it Camunda 8 runs a job worker user task (a
 *    job of type io.camunda.zeebe:userTask, not listed by the v2 user task
 *    API; the C8 profile reports W_C8_JOB_WORKER_USER_TASK).
 *  - a new event definition gets an id derived from its event's id
 *    (`Event_OrderReady` -> `ConditionalEventDefinition_OrderReady`):
 *    Camunda 8.9 refuses conditional, compensation and link catch event
 *    definitions without an id, and the Modeler gives every definition one.
 *
 * Camunda 7 defaults (camunda:historyTimeToLive of a new process) are
 * Doc.initProcess.
 */
import type { Doc } from '../document.js';
import { isValidId } from '../ids.js';
import { addTo, is, many, type El } from '../model.js';
import { ZEEBE_URI } from '../platform/descriptor.js';

/** Adds `<zeebe:userTask />` to a user task of a Camunda 8 file that has none; true when it did. */
export function zeebeUserTaskDefault(doc: Doc, el: El): boolean {
  if (doc.platform() !== 'camunda8' || !is(el, 'bpmn:UserTask')) return false;
  const container = el.get<El | undefined>('extensionElements');
  const values = container ? many(container, 'values') : [];
  if (values.some((v) => v.$type.endsWith(':userTask') && doc.namespaceUri(v.$type.slice(0, v.$type.indexOf(':'))) === ZEEBE_URI)) return false;
  const prefix = doc.prefixFor(ZEEBE_URI) ?? 'zeebe';
  doc.declareNamespace(prefix, ZEEBE_URI);
  let ext = container;
  if (!ext) {
    ext = doc.moddle.create('bpmn:ExtensionElements');
    ext.$parent = el;
    el.set('extensionElements', ext);
  }
  addTo(ext, 'values', doc.moddle.createAny(`${prefix}:userTask`, ZEEBE_URI, {}) as unknown as El);
  return true;
}

/** Gives a new event definition of a Camunda 8 file an id derived from its event's id, unless it has one. */
export function definitionIdDefault(doc: Doc, event: El, def: El): void {
  if (doc.platform() !== 'camunda8' || def.get<string | undefined>('id')) return;
  const eventId = event.get<string | undefined>('id') ?? '';
  const body = eventId.replace(/^[A-Za-z]+_(?=.)/, '');
  const type = def.$type.slice(def.$type.indexOf(':') + 1);
  const base = `${type}_${body || 'Definition'}`;
  if (!isValidId(base)) return;
  let id = base;
  for (let n = 2; doc.has(id) || doc.ids.has(id); n++) id = `${base}_${n}`;
  doc.ids.claim(id);
  def.set('id', id);
}
