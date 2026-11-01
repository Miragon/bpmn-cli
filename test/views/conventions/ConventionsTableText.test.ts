import { describe, expect, it } from 'vitest';
import { ConventionsTable } from '../../../src/views/conventions/ConventionsTable.js';

describe('ConventionsTableText', () => {
  it('prints the table with its sources', () => {
    const lines = new ConventionsTable().answer({ file: 'order.bpmn' }).text.split('\n');

    expect(lines[0]).toBe('conventions of order.bpmn');
    expect(lines[1]).toBe("no id conventions declared: new ids follow element-id-naming's defaults (case camelCase)");
    expect(lines.some((line) => /^ {2}gateway_\{name:camel\} +default +exclusiveGateway/.test(line))).toBe(true);
    expect(lines.at(-1)).toContain('sources: default = ');
  });

  it('says a new model has no file yet, and why nothing is declared', () => {
    const { text } = new ConventionsTable().answer({ exists: false, undeclared: 'no config' });

    expect(text).toContain('conventions of the model (no file yet: a new model)');
    expect(text).toContain('no id conventions: no .bpmnlintrc applies here;');
  });

  it.each([
    ['off' as const, 'element-id-naming is off or not configured in the .bpmnlintrc'],
    ['not loaded' as const, 'the .bpmnlintrc could not be loaded (W_LINT_UNAVAILABLE below)'],
  ])('words the reason %s', (undeclared, words) => {
    expect(new ConventionsTable().answer({ undeclared }).text).toContain(words);
  });

  it('prints the rule, its notes and the required qualifier', () => {
    const conventions = { source: '.bpmnlintrc', qualifier: 'required' as const, prefixes: { 'bpmn:StartEvent': 'start_', 'bpmn:StartEvent:timer': 'timerStart_' }, ignored: ['bpmn:StartEvent:timer'] };

    const { text } = new ConventionsTable(conventions).answer({ notes: [{ severity: 'warning', code: 'W_CONFIG_IGNORED', message: 'ignored', hint: 'see the rule' }] });

    expect(text).toContain('element-id-naming (.bpmnlintrc): warn, case any, eventDefinitionQualifier required');
    expect(text).toContain('required, new ids take it (not the triggers marked above)');
    expect(text).toContain('warning W_CONFIG_IGNORED: ignored  (see the rule)');
  });
});
