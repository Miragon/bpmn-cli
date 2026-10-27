import { FeelError } from './FeelError.js';

type Kind = 'num' | 'str' | 'temporal' | 'word' | 'tick' | 'op' | 'end';

interface Tok {
  kind: Kind;
  text: string;
  pos: number;
  /** a line break before this token */
  nl: boolean;
}

const RESERVED = new Set(['then', 'else', 'in', 'return', 'satisfies', 'function', 'and', 'or', 'true', 'false', 'null']);
/** Other function names with spaces hold no reserved word: `foo then bar(1)` is refused. */
const KEYWORD_CALLS = [['get', 'or', 'else']];
const MULTI_WORD_TYPES = [
  ['days', 'and', 'time', 'duration'],
  ['years', 'and', 'months', 'duration'],
  ['date', 'and', 'time'],
];

const NAME_START = /[\p{L}\p{Nl}\p{Sc}\p{Pc}]/u;
const NAME_PART = /[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Nd}\p{Mn}\p{Mc}\p{Cf}\u007f-\u009f]/u;
const SPACE = /[ \t\r\n\f\v\u2000-\u200a\u2028\u2029\u3000\ufeff]/;
const OPERATORS = ['**', '<=', '>=', '!=', '..', '*', '/', '+', '-', '<', '>', '=', '.', ',', '(', ')', '[', ']', '{', '}', ':'];

