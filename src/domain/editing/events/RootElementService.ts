import type { Doc } from '../../document/Doc.js';
import { modelError, usageError } from '../../document/utils/errors.js';
import { typeRequest } from '../../document/utils/requests.js';
import { kindLabel } from '../../document/utils/kinds.js';
import { addTo, is, type El, idOf } from '../../document/utils/moddle.js';
import type { ChangeSet } from '../../document/ChangeSet.js';

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

/**
 * Finds or creates the root bpmn:Message / Error / Signal / Escalation that events,
 * send / receive tasks and message flows reference.
 */
export class RootElementService {
  constructor(private readonly doc: Doc) {}

  /** `extra` (errorCode / escalationCode) is applied to a found element too. */
  ensure(type: RootRefType, nameOrId: string, extra: Record<string, string | undefined> = {}): { el: El; created: boolean } {
    const doc = this.doc;
    const key = nameOrId.trim();
    if (!key) {
      throw modelError('E_INVALID_VALUE', `The ${ROOT_PREFIX[type].toLowerCase()} name is empty`, { hint: 'Pass a name, e.g. --message OrderReceived.' });
    }
    const existing = doc.rootElementsOfType(type);
    let el = existing.find((candidate) => idOf(candidate) === key) ?? existing.find((candidate) => candidate.get<string | undefined>('name') === key);
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

  bindRefAs(cs: ChangeSet, alias: string | undefined, el: El | undefined): void {
    if (!alias || !el) return;
    const roots = RootElementService.referencedBy(el);
    const id = el.get<string | undefined>('id') ?? el.$type;
    if (roots.length !== 1) {
      throw usageError(`refAs ${alias}: ${kindLabel(el)} ${id} references ${roots.length ? `${roots.length} root elements (${roots.map((root) => root.get<string>('id')).join(', ')})` : 'no message, error, signal or escalation'}`, {
        element: id,
        hint: roots.length ? 'Refer to one of them by its id.' : 'refAs names the message / error / signal / escalation the element references: give it one in the same op ("message": "<Name>", "error": ..., "signal": ..., "escalation": ...).',
      });
    }
    cs.bind(alias, roots[0]);
  }

  private static referencedBy(el: El): El[] {
    const out: El[] = [];
    const add = (root: El | undefined): void => {
      if (root && !out.includes(root)) out.push(root);
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
