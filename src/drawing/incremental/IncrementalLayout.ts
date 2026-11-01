import type { BpmnDocument, ChangeSet } from '../../model/index.js';
import type { DrawingSnapshot } from '../DrawingSnapshot.js';

export interface IncrementalReport {
  placed: string[];
  moved: string[];
  rerouted: string[];
  reshaped: string[];
  pruned: string[];
  notes: string[];
}

export class IncrementalLayout {
  constructor(
    private readonly document: BpmnDocument,
    private readonly before: DrawingSnapshot,
  ) {}

  place(changes: ChangeSet): Promise<IncrementalReport> {
    return Promise.reject(new Error(`IncrementalLayout is not ported yet: ${this.document.tree.definitions.type}, ${this.before.isEmpty()}, ${changes.isEmpty}`));
  }
}
