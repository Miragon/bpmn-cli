import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitRoot } from './utils/find-up.js';
import { gitDirOf } from './utils/git.js';
import { inside, real } from './utils/paths.js';

/**
 * Why a repository does not count as the user's (repoOf): `owner`, it
 * belongs to another user; `gitfile`, its `.git` is a file that names no
 * git directory (git takes it for no repository either); `home`, there are
 * no uids (Windows) and it lies outside the home directory.
 */
export type RepoOff = 'owner' | 'gitfile' | 'home';

/** A git repository: its root and, when it does not count as the user's, why. */
export interface Repo {
  root: string;
  off?: RepoOff;
}

/**
 * Whether a repository is the user's, checked as git does it
 * (is_path_owned_by_current_uid; git's safe.directory is not read): the
 * directory, its `.git` and, for a `.git` file (a worktree, a submodule:
 * `gitdir: <path>`), the directory it names belong to the user running
 * bpmn-cli. A `.git` link or hard link of another user (to `/`, to a file of
 * root) does not count, nor a `.git` file whose git directory is missing.
 * Where there are no uids (Windows: Node reads no owner there), only a
 * repository inside the user's home directory counts, not one in a
 * directory every user may create (`C:\.git`, CVE-2022-24765). Only project
 * code (the project tier) depends on it.
 */
export class RepoTrust {
  private readonly uid = process.getuid?.();

  /** The git repository of a directory (its root, and why it does not count as the user's); undefined outside one. */
  repoOf(dir: string): Repo | undefined {
    const root = gitRoot(dir);
    if (root === undefined) return undefined;
    const off = this.offOf(root);
    return off ? { root, off } : { root };
  }

  private offOf(root: string): RepoOff | undefined {
    const dir = real(root);
    if (this.uid !== undefined && (!this.owned(dir) || !this.owned(join(dir, '.git')))) return 'owner';
    const gitdir = gitDirOf(dir);
    if (gitdir === null) return 'gitfile';
    if (this.uid === undefined) return this.inHome(dir) ? undefined : 'home';
    return gitdir === undefined || this.owned(gitdir) ? undefined : 'owner';
  }

  /**
   * A path of the user, as git decides it (is_path_owned_by_current_uid):
   * the owner of the path itself (lstat: a symbolic link counts by its own
   * owner, not by what it points to); root's paths only for root, and root
   * under sudo also those of the SUDO_UID sudo sets (decimal digits; git's
   * strtoul also takes a leading blank or `+`, which sudo never writes).
   */
  private owned(path: string): boolean {
    let owner: number;
    try {
      owner = lstatSync(path).uid;
    } catch {
      return false;
    }
    if (owner === this.uid) return true;
    const sudo = process.env['SUDO_UID'];
    return this.uid === 0 && sudo !== undefined && /^\d+$/.test(sudo) && owner === Number(sudo);
  }

  /** Whether `dir` lies inside the user's home directory, and is no filesystem root (the check where there are no uids). */
  private inHome(dir: string): boolean {
    let home: string;
    try {
      home = homedir();
    } catch {
      return false;
    }
    return home !== '' && dirname(dir) !== dir && inside(dir, real(home));
  }
}
