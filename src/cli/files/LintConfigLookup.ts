import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export class LintConfigLookup {
  static readonly FILE_NAME = '.bpmnlintrc';

  private static readonly MAX_GIT_FILE_BYTES = 1 << 20;
  private static readonly GIT_FILE_PREFIX = 'gitdir: ';

  private readonly given: string;

  constructor(startDirectory: string) {
    this.given = resolve(startDirectory);
  }

  private static isFile(path: string): boolean {
    try {
      return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
    } catch {
      return false;
    }
  }

  private static gitRootAbove(start: string): string | undefined {
    for (let directory = start; ; directory = dirname(directory)) {
      if (existsSync(join(directory, '.git'))) {
        return directory;
      }
      if (dirname(directory) === directory) {
        return undefined;
      }
    }
  }

  private static namesARepository(root: string): boolean {
    const git = join(LintConfigLookup.real(root), '.git');
    try {
      const status = statSync(git);
      if (status.isDirectory()) {
        return true;
      }
      if (!status.isFile() || status.size > LintConfigLookup.MAX_GIT_FILE_BYTES) {
        return false;
      }
      const text = readFileSync(git, 'utf8');
      const named = text.slice(LintConfigLookup.GIT_FILE_PREFIX.length).replace(/[\r\n]+$/, '');
      return text.startsWith(LintConfigLookup.GIT_FILE_PREFIX) && statSync(resolve(dirname(git), named)).isDirectory();
    } catch {
      return false;
    }
  }

  private static real(path: string): string {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  }

  private static above(start: string): string | undefined {
    for (let directory = start; ; directory = dirname(directory)) {
      const candidate = join(directory, LintConfigLookup.FILE_NAME);
      if (LintConfigLookup.isFile(candidate)) {
        return candidate;
      }
      if (existsSync(join(directory, '.git')) || dirname(directory) === directory) {
        return undefined;
      }
    }
  }

  private static from(start: string): string | undefined {
    const found = LintConfigLookup.above(start);
    if (found === undefined || dirname(found) === start) {
      return found;
    }
    const root = LintConfigLookup.gitRootAbove(start);
    return root !== undefined && LintConfigLookup.namesARepository(root) ? found : undefined;
  }

  nearest(): string | undefined {
    const physical = this.physical();
    return LintConfigLookup.from(this.given) ?? (physical === this.given ? undefined : LintConfigLookup.from(physical));
  }

  private physical(): string {
    const rest: string[] = [];
    for (let directory = this.given; ; directory = dirname(directory)) {
      try {
        return join(realpathSync(directory), ...rest.reverse());
      } catch {
        if (dirname(directory) === directory) {
          return this.given;
        }
        rest.push(basename(directory));
      }
    }
  }
}
