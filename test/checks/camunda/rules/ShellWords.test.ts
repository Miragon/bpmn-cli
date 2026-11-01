import { describe, expect, it } from 'vitest';
import { ShellWords } from '../../../../src/checks/camunda/rules/ShellWords.js';

describe('ShellWords', () => {
  it('leaves a plain word and a placeholder as they are', () => {
    expect(ShellWords.quote('camunda:topic=<topic>')).toBe('camunda:topic=<topic>');
  });

  it('quotes what the shell would read, a quote inside too', () => {
    expect(ShellWords.quote('condition=${a}')).toBe(`'condition=\${a}'`);
    expect(ShellWords.quote(`it's`)).toBe(`'it'\\''s'`);
  });

  it('puts the slot before the first word only', () => {
    expect(ShellWords.slotted('definition[1].', 'camunda:field name=x')).toBe(`'definition[1].camunda:field' name=x`);
    expect(ShellWords.slotted('loop.', 'camunda:field')).toBe('loop.camunda:field');
  });
});
