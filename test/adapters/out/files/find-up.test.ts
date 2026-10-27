/**
 * The upward file lookup of the node layer (src/adapters/out/files/utils/find-up.ts): the nearest
 * directory with one of some names as a regular file, the first name of the
 * list winning within a directory, optionally not above the git root; and
 * that root itself (gitRoot).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findUp, gitRoot } from '../../../../src/adapters/out/files/utils/find-up.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-find-up-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A fresh directory tree under the test directory: `a/b/c`, returned as [root, deepest]. */
function tree(name: string): [string, string] {
  const root = join(dir, name);
  const deep = join(root, 'a', 'b', 'c');
  mkdirSync(deep, { recursive: true });
  return [root, deep];
}

describe('findUp', () => {
  it('finds the nearest directory with one of the names, from the start directory itself upwards', () => {
    const [root, deep] = tree('nearest');
    writeFileSync(join(root, 'x.yml'), '');
    writeFileSync(join(root, 'a', 'x.yml'), '');
    expect(findUp(deep, ['x.yml'])).toEqual({ dir: join(root, 'a'), name: 'x.yml' });
    writeFileSync(join(deep, 'x.yml'), '');
    expect(findUp(deep, ['x.yml'])).toEqual({ dir: deep, name: 'x.yml' });
    expect(findUp(deep, ['missing.yml'])).toBeUndefined();
  });

  it('within a directory the order of the names decides; a nearer directory wins over the order', () => {
    const [root, deep] = tree('order');
    writeFileSync(join(root, 'first.yml'), '');
    writeFileSync(join(root, 'second.yml'), '');
    expect(findUp(deep, ['first.yml', 'second.yml'])).toEqual({ dir: root, name: 'first.yml' });
    expect(findUp(deep, ['second.yml', 'first.yml'])).toEqual({ dir: root, name: 'second.yml' });
    writeFileSync(join(root, 'a', 'second.yml'), '');
    expect(findUp(deep, ['first.yml', 'second.yml'])).toEqual({ dir: join(root, 'a'), name: 'second.yml' });
  });

  it('a directory or a dangling link with the name does not count and does not end the walk; a link to a file does', () => {
    const [root, deep] = tree('kinds');
    writeFileSync(join(root, 'x.yml'), '');
    mkdirSync(join(root, 'a', 'b', 'x.yml'));
    symlinkSync(join(root, 'nowhere'), join(root, 'a', 'x.yml'));
    expect(findUp(deep, ['x.yml'])).toEqual({ dir: root, name: 'x.yml' });
    // the second name in a directory whose first name is a directory
    writeFileSync(join(root, 'a', 'b', 'y.yml'), '');
    expect(findUp(deep, ['x.yml', 'y.yml'])).toEqual({ dir: join(root, 'a', 'b'), name: 'y.yml' });
    symlinkSync(join(root, 'x.yml'), join(deep, 'x.yml'));
    expect(findUp(deep, ['x.yml'])).toEqual({ dir: deep, name: 'x.yml' });
  });

  it('stopAtGitRoot ends the walk at a .git directory or file, after looking in that directory', () => {
    const [root, deep] = tree('git');
    writeFileSync(join(root, 'x.yml'), '');
    expect(findUp(deep, ['x.yml'], { stopAtGitRoot: true })).toEqual({ dir: root, name: 'x.yml' });
    // a worktree or submodule: .git is a file
    writeFileSync(join(root, 'a', '.git'), 'gitdir: ../.git/worktrees/a\n');
    expect(findUp(deep, ['x.yml'], { stopAtGitRoot: true })).toBeUndefined();
    expect(findUp(deep, ['x.yml'])).toEqual({ dir: root, name: 'x.yml' });
    // the git root itself is looked in
    writeFileSync(join(root, 'a', 'x.yml'), '');
    expect(findUp(deep, ['x.yml'], { stopAtGitRoot: true })).toEqual({ dir: join(root, 'a'), name: 'x.yml' });
    // a .git directory
    mkdirSync(join(deep, '.git'));
    expect(findUp(deep, ['x.yml'], { stopAtGitRoot: true })).toBeUndefined();
  });

  it('a relative start directory is resolved against the working directory; the result is absolute', () => {
    const [root, deep] = tree('relative');
    writeFileSync(join(root, 'x.yml'), '');
    expect(findUp(relative(process.cwd(), deep), ['x.yml'])).toEqual({ dir: root, name: 'x.yml' });
    expect(findUp(join(root, 'a', '.', 'b', '..'), ['x.yml'])).toEqual({ dir: root, name: 'x.yml' });
  });
});

describe('gitRoot', () => {
  it('is the nearest directory holding a .git (a directory or a file), from the start directory itself upwards', () => {
    const [root, deep] = tree('root');
    mkdirSync(join(root, '.git'));
    expect(gitRoot(deep)).toBe(root);
    expect(gitRoot(root)).toBe(root);
    // a worktree or submodule: .git is a file
    writeFileSync(join(root, 'a', '.git'), 'gitdir: ../.git/worktrees/a\n');
    expect(gitRoot(deep)).toBe(join(root, 'a'));
    expect(gitRoot(relative(process.cwd(), deep))).toBe(join(root, 'a'));
  });
});
