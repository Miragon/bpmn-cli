import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { findUp, gitRoot } from './utils/find-up.js';
import { gitDirOf } from './utils/git.js';
import { real } from './utils/paths.js';

export const BPMNLINT_CONFIG_FILE = '.bpmnlintrc';

/**
 * The nearest .bpmnlintrc from a start directory upwards, not above the repository root;
 * outside a repository only the start directory counts, as with bpmnlint's CLI. When nothing
 * is found through a symlinked start directory, it looks again from the physical one, like git.
 */
export class ConfigLookup {
  private readonly given: string;

  constructor(startDir: string) {
    this.given = resolve(startDir);
  }

  nearest(): string | undefined {
    const found = this.from(this.given);
    if (found !== undefined) return found;
    const physical = this.physical();
    return physical !== this.given ? this.from(physical) : undefined;
  }

  /** Resolves symlinks of the deepest existing ancestor; a write may create the rest. */
  private physical(): string {
    const rest: string[] = [];
    for (let d = this.given; ; d = dirname(d)) {
      try {
        return join(realpathSync(d), ...rest.reverse());
      } catch {
        if (dirname(d) === d) return this.given;
        rest.push(basename(d));
      }
    }
  }

  private from(startDir: string): string | undefined {
    const found = findUp(startDir, [BPMNLINT_CONFIG_FILE], { stopAtGitRoot: true });
    if (!found) return undefined;
    // a parent directory counts only inside a repository: not ~ or /tmp for every model below them
    if (found.dir !== startDir) {
      const root = gitRoot(startDir);
      if (root === undefined || gitDirOf(real(root)) === null) return undefined;
    }
    return join(found.dir, found.name);
  }
}
