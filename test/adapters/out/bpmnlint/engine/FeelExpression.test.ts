import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { FeelExpression } from '../../../../../src/adapters/out/bpmnlint/engine/rules/c8/feel/FeelExpression.js';

/** `[expression after the =, whether Camunda 8.9.22 deploys it as a flow condition]` */
const FEEL_VERDICTS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../fixtures/c8/feel-verdicts.json', import.meta.url)),
    'utf8',
  ),
) as Array<[string, boolean]>;

describe('FeelExpression agrees with Camunda 8.9.22', () => {
  it(`on all ${FEEL_VERDICTS.length} engine-checked expressions`, () => {
    const wrong = FEEL_VERDICTS.filter(
      ([expression, deploys]) =>
        (new FeelExpression(expression).problem() === undefined) !== deploys,
    ).map(
      ([expression, deploys]) =>
        `${deploys ? 'flagged' : 'missed'}: ${JSON.stringify(expression)} ${new FeelExpression(expression).problem() ?? ''}`,
    );
    expect(wrong).toEqual([]);
    expect(FEEL_VERDICTS.filter(([, deploys]) => !deploys).length).toBeGreaterThan(250);
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
  ])('names what %j means in FEEL', (expression, problem) => {
    expect(new FeelExpression(expression).problem()).toBe(problem);
  });
});
