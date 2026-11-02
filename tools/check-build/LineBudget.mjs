import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PARTS = [
  'src/model',
  'src/operations',
  'src/edit',
  'src/scoring',
  'src/drawing',
  'src/checks',
  'src/views',
  'src/write',
  'src/api',
  'src/cli',
  'packages/lint/src',
  'packages/render/src',
];

/**
 * Every module and package has a line budget, so the code cannot grow unnoticed.
 * Raising a budget is a decision that needs a reason in the commit, not something that just happens.
 */
export class LineBudget {
  static PARTS = PARTS;

  constructor(root, budgets) {
    this.root = root;
    this.budget = budgets.lines;
  }

  async run() {
    const lines = Object.fromEntries(PARTS.map((part) => [part, this.linesOf(part)]));
    const problems = PARTS.flatMap((part) => this.problemsOf(part, lines[part]));
    const total = Object.values(lines).reduce((sum, count) => sum + count, 0);
    if (total > this.budget.total) {
      problems.push(`src/ and packages/ have ${total} lines, over their budget of ${this.budget.total}`);
    }
    return { problems, summary: `${total} lines` };
  }

  problemsOf(part, lines) {
    if (this.budget[part] === undefined) {
      return [`${part} has no line budget`];
    }
    if (lines > this.budget[part]) {
      return [`${part} has ${lines} lines, over its budget of ${this.budget[part]}; raising it needs a reason in the commit`];
    }
    return [];
  }

  linesOf(part) {
    return this.sourceFiles(join(this.root, part)).reduce((sum, file) => sum + readFileSync(file, 'utf8').trimEnd().split('\n').length, 0);
  }

  sourceFiles(folder) {
    if (!existsSync(folder)) {
      return [];
    }
    return readdirSync(folder).flatMap((name) => {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) {
        return this.sourceFiles(path);
      }
      return path.endsWith('.ts') ? [path] : [];
    });
  }
}
