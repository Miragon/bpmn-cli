import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitRoot } from './utils/find-up.js';
import { gitDirOf } from './utils/git.js';
import { inside, real } from './utils/paths.js';

/**
 * `owner`: another user's; `gitfile`: a `.git` file naming no git directory;
 * `home`: no uids (Windows) and outside the home directory.
 */
export type RepoOff = 'owner' | 'gitfile' | 'home';

export interface Repo {
  root: string;
  off?: RepoOff;
}

/**
 * Whether a repository is the current user's, checked the way git checks ownership
 * (is_path_owned_by_current_uid, safe.directory not read). Without uids (Windows) only a
 * repository inside the home directory counts, so a planted `C:\.git` does not (CVE-2022-24765).
 */
export class RepoTrust {
  private readonly uid = process.getuid?.();

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
   * lstat: a symbolic link counts by its own owner. Root also owns what SUDO_UID owns, as in git.
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
