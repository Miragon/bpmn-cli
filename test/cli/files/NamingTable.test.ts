import { describe, expect, it } from 'vitest';
import { naming } from '@miragon/bpmnlint-plugin-rules';
import { type NamingOptions, NamingTable } from '../../../src/cli/files/NamingTable.js';

const read = (options?: NamingOptions) => new NamingTable(naming as never, options, '.bpmnlintrc in .').read();
const codesOf = (options: NamingOptions) => read(options).notes.map(({ message }) => message);

describe('NamingTable', () => {
  it('gives every kind the prefix of the rule, a gateway through its family', () => {
    const { prefixes, qualifier, case: bodyCase, source } = read().conventions;

    expect(prefixes['bpmn:ExclusiveGateway']).toBe('gateway_');
    expect(prefixes['bpmn:Gateway']).toBeUndefined();
    expect([qualifier, bodyCase, source]).toEqual(['optional', 'camelCase', '.bpmnlintrc in .']);
  });

  it('lists qualified prefixes unless the qualifier is off', () => {
    expect(read({ eventDefinitionQualifier: 'required' }).conventions.prefixes['bpmn:StartEvent:timer']).toBe('timerStartEvent_');
    expect(read({ eventDefinitionQualifier: 'off' }).conventions.prefixes['bpmn:StartEvent:timer']).toBeUndefined();
  });

  it('leaves the case out when any case goes', () => {
    expect(read({ case: 'any' }).conventions.case).toBeUndefined();
  });

  it('notes what new ids cannot follow', () => {
    expect(codesOf({ case: 'nope' }).join()).toContain('case "nope" is unknown');
    expect(codesOf({ eventDefinitionQualifier: 'nope' }).join()).toContain('eventDefinitionQualifier "nope" is unknown');
    expect(codesOf({ prefixes: { 'bpmn:Task': '1_' } }).join()).toContain('cannot start an id');
    expect(codesOf({ prefixes: { 'bpmn:Task': 'ä_' } }).join()).toContain('outside ASCII');
    expect(codesOf({ prefixes: { 'bpmndi:BPMNShape': 'Shape_' } }).join()).toContain('names DI after its element');
  });

  it('ignores a prefix too long for a qualified id, once', () => {
    const { conventions, notes } = read({ eventDefinitionQualifier: 'required', prefixes: { 'bpmn:StartEvent': `${'s'.repeat(52)}_` } });

    expect(conventions.ignored).toContain('bpmn:StartEvent:timer');
    expect(notes.some(({ message }) => message?.includes('longer than 56 characters'))).toBe(true);
  });
});
