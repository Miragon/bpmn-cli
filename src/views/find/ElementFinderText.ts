import { Phrase, type ElementRef } from '../lines/index.js';

export interface FindHit extends ElementRef {
  in?: string | undefined;
  match?: string | undefined;
}

export class ElementFinderText {
  private static readonly MATCH_MAX = 100;
  private static readonly GAP = '  ';

  constructor(private readonly hits: readonly FindHit[]) {}

  private static columns({ id, kind, name, in: within, match }: FindHit): string[] {
    return [id, kind, name ? new Phrase(name).quoted : '', within ?? '', match ? `[${new Phrase(match).cut(ElementFinderText.MATCH_MAX)}]` : ''];
  }

  text(): string {
    const rows = this.hits.map(ElementFinderText.columns);
    const widths = rows.reduce((widest, row) => row.map((cell, column) => Math.max(cell.length, widest[column] ?? 0)), [] as number[]);
    return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(ElementFinderText.GAP).trimEnd()).join('\n');
  }
}
