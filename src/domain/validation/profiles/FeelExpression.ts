import { FeelError } from './FeelError.js';
import { FeelParser } from './FeelParser.js';

export class FeelExpression {
  constructor(private readonly expression: string) {}

  /** Why Camunda 8 refuses the expression at deploy: JUEL habits first, then the FEEL syntax. */
  problem(): string | undefined {
    const expression = this.expression;
    let code = '';
    for (let index = 0; index < expression.length; index++) {
      const char = expression[index]!;
      if (char === '"' || char === '`') {
        let closing = index + 1;
        while (closing < expression.length && expression[closing] !== char) {
          closing += expression[closing] === '\\' && char === '"' ? 2 : 1;
        }
        if (closing >= expression.length) break;
        code += char === '"' ? ' "s" ' : ' n ';
        index = closing;
      } else if (char === '/' && expression[index + 1] === '/') {
        const end = expression.indexOf('\n', index);
        index = end === -1 ? expression.length : end;
      } else if (char === '/' && expression[index + 1] === '*') {
        const end = expression.indexOf('*/', index + 2);
        if (end === -1) break;
        index = end + 1;
      } else {
        code += char;
      }
    }
    if (/[$#]\{/.test(code)) {
      return '${...} (JUEL; FEEL writes the expression itself: = amount > 100)';
    }
    if (code.includes('&&')) return '&& (FEEL: and)';
    if (code.includes('||')) return '|| (FEEL: or)';
    if (code.includes('==')) return '== (FEEL compares with a single =)';
    if (/!(?!=)/.test(code)) return '! (FEEL: not(...))';
    if (code.includes("'")) return 'single quotes (FEEL strings use double quotes)';
    return this.syntaxError();
  }

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
