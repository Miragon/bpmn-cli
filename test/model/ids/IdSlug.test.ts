import { describe, expect, it } from 'vitest';
import { IdSlug } from '../../../src/model/ids/IdSlug.js';

describe('IdSlug', () => {
  it.each([
    ['Rechnung prüfen und Straße', 'RechnungPruefenUndStrasse'],
    ['Ärger ÖL Über', 'AergerOELUeber'],
    ['Æsir Łódź Þor', 'AesirLodzThor'],
    ['Café crème', 'CafeCreme'],
  ])('spells the name "%s" out in ASCII for a PascalCase id body', (name, expected) => {
    expect(IdSlug.slugify(name)).toBe(expected);
  });

  it('keeps the case of a capital umlaut by the letter that follows it', () => {
    expect(IdSlug.transliterate('Äpfel')).toBe('Aepfel');
    expect(IdSlug.transliterate('ÄPFEL')).toBe('AEPFEL');
  });

  it('writes the same name as camelCase, snake_case and kebab-case bodies', () => {
    expect(IdSlug.camelSlug('Check the Invoice')).toBe('checkTheInvoice');
    expect(IdSlug.camelSlug('HTTP server')).toBe('httpServer');
    expect(IdSlug.snakeSlug('Check the Invoice')).toBe('check_the_invoice');
    expect(IdSlug.kebabSlug('Check the Invoice')).toBe('check-the-invoice');
  });

  it('splits a name at camel-case humps, acronyms and punctuation', () => {
    expect(IdSlug.nameWords('checkInvoiceHTTPServer v2')).toEqual(['check', 'Invoice', 'HTTP', 'Server', 'v2']);
    expect(IdSlug.nameWords(undefined)).toEqual([]);
  });

  it('cuts a long name between words to at most 40 characters', () => {
    const slug = IdSlug.slugify('Check invoice and pay the bill with all the extras included now please');

    expect(slug).toBe('CheckInvoiceAndPayTheBillWithAll');
    expect(slug.length).toBeLessThanOrEqual(IdSlug.MAX_SLUG);
  });

  it('gives no body to a name without letters or digits and sees no words in a bare number', () => {
    expect([IdSlug.slugify('???'), IdSlug.camelSlug(undefined)]).toEqual(['', '']);
    expect([IdSlug.hasIdWords('42'), IdSlug.hasIdWords('a1'), IdSlug.hasIdWords(undefined)]).toEqual([false, true, false]);
  });

  it.each([
    ['task_Check', true],
    ['_hidden', true],
    ['flow-1.2', true],
    ['1st', false],
    ['two words', false],
    ['', false],
  ])('judges the id "%s" valid as an XML id: %s', (id, valid) => {
    expect(IdSlug.isValidId(id)).toBe(valid);
  });

  it.each([
    ['task_', true],
    ['1x_', false],
    ['a'.repeat(56), true],
    ['a'.repeat(57), false],
    [5, false],
  ])('judges %j a usable prefix: %s', (prefix, usable) => {
    expect(IdSlug.isUsablePrefix(prefix)).toBe(usable);
  });
});
