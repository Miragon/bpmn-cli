import { describe, expect, it } from 'vitest';
import { ConventionsTable } from '../../../src/views/conventions/ConventionsTable.js';

describe('ConventionsTable', () => {
  it('gives the pattern new ids of each kind follow when nothing is declared', () => {
    const patterns = new ConventionsTable().patterns();

    expect(patterns.get('userTask')).toBe('userTask_{name:camel}');
    expect(patterns.get('exclusiveGateway')).toBe('gateway_{name:camel}');
    expect(patterns.get('messageFlow')).toBe('messageFlow_{source}To{target}');
    expect(patterns.get('process')).toBe('{name:camel}');
  });

  it('follows declared conventions', () => {
    const patterns = new ConventionsTable({ source: '.bpmnlintrc', case: 'snake_case', qualifier: 'required', prefixes: { 'bpmn:UserTask': 'Task_' }, ignored: [] }).patterns();

    expect(patterns.get('userTask')).toBe('Task_{name:snake}');
    expect(patterns.get('sequenceFlow')).toMatch(/_to_/);
  });
});
