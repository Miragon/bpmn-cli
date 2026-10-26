import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { real } from './paths.js';

/**
 * undefined for a `.git` directory, the directory a `.git` file names, or null when it names
 * none. Only a regular file of at most 1 MiB is read, as git does: a planted FIFO would block.
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
