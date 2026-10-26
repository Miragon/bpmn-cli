import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface FindUpOptions {
  /** end the walk after the first directory holding a `.git` (directory or worktree file) */
  stopAtGitRoot?: boolean;
}

export interface FoundUp {
  dir: string;
  name: string;
}

/**
 * The nearest directory from `startDir` upwards in which one of `names` is a regular file;
 * within one directory the order of `names` decides.
 */
export function findUp(startDir: string, names: readonly string[], opts: FindUpOptions = {}): FoundUp | undefined {
  for (let dir = resolve(startDir); ; dir = dirname(dir)) {
    const name = names.find((candidate) => isFile(join(dir, candidate)));
    if (name !== undefined) return { dir, name };
    if (opts.stopAtGitRoot && existsSync(join(dir, '.git'))) return undefined;
    if (dirname(dir) === dir) return undefined;
  }
}

export function gitRoot(startDir: string): string | undefined {
  for (let dir = resolve(startDir); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}
