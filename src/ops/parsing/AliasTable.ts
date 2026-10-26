import type { Doc } from '../../model/Doc.js';
import { CliError } from '../../shared/CliError.js';
import { usageError } from '../../shared/utils/errors.js';
import type { El } from '../../model/utils/moddle.js';
import { isAlias, unknownAlias } from './utils/aliases.js';
import type { Op } from '../types.js';

/**
 * The aliases of a running batch. An alias binds the element itself, so it follows renames
 * and retypes; `rebind` moves it to the element a retype replaced it by.
 */
export class AliasTable {
  private readonly map = new Map<string, { el: El; op: number }>();

  constructor(private readonly doc: Doc) {}

  get size(): number {
    return this.map.size;
  }

  define(alias: string, el: El, op: number): void {
    const prev = this.map.get(alias);
    if (prev) throw new CliError('E_DUPLICATE_ALIAS', `ops[${op}]: alias ${alias} is already defined by ops[${prev.op}]`, 'usage', { op, hint: 'Every alias names one element of the batch: pick another name.' });
    if (!isAlias(alias)) throw usageError(`ops[${op}]: alias "${alias}" must look like $name ($ and a letter, then letters, digits, _ or -)`, { op });
    this.map.set(alias, { el, op });
  }

  rebind(from: El, to: El): void {
    for (const entry of this.map.values()) if (entry.el === from) entry.el = to;
  }

  idOf(alias: string, index: number, op: Op, key: string): string {
    const entry = this.map.get(alias);
    if (!entry) throw unknownAlias(index, op, key, alias, new Map([...this.map].map(([aliasName, aliasEntry]) => [aliasName, aliasEntry.op])));
    const id = entry.el.get<string | undefined>('id');
    if (!id || this.doc.get(id) !== entry.el) {
      throw new CliError('E_NOT_FOUND', `ops[${index}] (${op.op}): "${key}": ${alias} named ${id ?? 'an element'}, which an op before this one removed`, 'model', { op: index, element: id, hint: 'Refer to an element that still exists.' });
    }
    return id;
  }

  /** Elements removed later in the batch are left out. */
  toRecord(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [alias, { el }] of this.map) {
      const id = el.get<string | undefined>('id');
      if (id && this.doc.get(id) === el) out[alias] = id;
    }
    return out;
  }
}
