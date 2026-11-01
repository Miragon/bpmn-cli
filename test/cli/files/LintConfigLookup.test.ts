import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LintConfigLookup } from '../../../src/cli/files/LintConfigLookup.js';

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lookup-')));
  mkdirSync(join(root, 'a', 'b'), { recursive: true });
  writeFileSync(join(root, '.bpmnlintrc'), '{}');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('LintConfigLookup', () => {
  it('finds the file in the start directory outside a repository', () => {
    expect(new LintConfigLookup(root).nearest()).toBe(join(root, '.bpmnlintrc'));
  });

  it('does not walk up outside a repository', () => {
    expect(new LintConfigLookup(join(root, 'a')).nearest()).toBeUndefined();
  });

  it('walks up to the repository root and not above it', () => {
    mkdirSync(join(root, '.git'));
    expect(new LintConfigLookup(join(root, 'a', 'b')).nearest()).toBe(join(root, '.bpmnlintrc'));

    mkdirSync(join(root, 'a', '.git'));
    expect(new LintConfigLookup(join(root, 'a', 'b')).nearest()).toBeUndefined();
  });

  it('takes a .git file only when it names a directory', () => {
    writeFileSync(join(root, '.git'), 'gitdir: nowhere\n');
    expect(new LintConfigLookup(join(root, 'a')).nearest()).toBeUndefined();

    writeFileSync(join(root, '.git'), 'gitdir: a\n');
    expect(new LintConfigLookup(join(root, 'a')).nearest()).toBe(join(root, '.bpmnlintrc'));
  });

  it('looks again through the physical directory of a link, and copes with one that does not exist', () => {
    mkdirSync(join(root, '.git'));
    const link = join(root, 'a', 'link');
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'lookup-out-')));
    symlinkSync(join(root, 'a', 'b'), join(outside, 'link'));

    expect(new LintConfigLookup(join(outside, 'link')).nearest()).toBe(join(root, '.bpmnlintrc'));
    expect(new LintConfigLookup(join(link, 'not', 'yet')).nearest()).toBe(join(root, '.bpmnlintrc'));
    rmSync(outside, { recursive: true, force: true });
  });
});
