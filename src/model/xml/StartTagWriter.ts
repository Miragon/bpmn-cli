import { XmlTextReader, type XDocument, type XElement } from './XmlTextReader.js';

export interface Twin {
  origEl: XElement;
  n0: XElement;
  nextEl: XElement;
  name: string;
}

interface WrittenAttr {
  key: string;
  ws: string;
  text: string;
}

interface Spelled {
  key: string;
  text: string;
}

export class StartTagWriter {
  constructor(
    private readonly original: XDocument,
    private readonly baseline: XDocument,
    private readonly next: XDocument,
    private readonly selfClose: string,
  ) {}

  static core(document: XDocument, element: XElement): string {
    return document.text.slice(element.start, element.attrs.length ? element.attrs[element.attrs.length - 1]!.end : element.start + 1 + element.name.length);
  }

  private static spelled(document: XDocument, span: { start: number; end: number }): string {
    return document.text.slice(span.start, span.end);
  }

  private static insertAfterEarlier(written: WrittenAttr[], after: readonly Spelled[], index: number, ws: string): void {
    const entry = after[index]!;
    if (written.some(({ key }) => key === entry.key)) {
      return;
    }
    let at = 0;
    for (let earlier = index - 1; earlier >= 0 && at === 0; earlier--) {
      at = written.findIndex(({ key }) => key === after[earlier]!.key) + 1;
    }
    written.splice(at, 0, { key: entry.key, ws, text: entry.text });
  }

  write(twin: Twin, selfClosing: boolean): string {
    const { origEl } = twin;
    const body = this.keepsAttributes(twin) ? StartTagWriter.core(this.original, origEl) : this.rewritten(twin);
    const multiline = origEl.tail.includes('\n');
    if (selfClosing) {
      return body + (origEl.selfClosing || multiline ? `${origEl.tail}/>` : this.selfClose);
    }
    return `${body + (!origEl.selfClosing || multiline ? origEl.tail : '')}>`;
  }

  private keepsAttributes({ origEl, n0, nextEl, name }: Twin): boolean {
    const nextAttributes = StartTagWriter.core(this.next, nextEl).slice(nextEl.name.length + 1);
    const baseAttributes = StartTagWriter.core(this.baseline, n0).slice(n0.name.length + 1);
    return name === origEl.name && nextEl.name === n0.name && nextAttributes === baseAttributes;
  }

  private rewritten({ origEl, n0, nextEl, name }: Twin): string {
    const before = new Map(n0.attrs.map((attr) => [XmlTextReader.attrKey(n0, attr), StartTagWriter.spelled(this.baseline, attr)]));
    const after = nextEl.attrs.map((attr) => ({ key: XmlTextReader.attrKey(nextEl, attr), text: StartTagWriter.spelled(this.next, attr) }));
    const written = this.keptAttributes(origEl, before, new Map(after.map(({ key, text }) => [key, text])));
    const broken = origEl.attrs.map((attr) => attr.ws).filter((ws) => ws.includes('\n'));
    const ws = broken.at(-1) ?? ' ';
    after.forEach((_entry, index) => {
      StartTagWriter.insertAfterEarlier(written, after, index, ws);
    });
    return `<${name}${written.map((attr) => attr.ws + attr.text).join('')}`;
  }

  private keptAttributes(origEl: XElement, before: Map<string, string>, after: Map<string, string>): WrittenAttr[] {
    const written: WrittenAttr[] = [];
    for (const attr of origEl.attrs) {
      const key = XmlTextReader.attrKey(origEl, attr);
      const now = after.get(key);
      const asWritten = StartTagWriter.spelled(this.original, attr);
      if (now !== undefined) {
        written.push({ key, ws: attr.ws, text: before.get(key) === now ? asWritten : now });
      } else if (!before.has(key) || key.startsWith('xmlns')) {
        written.push({ key, ws: attr.ws, text: asWritten });
      }
    }
    return written;
  }
}
