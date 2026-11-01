import type { CommandRefusal, CommandWords } from '../../model/index.js';

type KeyWord = (key: string) => string;

export type Wording = string | ((key: KeyWord, bare: KeyWord) => string | undefined);

export class RefusalWording {
  private static readonly MARK = '\u0000';
  private static readonly QUOTED: KeyWord = (key) => `"${key}"`;
  private static readonly BARE: KeyWord = (key) => key;
  private static readonly MARKED: KeyWord = (key) => `${RefusalWording.MARK}${key}${RefusalWording.MARK}`;

  constructor(
    private readonly message: Wording,
    private readonly hint?: Wording,
  ) {}

  static onlyInBatch(hint: string | undefined): Wording | undefined {
    return hint === undefined ? undefined : (key) => (key === RefusalWording.QUOTED ? hint : undefined);
  }

  private static inBatch(wording: Wording): string {
    return (typeof wording === 'string' ? wording : wording(RefusalWording.QUOTED, RefusalWording.BARE))!;
  }

  private static inCommand(wording: Wording | undefined): CommandWords | undefined {
    const text = typeof wording === 'function' ? wording(RefusalWording.MARKED, RefusalWording.MARKED) : wording;
    return text?.split(RefusalWording.MARK).map((piece, index) => (index % 2 ? { key: piece } : piece));
  }

  get batchMessage(): string {
    return RefusalWording.inBatch(this.message);
  }

  get batchHint(): string | undefined {
    return this.hint === undefined ? undefined : RefusalWording.inBatch(this.hint);
  }

  asCommand(code?: string): CommandRefusal {
    const hint = RefusalWording.inCommand(this.hint);
    return { message: RefusalWording.inCommand(this.message)!, ...(hint ? { hint } : {}), ...(code ? { code } : {}) };
  }
}
