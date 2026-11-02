import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BrowserEntries } from './BrowserEntries.mjs';
import { CliSize } from './CliSize.mjs';
import { CoverageFloors } from './CoverageFloors.mjs';
import { DesignIqImports } from './DesignIqImports.mjs';
import { GuideSize } from './GuideSize.mjs';
import { LineBudget } from './LineBudget.mjs';
import { RuntimeExports } from './RuntimeExports.mjs';
import { WriteBundle } from './WriteBundle.mjs';

const GROUPS = {
  budgets: [LineBudget, CoverageFloors, RuntimeExports, CliSize, GuideSize],
  iso: [BrowserEntries, DesignIqImports],
  bundle: [WriteBundle],
};

async function runGroup(name, root, budgets) {
  const lines = [];
  for (const Check of GROUPS[name]) {
    const { problems, summary } = await new Check(root, budgets).run();
    if (problems.length > 0) {
      return { failed: true, lines: [...lines, ...problems.map((problem) => `${name}: ${problem}`)] };
    }
    lines.push(`${name}: ${summary}`);
  }
  return { failed: false, lines };
}

const [rootArgument = '.', ...groupArguments] = process.argv.slice(2);
const root = realpathSync(resolve(rootArgument));
const budgets = JSON.parse(readFileSync(join(root, 'budgets.json'), 'utf8'));
const groups = groupArguments.length > 0 ? groupArguments : Object.keys(GROUPS);
const results = await Promise.all(groups.map((name) => runGroup(name, root, budgets)));
for (const { failed, lines } of results) {
  lines.forEach((line) => (failed ? console.error(line) : console.log(line)));
}
process.exit(results.some(({ failed }) => failed) ? 1 : 0);
