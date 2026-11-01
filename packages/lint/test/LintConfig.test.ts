import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LintConfig } from '../src/LintConfig.js';

function folderOutsideAnyRepository(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'lint-config-')));
}

function repository(): string {
  const root = folderOutsideAnyRepository();
  execFileSync('git', ['init', '--quiet', root]);
  return root;
}

function configIn(folder: string, text = '{}'): LintConfig {
  writeFileSync(join(folder, '.bpmnlintrc'), text);
  return new LintConfig(join(folder, '.bpmnlintrc'));
}

describe('LintConfig', () => {
  it('reads the rules of a .bpmnlintrc that starts with a byte order mark', () => {
    const config = configIn(repository(), '﻿{ "extends": "bpmnlint:recommended" }');
    expect(config.content).toEqual({ extends: 'bpmnlint:recommended' });
    expect(config.unavailable).toEqual([]);
  });

  it.each([
    ['comments', '{ // no\n }', 'is not JSON'],
    ['an array', '[]', 'not a JSON object'],
  ])('leaves bpmnlint out for a .bpmnlintrc holding %s', (_, text, reason) => {
    const config = configIn(repository(), text);
    expect(config.content).toEqual({});
    expect(config.unavailable[0]?.kind).toBe('file');
    expect(config.unavailable[0]?.reason).toContain(reason);
  });

  it('leaves bpmnlint out when the .bpmnlintrc cannot be read', () => {
    const config = new LintConfig(join(repository(), '.bpmnlintrc'));
    expect(config.unavailable[0]?.reason).toContain('cannot be read');
  });

  it('trusts project plugins in a git repository the user owns, from any folder below it', () => {
    const root = repository();
    mkdirSync(join(root, 'models'));
    expect(configIn(join(root, 'models')).pluginsOff()).toBeUndefined();
  });

  it('trusts project plugins in a worktree whose .git file names a git directory of the user', () => {
    const root = folderOutsideAnyRepository();
    const gitDirectory = folderOutsideAnyRepository();
    writeFileSync(join(root, '.git'), `gitdir: ${gitDirectory}\n`);
    expect(configIn(root).pluginsOff()).toBeUndefined();
  });

  it('runs no project plugin outside a git repository', () => {
    expect(configIn(folderOutsideAnyRepository()).pluginsOff()?.why).toContain('only inside a git repository');
  });

  it('runs no project plugin where the .git file names no git directory', () => {
    const root = folderOutsideAnyRepository();
    writeFileSync(join(root, '.git'), 'not a pointer\n');
    expect(configIn(root).pluginsOff()?.why).toContain('names no git directory');
  });

  it('runs no project plugin where the .git file names a folder that is gone', () => {
    const root = folderOutsideAnyRepository();
    writeFileSync(join(root, '.git'), `gitdir: ${join(root, 'gone')}\n`);
    expect(configIn(root).pluginsOff()?.why).toContain('names no git directory');
  });

  it('runs no project plugin where the git directory belongs to another user', () => {
    const root = folderOutsideAnyRepository();
    writeFileSync(join(root, '.git'), 'gitdir: /usr\n');
    expect(configIn(root).pluginsOff()?.why).toContain('belongs to another user');
  });

  it('holds paths inside the repository root only, the root itself included', () => {
    const root = repository();
    mkdirSync(join(root, 'models'));
    const config = configIn(join(root, 'models'));
    expect(config.holds(join(root, 'node_modules', 'plugin', 'index.js'))).toBe(true);
    expect(config.holds(root)).toBe(true);
    expect(config.holds(`${root}-sibling`)).toBe(false);
    expect(config.holds(folderOutsideAnyRepository())).toBe(false);
  });

  it('takes the repository root without its symbolic links', () => {
    const root = repository();
    const link = join(folderOutsideAnyRepository(), 'link');
    symlinkSync(root, link);
    expect(configIn(link).root).toBe(root);
  });
});
