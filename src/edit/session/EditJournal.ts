import { type BpmnElement, ChangeEntries, type IdState, type Rename } from '../../model/index.js';

export interface KeptIdState {
  before: IdState;
  wasLabel: string;
}

export interface DroppedContent {
  element: string;
  kind: string;
  removed: string[];
}

export class EditJournal {
  private renames: Rename[] = [];
  private idStates = new Map<string, KeptIdState>();
  private readonly dropped: DroppedContent[] = [];

  recordRename(from: string, to: string, was?: string, el?: BpmnElement): void {
    this.renames.push(ChangeEntries.about({ from, to, ...(was ? { was } : {}) }, el));
  }

  recordRegenerated(from: string, to: string, was?: string, el?: BpmnElement): void {
    this.renames.push(ChangeEntries.about({ from, to, ...(was ? { was } : {}), regenerated: true as const }, el));
  }

  takeRenames(): Rename[] {
    const out = this.renames;
    this.renames = [];
    return out;
  }

  recordIdState(id: string, before: IdState, wasLabel: string): void {
    if (!this.idStates.has(id)) {
      this.idStates.set(id, { before, wasLabel });
    }
  }

  takeIdStates(): Map<string, KeptIdState> {
    const out = this.idStates;
    this.idStates = new Map();
    return out;
  }

  clearIdStates(): void {
    this.idStates.clear();
  }

  recordDroppedContent(drop: DroppedContent): void {
    this.dropped.push(drop);
  }

  get droppedContent(): readonly DroppedContent[] {
    return this.dropped;
  }
}
