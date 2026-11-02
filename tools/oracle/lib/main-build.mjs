import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_STAMP, MAIN_ROOT, REPO_ROOT, WORK_DIR } from './paths.mjs';

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function run(command, args) {
  execFileSync(command, args, { cwd: MAIN_ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
}

export function baseCommit() {
  return git('merge-base', 'HEAD', 'origin/main');
}

function builtCommit() {
  if (!existsSync(BUILD_STAMP) || !existsSync(join(MAIN_ROOT, 'dist', 'index.js'))) {
    return undefined;
  }
  return JSON.parse(readFileSync(BUILD_STAMP, 'utf8')).commit;
}

function dropOldWorktree() {
  rmSync(BUILD_STAMP, { force: true });
  if (existsSync(MAIN_ROOT)) {
    rmSync(MAIN_ROOT, { recursive: true, force: true });
  }
  git('worktree', 'prune');
}

export function ensureMainBuilt({ log = () => {} } = {}) {
  const commit = baseCommit();
  if (builtCommit() === commit) {
    return { commit, cached: true };
  }
  log(`building main at ${commit}`);
  dropOldWorktree();
  mkdirSync(WORK_DIR, { recursive: true });
  git('worktree', 'add', '--detach', MAIN_ROOT, commit);
  run('npm', ['ci', '--no-audit', '--no-fund']);
  run('npm', ['run', 'build']);
  writeFileSync(BUILD_STAMP, `${JSON.stringify({ commit })}\n`);
  return { commit, cached: false };
}
