/**
 * The root bpmn:Message / Error / Signal / Escalation elements a document's
 * events, send / receive tasks and message flows reference: found by id or
 * name, created when missing (ids Message_<Slug>, Error_<Slug>, Signal_<Slug>,
 * Escalation_<Slug> in the default style), and the one an op's `refAs` names.
 */
import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { typeRequest } from '../ids/utils/requests.js';
import { kindLabel } from '../model/kinds.js';
import { addTo, is, type El, idOf } from '../model/utils/moddle.js';
import type { ChangeSet } from '../model/ChangeSet.js';

/** Root element types a trigger may reference, with their id prefix. */
export type RootRefType = 'bpmn:Message' | 'bpmn:Error' | 'bpmn:Signal' | 'bpmn:Escalation';

const ROOT_PREFIX: Record<RootRefType, string> = {
  'bpmn:Message': 'Message',
  'bpmn:Error': 'Error',
  'bpmn:Signal': 'Signal',
  'bpmn:Escalation': 'Escalation',
};

const DEFINITION_REFS: Array<[string, string]> = [
  ['bpmn:MessageEventDefinition', 'messageRef'],
  ['bpmn:ErrorEventDefinition', 'errorRef'],
  ['bpmn:SignalEventDefinition', 'signalRef'],
  ['bpmn:EscalationEventDefinition', 'escalationRef'],
];

export class RootElements {
  constructor(private readonly doc: Doc) {}

  /**
   * Finds a root Message/Error/Signal/Escalation by id or name, creating it
   * (id `<Prefix>_<Slug>` in the default style, src/ids/IdStyle.ts) when missing. `extra` (errorCode / escalationCode)
   * is applied to found elements too. Returns whether it was created.
   */
  ensure(type: RootRefType, nameOrId: string, extra: Record<string, string | undefined> = {}): { el: El; created: boolean } {
    const doc = this.doc;
    const key = nameOrId.trim();
    if (!key) {
      throw modelError('E_INVALID_VALUE', `The ${ROOT_PREFIX[type].toLowerCase()} name is empty`, { hint: 'Pass a name, e.g. --message OrderReceived.' });
    }
    const existing = doc.rootElementsOfType(type);
    let el = existing.find((e) => idOf(e) === key) ?? existing.find((e) => e.get<string | undefined>('name') === key);
    let created = false;
    if (!el) {
      el = doc.create(type, { id: doc.edit.allocator.allocate(typeRequest(type, { name: key, prefix: ROOT_PREFIX[type] })).id, name: key });
      addTo(doc.definitions, 'rootElements', el);
      created = true;
    }
    for (const [prop, value] of Object.entries(extra)) {
      if (value !== undefined) el.set(prop, value || undefined);
    }
    doc.invalidate();
    return { el, created };
  }

  /**
   * Binds the batch alias `refAs` (ops/aliases.ts) to the root element `el`
   * references after the op; E_USAGE when it references none or several.
   */
  bindRefAs(cs: ChangeSet, alias: string | undefined, el: El | undefined): void {
    if (!alias || !el) return;
    const roots = RootElements.referencedBy(el);
    const id = el.get<string | undefined>('id') ?? el.$type;
    if (roots.length !== 1) {
      throw usageError(`refAs ${alias}: ${kindLabel(el)} ${id} references ${roots.length ? `${roots.length} root elements (${roots.map((r) => r.get<string>('id')).join(', ')})` : 'no message, error, signal or escalation'}`, {
        element: id,
        hint: roots.length ? 'Refer to one of them by its id.' : 'refAs names the message / error / signal / escalation the element references: give it one in the same op ("message": "<Name>", "error": ..., "signal": ..., "escalation": ...).',
      });
    }
    cs.bind(alias, roots[0]);
  }

  /**
   * The root bpmn:Message / Error / Signal / Escalation an element references:
   * the message of a send / receive task or message flow, the root element of
   * each event definition of an event (distinct, in order).
   */
  private static referencedBy(el: El): El[] {
    const out: El[] = [];
    const add = (r: El | undefined): void => {
      if (r && !out.includes(r)) out.push(r);
    };
    if (is(el, 'bpmn:SendTask') || is(el, 'bpmn:ReceiveTask') || is(el, 'bpmn:MessageFlow')) add(el.get<El | undefined>('messageRef'));
    if (is(el, 'bpmn:Event')) {
      for (const def of el.get<El[] | undefined>('eventDefinitions') ?? []) {
        for (const [type, prop] of DEFINITION_REFS) if (is(def, type)) add(def.get<El | undefined>(prop));
      }
    }
    return out;
  }
}
