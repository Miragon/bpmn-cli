import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { findUp, gitRoot } from './utils/find-up.js';
import { gitDirOf } from './utils/git.js';
import { real } from './utils/paths.js';

export const BPMNLINT_CONFIG_FILE = '.bpmnlintrc';

/**
 * The nearest .bpmnlintrc from a start directory upwards, not above the
 * repository root (a `.git` directory or file), whoever owns the repository
 * (RepoTrust decides only about project code): a .bpmnlintrc switches on
 * rules bpmn-cli ships and names moddle JSON (read, never run), and its
 * findings are advisory. Outside a repository (also under a `.git` file that
 * names no git directory, which git takes for no repository either) only the
 * start directory counts (bpmnlint's CLI reads only its working directory).
 * The walk takes the path as given; where it finds nothing and the start
 * directory is reached through a symbolic link, it walks again from the
 * physical directory, as git finds the repository (a model in a linked
 * directory gets its repository's .bpmnlintrc, also in a subdirectory a write
 * is about to create; an in-repository link to a directory outside keeps the
 * repository's; a linked model file counts by the directory of the link).
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

  /**
   * The start directory without symlinks, also where it does not exist yet (a
   * write into a new subdirectory): its deepest existing ancestor without
   * symlinks, the rest as given.
   */
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

  /** The lookup on one spelling of the start directory. */
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
