import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEXT = /\.(ts|mts|mjs|js|json|md|bpmn|sh|txt|yml|yaml)$|^(LICENSE.*|\.gitignore)$/;
const LOCAL_PATHS = [
  ['/', 'Users/'],
  ['/private', '/tmp'],
  ['/', 'home/'],
  ['scratch', 'pad'],
  ['claude', '-501'],
].map((localPath) => localPath.join(''));

function trackedTextFiles(): string[] {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0');
  return tracked.filter((file) => TEXT.test(basename(file)) && existsSync(join(ROOT, file)));
}

function manifestAt(folder: string): Manifest {
  return JSON.parse(readFileSync(join(ROOT, folder, 'package.json'), 'utf8'));
}

function driftFromCore(core: Manifest, part: Manifest): string[] {
  const needed = Object.entries({ ...part.dependencies, ...part.peerDependencies });
  return needed.flatMap(([name, version]) => {
    const inCore = core.dependencies?.[name];
    if (inCore === undefined) {
      return [`${part.name}: the core lacks ${name}`];
    }
    return inCore === version ? [] : [`${part.name}: ${name} is ${version}, the core pins ${inCore}`];
  });
}

const repoFiles = trackedTextFiles().filter((file) => file !== 'package-lock.json');
const core = manifestAt('.');

describe('repository hygiene', () => {
  it('scans the repository', () => {
    expect(repoFiles).toContain('README.md');
    expect(repoFiles).toContain(join('src', 'index.ts'));
    expect(repoFiles.some((file) => file.startsWith('fixtures'))).toBe(true);
  });

  it('holds no control characters in text files, only tab, newline and carriage return', () => {
    const bad: string[] = [];
    for (const file of repoFiles) {
      const bytes = readFileSync(join(ROOT, file));
      const controlIndex = bytes.findIndex((byte) => (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127);
      if (controlIndex >= 0) {
        bad.push(`${file} (byte ${controlIndex})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('names no local home, temporary or session scratch directory', () => {
    const bad: string[] = [];
    for (const file of repoFiles) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const localPath of LOCAL_PATHS) {
        if (text.includes(localPath)) {
          bad.push(`${file}: ${localPath}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it.each(['packages/render', 'packages/lint'])('lists every dependency of %s in the core at the same version', (folder) => {
    expect(driftFromCore(core, manifestAt(folder))).toEqual([]);
  });

  it('reports a dependency of a private package that the core lacks', () => {
    const part = { name: 'part', dependencies: { 'left-pad': '1.3.0' } };
    expect(driftFromCore(core, part)).toEqual(['part: the core lacks left-pad']);
  });

  it('reports a dependency of a private package at another version', () => {
    const part = { name: 'part', peerDependencies: { '@resvg/resvg-wasm': '2.6.1' } };
    expect(driftFromCore(core, part)).toEqual(['part: @resvg/resvg-wasm is 2.6.1, the core pins 2.6.2']);
  });
});
