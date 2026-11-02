import { describe, expect, it } from 'vitest';
import { CommandInput } from '../../../src/cli/commands/CommandInput.js';

const OPERATION = { op: 'layout' };

describe('CommandInput', () => {
  it('writes in place by default, to another file with -o', () => {
    expect(new CommandInput('a.bpmn', OPERATION, {}).target).toBe('a.bpmn');
    expect(new CommandInput('a.bpmn', OPERATION, { o: 'b.bpmn' }).target).toBe('b.bpmn');
  });

  it('writes to stdout with -o - or for a model from stdin', () => {
    expect(new CommandInput('a.bpmn', OPERATION, { o: '-' }).toStandardOutput).toBe(true);
    expect(new CommandInput('-', OPERATION, {}).toStandardOutput).toBe(true);
    expect(new CommandInput('-', OPERATION, { o: 'b.bpmn' }).toStandardOutput).toBe(false);
  });
});
