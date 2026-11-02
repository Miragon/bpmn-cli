import { ChildGaps } from './ChildGaps.js';
import { ElementAligner } from './ElementAligner.js';
import { StartTagWriter, type Twin } from './StartTagWriter.js';
import { XmlTextReader, type XDocument, type XElement } from './XmlTextReader.js';

interface KeptChild {
  kid: XElement;
  at: number;
}

export class PreservingWriter {
  private readonly toBase: Map<XElement, XElement>;
  private readonly toOriginal: Map<XElement, XElement>;
  private readonly nl: string;
  private readonly unit: string;
  private readonly selfClose: string;
  private readonly tags: StartTagWriter;

  constructor(
    private readonly original: XDocument,
    private readonly baseline: XDocument,
    private readonly next: XDocument,
    private readonly keepOrder: boolean,
  ) {
    this.toOriginal = new ElementAligner(baseline, original, false).counterparts();
    this.toBase = new ElementAligner(next, baseline, true).counterparts();
    const text = original.text;
    this.nl = text.includes('\r\n') ? '\r\n' : '\n';
    this.unit = this.indentUnit();
    const spaced = (text.match(/\s\/>/g) ?? []).length;
    const tight = (text.match(/[^\s]\/>/g) ?? []).length;
    this.selfClose = tight > spaced ? '/>' : ' />';
    this.tags = new StartTagWriter(original, baseline, next, this.selfClose);
  }

  write(): string {
    const { original, next } = this;
    const base = this.toBase.get(next.root);
    if (!base || !this.toOriginal.has(base)) {
      throw new Error('the root elements differ');
    }
    const text = original.text;
    return text.slice(0, original.root.start) + this.element(next.root, this.indentOf(original.root.start) ?? '') + text.slice(original.root.end);
  }

  private element(nextEl: XElement, indent: string): string {
    const n0 = this.toBase.get(nextEl);
    const origEl = n0 && this.toOriginal.get(n0);
    if (!n0 || !origEl) {
      return this.fresh(nextEl, indent);
    }
    const { original, baseline, next } = this;
    if (XmlTextReader.rawOf(next, nextEl) === XmlTextReader.rawOf(baseline, n0)) {
      return XmlTextReader.rawOf(original, origEl);
    }
    const twin: Twin = { origEl, n0, nextEl, name: nextEl.name };
    if (XmlTextReader.hasCharacterData(next, nextEl) || XmlTextReader.hasCharacterData(original, origEl)) {
      return this.withCharacterData(twin);
    }
    return XmlTextReader.elementChildren(nextEl).length ? this.withChildren(twin, indent) : this.withoutChildren(twin);
  }

  private closeTag({ origEl, name }: Twin): string {
    return !origEl.selfClosing && name === origEl.name ? this.original.text.slice(origEl.closeStart, origEl.end) : `</${name}>`;
  }

  private withCharacterData(twin: Twin): string {
    const { origEl, nextEl } = twin;
    if (XmlTextReader.elementChildren(nextEl).length || XmlTextReader.elementChildren(origEl).length) {
      return XmlTextReader.rawOf(this.next, nextEl);
    }
    const content = this.next.text.slice(nextEl.tagEnd, nextEl.closeStart);
    if (!content) {
      return this.tags.write(twin, true);
    }
    return this.tags.write(twin, false) + this.restyle(origEl, content) + this.closeTag(twin);
  }

  private withoutChildren(twin: Twin): string {
    const { origEl } = twin;
    if (XmlTextReader.elementChildren(origEl).length || origEl.selfClosing) {
      return this.tags.write(twin, true);
    }
    return this.tags.write(twin, false) + this.original.text.slice(origEl.tagEnd, origEl.closeStart) + this.closeTag(twin);
  }

  private withChildren(twin: Twin, indent: string): string {
    const { origEl, n0, nextEl } = twin;
    const originalKids = XmlTextReader.elementChildren(origEl);
    const gaps = ChildGaps.of(this.original.text, origEl, originalKids);
    const lined = originalKids.map((kid) => this.indentOf(kid.start)).find((kidIndent) => kidIndent !== undefined);
    const childIndent = lined ?? indent + this.unit;
    let out = this.tags.write(twin, false) + gaps.head;
    for (const child of this.childOrder(origEl, n0, XmlTextReader.elementChildren(nextEl))) {
      const original = this.originalOf(child);
      if (original && original.parent === origEl && gaps.lead.has(original)) {
        out += gaps.lead.get(original)! + this.element(child, this.indentOf(original.start) ?? childIndent) + (gaps.trail.get(original) ?? '');
      } else {
        out += (gaps.inline ? '' : this.nl + childIndent) + this.fresh(child, childIndent);
      }
    }
    out += originalKids.length ? gaps.closing : this.nl + indent;
    return out + this.closeTag(twin);
  }

