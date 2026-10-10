/**
 * A FEEL syntax check for the Camunda 8 profile: feelSyntaxError(text)
 * returns why Camunda 8.9 refuses to deploy an expression (the text after
 * the `=`), or undefined when it parses.
 *
 * Not an evaluator and no dependency: a tokenizer and a recursive-descent
 * reading of the grammar Camunda 8.9's FEEL engine (feel-scala) accepts at
 * deploy, written down from 766 expressions deployed to Camunda 8.9.22
 * (test/fixtures/c8/feel-verdicts.json keeps 762 of them with the engine's
 * verdict, test/step3-c8-fixes.test.ts checks them). Where the engine's
 * grammar was not probed the check accepts: a missed syntax error costs a
 * deploy round trip, a false one would block a valid file. Camunda's parser
 * reads a keyword at the start of a longer word as the keyword (`x andy` is
 * `x and y`); kw() does the same.
 *
 *   expression  textual: if c then a else b | for x in s (, y in s)* return e |
 *               some|every x in s (, ...)* satisfies e | disjunction
 *               (`if`, `for`, `some`, `every` are names where no such form follows)
 *   disjunction conjunction (or conjunction)*;  conjunction comparison (and comparison)*
 *   comparison  < <= > >= sum (a unary test) | an interval [a..b] (a..b) ]a..b[ |
 *               sum (one of: compare sum | between sum and sum | in tests | instance of type)?
 *               (no chains: a < b < c is refused)
 *   tests       ( test (, test)* ) | test;  test = comparison
 *   sum         product ((+|-) product)*;  product power ((*|/) power)*;  power unary (** unary)*
 *   unary       -? postfix (one minus: - -x is refused);  postfix primary (.name | [expression])*
 *               with one call right after a name or a path of names: a.b(1) but not f(1)(2), (f)(1)
 *   primary     number | "string" | @"temporal" | true | false | null | name | `name` | ? |
 *               (expression) | [expressions] | {key: expression, ...} | function(params) expression |
 *               a call of a name with spaces: string length(x), get or else(a, b)
 *   iteration   name in sum (.. sum)?    (for x in 1..3; a bracketed range is refused there)
 *
 * Reserved, never a name: then else in return satisfies function and or true
 * false null (`and(...)` / `or(...)` are calls of the built-ins). Names are Java
 * identifiers (letters, digits after the first, _ $ and currency symbols,
 * connector punctuation, combining marks) or `?`; a name with spaces only as
 * a function name before `(`, a context key, a parameter, or in backticks.
 */

type Kind = 'num' | 'str' | 'temporal' | 'word' | 'tick' | 'op' | 'end';

interface Tok {
  kind: Kind;
  text: string;
  pos: number;
  /** a line break between the previous token and this one */
  nl: boolean;
}

class FeelError extends Error {
  constructor(
    readonly at: number,
    message: string,
  ) {
    super(message);
  }
}

/** Never a name (standalone or in a path). */
const RESERVED = new Set(['then', 'else', 'in', 'return', 'satisfies', 'function', 'and', 'or', 'true', 'false', 'null']);
/** Built-in function names with a reserved word inside (other function names with spaces have none: `foo then bar(1)` is refused). */
const KEYWORD_CALLS = [['get', 'or', 'else']];
/** Type names with spaces (`instance of days and time duration`). */
const MULTI_WORD_TYPES = [
  ['days', 'and', 'time', 'duration'],
  ['years', 'and', 'months', 'duration'],
  ['date', 'and', 'time'],
];

const NAME_START = /[\p{L}\p{Nl}\p{Sc}\p{Pc}]/u;
const NAME_PART = /[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Nd}\p{Mn}\p{Mc}\p{Cf}\u007f-\u009f]/u;
const SPACE = /[ \t\r\n\f\v\u2000-\u200a\u2028\u2029\u3000\ufeff]/;
const OPERATORS = ['**', '<=', '>=', '!=', '..', '*', '/', '+', '-', '<', '>', '=', '.', ',', '(', ')', '[', ']', '{', '}', ':'];

