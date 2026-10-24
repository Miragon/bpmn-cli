/**
 * The layout of src/ (CONTRIBUTING.md, "How the package is laid out"),
 * checked with ArchUnitTS: the root holds only the package's entries; every
 * other module lives in the folder of its stage.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectFiles } from 'archunit';
import { describe, expect, it } from 'vitest';

const sourceFiles = (readdirSync('src', { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => join('src', f));

describe('architecture', () => {
  it('the root of src/ holds only the entries', async () => {
    const rule = projectFiles().inFolder('src').should().haveName(/^(api|cli|index)\.ts$/);
    await expect(rule).toPassAsync();
  });

  it('only the kind definitions group gateway types by behaviour (the engine rule chunks load on demand and keep their own)', () => {
    const gatewayType = String.raw`'bpmn:(?:Exclusive|Inclusive|Parallel|Complex)Gateway'`;
    const groupedGatewayTypes = new RegExp(`${gatewayType}.*${gatewayType}`);
    const ownedElsewhere = (file: string) => file === join('src', 'model', 'kinds.ts') || file.startsWith(join('src', 'platform', 'profiles'));
    const offenders = sourceFiles
      .filter((file) => !ownedElsewhere(file))
      .flatMap((file) => readFileSync(file, 'utf8').split('\n').map((line, i) => (groupedGatewayTypes.test(line) ? `${file}:${i + 1}` : undefined)))
      .filter(Boolean);
    expect(offenders).toEqual([]);
  });
});
