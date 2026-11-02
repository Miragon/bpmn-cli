import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SourceTree } from './SourceTree.mjs';

/**
 * src/ holds exactly the modules of docs/architecture.md, so a new folder there is a decision, not an accident.
 */
export class CoreLayout {
  constructor(tree) {
    this.tree = tree;
  }

  run() {
    const source = join(this.tree.root, 'src');
    const problems = [];
    for (const name of readdirSync(source)) {
      const isFolder = statSync(join(source, name)).isDirectory();
      if (isFolder && !SourceTree.MODULES.includes(name)) {
        problems.push(`src/${name}: is no module of docs/architecture.md`);
      }
      if (!isFolder && name !== 'index.ts') {
        problems.push(`src/${name}: the root of src/ holds only index.ts`);
      }
    }
    for (const module of SourceTree.MODULES) {
      if (!existsSync(join(source, module, 'index.ts'))) {
        problems.push(`src/${module}: has no index.ts`);
      }
    }
    return { problems, summary: `${SourceTree.MODULES.length} modules` };
  }
}
