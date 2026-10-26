import type { Warning } from './CliError.js';
import { kindLabel, kindOf } from './utils/kinds.js';
import { idOf, is, nameOf, type El } from './utils/moddle.js';
import { renamedNote } from './utils/renames.js';

export interface Change {
  id: string;
  /** canonical kind label, e.g. `userTask`, `startEvent:message`, `sequenceFlow` */
  kind: string;
  name?: string;
  /** free-form context, e.g. "after Activity_CheckInvoice", "Event_A -> Activity_B" */
  detail?: string;
}

export interface Rename {
  from: string;
  to: string;
  /** the flow's old ends (`A -> B`) the old id named */
  was?: string;
  /**
   * `to` was the id of an element the same change removed (a bridge takes the id of the flow it
   * replaces): the change lists each id once and no rename
   */
  takeover?: true;
  /**
   * the old id was never in the file (an element the change created took another id): entries,
   * notes and warnings name the new one, and a W_ID_SUFFIXED about the old id goes
   */
  regenerated?: true;
}

/** What a mutation did, rendered as text or JSON after every write. */
export class ChangeSet {
  /**
   * Kept out of the entries so their JSON stays as is: a rename renames only the entries of the
   * renamed element, not those of an element that took the freed id.
   */
  private static readonly elements = new WeakMap<object, El>();

  /** retyped element -> the element that took its place */
  private static readonly successors = new WeakMap<El, El>();

  static about<TEntry extends object>(entry: TEntry, el: El | undefined): TEntry {
    if (el) ChangeSet.elements.set(entry, el);
    return entry;
  }

  static entryOf(el: El, detail?: string): Change {
    const name = nameOf(el);
    return ChangeSet.about({ id: el.get<string | undefined>('id') ?? '', kind: ChangeSet.kindOf(el), ...(name ? { name } : {}), ...(detail ? { detail } : {}) }, el);
  }

  static flowEntryOf(flow: El, detail?: string): { id: string; kind: string; name?: string; detail: string } {
    const src = flow.get<El | undefined>('sourceRef');
    const tgt = flow.get<El | undefined>('targetRef');
    const name = flow.get<string | undefined>('name');
    return ChangeSet.about(
      {
        id: idOf(flow),
        kind: 'sequenceFlow',
        ...(name ? { name } : {}),
        detail: detail ?? `${src ? idOf(src) : '?'} -> ${tgt ? idOf(tgt) : '?'}`,
      },
      flow,
    );
  }

  private static kindOf(el: El): string {
    if (kindOf(el)) return kindLabel(el);
    if (is(el, 'bpmn:SequenceFlow')) return 'sequenceFlow';
    if (is(el, 'bpmn:MessageFlow')) return 'messageFlow';
    if (is(el, 'bpmn:DataAssociation')) return 'dataAssociation';
    if (is(el, 'bpmn:Association')) return 'association';
    const local = el.$type.split(':')[1] ?? el.$type;
    return local.charAt(0).toLowerCase() + local.slice(1);
  }

  /** A rename recorded for `next` also renames the entries an earlier op made for `old`. */
  static recordReplacement(old: El, next: El): void {
    if (old !== next) ChangeSet.successors.set(old, next);
  }

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
  notes: string[] = [];
  renames: Rename[] = [];
  bindings: Array<{ alias: string; el: El }> = [];
  /** the batch aliases follow a retype to another type */
  replaced: Array<{ from: El; to: El }> = [];
  /** nodes a `move` placed elsewhere, for the incremental layout; a no-op move keeps its drawing */
  relocated: string[] = [];

  create(change: Change): this {
    this.created.push(change);
    return this;
  }

  change(change: Change): this {
    if (!this.changed.some((existing) => existing.id === change.id && existing.detail === change.detail)) this.changed.push(change);
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
   * An element that took the freed id (a splice's new flow) keeps its entries. A rename onto the
   * id of an element this change removed is a takeover, so every id is listed once. A rename is
   * traced back to the id the element had in the file, as an earlier op may have renamed it already.
   */
  rename(renames: Rename[]): this {
    for (const rename of renames) {
      const el = ChangeSet.elements.get(rename);
      const renamed = el && ChangeSet.successorOf(el);
      const created = this.created.some((entry) => entry.id === rename.from || entry.id === rename.to);
      for (const entry of [...this.created, ...this.changed]) if (entry.id === rename.from && (!renamed || ChangeSet.successorOf(ChangeSet.elements.get(entry) ?? renamed) === renamed)) entry.id = rename.to;
      if (rename.regenerated) {
        const old = new RegExp(`(?<![A-Za-z0-9_.-])${rename.from.replace(/[.]/g, '\\.')}(?![A-Za-z0-9_.-])`, 'g');
        for (const entry of [...this.created, ...this.changed]) if (entry.detail) entry.detail = entry.detail.replace(old, rename.to);
        this.notes = this.notes.map((note) => note.replace(old, rename.to));
        this.warnings = this.warnings
          .filter((warning) => !(warning.code === 'W_ID_SUFFIXED' && warning.element === rename.from))
          .map((warning) => (warning.element === rename.from ? { ...warning, element: rename.to, message: warning.message.replace(old, rename.to), ...(warning.hint ? { hint: warning.hint.replace(old, rename.to) } : {}) } : warning));
      }
      const gone = rename.takeover || created ? -1 : this.removed.findIndex((entry) => entry.id === rename.to);
      if (gone === -1) {
        this.renames.push(rename);
        continue;
      }
      let origin = rename.from;
      for (let index = this.renames.length - 1; index >= 0; index--) if (this.renames[index]!.to === origin && !this.renames[index]!.takeover) origin = this.renames[index]!.from;
      this.removed[gone] = { id: origin, kind: this.removed[gone]!.kind, ...(rename.was && origin === rename.from ? { detail: rename.was } : {}) };
      for (const entry of this.changed) if (entry.id === rename.to && entry.detail) entry.detail = entry.detail.replace(renamedNote(rename.from), '');
      this.renames.push(ChangeSet.about({ ...rename, takeover: true as const }, el));
    }
    return this;
  }

  bind(alias: string | undefined, el: El | undefined): this {
    if (alias && el) this.bindings.push({ alias, el });
    return this;
  }

  /** Renames merge after the entries, so a rename onto an id an earlier op removed finds both (a takeover). */
  merge(other: ChangeSet): this {
    this.bindings.push(...other.bindings);
    this.replaced.push(...other.replaced);
    this.relocated.push(...other.relocated);
    this.created.push(...other.created);
    for (const change of other.changed) this.change(change);
    this.removed.push(...other.removed);
    this.warnings.push(...other.warnings);
    this.notes.push(...other.notes);
    this.rename(other.renames);
    return this;
  }

  get isEmpty(): boolean {
    return !this.created.length && !this.changed.length && !this.removed.length;
  }

  touchedIds(): string[] {
    const ids = new Set<string>();
    for (const entry of [...this.created, ...this.changed]) ids.add(entry.id);
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
