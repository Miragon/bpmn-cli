import { describe, expect, it } from 'vitest';
import { RefusalWording } from '../../../src/operations/fields/RefusalWording.js';

describe('RefusalWording', () => {
  const wording = new RefusalWording((key, bare) => `${key('after')} or ${bare('before')}`, (key) => `use ${key('flow')}`);

  it('quotes the keys of a batch and leaves a bare one as it is', () => {
    expect(wording.batchMessage).toBe('"after" or before');
    expect(wording.batchHint).toBe('use "flow"');
  });

  it('hands a command every key as a key, whatever the batch does with it', () => {
    expect(wording.asCommand()).toEqual({ message: ['', { key: 'after' }, ' or ', { key: 'before' }, ''], hint: ['use ', { key: 'flow' }, ''] });
  });

  it('keeps a hint that shows JSON from a command', () => {
    const shown = new RefusalWording('no good', RefusalWording.onlyInBatch('Example: {"op":"add"}.'));

    expect(shown.batchHint).toBe('Example: {"op":"add"}.');
    expect(shown.asCommand()).toEqual({ message: ['no good'] });
  });

  it('carries the code a command reads', () => {
    expect(new RefusalWording('no good').asCommand('E_UNKNOWN_KIND').code).toBe('E_UNKNOWN_KIND');
  });

  it('has no hint without one', () => {
    expect(RefusalWording.onlyInBatch(undefined)).toBeUndefined();
    expect(new RefusalWording('no good').batchHint).toBeUndefined();
  });
});
