import { describe, expect, it } from 'vitest';
import { IdCut } from '../../../src/model/ids/IdCut.js';

describe('IdCut', () => {
  it('leaves a slug that fits and cuts a longer one between words, keeping its numeric tail', () => {
    expect(IdCut.cutAt('Short', 30)).toBe('Short');
    expect(IdCut.cutAt('ReviewTheOrderAndShipItToTheCustomerQuickly_3', 30)).toBe('ReviewTheOrderAndShipItToThe_3');
  });

  it('drops a filler word that a name would end on, where an id keeps it', () => {
    expect(IdCut.cutName('CheckInvoiceAndPay', 15)).toBe('CheckInvoice');
    expect(IdCut.cutAt('CheckInvoiceAndPay', 15)).toBe('CheckInvoiceAnd');
  });

  it.each([
    ['und', true],
    ['The', true],
    ['_of', true],
    ['invoice', false],
  ])('knows "%s" as a filler word: %s', (word, filler) => {
    expect(IdCut.isFiller(word)).toBe(filler);
  });

  it('splits a slug into words at humps, digits and separators', () => {
    expect(IdCut.idWords('checkInvoice_2')).toEqual(['check', 'Invoice', '_2']);
    expect(IdCut.idWords('Check_Join')).toEqual(['Check', '_Join']);
    expect(IdCut.idWords('')).toEqual([]);
  });

  it('keeps a Join and a number at the end of a slug as its tail', () => {
    expect(IdCut.keptTail('CheckInvoiceJoin')).toBe('Join');
    expect(IdCut.keptTail('check_invoice_3')).toBe('_3');
    expect(IdCut.keptTail('Check2')).toBe('2');
    expect(IdCut.keptTail('check')).toBe('');
  });

  it('refuses a cut that leaves no letter or runs a number into the number behind it', () => {
    expect(IdCut.readsApart('Check', '2')).toBe(true);
    expect(IdCut.readsApart('Check2', '3')).toBe(false);
    expect(IdCut.readsApart('12', 'a')).toBe(false);
  });

  it('starts a slug that was cut to digits at its first word with a letter', () => {
    expect(IdCut.withLetter('1234Check', '1234', (rest) => `again:${rest}`)).toBe('again:Check');
    expect(IdCut.withLetter('Check', 'Che', (rest) => rest)).toBe('Che');
  });

  it.each([
    ['task', '', 2, 'task2'],
    ['task', '_', 2, 'task_2'],
    ['task', '-', 2, 'task-2'],
    ['task1', '', 2, 'task1No2'],
    ['Task9', '', 3, 'Task9No3'],
  ])('numbers the base "%s" with the separator "%s" and the number %i as "%s"', (base, separator, number, expected) => {
    expect(IdCut.withSuffix(base, separator, number)).toBe(expected);
  });

  it('cuts a base so that the id with its suffix stays within 64 characters', () => {
    const base = 'ReviewTheOrderAndShipItToTheCustomerQuicklyBeforeFridayAfternoonPleaseNow';

    expect(IdCut.withSuffix(base, '_', 12)).toBe('ReviewTheOrderAndShipItToTheCustomerQuicklyBeforeFriday_12');
    expect(IdCut.withSuffix(base, '', 12, () => 'Cut')).toBe('Cut12');
  });

  it.each([
    ['task', '2', '', true],
    ['task', '_2', '_', true],
    ['task', '_2', '-', false],
    ['task', '-2', 'either', true],
    ['task1', 'No2', '', true],
    ['task', 'No2', '', false],
  ])('judges the rest of "%s" being "%s" a suffix for the separator "%s": %s', (base, rest, separator, suffix) => {
    expect(IdCut.isSuffix(base, rest, separator)).toBe(suffix);
  });
});
