/**
 * Repository hygiene for a public repository: every text file that is part of
 * the repository (sources, tests, fixtures, scenarios, tools, docs) is plain
 * text without control characters (a raw NUL makes git and GitHub treat a
 * file as binary, so its diffs disappear), and none names a local home or
 * temporary directory or a session's scratch directory. Private models and
 * local paths stay outside the repository (docs/testing.md, "Private
 * corpora").
 *
 * Git-ignored output (node_modules, dist, bench results, fuzz output, the
 * regression harness's work directory) is not scanned.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.regress-work', 'results', 'out']);
const TEXT = /\.(ts|mts|mjs|js|json|md|bpmn|sh|txt|yml|yaml)$|^(LICENSE.*|\.gitignore)$/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...files(full));
    } else if (TEXT.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const repoFiles = files(ROOT).map((f) => relative(ROOT, f)).filter((f) => f !== 'package-lock.json');
// built from parts, so this file does not match itself
const LOCAL_PATHS = [['/', 'Users/'], ['/private', '/tmp'], ['/', 'home/'], ['scratch', 'pad'], ['claude', '-501']].map((p) => p.join(''));

describe('repository hygiene', () => {
  it('scans the repository (sanity check of the file walk)', () => {
    expect(repoFiles).toContain('README.md');
    expect(repoFiles).toContain(join('src', 'cli.ts'));
    expect(repoFiles.some((f) => f.startsWith(join('tools', 'scenarios')))).toBe(true);
  });

  it('text files contain no control characters (only tab, newline, carriage return)', () => {
    const bad: string[] = [];
    for (const f of repoFiles) {
      const bytes = readFileSync(join(ROOT, f));
      const i = bytes.findIndex((b) => (b < 32 && b !== 9 && b !== 10 && b !== 13) || b === 127);
      if (i >= 0) bad.push(`${f} (byte ${i})`);
    }
    expect(bad).toEqual([]);
  });

  it('no file names a local home, temporary or session scratch directory', () => {
    const bad: string[] = [];
    for (const f of repoFiles) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      for (const p of LOCAL_PATHS) if (text.includes(p)) bad.push(`${f}: ${p}`);
    }
    expect(bad).toEqual([]);
  });
});
