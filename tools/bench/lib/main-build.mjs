import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LAST_RELEASE_BEFORE_THE_REFACTORING = 'v0.9.0';
export const WORK_DIR = join(REPO_ROOT, '.work');
export const MAIN_ROOT = join(WORK_DIR, 'main');
export const SCORERS_ROOT = join(WORK_DIR, 'scorers');

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

const stampOf = (root) => `${root}-build.json`;

function builtCommit(root) {
  if (!existsSync(stampOf(root)) || !existsSync(join(root, 'dist', 'index.js'))) {
    return undefined;
  }
  return JSON.parse(readFileSync(stampOf(root), 'utf8')).commit;
}

function dropOldWorktree(root) {
  rmSync(stampOf(root), { force: true });
  if (existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }
  git('worktree', 'prune');
}

function ensureBuilt(root, commit, log) {
  if (builtCommit(root) === commit) {
    return { commit, cached: true };
  }
  log(`building ${commit} in ${root}`);
  dropOldWorktree(root);
  mkdirSync(WORK_DIR, { recursive: true });
  git('worktree', 'add', '--detach', root, commit);
  for (const script of [['ci', '--no-audit', '--no-fund'], ['run', 'build']]) {
    execFileSync('npm', script, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  writeFileSync(stampOf(root), `${JSON.stringify({ commit })}\n`);
  return { commit, cached: false };
}

export function ensureMainBuilt({ log = () => {} } = {}) {
  return ensureBuilt(MAIN_ROOT, git('merge-base', 'HEAD', 'origin/main'), log);
}

export function ensureScorersBuilt({ log = () => {} } = {}) {
  return ensureBuilt(SCORERS_ROOT, git('rev-parse', `${LAST_RELEASE_BEFORE_THE_REFACTORING}^{commit}`), log);
}
