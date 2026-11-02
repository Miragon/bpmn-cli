import { LineBudget } from './LineBudget.mjs';

const FLOOR = { lines: 90, branches: 85 };

/**
 * The coverage thresholds in budgets.json are only ever raised.
 * Without this check a failing coverage run could be silenced by lowering the floor.
 */
export class CoverageFloors {
  constructor(_root, budgets) {
    this.coverage = budgets.coverage;
  }

  async run() {
    const lowered = LineBudget.PARTS.filter((part) => this.isBelowFloor(this.coverage[part]));
    const problems = lowered.map((part) => `${part}: coverage below ${FLOOR.lines} % lines, ${FLOOR.branches} % branches; coverage is raised only`);
    return { problems, summary: `coverage at least ${FLOOR.lines} % lines, ${FLOOR.branches} % branches` };
  }

  isBelowFloor(floor) {
    return floor?.lines === undefined || floor.lines < FLOOR.lines || floor.branches < FLOOR.branches;
  }
}
