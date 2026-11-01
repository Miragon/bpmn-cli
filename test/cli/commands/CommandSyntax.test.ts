import { describe, expect, it } from 'vitest';
import { CommandSyntax } from '../../../src/cli/commands/CommandSyntax.js';

const syntaxOf = (name: string): CommandSyntax => CommandSyntax.editCommands().find((syntax) => syntax.name === name)!;
const parsed = (name: string, ...words: unknown[]) => syntaxOf(name).parse(words).operation;

describe('CommandSyntax', () => {
  it('describes the 17 edit commands', () => {
    expect(CommandSyntax.editCommands().map(({ name }) => name)).toEqual(['add', 'connect', 'set', 'remove', 'retype', 'move', 'order', 'ext add', 'ext remove', 'layout', 'tidy', 'compact', 'place', 'color', 'label', 'route', 'space']);
  });

  it('reads a flag per field in kebab case and none for what a batch alone takes', () => {
    const flags = syntaxOf('add').flags().map(({ usage }) => usage.split(' ')[0]);

    expect(flags).toContain('--flow-name');
    expect(flags).toContain('--black-box');
    expect(flags).not.toContain('--as');
    expect(flags).not.toContain('--set');
    expect(syntaxOf('add').flags()).toHaveLength(17);
    expect(syntaxOf('ext remove').flags()).toEqual([]);
  });

  it('turns a name that holds a key into a key', () => {
    expect(parsed('add', 'f.bpmn', 'userTask', 'doc=x', ['lane=y'], {}, {})).toEqual({ op: 'add', kind: 'userTask', set: { doc: 'x', lane: 'y' } });
    expect(parsed('add', 'f.bpmn', 'userTask', 'Check', [], {}, {})).toEqual({ op: 'add', kind: 'userTask', name: 'Check' });
  });

  it('refuses a word that is no key=value', () => {
    expect(() => parsed('set', 'f.bpmn', 'a', ['nope'], {}, {})).toThrow(expect.objectContaining({ code: 'E_USAGE' }));
  });

  it('keeps the attributes of an extension apart from its body', () => {
    expect(parsed('ext add', 'f.bpmn', 'a', 'zeebe:x', ['type=y', 'id=z', 'body=b'], {}, {})).toEqual({ op: 'ext', action: 'add', id: 'a', type: 'zeebe:x', attrs: { type: 'y', id: 'z' }, body: 'b' });
  });

  it('reads the selector of ext remove as an index, a slot or a type', () => {
    expect(parsed('ext remove', 'f.bpmn', 'a', '2', {}, {})).toMatchObject({ index: 2 });
    expect(parsed('ext remove', 'f.bpmn', 'a', 'loop.1', {}, {})).toMatchObject({ index: 1, slot: 'loop' });
    expect(parsed('ext remove', 'f.bpmn', 'a', 'camunda:x', {}, {})).toMatchObject({ type: 'camunda:x' });
  });

  it('leaves out ids nobody named, splits lists at commas and reads a number of pixels', () => {
    expect(parsed('tidy', 'f.bpmn', [], {}, {})).toEqual({ op: 'tidy' });
    expect(parsed('add', 'f.bpmn', 'group', undefined, [], { members: ['a,b', 'c'] }, {})).toMatchObject({ members: ['a', 'b', 'c'] });
    expect(parsed('space', 'f.bpmn', { after: 'a', by: '-80' }, {})).toMatchObject({ by: -80 });
  });

  it('names a field as it is typed: a flag, a positional, or the bare field', () => {
    const add = CommandSyntax.ofOperation({ op: 'add' })!;

    expect(['flowName', 'kind', 'set.x'].map((field) => add.wordFor(field))).toEqual(['--flow-name', '<kind>', 'set.x']);
  });

  it('writes an operation back as the words of its command', () => {
    expect(CommandSyntax.ofOperation({ op: 'set' })?.wordsOf({ op: 'set', id: 'a', set: { condition: '' } })).toEqual({ command: ['set'], rest: ['a', 'condition='] });
    expect(CommandSyntax.ofOperation({ op: 'remove' })?.wordsOf({ op: 'remove', ids: ['a'], withBranch: true })).toEqual({ command: ['remove'], rest: ['a', '--with-branch'] });
    expect(CommandSyntax.ofOperation({ op: 'ext', action: 'remove' })?.wordsOf({ op: 'ext', action: 'remove', id: 'a', index: 1 })).toBeUndefined();
    expect(CommandSyntax.ofOperation({ op: 'split' })).toBeUndefined();
  });
});