/** What a character that FEEL does not know usually meant. */
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

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let nl = false;
  const push = (kind: Kind, text: string, pos: number): void => {
    out.push({ kind, text, pos, nl });
    nl = false;
  };
  while (i < src.length) {
    const c = src[i]!;
    if (SPACE.test(c)) {
      if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') nl = true;
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new FeelError(i, 'an unterminated comment');
      if (/[\n\r]/.test(src.slice(i, end))) nl = true;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' && c === '"' ? 2 : 1;
      if (j >= src.length) throw new FeelError(i, c === '"' ? 'an unterminated string' : 'an unterminated `name`');
      if (c === '`' && j === i + 1) throw new FeelError(i, 'an empty `` name');
      push(c === '"' ? 'str' : 'tick', src.slice(i, j + 1), i);
      i = j + 1;
      continue;
    }
    if (c === '@') {
      let j = i + 1;
      while (j < src.length && SPACE.test(src[j]!)) j++;
      if (src[j] !== '"') throw new FeelError(i, '@ without a "string" (a temporal literal is @"2030-01-01")');
      let k = j + 1;
      while (k < src.length && src[k] !== '"') k += src[k] === '\\' ? 2 : 1;
      if (k >= src.length) throw new FeelError(j, 'an unterminated string');
      push('temporal', src.slice(i, k + 1), i);
      i = k + 1;
      continue;
    }
    const prev = out[out.length - 1];
    const afterValue = !!prev && (prev.kind !== 'op' || [')', ']', '}'].includes(prev.text));
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? '') && !afterValue)) {
      const m = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/.exec(src.slice(i))!;
      push('num', m[0], i);
      i += m[0].length;
      continue;
    }
    if (c === '?') {
      push('word', '?', i);
      i++;
      continue;
    }
    if (NAME_START.test(c)) {
      let j = i + 1;
      while (j < src.length && NAME_PART.test(src[j]!)) j++;
      push('word', src.slice(i, j), i);
      i = j;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      push('op', op, i);
      i += op.length;
      continue;
    }
    throw new FeelError(i, STRAY[c] ?? `the character ${JSON.stringify(c)}`);
  }
  out.push({ kind: 'end', text: '', pos: src.length, nl });
  return out;
}

class Parser {
  private i = 0;
  /** parsing the upper bound of an interval */
  private rangeEnd = 0;
  /** the farthest error of a reading either() gave up (if x then 1: the missing else, not "x" after a name if) */
  private farthest: FeelError | undefined;

  constructor(
    private t: Tok[],
    private readonly src: string,
  ) {}

  run(): void {
    try {
      this.textual();
      if (this.peek().kind !== 'end') this.unexpected();
    } catch (err) {
      // the message: where the parse got farthest (the verdict does not depend on it)
      if (err instanceof FeelError && this.farthest && this.farthest.at > err.at) throw this.farthest;
      throw err;
    }
  }

  /* tokens ----------------------------------------------------------- */

  private peek(k = 0): Tok {
    return this.t[Math.min(this.i + k, this.t.length - 1)]!;
  }

  private next(): Tok {
    return this.t[Math.min(this.i++, this.t.length - 1)]!;
  }

  private isOp(text: string, k = 0): boolean {
    const t = this.peek(k);
    return t.kind === 'op' && t.text === text;
  }

  private isWord(text?: string, k = 0): boolean {
    const t = this.peek(k);
    return t.kind === 'word' && (text === undefined || t.text === text);
  }

  private eatOp(text: string): boolean {
    if (!this.isOp(text)) return false;
    this.i++;
    return true;
  }

  private expectOp(text: string, what?: string): void {
    if (!this.eatOp(text)) this.unexpected(what ?? `expected ${text}`);
  }

  /**
   * The keyword `word` here (k tokens ahead): the whole word, or the start of a
   * longer one, which Camunda 8's parser reads as the keyword and the rest
   * (`x andy` is `x and y`, `x between1 and 2`, `ifx then 1 else 2`); the
   * token is split then (either() undoes it when that reading fails).
   */
  private kw(word: string, k = 0): boolean {
    const t = this.peek(k);
    if (t.kind !== 'word' || !t.text.startsWith(word)) return false;
    if (t.text === word) return true;
    let rest: Tok[];
    try {
      rest = tokenize(t.text.slice(word.length)).slice(0, -1);
    } catch {
      return false;
    }
    const at = Math.min(this.i + k, this.t.length - 1);
    this.t = [...this.t.slice(0, at), { ...t, text: word }, ...rest.map((r) => ({ ...r, pos: r.pos + t.pos + word.length, nl: false })), ...this.t.slice(at + 1)];
    return true;
  }

  private expectKw(word: string, what: string): void {
    if (!this.kw(word)) this.unexpected(what);
    this.i++;
  }

