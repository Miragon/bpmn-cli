import { describe, expect, it } from 'vitest';
import { SuggestedCommand } from '../../../src/cli/output/SuggestedCommand.js';

describe('SuggestedCommand', () => {
  it('prints an operation as its command, quoted for the shell', () => {
    expect(new SuggestedCommand({ op: 'set', id: 'a', set: { name: 'Check it' } }).line('my file.bpmn')).toBe("bpmn set 'my file.bpmn' a 'name=Check it'");
    expect(new SuggestedCommand({ op: 'set', id: 'flow', set: { default: true } }).line('f.bpmn')).toBe('bpmn set f.bpmn flow default=true');
  });

  it('repeats --unset for every key it removes', () => {
    expect(new SuggestedCommand({ op: 'set', id: 'a', unset: ['name', 'camunda:assignee'] }).line('f.bpmn')).toBe('bpmn set f.bpmn a --unset name --unset camunda:assignee');
  });

  it('prints nothing for an operation no command says', () => {
    expect(new SuggestedCommand({ op: 'split', after: 'a', branches: [] }).line('f.bpmn')).toBeUndefined();
    expect(new SuggestedCommand({ op: 'remove', ids: ['a'], nope: 1 }).line('f.bpmn')).toBeUndefined();
  });
});
