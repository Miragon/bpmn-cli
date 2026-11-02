import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GUIDE_FOLDERS = ['src/cli/help/guide', 'src/cli/help/project', 'src/cli/help/tables'];

/**
 * Agents read the help guide in full, as context.
 * A guide that grows makes every agent call more expensive and the guide harder to follow.
 */
export class GuideSize {
  constructor(root, budgets) {
    this.root = root;
    this.budget = budgets.guideKilobytes;
  }

  async run() {
    if (this.budget === undefined) {
      return { problems: ['budgets.json lacks guideKilobytes'], summary: 'guide unmeasured' };
    }
    const folders = GUIDE_FOLDERS.map((folder) => join(this.root, folder)).filter(existsSync);
    const bytes = folders.flatMap((folder) => readdirSync(folder).map((name) => join(folder, name))).reduce((sum, file) => sum + statSync(file).size, 0);
    const kilobytes = Math.ceil(bytes / 100) / 10;
    const problems = kilobytes > this.budget ? [`the guide has ${kilobytes} KB, over its budget of ${this.budget}`] : [];
    return { problems, summary: `guide ${kilobytes} KB` };
  }
}
