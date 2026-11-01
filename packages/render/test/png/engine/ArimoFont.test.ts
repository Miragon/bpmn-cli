import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ArimoFont } from '../../../src/png/engine/ArimoFont.js';

describe('ArimoFont', () => {
  it('holds the bytes of the Arimo the repository ships', () => {
    const shipped = readFileSync(new URL('../../../../../assets/fonts/Arimo-Regular-Latin.ttf', import.meta.url));
    expect(Buffer.from(ArimoFont.bytes()).equals(shipped)).toBe(true);
  });
});