  /**
   * Throws the error at the current token. `hint`: "expected ..." is added to
   * the default message, anything else is the message (if without else, ...).
   */
  private unexpected(hint?: string): never {
    const tok = this.peek();
    const prev = this.i > 0 ? this.t[this.i - 1] : undefined;
    const sentence = hint !== undefined && !hint.startsWith('expected');
    const glued = (a: string, b: string): boolean => !!prev && prev.text === a && tok.text === b && prev.pos + a.length === tok.pos;
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

  /** The innermost bracket still open before the current token (for "an unclosed (" at the end). */
  private openBracket(): string | undefined {
    const stack: string[] = [];
    for (let k = 0; k < this.i && k < this.t.length; k++) {
      const x = this.t[k]!;
      if (x.kind !== 'op') continue;
      if (x.text === '(' || x.text === '[' || x.text === '{') stack.push(x.text);
      else if (x.text === ')' || x.text === ']' || x.text === '}') stack.pop();
    }
    return stack[stack.length - 1];
  }

  /** Runs `fn`; on a syntax error goes back and runs `fallback`; the error that got further wins when both fail. */
  private either(fn: () => void, fallback: () => void): void {
    const start = this.i;
    const tokens = this.t;
    try {
      fn();
      return;
    } catch (first) {
      if (!(first instanceof FeelError)) throw first;
      if (!this.farthest || first.at > this.farthest.at) this.farthest = first;
      this.i = start;
      this.t = tokens;
      try {
        fallback();
      } catch (second) {
        if (!(second instanceof FeelError)) throw second;
        throw second.at > first.at ? second : first;
      }
    }
  }

  /* grammar ---------------------------------------------------------- */

  private textual(): void {
    const w = this.peek();
    // if / for / some / every start their forms (also glued to the next word: ifx then ...), else they are names
    if (w.kind === 'word') {
      for (const [word, form] of [
        ['if', () => this.ifExpr()],
        ['for', () => this.forExpr()],
        ['some', () => this.quantified()],
        ['every', () => this.quantified()],
      ] as const) {
        if (w.text.startsWith(word)) return this.either(() => (this.kw(word), form()), () => this.disjunction());
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

  /** name in sum (.. sum)? */
  private iteration(): void {
    const v = this.peek();
    if (v.kind === 'tick' || (v.kind === 'word' && !RESERVED.has(v.text))) this.next();
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

  private comparison(): void {
    if (['<', '<=', '>', '>='].some((o) => this.isOp(o))) {
      this.next();
      this.sum();
      return;
    }
    if (this.rangeAhead()) {
      this.range();
      return;
    }
    this.sum();
    if (['=', '!=', '<', '<=', '>', '>='].some((o) => this.isOp(o))) {
      this.next();
      this.sum();
    } else if (this.kw('between')) {
      this.next();
      this.sum();
      this.expectKw('and', 'between needs and: x between 1 and 5');
      this.sum();
    } else if (this.isWord() && this.peek().text.startsWith('in')) {
      // instance of before in, as Camunda's parser tries them (x instanceof is x in stanceof)
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

  /** An interval starts here: [a..b], (a..b], ]a..b[ (a `..` before the bracket closes or a comma). */
  private rangeAhead(): boolean {
    const open = this.peek();
    if (open.kind !== 'op' || !['[', '(', ']'].includes(open.text)) return false;
    let depth = 0;
    for (let k = 1; ; k++) {
      const x = this.peek(k);
      if (x.kind === 'end') return false;
      if (x.kind !== 'op') continue;
      if (depth === 0 && x.text === '..') return true;
      if (depth === 0 && (x.text === ',' || x.text === ')' || x.text === ']' || x.text === '}')) return false;
      if (x.text === '(' || x.text === '[' || x.text === '{') depth++;
      else if (x.text === ')' || x.text === ']' || x.text === '}') depth--;
    }
  }

  private range(): void {
    this.next();
    this.sum();
    this.expectOp('..', 'expected .. in an interval: [1..5]');
    // the upper bound: a `[` without its `]` closes the interval ([1..5[), it is no filter
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

  /** After `in`: ( test (, test)* ) or one test. */
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
      if (words.every((w, k) => this.isWord(w, k) && (k === 0 || !this.peek(k).nl))) {
        this.i += words.length;
        return;
      }
    }
    const t = this.peek();
    if (t.kind === 'tick' || (t.kind === 'word' && (t.text === 'function' || !RESERVED.has(t.text)))) this.next();
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

  /** The `[` here has its `]`. */
  private bracketCloses(): boolean {
    let depth = 0;
    for (let k = 0; ; k++) {
      const x = this.peek(k);
      if (x.kind === 'end') return false;
      if (x.kind !== 'op') continue;
      if (x.text === '(' || x.text === '[' || x.text === '{') depth++;
      else if (x.text === ')' || x.text === ']' || x.text === '}') {
        depth--;
        if (depth === 0) return x.text === ']';
      }
    }
  }

  private pathName(): void {
    const t = this.peek();
    if (t.kind === 'tick' || (t.kind === 'word' && !RESERVED.has(t.text))) this.next();
    else this.unexpected('expected a name after .');
  }

  private postfix(): void {
    // a call may follow a name or a path of names, once
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

  /** Reads a primary; true when a call may follow (a name). */
  private primary(): boolean {
    const t = this.peek();
    if (t.kind === 'num' || t.kind === 'str' || t.kind === 'temporal') {
      this.next();
      return false;
    }
    if (t.kind === 'op') {
      if (t.text === '(') {
        this.next();
        this.textual();
        this.expectOp(')', 'expected )');
        return false;
      }
      if (t.text === '[') {
        this.next();
        if (!this.eatOp(']')) {
          do this.textual();
          while (this.eatOp(','));
          this.expectOp(']', 'expected , or ] in the list');
        }
        return false;
      }
      if (t.text === '{') {
        this.context();
        return false;
      }
      this.unexpected();
    }
    if (t.kind === 'word' && t.text === 'function') {
      this.functionDefinition();
      return false;
    }
    const words = this.callWordsAhead();
    if (!words) return this.name();
    // a function name with spaces (string length(x)); when its arguments do not parse: the first word alone
    let callable = false;
    this.either(
      () => {
        this.i += words;
        this.args();
      },
      () => {
        callable = this.name();
      },
    );
    return callable;
  }

  /** One name (or literal word); true when a call may follow. */
  private name(): boolean {
    const t = this.peek();
    if (t.kind === 'tick') {
      this.next();
      return true;
    }
    if (t.kind !== 'word') this.unexpected();
    if (t.text === 'true' || t.text === 'false' || t.text === 'null') {
      this.next();
      return false;
    }
    // the built-ins and(list) / or(list)
    if ((t.text === 'and' || t.text === 'or') && this.isOp('(', 1)) {
      this.next();
      return true;
    }
    if (RESERVED.has(t.text)) this.unexpected(`${t.text} is a FEEL keyword, not a value`);
    this.next();
    return true;
  }

  /** The number of words of a function name with spaces before `(` (string length(...), get or else(...)), else 0. */
  private callWordsAhead(): number {
    for (const words of KEYWORD_CALLS) {
      if (words.every((w, j) => this.isWord(w, j) && (j === 0 || !this.peek(j).nl)) && this.isOp('(', words.length)) return words.length;
    }
    let k = 0;
    for (;;) {
      const w = this.peek(k);
      if (k > 0 && w.nl) return 0;
      if (w.kind === 'word' && w.text !== '?' && !RESERVED.has(w.text)) k++;
      else break;
    }
    return k >= 2 && this.isOp('(', k) ? k : 0;
  }

  /** ( ) | ( expression (, expression)* ) | ( name: expression (, name: expression)* ) */
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

  /** `name:` (a name with spaces too) starts here. */
  private namedArgAhead(): boolean {
    let k = 0;
    while (this.peek(k).kind === 'tick' || (this.peek(k).kind === 'word' && !RESERVED.has(this.peek(k).text))) k++;
    return k > 0 && this.isOp(':', k);
  }

  /** {key: expression, ...}: a key is a string, a `name` or any words up to the colon. */
  private context(): void {
    this.next();
    if (this.eatOp('}')) return;
    do {
      let n = 0;
      while (!this.isOp(':') && !this.isOp(',') && !this.isOp('{') && !this.isOp('}') && !this.isOp('(') && !this.isOp(')') && !this.isOp('[') && !this.isOp(']') && this.peek().kind !== 'end') {
        this.next();
        n++;
      }
      if (!n) this.unexpected('expected a key: {key: value}');
      this.expectOp(':', 'expected : after the key: {key: value}');
      this.textual();
    } while (this.eatOp(','));
    this.expectOp('}', 'expected , or } in the context');
  }

  /** function(a, b) expression (a parameter name may have spaces) */
  private functionDefinition(): void {
    this.next();
    this.expectOp('(', 'function needs parameters: function(a, b) a + b');
    if (!this.eatOp(')')) {
      do {
        let n = 0;
        while (this.peek().kind === 'tick' || this.peek().kind === 'word') {
          this.next();
          n++;
        }
        if (!n) this.unexpected('expected a parameter name');
      } while (this.eatOp(','));
      this.expectOp(')', 'expected , or ) after the parameters');
    }
    this.textual();
  }
}

/** Why Camunda 8 refuses the FEEL expression (the text after `=`), or undefined when it parses. */
export function feelSyntaxError(text: string): string | undefined {
  try {
    new Parser(tokenize(text), text).run();
    return undefined;
  } catch (err) {
    if (err instanceof FeelError) return err.message;
    throw err;
  }
}
