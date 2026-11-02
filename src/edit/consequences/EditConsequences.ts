import type { ChangeSet } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { DataIntoCollapsedSubProcess, type ElementDeletion } from './DataIntoCollapsedSubProcess.js';
import type { EditConsequence } from './EditConsequence.js';
import { UnusedRootElements } from './UnusedRootElements.js';

/**
 * Runs every EditConsequence around a batch of operations: once before the first operation and once after the last.
 * Checking once per batch, not per operation, keeps a message that the batch unlinks and links again.
 */
export class EditConsequences {
  private readonly consequences: readonly EditConsequence<unknown>[];

  constructor(edit: EditSession, deletion: ElementDeletion) {
    this.consequences = [
      new DataIntoCollapsedSubProcess(edit, deletion),
      new UnusedRootElements(edit),
    ];
  }

  findProblemsAtStart(): void {
    for (const consequence of this.consequences) {
      consequence.findProblemsAtStart();
    }
  }

  repairNewProblems(changes: ChangeSet): void {
    for (const consequence of this.consequences) {
      consequence.repairNewProblems(changes);
    }
  }
}
