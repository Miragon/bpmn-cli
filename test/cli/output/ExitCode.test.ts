import { describe, expect, it } from 'vitest';
import { ExitCode } from '../../../src/cli/output/ExitCode.js';

describe('ExitCode', () => {
  it('starts at 0 and holds the code it is given', () => {
    const exit = new ExitCode();
    expect(exit.code).toBe(ExitCode.OK);

    exit.set(ExitCode.STRICT_WARNINGS);

    expect(exit.code).toBe(5);
  });
});
