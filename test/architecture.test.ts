/**
 * The layout of src/ (CONTRIBUTING.md, "How the package is laid out"),
 * checked with ArchUnitTS: the root holds only the package's entries; every
 * other module lives in the folder of its stage.
 */
import { projectFiles } from 'archunit';
import { describe, expect, it } from 'vitest';

describe('architecture', () => {
  it('the root of src/ holds only the entries', async () => {
    const rule = projectFiles().inFolder('src').should().haveName(/^(api|cli|index)\.ts$/);
    await expect(rule).toPassAsync();
  });
});
