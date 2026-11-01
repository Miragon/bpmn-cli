import { describe, expect, it } from 'vitest';
import { FindingLines } from '../../../src/cli/output/FindingLines.js';

const finding = (element: string, more: object = {}) => ({ code: 'W_X', message: `about ${element}`, element, ...more });
const three = [finding('a'), finding('b'), finding('c')];

describe('FindingLines', () => {
  it('prints a warning with its element, related ids and hint', () => {
    expect(new FindingLines('f.bpmn').warnings([finding('a', { related: ['b'], hint: 'do' })])).toEqual(['warning W_X a [b]: about a  (do)']);
  });

  it('prints the command of a suggested fix instead of the hint', () => {
    expect(new FindingLines('f.bpmn').warnings([finding('a', { hint: 'do', fix: { op: 'remove', ids: ['a'] } })])).toEqual(['warning W_X a: about a  (bpmn remove f.bpmn a)']);
  });

  it('folds three warnings of one code into one line', () => {
    expect(new FindingLines('f.bpmn').warnings(three)).toEqual(['warning W_X x3 [a, b, c]: about a']);
  });

  it('prints what --force let through', () => {
    expect(new FindingLines('f.bpmn').forced([finding('a', { validator: 'v' })])).toEqual(['forced [v] W_X a: about a']);
  });

  it('keeps the problems of a blocking check apart, and folds an advisory rule', () => {
    const advisory = three.map((item) => ({ ...item, validator: 'bpmnlint', severity: 'error' as const }));

    expect(new FindingLines('f.bpmn').problems(three)).toHaveLength(3);
    expect(new FindingLines('f.bpmn', new Set(['bpmnlint'])).problems(advisory)).toEqual(['[bpmnlint error] W_X x3 [a]: about a (1 of 3; 2 others with 2 other messages, --json lists them)']);
  });
});
