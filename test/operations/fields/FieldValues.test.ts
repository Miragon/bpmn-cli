import { describe, expect, it } from 'vitest';
import { FieldValues } from '../../../src/operations/fields/FieldValues.js';

describe('FieldValues', () => {
  it.each(['$check', '$_a', '$a-1'])('takes %s as an alias', (alias) => {
    expect(FieldValues.alias.safeParse(alias).success).toBe(true);
  });

  it.each(['check', '$', '$1', '${ok}'])('takes %s as no alias', (alias) => {
    expect(FieldValues.alias.safeParse(alias).success).toBe(false);
  });

  it('turns the numbers and booleans of key values into text', () => {
    expect(FieldValues.keys.parse({ retries: 3, nonInterrupting: true, doc: '' })).toEqual({ retries: '3', nonInterrupting: 'true', doc: '' });
  });

  it('keeps a size that is a word and turns a size that is a number into pixels', () => {
    expect(FieldValues.size.parse('2col')).toBe('2col');
    expect(FieldValues.size.parse(' -40 ')).toBe(-40);
    expect(FieldValues.size.parse(40)).toBe(40);
  });

  it('holds a choice to its values', () => {
    const side = FieldValues.choice(['top', 'bottom']);
    expect(side.safeParse('top').success).toBe(true);
    expect(side.safeParse('left').success).toBe(false);
  });

  it('counts the entries of a list of references and of items', () => {
    expect(FieldValues.references(2).safeParse(['a']).success).toBe(false);
    expect(FieldValues.references(0).safeParse([]).success).toBe(true);
    expect(FieldValues.items(1, 'branch').safeParse([]).success).toBe(false);
  });
});
