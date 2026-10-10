/**
 * What a mutation did. Rendered as text or JSON after every write.
 */
import type { Warning } from './errors.js';
import type { El } from './model.js';

export interface Change {
  id: string;
  /** canonical kind label, e.g. `userTask`, `startEvent:message`, `sequenceFlow` */
  kind: string;
  name?: string;
  /** free-form context, e.g. "after Activity_CheckInvoice", "Event_A -> Activity_B" */
  detail?: string;
}

export class ChangeSet {
  created: Change[] = [];
  changed: Change[] = [];
  removed: Change[] = [];
  warnings: Warning[] = [];
  /** human-readable remarks, e.g. "inserted between A and B" */
  notes: string[] = [];
  /** ids an op renamed (a flow whose id named its old ends, ops/flows.ts followEnds): earlier entries name the new id */
  renames: Array<{ from: string; to: string }> = [];
  /** batch aliases an op defined (`as`, `flowAs`, `joinAs`; ops/aliases.ts): the element itself */
  bindings: Array<{ alias: string; el: El }> = [];

  create(change: Change): this {
    this.created.push(change);
    return this;
  }

  change(change: Change): this {
    if (!this.changed.some((c) => c.id === change.id && c.detail === change.detail)) this.changed.push(change);
    return this;
  }

  remove(change: Change): this {
    this.removed.push(change);
    return this;
  }

  warn(warning: Warning): this {
    this.warnings.push(warning);
    return this;
  }

  note(text: string): this {
    this.notes.push(text);
    return this;
  }

  /** Records renamed ids: the entries made so far (and later merged ones) name the element by its new id. */
  rename(renames: Array<{ from: string; to: string }>): this {
    for (const r of renames) {
      for (const c of [...this.created, ...this.changed]) if (c.id === r.from) c.id = r.to;
      this.renames.push(r);
    }
    return this;
  }

  /** Binds a batch alias to an element (ops/index.ts registers it). */
  bind(alias: string | undefined, el: El | undefined): this {
    if (alias && el) this.bindings.push({ alias, el });
    return this;
  }

  merge(other: ChangeSet): this {
    this.rename(other.renames);
    this.bindings.push(...other.bindings);
    this.created.push(...other.created);
    for (const c of other.changed) this.change(c);
    this.removed.push(...other.removed);
    this.warnings.push(...other.warnings);
    this.notes.push(...other.notes);
    return this;
  }

  get isEmpty(): boolean {
    return !this.created.length && !this.changed.length && !this.removed.length;
  }

  /** all ids touched, for the "context" rendering after a mutation */
  touchedIds(): string[] {
    const ids = new Set<string>();
    for (const c of [...this.created, ...this.changed]) ids.add(c.id);
    return [...ids];
  }

  toJSON(): Record<string, unknown> {
    return {
      created: this.created,
      changed: this.changed,
      removed: this.removed,
      warnings: this.warnings,
      notes: this.notes,
    };
  }
}
