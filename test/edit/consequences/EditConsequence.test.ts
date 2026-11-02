import { describe, expect, it } from 'vitest';
import { EditConsequence } from '../../../src/edit/consequences/EditConsequence.js';
import { ChangeSet } from '../../support/ModelValues.js';

class ListedProblems extends EditConsequence<string> {
  current = new Set<string>();
  readonly repaired: string[] = [];

  findProblems(): Set<string> {
    return new Set(this.current);
  }

  repair(problem: string): void {
    this.repaired.push(problem);
  }
}

describe('EditConsequence', () => {
  it('repairs only the problems found at the end that were not there at the start', () => {
    const consequence = new ListedProblems();
    consequence.current = new Set(['inInputFile', 'fixedByBatch']);
    consequence.findProblemsAtStart();
    consequence.current = new Set(['inInputFile', 'causedByBatch']);

    consequence.repairNewProblems(new ChangeSet());

    expect(consequence.repaired).toEqual(['causedByBatch']);
  });
});
