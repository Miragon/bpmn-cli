import { FeelError } from './FeelError.js';
import { FeelParser } from './FeelParser.js';
import { FeelTokenizer } from './FeelTokenizer.js';

export class FeelExpression {
  private static readonly STAND_INS: Record<string, string> = { '"': ' "s" ', '`': ' n ' };

  constructor(private readonly expression: string) {}

  problem(): string | undefined {
    const code = this.withoutStringsAndComments();
    if (/[$#]\{/.test(code)) {
      return '${...} (JUEL; FEEL writes the expression itself: = amount > 100)';
    }
    if (code.includes('&&')) {
      return '&& (FEEL: and)';
    }
    if (code.includes('||')) {
      return '|| (FEEL: or)';
    }
    if (code.includes('==')) {
      return '== (FEEL compares with a single =)';
    }
    if (/!(?!=)/.test(code)) {
      return '! (FEEL: not(...))';
    }
    if (code.includes("'")) {
      return 'single quotes (FEEL strings use double quotes)';
    }
    return this.syntaxError();
  }

  private withoutStringsAndComments(): string {
    let code = '';
    for (let index = 0; index < this.expression.length; index++) {
      const char = this.expression[index]!;
      const end = this.endOfStringOrComment(char, index);
      if (end === -1) {
        break;
      }
      if (end === undefined) {
        code += char;
      } else {
        code += FeelExpression.STAND_INS[char] ?? '';
        index = end;
      }
    }
    return code;
  }

  private endOfStringOrComment(char: string, index: number): number | undefined {
    const expression = this.expression;
    if (char === '"' || char === '`') {
      const closing = FeelTokenizer.closingQuote(expression, char, index + 1);
      return closing >= expression.length ? -1 : closing;
    }
    if (char === '/' && expression[index + 1] === '/') {
      const end = expression.indexOf('\n', index);
      return end === -1 ? expression.length : end;
    }
    if (char === '/' && expression[index + 1] === '*') {
      const end = expression.indexOf('*/', index + 2);
      return end === -1 ? -1 : end + 1;
    }
    return undefined;
  }

  private syntaxError(): string | undefined {
    try {
      new FeelParser(this.expression).run();
      return undefined;
    } catch (err) {
      if (err instanceof FeelError) {
        return err.message;
      }
      throw err;
    }
  }
}
