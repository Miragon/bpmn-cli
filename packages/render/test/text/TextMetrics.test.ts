import { describe, expect, it } from 'vitest';
import { TextMetrics } from '../../src/text/TextMetrics.js';

describe('TextMetrics', () => {
  it('measures a task name in Arial at 12 px', () => {
    expect(TextMetrics.width('Order')).toBeCloseTo(((778 + 333 + 556 + 556 + 333) * 12) / 1000, 6);
  });

  it('measures a character Arial has no advance for as a digit', () => {
    expect(TextMetrics.width('字')).toBeCloseTo(6.672, 6);
  });

  it('breaks a task name at spaces as diagram-js does', () => {
    expect(TextMetrics.wrap('Check the incoming order for completeness', 86)).toEqual(['Check the ', 'incoming order ', 'for ', 'completeness']);
  });

  it('keeps the line breaks of an annotation', () => {
    expect(TextMetrics.wrap('first\nsecond', 200)).toEqual(['first', 'second']);
  });

  it('cuts a word without any break into pieces', () => {
    expect(TextMetrics.wrap('Donaudampfschifffahrtsgesellschaft', 60).length).toBeGreaterThan(2);
  });

  it('turns a soft hyphen at a line end into a hyphen', () => {
    expect(TextMetrics.wrap('Bestell­abwicklung', 60)[0]).toBe('Bestell-');
  });

  it('gives no title box to a sub-process without a name', () => {
    expect(TextMetrics.titleBox({ x: 0, y: 0, width: 350, height: 200 }, '  ')).toBeUndefined();
  });

  it('centres the title of an expanded sub-process 7 px below its top', () => {
    const box = TextMetrics.titleBox({ x: 10, y: 20, width: 350, height: 200 }, 'Handle order');
    expect(box?.y).toBe(27);
    expect(box?.height).toBeCloseTo(14.4, 6);
    expect(((box?.x ?? 0) * 2 + (box?.width ?? 0)) / 2).toBeCloseTo(185, 6);
  });

  it('adds no depth for a sub-process without a name', () => {
    expect(TextMetrics.titleDepth(undefined, 100)).toBe(0);
  });

  it('counts the depth of a two-line sub-process title', () => {
    expect(TextMetrics.titleDepth('Check the incoming order', 100)).toBeCloseTo(7 + 2 * 14.4, 6);
  });

  it('sizes an external label on one line', () => {
    expect(TextMetrics.labelSize('Rejected')).toEqual({ width: 68, height: 14, lines: 1 });
  });

  it('widens a label to its longest word instead of breaking it', () => {
    expect(TextMetrics.labelSize('Donaudampfschifffahrt ab').width).toBe(21 * 7 + 12);
  });

  it('wraps a long label into several lines', () => {
    expect(TextMetrics.labelSize('Is the order complete and correct').lines).toBeGreaterThan(1);
  });

  it('gives an empty label the smallest width', () => {
    expect(TextMetrics.labelSize('')).toEqual({ width: 20, height: 14, lines: 1 });
  });

  it('forgets remembered labels when the memory is full', () => {
    const names = Array.from({ length: 4097 }, (_, index) => `name ${index}`);
    const sizes = names.map((name) => TextMetrics.labelSize(name, 91));
    expect(sizes.at(-1)?.lines).toBe(1);
  });
});
