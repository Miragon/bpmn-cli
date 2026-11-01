import type { XElement } from './XmlTextReader.js';

export class ChildGaps {
  readonly lead = new Map<XElement, string>();
  readonly trail = new Map<XElement, string>();
  head = '';
  closing = '';
  inline: boolean;

  private constructor(hasChildren: boolean) {
    this.inline = hasChildren;
  }

  static of(text: string, element: XElement, kids: readonly XElement[]): ChildGaps {
    const gaps = new ChildGaps(kids.length > 0);
    let from = element.tagEnd;
    for (let index = 0; index <= kids.length; index++) {
      const kid = kids[index];
      gaps.record(text.slice(from, kid ? kid.start : element.closeStart), kids[index - 1], kid);
      from = kid ? kid.end : from;
    }
    return gaps;
  }

  private static lineBreakIn(gap: string): number {
    const lineFeed = gap.indexOf('\n');
    return lineFeed > 0 && gap[lineFeed - 1] === '\r' ? lineFeed - 1 : lineFeed;
  }

  private record(gap: string, previous: XElement | undefined, following: XElement | undefined): void {
    const lineBreak = ChildGaps.lineBreakIn(gap);
    if (lineBreak >= 0) {
      this.inline = false;
    }
    const before = lineBreak >= 0 ? gap.slice(0, lineBreak) : '';
    const after = lineBreak >= 0 ? gap.slice(lineBreak) : gap;
    if (previous) {
      this.trail.set(previous, before);
    } else {
      this.head = before;
    }
    if (following) {
      this.lead.set(following, after);
    } else {
      this.closing = after;
    }
  }
}
