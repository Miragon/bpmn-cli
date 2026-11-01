import { LayoutRequests } from '../diagram/LayoutRequests.js';
import type { Finding } from '../findings/Findings.js';
import type { BpmnElement } from './BpmnElement.js';
import { ChangeEntries, type Change, type Rename } from './ChangeEntries.js';

export class ChangeSet {
  created: Change[] = [];
  changed: Change[] = [];
  removed: Change[] = [];
  warnings: Finding[] = [];
  notes: string[] = [];
  renames: Rename[] = [];
  bindings: Array<{ alias: string; el: BpmnElement }> = [];
  replaced: Array<{ from: BpmnElement; to: BpmnElement }> = [];
  relocated: string[] = [];
  readonly expansions = new LayoutRequests();

  create(change: Change): this {
    this.created.push(change);
    return this;
  }

  change(change: Change): this {
    if (!this.changed.some((existing) => existing.id === change.id && existing.detail === change.detail)) {
      this.changed.push(change);
    }
    return this;
  }

  remove(change: Change): this {
    this.removed.push(change);
    return this;
  }

  warn(warning: Finding): this {
    this.warnings.push(warning);
    return this;
  }

  note(text: string): this {
    this.notes.push(text);
    return this;
  }

  rename(renames: Rename[]): this {
    for (const rename of renames) {
      this.applyRename(rename);
    }
    return this;
  }

  bind(alias: string | undefined, element: BpmnElement | undefined): this {
    if (alias && element) {
      this.bindings.push({ alias, el: element });
    }
    return this;
  }

  merge(other: ChangeSet): this {
    this.bindings.push(...other.bindings);
    this.replaced.push(...other.replaced);
    this.relocated.push(...other.relocated);
    this.expansions.merge(other.expansions);
    this.created.push(...other.created);
    for (const change of other.changed) {
      this.change(change);
    }
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
    return [...new Set([...this.created, ...this.changed].map((entry) => entry.id))];
  }

  toJSON(): Record<string, unknown> {
    return { created: this.created, changed: this.changed, removed: this.removed, warnings: this.warnings, notes: this.notes };
  }

  private applyRename(rename: Rename): void {
    const element = ChangeEntries.elementOf(rename);
    const created = this.created.some((entry) => entry.id === rename.from || entry.id === rename.to);
    this.renameEntries(rename, element && ChangeEntries.successorOf(element));
    if (rename.regenerated) {
      this.followRegenerated(rename);
    }
    const gone = rename.takeover || created ? -1 : this.removed.findIndex((entry) => entry.id === rename.to);
    if (gone === -1) {
      this.renames.push(rename);
    } else {
      this.recordTakeover(rename, gone, element);
    }
  }

  private renameEntries(rename: Rename, renamed: BpmnElement | undefined): void {
    for (const entry of [...this.created, ...this.changed]) {
      if (entry.id === rename.from && (!renamed || ChangeEntries.successorOf(ChangeEntries.elementOf(entry) ?? renamed) === renamed)) {
        entry.id = rename.to;
      }
    }
  }

  private followRegenerated(rename: Rename): void {
    const old = new RegExp(`(?<![A-Za-z0-9_.-])${rename.from.replace(/[.]/g, '\\.')}(?![A-Za-z0-9_.-])`, 'g');
    for (const entry of [...this.created, ...this.changed]) {
      if (entry.detail) {
        entry.detail = entry.detail.replace(old, rename.to);
      }
    }
    this.notes = this.notes.map((note) => note.replace(old, rename.to));
    this.warnings = this.warnings
      .filter((warning) => !(warning.code === 'W_ID_SUFFIXED' && warning.element === rename.from))
      .map((warning) => (warning.element === rename.from ? { ...warning, element: rename.to, message: warning.message.replace(old, rename.to), ...(warning.hint ? { hint: warning.hint.replace(old, rename.to) } : {}) } : warning));
  }

  private recordTakeover(rename: Rename, gone: number, element: BpmnElement | undefined): void {
    const origin = this.originOf(rename.from);
    this.removed[gone] = { id: origin, kind: this.removed[gone]!.kind, ...(rename.was && origin === rename.from ? { detail: rename.was } : {}) };
    for (const entry of this.changed) {
      if (entry.id === rename.to && entry.detail) {
        entry.detail = entry.detail.replace(ChangeEntries.renamedNote(rename.from), '');
      }
    }
    this.renames.push(ChangeEntries.about({ ...rename, takeover: true as const }, element));
  }

  private originOf(id: string): string {
    let origin = id;
    for (const earlier of [...this.renames].reverse()) {
      if (earlier.to === origin && !earlier.takeover) {
        origin = earlier.from;
      }
    }
    return origin;
  }
}
