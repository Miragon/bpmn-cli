import type { ChangeSet } from '../../model/index.js';

/**
 * One rule an edit must keep, such as "no message is left without a reference".
 * It looks for its problems at the start and at the end of a batch and repairs only the new ones,
 * so an operation never has to remember the cleanup, and what the input file already had stays untouched.
 */
export abstract class EditConsequence<Problem> {
  private problemsAtStart = new Set<Problem>();

  abstract findProblems(): Set<Problem>;

  abstract repair(problem: Problem, changes: ChangeSet): void;

  findProblemsAtStart(): void {
    this.problemsAtStart = this.findProblems();
  }

  repairNewProblems(changes: ChangeSet): void {
    const problemsAtEnd = this.findProblems();
    const problemsCausedByBatch = [...problemsAtEnd].filter((problem) => this.isCausedByBatch(problem, this.problemsAtStart));
    for (const problem of problemsCausedByBatch) {
      this.repair(problem, changes);
    }
  }

  protected isCausedByBatch(problem: Problem, problemsAtStart: ReadonlySet<Problem>): boolean {
    return !problemsAtStart.has(problem);
  }
}
