import { FeelCursor } from './FeelCursor.js';
import { FeelPrimaries } from './FeelPrimaries.js';

export class FeelParser {
  private readonly cursor: FeelCursor;
  private readonly primaries: FeelPrimaries;
  private rangeEnd = 0;

  constructor(src: string) {
    this.cursor = new FeelCursor(src);
    this.primaries = new FeelPrimaries(this.cursor, () => this.textual());
  }

  run(): void {
    this.cursor.whole(() => this.textual());
  }

  private static nesting(text: string): number {
    if (FeelCursor.OPENING.includes(text)) {
      return 1;
    }
    return FeelCursor.CLOSING.includes(text) ? -1 : 0;
  }

  private *operatorsAhead(from: number): Generator<string> {
    for (let offset = from; this.cursor.peek(offset).kind !== 'end'; offset++) {
      if (this.cursor.peek(offset).kind === 'op') {
        yield this.cursor.peek(offset).text;
      }
    }
  }

  private textual(): void {
    const token = this.cursor.peek();
    if (token.kind === 'word') {
      for (const [word, form] of [
        ['if', () => this.ifExpr()],
        ['for', () => this.forExpr()],
        ['some', () => this.quantified()],
        ['every', () => this.quantified()],
      ] as const) {
        if (token.text.startsWith(word)) {
          return this.cursor.either(() => (this.cursor.kw(word), form()), () => this.disjunction());
        }
      }
    }
    this.disjunction();
  }

  private ifExpr(): void {
    this.cursor.next();
    this.textual();
    this.cursor.expectKw('then', 'if needs then and else: if c then a else b');
    this.textual();
    this.cursor.expectKw('else', 'if ... then without else: FEEL needs if c then a else b');
    this.textual();
  }

  private forExpr(): void {
    this.cursor.next();
    this.iterations();
    this.cursor.expectKw('return', 'for ... in ... needs return: for x in xs return x');
    this.textual();
  }

  private quantified(): void {
    const kw = this.cursor.next().text;
    this.iterations();
    this.cursor.expectKw('satisfies', `${kw} ... in ... needs satisfies: ${kw} x in xs satisfies x > 1`);
    this.textual();
  }

  private iterations(): void {
    do {
      this.primaries.expectName('expected a variable name');
      this.cursor.expectKw('in', 'expected in');
      this.sum();
      if (this.cursor.eatOp('..')) {
        this.sum();
      }
    } while (this.cursor.eatOp(','));
  }

  private leftAssociative(operand: () => void, continues: () => boolean): void {
    operand();
    while (continues()) {
      this.cursor.next();
      operand();
    }
  }

  private disjunction(): void {
    this.leftAssociative(() => this.conjunction(), () => this.cursor.kw('or'));
  }

  private conjunction(): void {
    this.leftAssociative(() => this.comparison(), () => this.cursor.kw('and'));
  }

  private comparison(): void {
    if (['<', '<=', '>', '>='].some((operator) => this.cursor.isOp(operator))) {
      this.cursor.next();
      this.sum();
      return;
    }
    if (this.rangeAhead()) {
      this.range();
      return;
    }
    this.sum();
    if (['=', '!=', '<', '<=', '>', '>='].some((operator) => this.cursor.isOp(operator))) {
      this.cursor.next();
      this.sum();
    } else if (this.cursor.kw('between')) {
      this.cursor.next();
      this.sum();
      this.cursor.expectKw('and', 'between needs and: x between 1 and 5');
      this.sum();
    } else if (this.cursor.isWord() && this.cursor.peek().text.startsWith('in')) {
      this.cursor.either(() => this.instanceOf(), () => this.membership());
    }
  }

  private instanceOf(): void {
    if (!this.cursor.kw('instance')) {
      this.cursor.unexpected();
    }
    this.cursor.next();
    this.cursor.expectKw('of', 'instance of needs of: x instance of number');
    this.primaries.typeName();
  }

  private membership(): void {
    this.cursor.expectKw('in', 'expected in');
    this.tests();
  }

  private rangeAhead(): boolean {
    const open = this.cursor.peek();
    if (open.kind !== 'op' || !['[', '(', ']'].includes(open.text)) {
      return false;
    }
    let depth = 0;
    for (const operator of this.operatorsAhead(1)) {
      if (depth === 0 && operator === '..') {
        return true;
      }
      if (depth === 0 && (operator === ',' || FeelCursor.CLOSING.includes(operator))) {
        return false;
      }
      depth += FeelParser.nesting(operator);
    }
    return false;
  }

  private range(): void {
    this.cursor.next();
    this.sum();
    this.cursor.expectOp('..', 'expected .. in an interval: [1..5]');
    this.rangeEnd++;
    try {
      this.sum();
    } finally {
      this.rangeEnd--;
    }
    const close = this.cursor.peek();
    if (close.kind === 'op' && [']', ')', '['].includes(close.text)) {
      this.cursor.next();
    } else {
      this.cursor.unexpected('expected ] or ) to close the interval');
    }
  }

  private tests(): void {
    if (this.cursor.isOp('(') && !this.rangeAhead()) {
      this.cursor.next();
      do {
        this.comparison();
      } while (this.cursor.eatOp(','));
      this.cursor.expectOp(')', 'expected , or ) in the list of tests');
      return;
    }
    this.textual();
  }

  private sum(): void {
    this.leftAssociative(() => this.product(), () => this.cursor.isOp('+') || this.cursor.isOp('-'));
  }

  private product(): void {
    this.leftAssociative(() => this.power(), () => this.cursor.isOp('*') || this.cursor.isOp('/'));
  }

  private power(): void {
    this.leftAssociative(() => this.unary(), () => this.cursor.isOp('**'));
  }

  private unary(): void {
    if (this.cursor.eatOp('-') && this.cursor.isOp('-')) {
      this.cursor.unexpected('two minus signs in a row');
    }
    this.postfix();
  }

  private bracketCloses(): boolean {
    let depth = 0;
    for (const operator of this.operatorsAhead(0)) {
      depth += FeelParser.nesting(operator);
      if (depth === 0 && FeelCursor.CLOSING.includes(operator)) {
        return operator === ']';
      }
    }
    return false;
  }

  private postfix(): void {
    let callable = this.primaries.primary();
    for (;;) {
      if (this.cursor.isOp('.')) {
        this.cursor.next();
        this.primaries.expectName('expected a name after .');
      } else if (this.cursor.isOp('[') && (!this.rangeEnd || this.bracketCloses())) {
        this.cursor.next();
        this.textual();
        this.cursor.expectOp(']', 'expected ] to close the filter');
        callable = false;
      } else if (this.cursor.isOp('(') && callable) {
        this.primaries.args();
        callable = false;
      } else {
        return;
      }
    }
  }
}