const STRAY: Record<string, string> = {
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

/**
 * The FEEL grammar Camunda 8.9 accepts at deploy, written down from 766 deployed expressions;
 * run() throws a FeelError saying why. Where the grammar was not probed it accepts: a missed
 * error costs a deploy round trip, a false one blocks a valid file.
 */
export class FeelParser {
  private pos = 0;
  private rangeEnd = 0;
  /** if x then 1 reports the missing else, not "x" after a name if */
  private farthest: FeelError | undefined;

  private tokens: Tok[];

  constructor(private readonly src: string) {
    this.tokens = FeelParser.tokenize(src);
  }

  run(): void {
    try {
      this.textual();
      if (this.peek().kind !== 'end') this.unexpected();
    } catch (err) {
      if (err instanceof FeelError && this.farthest && this.farthest.at > err.at) throw this.farthest;
      throw err;
    }
  }

  private peek(offset = 0): Tok {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private next(): Tok {
    return this.tokens[Math.min(this.pos++, this.tokens.length - 1)]!;
  }

  private isOp(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'op' && token.text === text;
  }

  private isWord(text?: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'word' && (text === undefined || token.text === text);
  }

  private eatOp(text: string): boolean {
    if (!this.isOp(text)) return false;
    this.pos++;
    return true;
  }

  private expectOp(text: string, what?: string): void {
    if (!this.eatOp(text)) this.unexpected(what ?? `expected ${text}`);
  }

  /**
   * Camunda's parser reads a keyword at the start of a longer word as the keyword:
   * `x andy` is `x and y`. The token is split then; either() undoes it.
   */
  private kw(word: string, offset = 0): boolean {
    const token = this.peek(offset);
    if (token.kind !== 'word' || !token.text.startsWith(word)) return false;
    if (token.text === word) return true;
    let rest: Tok[];
    try {
      rest = FeelParser.tokenize(token.text.slice(word.length)).slice(0, -1);
    } catch {
      return false;
    }
    const at = Math.min(this.pos + offset, this.tokens.length - 1);
    this.tokens = [...this.tokens.slice(0, at), { ...token, text: word }, ...rest.map((restToken) => ({ ...restToken, pos: restToken.pos + token.pos + word.length, nl: false })), ...this.tokens.slice(at + 1)];
    return true;
  }

  private expectKw(word: string, what: string): void {
    if (!this.kw(word)) this.unexpected(what);
    this.pos++;
  }

  /** A hint starting with "expected" is added to the default message, any other replaces it. */
  private unexpected(hint?: string): never {
    const tok = this.peek();
    const prev = this.pos > 0 ? this.tokens[this.pos - 1] : undefined;
    const sentence = hint !== undefined && !hint.startsWith('expected');
    const glued = (left: string, right: string): boolean => !!prev && prev.text === left && tok.text === right && prev.pos + left.length === tok.pos;
    if (glued('<', '>')) throw new FeelError(prev!.pos, '<> (FEEL: != for "not equal")');
    if (glued('>', '>') || glued('<', '<')) throw new FeelError(prev!.pos, `${prev!.text}${tok.text} (FEEL has no shift operators)`);
    if (tok.text === ':' && this.src[tok.pos + 1] === '=') throw new FeelError(tok.pos, ':= (FEEL has no assignment; = compares)');
    if (tok.kind === 'word' && /^(AND|OR|NOT|And|Or|Not)$/.test(tok.text)) throw new FeelError(tok.pos, `${tok.text} (FEEL keywords are lower case: ${tok.text.toLowerCase()}${tok.text.toLowerCase() === 'not' ? '(...)' : ''})`);
    if ((tok.text === '?' || tok.text === ':') && /\?[\s\S]*:/.test(this.src) && !sentence) throw new FeelError(tok.pos, '?: (FEEL: if ... then ... else ...)');
    if (tok.kind === 'end') {
      if (sentence) throw new FeelError(tok.pos, hint);
      const open = this.openBracket();
      throw new FeelError(tok.pos, open ? `an unclosed ${open}` : prev ? `an incomplete expression: it ends after ${prev.text}` : 'an empty expression');
    }
    const what = tok.kind === 'str' ? `the string ${tok.text}` : `"${tok.text}"`;
    if (sentence) throw new FeelError(tok.pos, `${hint} (at ${what}, column ${tok.pos + 1})`);
    throw new FeelError(tok.pos, `${what} at column ${tok.pos + 1}${hint ? ` (${hint})` : prev && tok.kind !== 'op' && prev.kind !== 'op' ? ` after ${prev.text}: two values without an operator between them` : ''}`);
  }

  private openBracket(): string | undefined {
    const stack: string[] = [];
    for (let index = 0; index < this.pos && index < this.tokens.length; index++) {
      const token = this.tokens[index]!;
      if (token.kind !== 'op') continue;
      if (token.text === '(' || token.text === '[' || token.text === '{') stack.push(token.text);
      else if (token.text === ')' || token.text === ']' || token.text === '}') stack.pop();
    }
    return stack[stack.length - 1];
  }

  /** When both readings fail, the error that got further wins. */
  private either(fn: () => void, fallback: () => void): void {
    const start = this.pos;
    const tokens = this.tokens;
    try {
      fn();
      return;
    } catch (first) {
      if (!(first instanceof FeelError)) throw first;
      if (!this.farthest || first.at > this.farthest.at) this.farthest = first;
      this.pos = start;
      this.tokens = tokens;
      try {
        fallback();
      } catch (second) {
        if (!(second instanceof FeelError)) throw second;
        throw second.at > first.at ? second : first;
      }
    }
  }

  /** Parses an if / for / some / every form; the word is a name where its form does not follow. */
  private textual(): void {
    const token = this.peek();
    if (token.kind === 'word') {
      for (const [word, form] of [
        ['if', () => this.ifExpr()],
        ['for', () => this.forExpr()],
        ['some', () => this.quantified()],
        ['every', () => this.quantified()],
      ] as const) {
        if (token.text.startsWith(word)) return this.either(() => (this.kw(word), form()), () => this.disjunction());
      }
    }
    this.disjunction();
  }

  private ifExpr(): void {
    this.next();
    this.textual();
    this.expectKw('then', 'if needs then and else: if c then a else b');
    this.textual();
    this.expectKw('else', 'if ... then without else: FEEL needs if c then a else b');
    this.textual();
  }

  private forExpr(): void {
    this.next();
    do this.iteration();
    while (this.eatOp(','));
    this.expectKw('return', 'for ... in ... needs return: for x in xs return x');
    this.textual();
  }

  private quantified(): void {
    const kw = this.next().text;
    do this.iteration();
    while (this.eatOp(','));
    this.expectKw('satisfies', `${kw} ... in ... needs satisfies: ${kw} x in xs satisfies x > 1`);
    this.textual();
  }

  private iteration(): void {
    const token = this.peek();
    if (token.kind === 'tick' || (token.kind === 'word' && !RESERVED.has(token.text))) this.next();
    else this.unexpected('expected a variable name');
    this.expectKw('in', 'expected in');
    this.sum();
    if (this.eatOp('..')) this.sum();
  }

  private disjunction(): void {
    this.conjunction();
    while (this.kw('or')) {
      this.next();
      this.conjunction();
    }
  }

  private conjunction(): void {
    this.comparison();
    while (this.kw('and')) {
      this.next();
      this.comparison();
    }
  }

  /** Parses a comparison; `instance of` is tried before `in`, as Camunda's parser does. */
  private comparison(): void {
    if (['<', '<=', '>', '>='].some((operator) => this.isOp(operator))) {
      this.next();
      this.sum();
      return;
    }
    if (this.rangeAhead()) {
      this.range();
      return;
    }
    this.sum();
    if (['=', '!=', '<', '<=', '>', '>='].some((operator) => this.isOp(operator))) {
      this.next();
      this.sum();
    } else if (this.kw('between')) {
      this.next();
      this.sum();
      this.expectKw('and', 'between needs and: x between 1 and 5');
      this.sum();
    } else if (this.isWord() && this.peek().text.startsWith('in')) {
      this.either(
        () => {
          if (!this.kw('instance')) this.unexpected();
          this.next();
          this.expectKw('of', 'instance of needs of: x instance of number');
          this.typeName();
        },
        () => {
          this.expectKw('in', 'expected in');
          this.tests();
        },
      );
    }
  }

  private rangeAhead(): boolean {
    const open = this.peek();
    if (open.kind !== 'op' || !['[', '(', ']'].includes(open.text)) return false;
    let depth = 0;
    for (let offset = 1; ; offset++) {
      const token = this.peek(offset);
      if (token.kind === 'end') return false;
      if (token.kind !== 'op') continue;
      if (depth === 0 && token.text === '..') return true;
      if (depth === 0 && (token.text === ',' || token.text === ')' || token.text === ']' || token.text === '}')) return false;
      if (token.text === '(' || token.text === '[' || token.text === '{') depth++;
      else if (token.text === ')' || token.text === ']' || token.text === '}') depth--;
    }
  }

  /** Parses an interval; in its upper bound a `[` without its `]` closes the interval ([1..5[) instead of starting a filter. */
  private range(): void {
    this.next();
    this.sum();
    this.expectOp('..', 'expected .. in an interval: [1..5]');
    this.rangeEnd++;
    try {
      this.sum();
    } finally {
      this.rangeEnd--;
    }
    const close = this.peek();
    if (close.kind === 'op' && [']', ')', '['].includes(close.text)) this.next();
    else this.unexpected('expected ] or ) to close the interval');
  }

  private tests(): void {
    if (this.isOp('(') && !this.rangeAhead()) {
      this.next();
      do this.comparison();
      while (this.eatOp(','));
      this.expectOp(')', 'expected , or ) in the list of tests');
      return;
    }
    this.textual();
  }

  private typeName(): void {
    for (const words of MULTI_WORD_TYPES) {
      if (words.every((word, offset) => this.isWord(word, offset) && (offset === 0 || !this.peek(offset).nl))) {
        this.pos += words.length;
        return;
      }
    }
    const token = this.peek();
    if (token.kind === 'tick' || (token.kind === 'word' && (token.text === 'function' || !RESERVED.has(token.text)))) this.next();
    else this.unexpected('expected a type name after instance of');
    while (this.isOp('.')) {
      this.next();
      this.pathName();
    }
  }

  private sum(): void {
    this.product();
    while (this.isOp('+') || this.isOp('-')) {
      this.next();
      this.product();
    }
  }

  private product(): void {
    this.power();
    while (this.isOp('*') || this.isOp('/')) {
      this.next();
      this.power();
    }
  }

  private power(): void {
    this.unary();
    while (this.isOp('**')) {
      this.next();
      this.unary();
    }
  }

  private unary(): void {
    if (this.eatOp('-') && this.isOp('-')) this.unexpected('two minus signs in a row');
    this.postfix();
  }

  private bracketCloses(): boolean {
    let depth = 0;
    for (let offset = 0; ; offset++) {
      const token = this.peek(offset);
      if (token.kind === 'end') return false;
      if (token.kind !== 'op') continue;
      if (token.text === '(' || token.text === '[' || token.text === '{') depth++;
      else if (token.text === ')' || token.text === ']' || token.text === '}') {
        depth--;
        if (depth === 0) return token.text === ']';
      }
    }
  }

  private pathName(): void {
    const token = this.peek();
    if (token.kind === 'tick' || (token.kind === 'word' && !RESERVED.has(token.text))) this.next();
    else this.unexpected('expected a name after .');
  }

  /** Parses a primary and what follows it; a call may follow once, after a name or a path of names: a.b(1) but not f(1)(2). */
  private postfix(): void {
    let callable = this.primary();
    for (;;) {
      if (this.isOp('.')) {
        this.next();
        this.pathName();
      } else if (this.isOp('[') && (!this.rangeEnd || this.bracketCloses())) {
        this.next();
        this.textual();
        this.expectOp(']', 'expected ] to close the filter');
        callable = false;
      } else if (this.isOp('(') && callable) {
        this.args();
        callable = false;
      } else return;
    }
  }

  /**
   * Parses a primary; true when a call may follow. A function name may contain spaces
   * (string length(x)), else the first word alone is the name.
   */
  private primary(): boolean {
    const token = this.peek();
    if (token.kind === 'num' || token.kind === 'str' || token.kind === 'temporal') {
      this.next();
      return false;
    }
    if (token.kind === 'op') {
      if (token.text === '(') {
        this.next();
        this.textual();
        this.expectOp(')', 'expected )');
        return false;
      }
      if (token.text === '[') {
        this.next();
        if (!this.eatOp(']')) {
          do this.textual();
          while (this.eatOp(','));
          this.expectOp(']', 'expected , or ] in the list');
        }
        return false;
      }
      if (token.text === '{') {
        this.context();
        return false;
      }
      this.unexpected();
    }
    if (token.kind === 'word' && token.text === 'function') {
      this.functionDefinition();
      return false;
    }
    const words = this.callWordsAhead();
    if (!words) return this.name();
    let callable = false;
    this.either(
      () => {
        this.pos += words;
        this.args();
      },
      () => {
        callable = this.name();
      },
    );
    return callable;
  }

  /** true when a call may follow */
  private name(): boolean {
    const token = this.peek();
    if (token.kind === 'tick') {
      this.next();
      return true;
    }
    if (token.kind !== 'word') this.unexpected();
    if (token.text === 'true' || token.text === 'false' || token.text === 'null') {
      this.next();
      return false;
    }
    if ((token.text === 'and' || token.text === 'or') && this.isOp('(', 1)) {
      this.next();
      return true;
    }
    if (RESERVED.has(token.text)) this.unexpected(`${token.text} is a FEEL keyword, not a value`);
    this.next();
    return true;
  }

  private callWordsAhead(): number {
    for (const words of KEYWORD_CALLS) {
      if (words.every((word, offset) => this.isWord(word, offset) && (offset === 0 || !this.peek(offset).nl)) && this.isOp('(', words.length)) return words.length;
    }
    let wordCount = 0;
    for (;;) {
      const token = this.peek(wordCount);
      if (wordCount > 0 && token.nl) return 0;
      if (token.kind === 'word' && token.text !== '?' && !RESERVED.has(token.text)) wordCount++;
      else break;
    }
    return wordCount >= 2 && this.isOp('(', wordCount) ? wordCount : 0;
  }

  private args(): void {
    this.expectOp('(');
    if (this.eatOp(')')) return;
    const named = this.namedArgAhead();
    do {
      if (named) {
        if (!this.namedArgAhead()) this.unexpected('named and positional arguments cannot be mixed');
        while (!this.isOp(':')) this.next();
        this.next();
      }
      this.textual();
    } while (this.eatOp(','));
    this.expectOp(')', named ? 'expected , or ) after a named argument' : 'expected , or ) in the arguments');
  }

  private namedArgAhead(): boolean {
    let nameLength = 0;
    while (this.peek(nameLength).kind === 'tick' || (this.peek(nameLength).kind === 'word' && !RESERVED.has(this.peek(nameLength).text))) nameLength++;
    return nameLength > 0 && this.isOp(':', nameLength);
  }

  private context(): void {
    this.next();
    if (this.eatOp('}')) return;
    do {
      let keyTokens = 0;
      while (!this.isOp(':') && !this.isOp(',') && !this.isOp('{') && !this.isOp('}') && !this.isOp('(') && !this.isOp(')') && !this.isOp('[') && !this.isOp(']') && this.peek().kind !== 'end') {
        this.next();
        keyTokens++;
      }
      if (!keyTokens) this.unexpected('expected a key: {key: value}');
      this.expectOp(':', 'expected : after the key: {key: value}');
      this.textual();
    } while (this.eatOp(','));
    this.expectOp('}', 'expected , or } in the context');
  }

  private functionDefinition(): void {
    this.next();
    this.expectOp('(', 'function needs parameters: function(a, b) a + b');
    if (!this.eatOp(')')) {
      do {
        let nameTokens = 0;
        while (this.peek().kind === 'tick' || this.peek().kind === 'word') {
          this.next();
          nameTokens++;
        }
        if (!nameTokens) this.unexpected('expected a parameter name');
      } while (this.eatOp(','));
      this.expectOp(')', 'expected , or ) after the parameters');
    }
    this.textual();
  }

  private static tokenize(src: string): Tok[] {
    const out: Tok[] = [];
    let index = 0;
    let nl = false;
    const push = (kind: Kind, text: string, pos: number): void => {
      out.push({ kind, text, pos, nl });
      nl = false;
    };
    while (index < src.length) {
      const char = src[index]!;
      if (SPACE.test(char)) {
        if (char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029') nl = true;
        index++;
        continue;
      }
      if (char === '/' && src[index + 1] === '/') {
        while (index < src.length && src[index] !== '\n') index++;
        continue;
      }
      if (char === '/' && src[index + 1] === '*') {
        const end = src.indexOf('*/', index + 2);
        if (end === -1) throw new FeelError(index, 'an unterminated comment');
        if (/[\n\r]/.test(src.slice(index, end))) nl = true;
        index = end + 2;
        continue;
      }
      if (char === '"' || char === '`') {
        let closing = index + 1;
        while (closing < src.length && src[closing] !== char) closing += src[closing] === '\\' && char === '"' ? 2 : 1;
        if (closing >= src.length) throw new FeelError(index, char === '"' ? 'an unterminated string' : 'an unterminated `name`');
        if (char === '`' && closing === index + 1) throw new FeelError(index, 'an empty `` name');
        push(char === '"' ? 'str' : 'tick', src.slice(index, closing + 1), index);
        index = closing + 1;
        continue;
      }
      if (char === '@') {
        let quote = index + 1;
        while (quote < src.length && SPACE.test(src[quote]!)) quote++;
        if (src[quote] !== '"') throw new FeelError(index, '@ without a "string" (a temporal literal is @"2030-01-01")');
        let closing = quote + 1;
        while (closing < src.length && src[closing] !== '"') closing += src[closing] === '\\' ? 2 : 1;
        if (closing >= src.length) throw new FeelError(quote, 'an unterminated string');
        push('temporal', src.slice(index, closing + 1), index);
        index = closing + 1;
        continue;
      }
      const prev = out[out.length - 1];
      const afterValue = !!prev && (prev.kind !== 'op' || [')', ']', '}'].includes(prev.text));
      if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(src[index + 1] ?? '') && !afterValue)) {
        const match = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/.exec(src.slice(index))!;
        push('num', match[0], index);
        index += match[0].length;
        continue;
      }
      if (char === '?') {
        push('word', '?', index);
        index++;
        continue;
      }
      if (NAME_START.test(char)) {
        let nameEnd = index + 1;
        while (nameEnd < src.length && NAME_PART.test(src[nameEnd]!)) nameEnd++;
        push('word', src.slice(index, nameEnd), index);
        index = nameEnd;
        continue;
      }
      const op = OPERATORS.find((operator) => src.startsWith(operator, index));
      if (op) {
        push('op', op, index);
        index += op.length;
        continue;
      }
      throw new FeelError(index, STRAY[char] ?? `the character ${JSON.stringify(char)}`);
    }
    out.push({ kind: 'end', text: '', pos: src.length, nl });
    return out;
  }
}