  private originalOf(nextEl: XElement): XElement | undefined {
    const base = this.toBase.get(nextEl);
    return base && this.toOriginal.get(base);
  }

  private childOrder(origEl: XElement, n0: XElement, kids: XElement[]): XElement[] {
    if (!this.keepOrder) {
      return kids;
    }
    const kept = this.keptPositions(origEl, n0, kids);
    if (!kept || kept.every((entry, index) => index === 0 || kept[index - 1]!.at < entry.at)) {
      return kids;
    }
    return PreservingWriter.withFollowers(kids, kept);
  }

  private keptPositions(origEl: XElement, n0: XElement, kids: XElement[]): KeptChild[] | undefined {
    const basePositions = new Map(XmlTextReader.elementChildren(n0).map((child, index) => [child, index]));
    const originalPositions = new Map(XmlTextReader.elementChildren(origEl).map((child, index) => [child, index]));
    const kept: KeptChild[] = [];
    let last = -1;
    for (const kid of kids) {
      const base = this.toBase.get(kid);
      const original = this.originalOf(kid);
      const basePosition = base && basePositions.get(base);
      const at = original && originalPositions.get(original);
      if (basePosition !== undefined && at !== undefined) {
        if (basePosition < last) {
          return undefined;
        }
        last = basePosition;
        kept.push({ kid, at });
      }
    }
    return kept;
  }

  private static withFollowers(kids: XElement[], kept: KeptChild[]): XElement[] {
    const keptKids = new Set(kept.map((entry) => entry.kid));
    const following = new Map<XElement | undefined, XElement[]>();
    let anchor: XElement | undefined;
    for (const kid of kids) {
      if (keptKids.has(kid)) {
        anchor = kid;
      } else {
        following.set(anchor, [...(following.get(anchor) ?? []), kid]);
      }
    }
    const ordered = [...(following.get(undefined) ?? [])];
    for (const entry of [...kept].sort((first, second) => first.at - second.at)) {
      ordered.push(entry.kid, ...(following.get(entry.kid) ?? []));
    }
    return ordered;
  }

  private fresh(nextEl: XElement, indent: string): string {
    const { next } = this;
    const kids = XmlTextReader.elementChildren(nextEl);
    if (nextEl.selfClosing) {
      return StartTagWriter.core(next, nextEl) + this.selfClose;
    }
    if (!kids.length || XmlTextReader.hasCharacterData(next, nextEl)) {
      return XmlTextReader.rawOf(next, nextEl);
    }
    let out = next.text.slice(nextEl.start, nextEl.tagEnd);
    for (const child of kids) {
      out += this.nl + indent + this.unit + this.fresh(child, indent + this.unit);
    }
    return out + this.nl + indent + next.text.slice(nextEl.closeStart, nextEl.end);
  }

  private restyle(origEl: XElement, content: string): string {
    const only = origEl.children.length === 1 ? origEl.children[0]! : undefined;
    if (only?.kind !== 'cdata' || content.includes('<![CDATA[')) {
      return content;
    }
    const text = XmlTextReader.decode(content);
    return text.includes(']]>') ? content : `<![CDATA[${text}]]>`;
  }

  private indentOf(at: number): string | undefined {
    const text = this.original.text;
    let cursor = at - 1;
    while (cursor >= 0 && (text[cursor] === ' ' || text[cursor] === '\t')) {
      cursor--;
    }
    if (cursor >= 0 && text[cursor] !== '\n') {
      return undefined;
    }
    return text.slice(cursor + 1, at);
  }

  private indentUnit(): string {
    const doc = this.original;
    const counts = new Map<string, number>();
    const visit = (el: XElement): void => {
      const kids = XmlTextReader.elementChildren(el);
      const own = this.indentOf(el.start);
      const first = kids[0] ? this.indentOf(kids[0].start) : undefined;
      if (own !== undefined && first !== undefined && first.length > own.length && first.startsWith(own)) {
        const step = first.slice(own.length);
        counts.set(step, (counts.get(step) ?? 0) + 1);
      }
      for (const kid of kids) {
        visit(kid);
      }
    };
    visit(doc.root);
    let best = '  ';
    let bestCount = 0;
    for (const [step, count] of counts) {
      if (count > bestCount) {
        [best, bestCount] = [step, count];
      }
    }
    return best;
  }
}
