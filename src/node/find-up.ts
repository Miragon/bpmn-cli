/**
 * The upward lookup of a file by name (Node only): the nearest directory, from
 * a start directory up to the filesystem root, that holds one of some names
 * as a regular file. The .bpmnlintrc lookup (src/node/bpmnlint.ts) runs it.
 *
 *   findUp(dir, ['a.yml', 'b.yml'])                        -> { dir, name } of the nearest directory with either
 *   findUp(dir, ['.bpmnlintrc'], { stopAtGitRoot: true })  -> the same, but not above the repository's root
 *   gitRoot(dir)                                           -> that root: the nearest directory holding a .git, or undefined
 *
 * Within one directory the order of `names` decides: the first name that is a
 * regular file there wins, and the walk ends in that directory. A directory or
 * a dangling link that carries a name does not count, and the walk goes on.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface FindUpOptions {
  /** end the walk at the first directory that holds a `.git` (a directory, or the file of a worktree or submodule), after looking in it */
  stopAtGitRoot?: boolean;
}

/** Where findUp found a name: the directory (absolute) and the name, one of the names it was given. */
export interface FoundUp {
  dir: string;
  name: string;
}

/** The nearest directory from `startDir` upwards in which one of `names` is a regular file, with the first such name (see the module header). */
export function findUp(startDir: string, names: readonly string[], opts: FindUpOptions = {}): FoundUp | undefined {
  for (let dir = resolve(startDir); ; dir = dirname(dir)) {
    const name = names.find((n) => isFile(join(dir, n)));
    if (name !== undefined) return { dir, name };
    if (opts.stopAtGitRoot && existsSync(join(dir, '.git'))) return undefined;
    if (dirname(dir) === dir) return undefined;
  }
}

/** The repository root of `startDir`: the nearest directory from it upwards that holds a `.git` (a directory or a file), or undefined. */
export function gitRoot(startDir: string): string | undefined {
  for (let dir = resolve(startDir); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** A regular file, or a link to one (a directory, a dangling link or an unreadable path is not). */
function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}
