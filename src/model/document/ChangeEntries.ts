import { Kinds } from '../kinds/Kinds.js';
import type { BpmnElement } from './BpmnElement.js';

export interface Change {
  id: string;
  kind: string;
  name?: string;
  detail?: string;
}

export interface Rename {
  from: string;
  to: string;
  was?: string;
  takeover?: true;
  regenerated?: true;
}

export class ChangeEntries {
  private static readonly elements = new WeakMap<object, BpmnElement>();
  private static readonly successors = new WeakMap<BpmnElement, BpmnElement>();

  static about<TEntry extends object>(entry: TEntry, element: BpmnElement | undefined): TEntry {
    if (element) {
      ChangeEntries.elements.set(entry, element);
    }
    return entry;
  }

  static elementOf(entry: object): BpmnElement | undefined {
    return ChangeEntries.elements.get(entry);
  }

  static of(element: BpmnElement, detail?: string): Change {
    const name = element.name;
    return ChangeEntries.about({ id: element.get<string | undefined>('id') ?? '', kind: Kinds.labelOrType(element), ...(name ? { name } : {}), ...(detail ? { detail } : {}) }, element);
  }

  static ofFlow(flow: BpmnElement, detail?: string): { id: string; kind: string; name?: string; detail: string } {
    const source = flow.get<BpmnElement | undefined>('sourceRef');
    const target = flow.get<BpmnElement | undefined>('targetRef');
    const name = flow.get<string | undefined>('name');
    const entry = { id: flow.id, kind: 'sequenceFlow', ...(name ? { name } : {}), detail: detail ?? `${source ? source.id : '?'} -> ${target ? target.id : '?'}` };
    return ChangeEntries.about(entry, flow);
  }

  static renamedNote(old: string | undefined): string {
    if (old === '') {
      return ' (id added: it had none)';
    }
    return old ? ` (renamed from ${old}: its id named its old ends)` : '';
  }

  static recordReplacement(old: BpmnElement, next: BpmnElement): void {
    if (old !== next) {
      ChangeEntries.successors.set(old, next);
    }
  }

  static successorOf(element: BpmnElement): BpmnElement {
    const seen = new Set<BpmnElement>([element]);
    let current = element;
    for (let next = ChangeEntries.successors.get(current); next && !seen.has(next); next = ChangeEntries.successors.get(current)) {
      seen.add(next);
      current = next;
    }
    return current;
  }
}
