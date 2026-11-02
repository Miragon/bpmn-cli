export class Phrase {
  private static readonly FLAG_MAX = 60;

  constructor(private readonly text: string) {}

  get flat(): string {
    return this.text.replace(/\s+/g, ' ').trim();
  }

  get quoted(): string {
    return `"${this.flat.replace(/"/g, '\\"')}"`;
  }

  cut(max: number): string {
    const { flat } = this;
    return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
  }

  cutQuoted(max: number): string {
    return new Phrase(this.cut(max)).quoted;
  }

  flag(max = Phrase.FLAG_MAX): string {
    return /^[^\s,[\]"]+$/.test(this.text) && this.text.length <= max ? this.text : this.cutQuoted(max);
  }
}
