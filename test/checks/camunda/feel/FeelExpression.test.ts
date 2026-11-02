import { describe, expect, it } from 'vitest';
import { FeelExpression } from '../../../../src/checks/camunda/feel/FeelExpression.js';
import { EngineRows } from '../../../support/EngineRows.js';

describe('FeelExpression', () => {
  it.each(EngineRows.feel())('agrees with Camunda 8.9.22 on $expression', ({ expression, accepted }) => {
    expect(new FeelExpression(expression).problem() === undefined).toBe(accepted);
  });

  it.each([
    [' x & y', '& (FEEL: and)'],
    [' x | y', '| (FEEL: or)'],
    [' x <> 1', '<> (FEEL: != for "not equal")'],
    [' x >> 1', '>> (FEEL has no shift operators)'],
    [' x % 2 = 0', '% (FEEL has no modulo operator: modulo(a, b))'],
    [' if x then true', 'if ... then without else: FEEL needs if c then a else b'],
    [' for x in xs', 'for ... in ... needs return: for x in xs return x'],
    [' x AND y', 'AND (FEEL keywords are lower case: and)'],
    [' x := 1', ':= (FEEL has no assignment; = compares)'],
    [' a ? b : c', '?: (FEEL: if ... then ... else ...)'],
    [' a && b', '&& (FEEL: and)'],
    [' (a', 'an unclosed ('],
    [' a +', 'an incomplete expression: it ends after +'],
  ])('names what the slip %s means in FEEL', (expression, problem) => {
    expect(new FeelExpression(expression).problem()).toBe(problem);
  });
});
