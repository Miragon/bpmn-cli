import { describe, expect, it } from 'vitest';
import { BpmnError } from '../../../src/model/errors/BpmnError.js';
import { ModelError } from '../../../src/model/errors/ModelError.js';

describe('BpmnError', () => {
  it('carries a stable code, a category and details', () => {
    const error = BpmnError.model('E_NOT_FOUND', 'No element', { element: 'task' });

    expect([error.code, error.category, error.details.element]).toEqual(['E_NOT_FOUND', 'model', 'task']);
    expect(error.toJSON()).toEqual({ code: 'E_NOT_FOUND', message: 'No element', element: 'task' });
  });

  it.each([
    [BpmnError.usage('bad flag'), 'E_USAGE', 1],
    [BpmnError.model('E_X', 'bad model'), 'E_X', 2],
    [new BpmnError('E_LAYOUT', 'bad drawing', 'layout'), 'E_LAYOUT', 3],
    [BpmnError.io('E_IO', 'bad file'), 'E_IO', 4],
    [new BpmnError('E_BUG', 'bad code', 'internal'), 'E_BUG', 70],
  ])('exits with the code of its category', (error, code, exitCode) => {
    expect([error.code, error.exitCode]).toEqual([code, exitCode]);
  });

  it.each([
    ['LAYOUT_FAILED', 'layout'],
    ['PARSE_ERROR', 'io'],
    ['ANYTHING', 'model'],
  ])('turns a model error of %s into the category %s', (code, category) => {
    const converted = BpmnError.from(new ModelError('It failed', code, { element: 'task' })) as BpmnError;

    expect([converted.code, converted.category, converted.details.element]).toEqual([`E_${code}`, category, 'task']);
  });

  it('shortens a failure to its first line', () => {
    expect(BpmnError.firstLine(new Error('first\nsecond'))).toBe('first');
    expect(BpmnError.firstLine('plain')).toBe('plain');
  });

  it('leaves any other error as it is', () => {
    const failure = new Error('anything');

    expect(BpmnError.from(failure)).toBe(failure);
  });
});
