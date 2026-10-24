import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { real } from './paths.js';

/**
 * The git directory of the repository at `dir` (without symlinks): undefined
 * for a `.git` directory (or a link to one), the directory a `.git` file
 * names (a worktree, a submodule: `gitdir: <path>`), or null for a `.git`
 * file that names no git directory (git takes it for no repository). Only a
 * regular file of at most 1 MiB is read, as git reads it: the lookup asks
 * before anyone's owner is checked, and a planted FIFO would block the read.
 */
export function gitDirOf(dir: string): string | undefined | null {
  const git = join(dir, '.git');
  try {
    const st = statSync(git);
    if (st.isDirectory()) return undefined;
    if (!st.isFile() || st.size > 1 << 20) return null;
    const text = readFileSync(git, 'utf8');
    if (!text.startsWith('gitdir: ')) return null;
    const gitdir = real(resolve(dir, text.slice('gitdir: '.length).replace(/[\r\n]+$/, '')));
    return statSync(gitdir).isDirectory() ? gitdir : null;
  } catch {
    return null;
  }
}
