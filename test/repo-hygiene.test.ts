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
 * regression harness's work directory, the docs site's dev cache in
 * docs/.vitepress/cache) is not scanned.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.regress-work', 'results', 'out', 'cache']);
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

const repoFiles = files(ROOT).map((file) => relative(ROOT, file)).filter((file) => file !== 'package-lock.json');
// built from parts, so this file does not match itself
const LOCAL_PATHS = [['/', 'Users/'], ['/private', '/tmp'], ['/', 'home/'], ['scratch', 'pad'], ['claude', '-501']].map((localPath) => localPath.join(''));

describe('repository hygiene', () => {
  it('scans the repository (sanity check of the file walk)', () => {
    expect(repoFiles).toContain('README.md');
    expect(repoFiles).toContain(join('src', 'cli.ts'));
    expect(repoFiles.some((file) => file.startsWith(join('tools', 'scenarios')))).toBe(true);
  });

  it('text files contain no control characters (only tab, newline, carriage return)', () => {
    const bad: string[] = [];
    for (const file of repoFiles) {
      const bytes = readFileSync(join(ROOT, file));
      const controlIndex = bytes.findIndex((byte) => (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127);
      if (controlIndex >= 0) bad.push(`${file} (byte ${controlIndex})`);
    }
    expect(bad).toEqual([]);
  });

  it('no file names a local home, temporary or session scratch directory', () => {
    const bad: string[] = [];
    for (const file of repoFiles) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const localPath of LOCAL_PATHS) if (text.includes(localPath)) bad.push(`${file}: ${localPath}`);
    }
    expect(bad).toEqual([]);
  });
});

/** Test files that check the repository as a whole sit directly in test/. */
const PROJECT_TESTS = new Set(['architecture.test.ts', 'repo-hygiene.test.ts']);

/**
 * Tests mirror the module folders of src/: a test sits in the folder of the module whose
 * interface it exercises, a black-box test through the entries in test/e2e, shared helpers in
 * test/helpers. Test names say what they test, never the work step that added them.
 */
describe('test layout', () => {
  const testFiles = repoFiles.filter((file) => file.startsWith(`test${sep}`) && file.endsWith('.ts') && !file.startsWith(join('test', 'fixtures')));

  it('puts every test into a src module folder, test/e2e or the project tests', () => {
    const misplaced = testFiles.filter((file) => file.endsWith('.test.ts')).filter((file) => {
      const folder = dirname(relative('test', file));
      if (folder === '.') return !PROJECT_TESTS.has(relative('test', file));
      return folder !== 'e2e' && !existsSync(join(ROOT, 'src', folder));
    });
    expect(misplaced).toEqual([]);
  });

  it('keeps helpers in test/helpers', () => {
    expect(testFiles.filter((file) => !file.endsWith('.test.ts') && !file.startsWith(join('test', 'helpers')))).toEqual([]);
  });

  it('names no test after a work step', () => {
    expect(testFiles.filter((file) => /(^|[/-])step\d/.test(file))).toEqual([]);
  });
});
