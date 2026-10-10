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

/** An id an op renamed (a flow whose id named its old ends, ops/flows.ts followEnds). */
export interface Rename {
  from: string;
  to: string;
  /** what the old id named: the flow's old ends (`A -> B`) */
  was?: string;
  /**
   * `to` was the id of an element the same change removed (a bridge takes
   * the id of the flow it replaces): by id, `from` is removed and `to`
   * changed, so the change lists each id once and no rename
   */
  takeover?: true;
}

/** ` (renamed from <old>: ...)`, the detail a change entry gets when followEnds renamed the flow. */
export function renamedNote(old: string | undefined): string {
  return old ? ` (renamed from ${old}: its id named its old ends)` : '';
}

export class ChangeSet {
  created: Change[] = [];
  changed: Change[] = [];
  removed: Change[] = [];
  warnings: Warning[] = [];
  /** human-readable remarks, e.g. "inserted between A and B" */
  notes: string[] = [];
  /** ids an op renamed (a flow whose id named its old ends, ops/flows.ts followEnds): earlier entries name the new id */
  renames: Rename[] = [];
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

  /**
   * Records renamed ids: the entries made so far (and later merged ones)
   * name the element by its new id. A rename onto the id of an element this
   * change removed is a takeover (Rename.takeover): the removed entry names
   * the old id (and what it named), the changed entry keeps the id without
   * the rename note, so every id is listed once.
   */
  rename(renames: Rename[]): this {
    for (const r of renames) {
      const created = this.created.some((c) => c.id === r.from || c.id === r.to);
      for (const c of [...this.created, ...this.changed]) if (c.id === r.from) c.id = r.to;
      const gone = r.takeover || created ? -1 : this.removed.findIndex((c) => c.id === r.to);
      if (gone === -1) {
        this.renames.push(r);
        continue;
      }
      // the id the element had in the file (an earlier op of the batch may have renamed it already)
      let origin = r.from;
      for (let i = this.renames.length - 1; i >= 0; i--) if (this.renames[i]!.to === origin && !this.renames[i]!.takeover) origin = this.renames[i]!.from;
      this.removed[gone] = { id: origin, kind: this.removed[gone]!.kind, ...(r.was && origin === r.from ? { detail: r.was } : {}) };
      for (const c of this.changed) if (c.id === r.to && c.detail) c.detail = c.detail.replace(renamedNote(r.from), '');
      this.renames.push({ ...r, takeover: true });
    }
    return this;
  }

  /** Binds a batch alias to an element (ops/index.ts registers it). */
  bind(alias: string | undefined, el: El | undefined): this {
    if (alias && el) this.bindings.push({ alias, el });
    return this;
  }

  merge(other: ChangeSet): this {
    this.bindings.push(...other.bindings);
    this.created.push(...other.created);
    for (const c of other.changed) this.change(c);
    this.removed.push(...other.removed);
    this.warnings.push(...other.warnings);
    this.notes.push(...other.notes);
    // after the entries: a rename onto an id an earlier op removed finds both (a takeover)
    this.rename(other.renames);
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
