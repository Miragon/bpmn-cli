import { FeelError } from './FeelError.js';


export type FeelTokenKind = 'num' | 'str' | 'temporal' | 'word' | 'tick' | 'op' | 'end';

export interface FeelToken {
  kind: FeelTokenKind;
  text: string;
  pos: number;
  nl: boolean;
}

export class FeelTokenizer {
  private static readonly NAME_START = /[\p{L}\p{Nl}\p{Sc}\p{Pc}]/u;
  private static readonly NAME_PART = /[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Nd}\p{Mn}\p{Mc}\p{Cf}\u007f-\u009f]/u;
  private static readonly SPACE = /[ \t\r\n\f\v\u2000-\u200a\u2028\u2029\u3000\ufeff]/;
  private static readonly OPERATORS = ['**', '<=', '>=', '!=', '..', '*', '/', '+', '-', '<', '>', '=', '.', ',', '(', ')', '[', ']', '{', '}', ':'];
  private static readonly STRAY: Record<string, string> = {
  '&': '& (FEEL: and)',
  '|': '| (FEEL: or)',
  '%': '% (FEEL has no modulo operator: modulo(a, b))',
  '^': '^ (FEEL: ** for powers)',
  '!': '! (FEEL: not(...))',
  "'": "' (FEEL strings use double quotes)",
  '\\': 'a backslash outside a string',
  ';': ';',
  '#': '#',
  '~': '~',
  '\u00a0': 'a non-breaking space',
};

  private readonly found: FeelToken[] = [];
  private index = 0;
  private nl = false;

  constructor(private readonly src: string) {}

  static closingQuote(src: string, quote: string, from: number): number {
    let closing = from;
    while (closing < src.length && src[closing] !== quote) {
      closing += src[closing] === '\\' && quote === '"' ? 2 : 1;
    }
    return closing;
  }

  tokens(): FeelToken[] {
    while (this.index < this.src.length) {
      this.scan(this.src[this.index]!);
    }
    this.found.push({ kind: 'end', text: '', pos: this.src.length, nl: this.nl });
    return this.found;
  }

  private scan(char: string): void {
    const following = this.src[this.index + 1];
    if (FeelTokenizer.SPACE.test(char)) {
      this.skipSpace(char);
    } else if (char === '/' && following === '/') {
      this.skipLineComment();
    } else if (char === '/' && following === '*') {
      this.skipBlockComment();
    } else if (char === '"' || char === '`') {
      this.scanQuoted(char);
    } else if (char === '@') {
      this.scanTemporal();
    } else if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(following ?? '') && !this.afterValue())) {
      this.push('num', /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/.exec(this.src.slice(this.index))![0]);
    } else if (char === '?') {
      this.push('word', '?');
    } else if (FeelTokenizer.NAME_START.test(char)) {
      this.scanName();
    } else {
      this.scanOperator(char);
    }
  }

  private push(kind: FeelTokenKind, text: string): void {
    this.found.push({ kind, text, pos: this.index, nl: this.nl });
    this.nl = false;
    this.index += text.length;
  }

  private afterValue(): boolean {
    const previous = this.found[this.found.length - 1];
    return !!previous && (previous.kind !== 'op' || [')', ']', '}'].includes(previous.text));
  }

  private skipSpace(char: string): void {
    if (char === '\n' || char === '\r' || char === ' ' || char === ' ') {
      this.nl = true;
    }
    this.index++;
  }

  private skipLineComment(): void {
    while (this.index < this.src.length && this.src[this.index] !== '\n') {
      this.index++;
    }
  }

  private skipBlockComment(): void {
    const end = this.src.indexOf('*/', this.index + 2);
    if (end === -1) {
      throw new FeelError(this.index, 'an unterminated comment');
    }
    if (/[\n\r]/.test(this.src.slice(this.index, end))) {
      this.nl = true;
    }
    this.index = end + 2;
  }

  private scanQuoted(quote: string): void {
    const closing = FeelTokenizer.closingQuote(this.src, quote, this.index + 1);
    if (closing >= this.src.length) {
      throw new FeelError(this.index, quote === '"' ? 'an unterminated string' : 'an unterminated `name`');
    }
    if (quote === '`' && closing === this.index + 1) {
      throw new FeelError(this.index, 'an empty `` name');
    }
    this.push(quote === '"' ? 'str' : 'tick', this.src.slice(this.index, closing + 1));
  }

  private scanTemporal(): void {
    let quote = this.index + 1;
    while (quote < this.src.length && FeelTokenizer.SPACE.test(this.src[quote]!)) {
      quote++;
    }
    if (this.src[quote] !== '"') {
      throw new FeelError(this.index, '@ without a "string" (a temporal literal is @"2030-01-01")');
    }
    const closing = FeelTokenizer.closingQuote(this.src, '"', quote + 1);
    if (closing >= this.src.length) {
      throw new FeelError(quote, 'an unterminated string');
    }
    this.push('temporal', this.src.slice(this.index, closing + 1));
  }

  private scanName(): void {
    let nameEnd = this.index + 1;
    while (nameEnd < this.src.length && FeelTokenizer.NAME_PART.test(this.src[nameEnd]!)) {
      nameEnd++;
    }
    this.push('word', this.src.slice(this.index, nameEnd));
  }

  private scanOperator(char: string): void {
    const operator = FeelTokenizer.OPERATORS.find((candidate) => this.src.startsWith(candidate, this.index));
    if (!operator) {
      throw new FeelError(this.index, FeelTokenizer.STRAY[char] ?? `the character ${JSON.stringify(char)}`);
    }
    this.push('op', operator);
  }
}
