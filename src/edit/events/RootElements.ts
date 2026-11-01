import { type BpmnElement, BpmnError, type ChangeSet, IdRequests, Kinds, Triggers } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';

export type RootRefType = 'bpmn:Message' | 'bpmn:Error' | 'bpmn:Signal' | 'bpmn:Escalation';

const ROOT_PREFIX: Record<RootRefType, string> = {
  'bpmn:Message': 'Message',
  'bpmn:Error': 'Error',
  'bpmn:Signal': 'Signal',
  'bpmn:Escalation': 'Escalation',
};

export class RootElements {
  constructor(private readonly edit: EditSession) {}

  ensure(type: RootRefType, nameOrId: string, extra: Record<string, string | undefined> = {}): { el: BpmnElement; created: boolean } {
    const document = this.edit.document;
    const key = nameOrId.trim();
    if (!key) {
      throw BpmnError.model('E_INVALID_VALUE', `The ${ROOT_PREFIX[type].toLowerCase()} name is empty`, { hint: 'Pass a name, e.g. --message OrderReceived.' });
    }
    const existing = document.tree.rootElementsOfType(type);
    let el = existing.find((candidate) => candidate.id === key) ?? existing.find((candidate) => candidate.get<string | undefined>('name') === key);
    let created = false;
    if (!el) {
      el = document.tree.create(type, { id: this.edit.allocator.allocate(IdRequests.typeRequest(type, { name: key })).id, name: key });
      document.tree.definitions.add('rootElements', el);
      created = true;
    }
    for (const [prop, value] of Object.entries(extra)) {
      if (value !== undefined) {
        el.set(prop, value || undefined);
      }
    }
    document.tree.invalidate();
    return { el, created };
  }

  static bindRefAs(changes: ChangeSet, alias: string | undefined, el: BpmnElement | undefined): void {
    if (!alias || !el) {
      return;
    }
    const roots = RootElements.referencedBy(el);
    const id = el.get<string | undefined>('id') ?? el.type;
    if (roots.length !== 1) {
      throw BpmnError.usage(`refAs ${alias}: ${Kinds.label(el)} ${id} references ${roots.length ? `${roots.length} root elements (${roots.map((root) => root.get<string>('id')).join(', ')})` : 'no message, error, signal or escalation'}`, {
        element: id,
        hint: roots.length ? 'Refer to one of them by its id.' : 'refAs names the message / error / signal / escalation the element references: give it one in the same op ("message": "<Name>", "error": ..., "signal": ..., "escalation": ...).',
      });
    }
    changes.bind(alias, roots[0]);
  }

  private static referencedBy(el: BpmnElement): BpmnElement[] {
    const out: BpmnElement[] = [];
    const add = (root: BpmnElement | undefined): void => {
      if (root && !out.includes(root)) {
        out.push(root);
      }
    };
    if (el.is('bpmn:SendTask') || el.is('bpmn:ReceiveTask') || el.is('bpmn:MessageFlow')) {
      add(el.get<BpmnElement | undefined>('messageRef'));
    }
    if (el.is('bpmn:Event')) {
      for (const def of el.get<BpmnElement[] | undefined>('eventDefinitions') ?? []) {
        for (const { definition, root } of Object.values(Triggers.TABLE)) {
          if (root && def.is(definition)) {
            add(def.get<BpmnElement | undefined>(root.refProperty));
          }
        }
      }
    }
    return out;
  }
}
