import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE_SOURCE = 'src/';

/**
 * budgets.json names every module and package once, in its line budgets; the gates read the list from there.
 */
export class BudgetedParts {
  constructor(budgets) {
    this.parts = Object.keys(budgets.lines).filter((part) => part !== 'total');
  }

  static of(root) {
    return new BudgetedParts(JSON.parse(readFileSync(join(root, 'budgets.json'), 'utf8')));
  }

  coreModules() {
    return this.parts.filter((part) => part.startsWith(CORE_SOURCE)).map((part) => part.slice(CORE_SOURCE.length));
  }
}
