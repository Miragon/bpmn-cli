import { FeelCursor } from './FeelCursor.js';
import type { FeelToken } from './FeelTokenizer.js';

export class FeelPrimaries {
  private static readonly RESERVED = new Set(['then', 'else', 'in', 'return', 'satisfies', 'function', 'and', 'or', 'true', 'false', 'null']);
  private static readonly KEYWORD_CALLS = [['get', 'or', 'else']];
  private static readonly MULTI_WORD_TYPES = [
  ['days', 'and', 'time', 'duration'],
  ['years', 'and', 'months', 'duration'],
  ['date', 'and', 'time'],
];

  constructor(
    private readonly cursor: FeelCursor,
    private readonly expression: () => void,
  ) {}

  primary(): boolean {
    const token = this.cursor.peek();
    if (token.kind === 'num' || token.kind === 'str' || token.kind === 'temporal') {
      this.cursor.next();
      return false;
    }
    if (token.kind === 'op') {
      this.bracketed(token.text);
      return false;
    }
    if (token.kind === 'word' && token.text === 'function') {
      this.functionDefinition();
      return false;
    }
    return this.callOrName();
  }

  args(): void {
    this.cursor.expectOp('(');
    if (this.cursor.eatOp(')')) {
      return;
    }
    const named = this.namedArgAhead();
    do {
      if (named) {
        this.skipArgName();
      }
      this.expression();
    } while (this.cursor.eatOp(','));
    this.cursor.expectOp(')', named ? 'expected , or ) after a named argument' : 'expected , or ) in the arguments');
  }

  expectName(hint: string): void {
    if (FeelPrimaries.isName(this.cursor.peek())) {
      this.cursor.next();
    } else {
      this.cursor.unexpected(hint);
    }
  }

  typeName(): void {
    for (const words of FeelPrimaries.MULTI_WORD_TYPES) {
      if (this.wordsAhead(words)) {
        this.cursor.skip(words.length);
        return;
      }
    }
    if (this.cursor.isWord('function')) {
      this.cursor.next();
    } else {
      this.expectName('expected a type name after instance of');
    }
    while (this.cursor.isOp('.')) {
      this.cursor.next();
      this.expectName('expected a name after .');
    }
  }

  private static isName(token: FeelToken): boolean {
    return token.kind === 'tick' || (token.kind === 'word' && !FeelPrimaries.RESERVED.has(token.text));
  }

  private wordsAhead(words: string[]): boolean {
    return words.every((word, offset) => this.cursor.isWord(word, offset) && (offset === 0 || !this.cursor.peek(offset).nl));
  }

  private bracketed(open: string): void {
    if (open === '(') {
      this.cursor.next();
      this.expression();
      this.cursor.expectOp(')', 'expected )');
    } else if (open === '[') {
      this.list();
    } else if (open === '{') {
      this.context();
    } else {
      this.cursor.unexpected();
    }
  }

  private list(): void {
    this.cursor.next();
    if (this.cursor.eatOp(']')) {
      return;
    }
    do {
      this.expression();
    } while (this.cursor.eatOp(','));
    this.cursor.expectOp(']', 'expected , or ] in the list');
  }

  private callOrName(): boolean {
    const words = this.callWordsAhead();
    if (!words) {
      return this.name();
    }
    let callable = false;
    this.cursor.either(
      () => {
        this.cursor.skip(words);
        this.args();
      },
      () => {
        callable = this.name();
      },
    );
    return callable;
  }

  private name(): boolean {
    const token = this.cursor.peek();
    if (token.kind === 'tick') {
      this.cursor.next();
      return true;
    }
    if (token.kind !== 'word') {
      this.cursor.unexpected();
    }
    if (token.text === 'true' || token.text === 'false' || token.text === 'null') {
      this.cursor.next();
      return false;
    }
    if ((token.text === 'and' || token.text === 'or') && this.cursor.isOp('(', 1)) {
      this.cursor.next();
      return true;
    }
    if (FeelPrimaries.RESERVED.has(token.text)) {
      this.cursor.unexpected(`${token.text} is a FEEL keyword, not a value`);
    }
    this.cursor.next();
    return true;
  }

  private callWordsAhead(): number {
    for (const words of FeelPrimaries.KEYWORD_CALLS) {
      if (this.wordsAhead(words) && this.cursor.isOp('(', words.length)) {
        return words.length;
      }
    }
    let wordCount = 0;
    for (;;) {
      const token = this.cursor.peek(wordCount);
      if (wordCount > 0 && token.nl) {
        return 0;
      }
      if (token.kind === 'word' && token.text !== '?' && !FeelPrimaries.RESERVED.has(token.text)) {
        wordCount++;
      } else {
        break;
      }
    }
    return wordCount >= 2 && this.cursor.isOp('(', wordCount) ? wordCount : 0;
  }

  private skipArgName(): void {
    if (!this.namedArgAhead()) {
      this.cursor.unexpected('named and positional arguments cannot be mixed');
    }
    while (!this.cursor.isOp(':')) {
      this.cursor.next();
    }
    this.cursor.next();
  }

  private namedArgAhead(): boolean {
    let nameLength = 0;
    while (FeelPrimaries.isName(this.cursor.peek(nameLength))) {
      nameLength++;
    }
    return nameLength > 0 && this.cursor.isOp(':', nameLength);
  }

  private context(): void {
    this.cursor.next();
    if (this.cursor.eatOp('}')) {
      return;
    }
    do {
      let keyTokens = 0;
      while (!this.endsContextKey()) {
        this.cursor.next();
        keyTokens++;
      }
      if (!keyTokens) {
        this.cursor.unexpected('expected a key: {key: value}');
      }
      this.cursor.expectOp(':', 'expected : after the key: {key: value}');
      this.expression();
    } while (this.cursor.eatOp(','));
    this.cursor.expectOp('}', 'expected , or } in the context');
  }

  private endsContextKey(): boolean {
    return [':', ',', ...FeelCursor.OPENING, ...FeelCursor.CLOSING].some((text) => this.cursor.isOp(text)) || this.cursor.peek().kind === 'end';
  }

  private functionDefinition(): void {
    this.cursor.next();
    this.cursor.expectOp('(', 'function needs parameters: function(a, b) a + b');
    if (!this.cursor.eatOp(')')) {
      do {
        this.parameterName();
      } while (this.cursor.eatOp(','));
      this.cursor.expectOp(')', 'expected , or ) after the parameters');
    }
    this.expression();
  }

  private parameterName(): void {
    let nameTokens = 0;
    while (this.cursor.peek().kind === 'tick' || this.cursor.peek().kind === 'word') {
      this.cursor.next();
      nameTokens++;
    }
    if (!nameTokens) {
      this.cursor.unexpected('expected a parameter name');
    }
  }
}
