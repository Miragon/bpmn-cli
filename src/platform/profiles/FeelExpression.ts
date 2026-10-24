import { FeelError } from './FeelError.js';
import { FeelParser } from './FeelParser.js';

export class FeelExpression {
  constructor(private readonly expression: string) {}

  /**
   * Why Camunda 8 refuses a FEEL expression at deploy (the text after the `=`),
   * or undefined. The JUEL habits first, with their FEEL spelling (&&, ||, ==,
   * !, ${...}, single quotes), then the syntax check of FeelParser (the
   * grammar Camunda 8.9 parses, engine-checked; every valid probe passes).
   */
  problem(): string | undefined {
    const expression = this.expression;
    let code = '';
    for (let i = 0; i < expression.length; i++) {
      const c = expression[i]!;
      if (c === '"' || c === '`') {
        let j = i + 1;
        while (j < expression.length && expression[j] !== c) j += expression[j] === '\\' && c === '"' ? 2 : 1;
        if (j >= expression.length) break;
        code += c === '"' ? ' "s" ' : ' n ';
        i = j;
      } else if (c === '/' && expression[i + 1] === '/') {
        const end = expression.indexOf('\n', i);
        i = end === -1 ? expression.length : end;
      } else if (c === '/' && expression[i + 1] === '*') {
        const end = expression.indexOf('*/', i + 2);
        if (end === -1) break;
        i = end + 1;
      } else {
        code += c;
      }
    }
    if (/[$#]\{/.test(code)) return '${...} (JUEL; FEEL writes the expression itself: = amount > 100)';
    if (code.includes('&&')) return '&& (FEEL: and)';
    if (code.includes('||')) return '|| (FEEL: or)';
    if (code.includes('==')) return '== (FEEL compares with a single =)';
    if (/!(?!=)/.test(code)) return '! (FEEL: not(...))';
    if (code.includes("'")) return 'single quotes (FEEL strings use double quotes)';
    return this.syntaxError();
  }

  /** Why Camunda 8 refuses the FEEL expression (the text after `=`), or undefined when it parses. */
  private syntaxError(): string | undefined {
    try {
      new FeelParser(this.expression).run();
      return undefined;
    } catch (err) {
      if (err instanceof FeelError) return err.message;
      throw err;
    }
  }
}
