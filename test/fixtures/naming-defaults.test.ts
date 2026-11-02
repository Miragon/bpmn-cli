import { naming } from '@miragon/bpmnlint-plugin-rules';
import { describe, expect, it } from 'vitest';
import { IdDefaults } from '../../src/model/ids/IdDefaults.js';
import { type BpmnElement, Kinds, NewDocument, Triggers, type DefinedTrigger } from '../../src/model/index.js';

const { tree } = new NewDocument().create();
const convention = new naming.ElementIdConvention();
const prefixes = Object.entries(IdDefaults.CONVENTIONS.prefixes);

function nodeOf(type: string, trigger?: string): BpmnElement {
  const node = tree.build(type);
  if (trigger) {
    node.set('eventDefinitions', [tree.build(Triggers.TABLE[trigger as DefinedTrigger].definition)]);
  }
  return node;
}

describe('the id defaults model keeps as data', () => {
  it.each(prefixes.filter(([key]) => key.split(':').length === 2))('%s has the prefix of the plugin', (type, prefix) => {
    expect(convention.prefixOf(nodeOf(type).raw as never)).toBe(prefix);
  });

  it.each(prefixes.filter(([key]) => key.split(':').length === 3))('%s has the qualified prefix of the plugin', (key, prefix) => {
    const [namespace, local, trigger] = key.split(':');

    expect(convention.prefixesFor(nodeOf(`${namespace}:${local}`, trigger).raw as never)).toContain(prefix);
  });

  it('covers every kind the plugin checks', () => {
    const checked = Kinds.ALL.filter(({ type }) => convention.prefixOf(nodeOf(type).raw as never) !== null);

    expect(checked.every(({ type }) => IdDefaults.CONVENTIONS.prefixes[type] !== undefined)).toBe(true);
  });

  it('has the case and the qualifier of the plugin', () => {
    expect(convention.case.label).toBe(IdDefaults.CONVENTIONS.case);
    expect(convention.qualifier).toBe(IdDefaults.CONVENTIONS.qualifier);
  });
});
