import { FeelError } from './FeelError.js';
import { type FeelToken, FeelTokenizer } from './FeelTokenizer.js';

export class FeelCursor {
  static readonly OPENING = ['(', '[', '{'];
  static readonly CLOSING = [')', ']', '}'];

  private pos = 0;
  private farthest: FeelError | undefined;
  private tokens: FeelToken[];

  constructor(private readonly src: string) {
    this.tokens = new FeelTokenizer(src).tokens();
  }

  whole(expression: () => void): void {
    try {
      expression();
      if (this.peek().kind !== 'end') {
        this.unexpected();
      }
    } catch (err) {
      if (err instanceof FeelError && this.farthest && this.farthest.at > err.at) {
        throw this.farthest;
      }
      throw err;
    }
  }

  peek(offset = 0): FeelToken {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  next(): FeelToken {
    return this.tokens[Math.min(this.pos++, this.tokens.length - 1)]!;
  }

  skip(count: number): void {
    this.pos += count;
  }

  isOp(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'op' && token.text === text;
  }

  isWord(text?: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'word' && (text === undefined || token.text === text);
  }

  eatOp(text: string): boolean {
    if (!this.isOp(text)) {
      return false;
    }
    this.pos++;
    return true;
  }

  expectOp(text: string, what?: string): void {
    if (!this.eatOp(text)) {
      this.unexpected(what ?? `expected ${text}`);
    }
  }

  kw(word: string, offset = 0): boolean {
    const token = this.peek(offset);
    if (token.kind !== 'word' || !token.text.startsWith(word)) {
      return false;
    }
    if (token.text === word) {
      return true;
    }
    let rest: FeelToken[];
    try {
      rest = new FeelTokenizer(token.text.slice(word.length)).tokens().slice(0, -1);
    } catch {
      return false;
    }
    const at = Math.min(this.pos + offset, this.tokens.length - 1);
    this.tokens = [...this.tokens.slice(0, at), { ...token, text: word }, ...rest.map((restToken) => ({ ...restToken, pos: restToken.pos + token.pos + word.length, nl: false })), ...this.tokens.slice(at + 1)];
    return true;
  }

  expectKw(word: string, what: string): void {
    if (!this.kw(word)) {
      this.unexpected(what);
    }
    this.pos++;
  }

  unexpected(hint?: string): never {
    const tok = this.peek();
    const prev = this.pos > 0 ? this.tokens[this.pos - 1] : undefined;
    const sentence = hint !== undefined && !hint.startsWith('expected');
    throw this.foreignSyntax(tok, prev, sentence) ?? (tok.kind === 'end' ? this.endOfInput(tok, prev, sentence ? hint : undefined) : FeelCursor.unexpectedToken(tok, prev, hint, sentence));
  }

  private foreignSyntax(tok: FeelToken, prev: FeelToken | undefined, sentence: boolean): FeelError | undefined {
    const glued = (left: string, right: string): boolean => !!prev && prev.text === left && tok.text === right && prev.pos + left.length === tok.pos;
    if (glued('<', '>')) {
      return new FeelError(prev!.pos, '<> (FEEL: != for "not equal")');
    }
    if (glued('>', '>') || glued('<', '<')) {
      return new FeelError(prev!.pos, `${prev!.text}${tok.text} (FEEL has no shift operators)`);
    }
    if (tok.text === ':' && this.src[tok.pos + 1] === '=') {
      return new FeelError(tok.pos, ':= (FEEL has no assignment; = compares)');
    }
    if (tok.kind === 'word' && /^(AND|OR|NOT|And|Or|Not)$/.test(tok.text)) {
      return new FeelError(tok.pos, `${tok.text} (FEEL keywords are lower case: ${tok.text.toLowerCase()}${tok.text.toLowerCase() === 'not' ? '(...)' : ''})`);
    }
    if ((tok.text === '?' || tok.text === ':') && /\?[\s\S]*:/.test(this.src) && !sentence) {
      return new FeelError(tok.pos, '?: (FEEL: if ... then ... else ...)');
    }
    return undefined;
  }

  private endOfInput(tok: FeelToken, prev: FeelToken | undefined, sentence: string | undefined): FeelError {
    if (sentence !== undefined) {
      return new FeelError(tok.pos, sentence);
    }
    const open = this.openBracket();
    if (open) {
      return new FeelError(tok.pos, `an unclosed ${open}`);
    }
    return new FeelError(tok.pos, prev ? `an incomplete expression: it ends after ${prev.text}` : 'an empty expression');
  }

  private static unexpectedToken(tok: FeelToken, prev: FeelToken | undefined, hint: string | undefined, sentence: boolean): FeelError {
    const what = tok.kind === 'str' ? `the string ${tok.text}` : `"${tok.text}"`;
    if (sentence) {
      return new FeelError(tok.pos, `${hint} (at ${what}, column ${tok.pos + 1})`);
    }
    if (hint) {
      return new FeelError(tok.pos, `${what} at column ${tok.pos + 1} (${hint})`);
    }
    const twoValues = prev && tok.kind !== 'op' && prev.kind !== 'op';
    return new FeelError(tok.pos, `${what} at column ${tok.pos + 1}${twoValues ? ` after ${prev.text}: two values without an operator between them` : ''}`);
  }

  private openBracket(): string | undefined {
    const stack: string[] = [];
    for (let index = 0; index < this.pos && index < this.tokens.length; index++) {
      const token = this.tokens[index]!;
      if (token.kind !== 'op') {
        continue;
      }
      if (FeelCursor.OPENING.includes(token.text)) {
        stack.push(token.text);
      } else if (FeelCursor.CLOSING.includes(token.text)) {
        stack.pop();
      }
    }
    return stack[stack.length - 1];
  }

  either(fn: () => void, fallback: () => void): void {
    const start = this.pos;
    const tokens = this.tokens;
    try {
      fn();
      return;
    } catch (first) {
      if (!(first instanceof FeelError)) {
        throw first;
      }
      if (!this.farthest || first.at > this.farthest.at) {
        this.farthest = first;
      }
      this.pos = start;
      this.tokens = tokens;
      try {
        fallback();
      } catch (second) {
        if (!(second instanceof FeelError)) {
          throw second;
        }
        throw second.at > first.at ? second : first;
      }
    }
  }
}
