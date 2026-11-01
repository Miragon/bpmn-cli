import { describe, expect, it } from 'vitest';
import { ConventionsTable } from '../../../src/views/conventions/ConventionsTable.js';

describe('ConventionsTable', () => {
  it('follows the defaults of element-id-naming when nothing is declared', () => {
    const { rows, rule, exists, qualified } = new ConventionsTable().answer();

    expect(rule).toBeUndefined();
    expect(exists).toBe(true);
    expect(rows.find(({ kinds }) => kinds.includes('userTask'))).toMatchObject({ pattern: '<kind>_{name:camel}', source: 'default' });
    expect(rows.find(({ kinds }) => kinds.includes('exclusiveGateway'))).toMatchObject({ pattern: 'gateway_{name:camel}' });
    expect(qualified?.mode).toBe('optional');
  });

  it('says a row of one kind in its concrete pattern', () => {
    const { rows } = new ConventionsTable().answer();

    expect(rows.find(({ kinds }) => kinds.includes('sequenceFlow'))?.pattern).toBe('flow_{source}To{target}');
    expect(rows.find(({ kinds }) => kinds.includes('process'))).toMatchObject({ pattern: '{name:camel}', note: 'not checked; unnamed: Process_1' });
  });

  it('gives the pattern new ids of each kind follow', () => {
    const patterns = new ConventionsTable().patterns();

    expect(patterns.get('userTask')).toBe('userTask_{name:camel}');
    expect(patterns.get('exclusiveGateway')).toBe('gateway_{name:camel}');
    expect(patterns.get('messageFlow')).toBe('messageFlow_{source}To{target}');
  });

  it('follows declared conventions and names their source and rule', () => {
    const { rows, rule, source } = new ConventionsTable({ source: '.bpmnlintrc', case: 'snake_case', qualifier: 'required', prefixes: { 'bpmn:UserTask': 'Task_', 'bpmn:StartEvent:timer': 'timerStart_' }, ignored: ['bpmn:Collaboration'] }).answer({ severity: 'error' });

    expect(source).toBe('.bpmnlintrc');
    expect(rule).toEqual({ severity: 'error', case: 'snake_case', qualifier: 'required' });
    expect(rows.find(({ kinds }) => kinds.includes('userTask'))?.pattern).toBe('Task_{name:snake}');
  });

  it('carries why nothing is declared and where it looked', () => {
    expect(new ConventionsTable().answer({ undeclared: 'off', where: '.bpmnlintrc', exists: false, file: 'new.bpmn' })).toMatchObject({ undeclared: 'off', source: '.bpmnlintrc', exists: false, file: 'new.bpmn' });
  });

  it('leaves the qualified prefixes out when the qualifier is off', () => {
    expect(new ConventionsTable({ qualifier: 'off', prefixes: {} }).answer().qualified).toBeUndefined();
  });
});
