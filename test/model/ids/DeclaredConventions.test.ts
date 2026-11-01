import { describe, expect, it } from 'vitest';
import { DeclaredConventions } from '../../../src/model/ids/DeclaredConventions.js';

describe('DeclaredConventions', () => {
  const prefixes = { 'bpmn:StartEvent': 'start_', 'bpmn:StartEvent:message': 'msgStart_', 'bpmn:Task': 'Task_' };

  it('keeps usable prefixes only and reads qualifier and case with their defaults', () => {
    const declared = DeclaredConventions.of({ prefixes: { ...prefixes, 'bpmn:Lane': 'bad prefix', 'bpmn:Group': '1x_' }, case: 'snake_case' });

    expect(declared.prefixes).toEqual(prefixes);
    expect([declared.qualifier, declared.bodyCase]).toEqual(['optional', 'snake']);
    expect(DeclaredConventions.of({ prefixes }).bodyCase).toBeUndefined();
  });

  it('answers a qualified prefix only when the qualifier is required', () => {
    const required = DeclaredConventions.of({ prefixes, qualifier: 'required' });
    const optional = DeclaredConventions.of({ prefixes, qualifier: 'optional' });

    expect([required.headFor('bpmn:StartEvent', 'message'), required.headFor('bpmn:StartEvent', 'timer'), required.headFor('bpmn:StartEvent', undefined)]).toEqual(['msgStart_', 'start_', 'start_']);
    expect(optional.headFor('bpmn:StartEvent', 'message')).toBe('start_');
    expect(optional.headFor('bpmn:Group', undefined)).toBeUndefined();
  });

  it.each([
    ['optional', [], 'message', ['start_', 'msgStart_']],
    ['required', [], 'message', ['msgStart_']],
    ['required', [], 'timer', ['start_']],
    ['off', [], 'message', ['start_']],
    ['required', ['bpmn:StartEvent:timer'], 'timer', []],
  ] as const)('lists the heads a start event may carry with the qualifier %s, ignoring %j and the trigger %s', (qualifier, ignored, trigger, heads) => {
    const declared = DeclaredConventions.of({ prefixes, qualifier, ignored: [...ignored] });

    expect(declared.headsOf({ type: 'bpmn:StartEvent', trigger })).toEqual(heads);
  });

  it('accepts any id for a type without a declared prefix and finds the longest head an id carries', () => {
    const declared = DeclaredConventions.of({ prefixes, qualifier: 'optional' });
    const message = { type: 'bpmn:StartEvent', trigger: 'message' };

    expect(declared.headsOf({ type: 'bpmn:Group' })).toEqual([]);
    expect(declared.acceptsId('foo', { type: 'bpmn:Group' })).toBe(true);
    expect([declared.acceptsId('start_x', message), declared.acceptsId('foo', message)]).toEqual([true, false]);
    expect([declared.headOf('msgStart_x', message), declared.headOf('start_x', message), declared.headOf('foo', message)]).toEqual(['msgStart_', 'start_', undefined]);
  });

  it.each([
    ['camelCase', 'task-checkIt', true],
    ['camelCase', 'task-check-it', false],
    ['PascalCase', 'task-CheckIt', true],
    ['PascalCase', 'task-checkIt', false],
    ['snake_case', 'task-check_it', true],
    ['snake_case', 'task-Check_It', false],
    ['kebab-case', 'task-check-it', true],
    ['kebab-case', 'task-checkIt', false],
  ] as const)('judges the body of "%2$s" in the case %1$s: %3$s', (declaredCase, id, inCase) => {
    const declared = DeclaredConventions.of({ prefixes: { 'bpmn:Task': 'task-' }, case: declaredCase });

    expect(declared.inDeclaredCase(id, { type: 'bpmn:Task' })).toBe(inCase);
  });

  it('sees an id in no case when it lacks the head, and any id in case without a declared head', () => {
    const declared = DeclaredConventions.of({ prefixes: { 'bpmn:Task': 'task_' }, case: 'snake_case' });

    expect(declared.inDeclaredCase('xx_check', { type: 'bpmn:Task' })).toBe(false);
    expect(declared.inDeclaredCase('anything', { type: 'bpmn:Group' })).toBe(true);
  });

  it('leads with a capital letter when most declared prefixes do', () => {
    expect(DeclaredConventions.of({ prefixes }).upperFirst).toBe(false);
    expect(DeclaredConventions.of({ prefixes: { 'bpmn:Task': 'Task_', 'bpmn:Lane': 'Lane_', 'bpmn:Group': 'group_' } }).upperFirst).toBe(true);
  });
});
