/**
 * What a mutation did. Rendered as text or JSON after every write.
 */
import type { Warning } from '../shared/CliError.js';
import type { El } from './utils/moddle.js';
import { renamedNote } from './utils/renames.js';

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
  /**
   * an element the same change created took another id (ops/set.ts
   * recordIdState: its generated id after a retype), or a flow the change
   * named after it followed (with `was`): the old id was never in the file,
   * so the details of the change's entries (a flow's ends), its notes and
   * its warnings name the element by the new one too, and a W_ID_SUFFIXED
   * about the old id goes
   */
  regenerated?: true;
}

export class ChangeSet {
  /**
   * The element a change entry or a rename is about (ops/flows.ts flowChange,
   * ops/set.ts changeOf, EditContext.recordRename): rename renames only the
   * entries of the renamed element, not those of an element that took the id
   * the rename freed. Kept out of the objects, so JSON and the entries' shape
   * stay as they are.
   */
  private static readonly elements = new WeakMap<object, El>();

  /** An element a retype replaced (EditContext.replaceElement) -> the element that took its place. */
  private static readonly successors = new WeakMap<El, El>();

  /** Records that `entry` (a change entry or a rename) is about `el`; returns `entry`. */
  static about<T extends object>(entry: T, el: El | undefined): T {
    if (el) ChangeSet.elements.set(entry, el);
    return entry;
  }

  /**
   * Records that `next` took the place of `old` (a retype that changes the
   * type builds a new element, ops/retype.ts swapType): an entry about `old`
   * is about `next` (rename), so a rename recorded for `next` (its id
   * regenerated) renames the entries an earlier op made for `old`.
   */
  static recordReplacement(old: El, next: El): void {
    if (old !== next) ChangeSet.successors.set(old, next);
  }

  /** The element `el` is now: the last one that took its place (recordReplacement), or itself (also read by layout/Snapshot.ts changedEnds). */
  static successorOf(el: El): El {
    const seen = new Set<El>([el]);
    for (let next = ChangeSet.successors.get(el); next && !seen.has(next); next = ChangeSet.successors.get(el)) {
      seen.add(next);
      el = next;
    }
    return el;
  }

  created: Change[] = [];
  changed: Change[] = [];
  removed: Change[] = [];
  warnings: Warning[] = [];
  /** human-readable remarks, e.g. "inserted between A and B" */
  notes: string[] = [];
  /** ids an op renamed (a flow whose id named its old ends, ops/flows.ts followEnds): earlier entries name the new id */
  renames: Rename[] = [];
  /** batch aliases an op defined (`as`, `flowAs`, `joinAs`; ops/OpAliases.ts): the element itself */
  bindings: Array<{ alias: string; el: El }> = [];
  /** elements an op replaced by a new one (a retype to another type, ops/retype.ts swapType): the batch aliases follow */
  replaced: Array<{ from: El; to: El }> = [];
  /**
   * nodes a `move` placed elsewhere, by their id at the time (ops/move.ts; not
   * renamed): the incremental layout places them again. A move that left a
   * node where it was lists nothing, so its drawing stays.
   */
  relocated: string[] = [];

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
   * name the element by its new id, but not an entry of another element
   * (about): one that took the id the rename freed (a splice's new flow
   * after the spliced one was renamed) keeps it; an element a retype
   * replaced since counts as the one that took its place (replaced). A
   * rename onto the id of an
   * element this change removed is a takeover (Rename.takeover): the
   * removed entry names the old id (and what it named), the changed entry
   * keeps the id without the rename note, so every id is listed once.
   */
  rename(renames: Rename[]): this {
    for (const r of renames) {
      const el = ChangeSet.elements.get(r);
      const renamed = el && ChangeSet.successorOf(el);
      const created = this.created.some((c) => c.id === r.from || c.id === r.to);
      for (const c of [...this.created, ...this.changed]) if (c.id === r.from && (!renamed || ChangeSet.successorOf(ChangeSet.elements.get(c) ?? renamed) === renamed)) c.id = r.to;
      if (r.regenerated) {
        const old = new RegExp(`(?<![A-Za-z0-9_.-])${r.from.replace(/[.]/g, '\\.')}(?![A-Za-z0-9_.-])`, 'g');
        for (const c of [...this.created, ...this.changed]) if (c.detail) c.detail = c.detail.replace(old, r.to);
        this.notes = this.notes.map((n) => n.replace(old, r.to));
        this.warnings = this.warnings
          .filter((w) => !(w.code === 'W_ID_SUFFIXED' && w.element === r.from))
          .map((w) => (w.element === r.from ? { ...w, element: r.to, message: w.message.replace(old, r.to), ...(w.hint ? { hint: w.hint.replace(old, r.to) } : {}) } : w));
      }
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
      this.renames.push(ChangeSet.about({ ...r, takeover: true as const }, el));
    }
    return this;
  }

  /** Binds a batch alias to an element (OpRunner registers it). */
  bind(alias: string | undefined, el: El | undefined): this {
    if (alias && el) this.bindings.push({ alias, el });
    return this;
  }

  merge(other: ChangeSet): this {
    this.bindings.push(...other.bindings);
    this.replaced.push(...other.replaced);
    this.relocated.push(...other.relocated);
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
