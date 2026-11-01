import { type BpmnDocument, type BpmnElement, BpmnError } from '../../model/index.js';
import { type Operation, OperationAliases } from '../../operations/index.js';

export class AliasTable {
  private readonly map = new Map<string, { el: BpmnElement; op: number }>();

  constructor(private readonly document: BpmnDocument) {}

  get size(): number {
    return this.map.size;
  }

  define(alias: string, el: BpmnElement, op: number): void {
    const prev = this.map.get(alias);
    if (prev) {
      throw new BpmnError('E_DUPLICATE_ALIAS', `ops[${op}]: alias ${alias} is already defined by ops[${prev.op}]`, 'usage', { op, hint: 'Every alias names one element of the batch: pick another name.' });
    }
    if (!OperationAliases.isAlias(alias)) {
      throw BpmnError.usage(`ops[${op}]: alias "${alias}" must look like $name ($ and a letter, then letters, digits, _ or -)`, { op });
    }
    this.map.set(alias, { el, op });
  }

  rebind(from: BpmnElement, to: BpmnElement): void {
    for (const entry of this.map.values()) {
      if (entry.el === from) {
        entry.el = to;
      }
    }
  }

  idOf(alias: string, index: number, command: Operation, key: string): string {
    const entry = this.map.get(alias);
    if (!entry) {
      throw OperationAliases.unknown(index, command, key, alias, new Map([...this.map].map(([aliasName, aliasEntry]) => [aliasName, aliasEntry.op])));
    }
    const id = entry.el.get<string | undefined>('id');
    if (!id || this.document.tree.byId(id) !== entry.el) {
      throw new BpmnError('E_NOT_FOUND', `ops[${index}] (${command.op}): "${key}": ${alias} named ${id ?? 'an element'}, which an op before this one removed`, 'model', { op: index, element: id, hint: 'Refer to an element that still exists.' });
    }
    return id;
  }

  toRecord(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [alias, { el }] of this.map) {
      const id = el.get<string | undefined>('id');
      if (id && this.document.tree.byId(id) === el) {
        out[alias] = id;
      }
    }
    return out;
  }
}
