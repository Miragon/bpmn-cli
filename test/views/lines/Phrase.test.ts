import { describe, expect, it } from 'vitest';
import { Phrase } from '../../../src/views/lines/Phrase.js';

describe('Phrase', () => {
  it('flattens a multi-line BPMN name to one line', () => {
    expect(new Phrase(' Check\n  the   order ').flat).toBe('Check the order');
  });

  it('quotes a name with quotes inside', () => {
    expect(new Phrase('The "big" order').quoted).toBe('"The \\"big\\" order"');
  });

  it('cuts a long documentation text and marks the cut', () => {
    expect(new Phrase('a long documentation').cut(10)).toBe('a long ...');
    expect(new Phrase('short').cut(10)).toBe('short');
  });

  it('keeps an identifier bare as a flag and quotes what needs it', () => {
    expect(new Phrase('check-policy').flag()).toBe('check-policy');
    expect(new Phrase('two words').flag()).toBe('"two words"');
    expect(new Phrase('x'.repeat(70)).flag()).toBe(`"${'x'.repeat(57)}..."`);
    expect(new Phrase('x'.repeat(70)).flag(120)).toBe('x'.repeat(70));
  });
});
