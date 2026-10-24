/**
 * The layout of src/ (CONTRIBUTING.md, "How the package is laid out"),
 * checked with ArchUnitTS: the root holds only the package's entries; every
 * other module lives in the folder of its stage. The error catalogue is the
 * one source of truth for the E_/W_ codes src/ emits.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { projectFiles } from 'archunit';
import { describe, expect, it } from 'vitest';
import { ERROR_CATALOGUE } from '../src/report/guide.js';

const SRC_DIR = join(__dirname, '..', 'src');

/** Codes the pipeline composes from the layout engine's codes (`E_${code}`, `W_LAYOUT_${code}`), keyed to the literal they are composed from. */
const COMPOSED_CODES: Record<string, string> = {
  E_LAYOUT_INCREMENTAL: 'LAYOUT_INCREMENTAL',
  W_LAYOUT_INCREMENTAL_FAILED: 'INCREMENTAL_FAILED',
};

function quotedLiteralsOutsideGuide(pattern: RegExp): Set<string> {
  const literals = new Set<string>();
  for (const entry of readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const file = join(entry.parentPath, entry.name);
    if (file.endsWith(join('report', 'guide.ts'))) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(pattern)) literals.add(m[1]!);
  }
  return literals;
}

const covers = (entry: string, code: string) => (entry.endsWith('*') ? code.startsWith(entry.slice(0, -1)) : entry === code);

const sourceFiles = (readdirSync('src', { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => join('src', f));

describe('architecture', () => {
  it('the root of src/ holds only the entries', async () => {
    const rule = projectFiles().inFolder('src').should().haveName(/^(api|cli|index)\.ts$/);
    await expect(rule).toPassAsync();
  });

  it('only the kind definitions group gateway types by behaviour (the engine rule chunks load on demand and keep their own)', () => {
    const gatewayType = String.raw`'bpmn:(?:Exclusive|Inclusive|Parallel|Complex)Gateway'`;
    const groupedGatewayTypes = new RegExp(`${gatewayType}.*${gatewayType}`);
    const ownedElsewhere = (file: string) => file === join('src', 'model', 'utils', 'kinds.ts') || file.startsWith(join('src', 'platform', 'profiles'));
    const offenders = sourceFiles
      .filter((file) => !ownedElsewhere(file))
      .flatMap((file) => readFileSync(file, 'utf8').split('\n').map((line, i) => (groupedGatewayTypes.test(line) ? `${file}:${i + 1}` : undefined)))
      .filter(Boolean);
    expect(offenders).toEqual([]);
  });

  it('the error catalogue documents exactly the codes src/ emits', () => {
    const emitted = [...quotedLiteralsOutsideGuide(/'([EW]_[A-Z0-9_]+)'/g)];
    const catalogued = ERROR_CATALOGUE.map((e) => e.code);

    const undocumented = emitted.filter((code) => !catalogued.some((entry) => covers(entry, code)));
    expect(undocumented, 'emitted in src/ but missing from ERROR_CATALOGUE').toEqual([]);

    const sourceLiterals = quotedLiteralsOutsideGuide(/'([A-Z][A-Z0-9_]+)'/g);
    const composed = Object.entries(COMPOSED_CODES).filter(([, literal]) => sourceLiterals.has(literal)).map(([code]) => code);
    const dead = catalogued.filter((entry) => ![...emitted, ...composed].some((code) => covers(entry, code)));
    expect(dead, 'in ERROR_CATALOGUE but emitted nowhere in src/').toEqual([]);
  });

  it('only the modules owning group names and memberships touch a category value reference', () => {
    const owners = ['model/utils/moddle.ts', 'ops/artifacts.ts', 'ops/remove.ts', 'diagram/groups.ts'];
    const touching = readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.startsWith('platform/profiles/'))
      .filter((file) => readFileSync(join('src', file), 'utf8').includes("'categoryValueRef'"));
    expect(touching.sort()).toEqual(owners.sort());
  });

  it('the CLI spells the op rules of ops/rules.ts with flags instead of restating them', () => {
    const cliFiles = [join('src', 'cli.ts'), ...sourceFiles.filter((file) => file.startsWith(join('src', 'commands') + sep))];
    expect(cliFiles.length).toBeGreaterThan(1);
    for (const file of cliFiles) {
      const cli = readFileSync(file, 'utf8');
      for (const restatedRule of ['cannot be combined`', 'mutually exclusive', 'Use exactly one placement', 'Give at most one of']) expect(cli, file).not.toContain(restatedRule);
    }
  });
});
