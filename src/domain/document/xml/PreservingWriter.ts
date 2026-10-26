import { ElementAligner } from './ElementAligner.js';
import { attrKey, decodeXml, elementChildren, hasCharacterData, rawOf, type XDocument, type XElement } from '../utils/text-reader.js';

interface Gaps {
  /** text after the start tag up to the first line break: belongs to the parent */
  head: string;
  /** per child: the text before it from the line break on, and after it up to the next one */
  lead: Map<XElement, string>;
  trail: Map<XElement, string>;
  /** text before the end tag from the last line break on */
  closing: string;
  inline: boolean;
}

/** Writes `next` with the unchanged parts and the style of `original`. */
export class PreservingWriter {
  private readonly toBase: Map<XElement, XElement>;
  private readonly toOriginal: Map<XElement, XElement>;
  private readonly nl: string;
  private readonly unit: string;
  private readonly selfClose: string;

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
  }

  write(): string {
    const { original, next } = this;
    const base = this.toBase.get(next.root);
    if (!base || !this.toOriginal.has(base)) throw new Error('the root elements differ');
    const text = original.text;
    return text.slice(0, original.root.start) + this.element(next.root, this.indentOf(original.root.start) ?? '') + text.slice(original.root.end);
  }

  private element(nextEl: XElement, indent: string): string {
    const n0 = this.toBase.get(nextEl);
    const origEl = n0 && this.toOriginal.get(n0);
    if (!n0 || !origEl) return this.fresh(nextEl, indent);
    const { original, baseline, next } = this;
    if (rawOf(next, nextEl) === rawOf(baseline, n0)) return rawOf(original, origEl);
    const name = origEl.name === nextEl.name ? origEl.name : nextEl.name;
    const close = !origEl.selfClosing && name === origEl.name ? original.text.slice(origEl.closeStart, origEl.end) : `</${name}>`;
    const nKids = elementChildren(nextEl);
    const oKids = elementChildren(origEl);
    const nData = hasCharacterData(next, nextEl);
    const oData = hasCharacterData(original, origEl);
    if (nData || oData) {
      // mixed content is not merged: bpmn-moddle's text of the element
      if (nKids.length || oKids.length) return rawOf(next, nextEl);
      const content = next.text.slice(nextEl.tagEnd, nextEl.closeStart);
      if (!content) return this.startTag(origEl, n0, nextEl, name, true);
      return this.startTag(origEl, n0, nextEl, name, false) + this.restyle(origEl, content) + close;
    }
    if (!nKids.length) {
      if (oKids.length || origEl.selfClosing) return this.startTag(origEl, n0, nextEl, name, true);
      return this.startTag(origEl, n0, nextEl, name, false) + original.text.slice(origEl.tagEnd, origEl.closeStart) + close;
    }
    const gaps = this.gapsOf(origEl, oKids);
    const lined = oKids.map((kid) => this.indentOf(kid.start)).find((kidIndent) => kidIndent !== undefined);
    const childIndent = lined ?? indent + this.unit;
    let out = this.startTag(origEl, n0, nextEl, name, false) + gaps.head;
    for (const child of this.childOrder(origEl, n0, nKids)) {
      const c0 = this.toBase.get(child);
      const oc = c0 && this.toOriginal.get(c0);
      if (oc && oc.parent === origEl && gaps.lead.has(oc)) {
        out += gaps.lead.get(oc)! + this.element(child, this.indentOf(oc.start) ?? childIndent) + (gaps.trail.get(oc) ?? '');
      } else {
        out += (gaps.inline ? '' : this.nl + childIndent) + this.fresh(child, childIndent);
      }
    }
    out += oKids.length ? gaps.closing : this.nl + indent;
    return out + close;
  }

  /**
   * bpmn-moddle groups children by property, a file may not: with `keepOrder` and no reorder
   * the original order stays, each new child after the one it follows in bpmn-moddle's order.
   */
  private childOrder(origEl: XElement, n0: XElement, kids: XElement[]): XElement[] {
    if (!this.keepOrder) return kids;
    const basePos = new Map(elementChildren(n0).map((child, index) => [child, index]));
    const origPos = new Map(elementChildren(origEl).map((child, index) => [child, index]));
    const kept: Array<{ kid: XElement; at: number }> = [];
    let last = -1;
    for (const kid of kids) {
      const c0 = this.toBase.get(kid);
      const oc = c0 && this.toOriginal.get(c0);
      const basePosition = c0 && basePos.get(c0);
      const at = oc && origPos.get(oc);
      if (basePosition === undefined || at === undefined) continue;
      if (basePosition < last) return kids;
      last = basePosition;
      kept.push({ kid, at });
    }
    if (kept.every((entry, index) => index === 0 || kept[index - 1]!.at < entry.at)) return kids;
    const keptSet = new Set(kept.map((entry) => entry.kid));
    const following = new Map<XElement | undefined, XElement[]>();
    let anchor: XElement | undefined;
    for (const kid of kids) {
      if (keptSet.has(kid)) anchor = kid;
      else following.set(anchor, [...(following.get(anchor) ?? []), kid]);
    }
    const out = [...(following.get(undefined) ?? [])];
    for (const entry of [...kept].sort((first, second) => first.at - second.at)) out.push(entry.kid, ...(following.get(entry.kid) ?? []));
    return out;
  }

  /** Without a counterpart in the original: bpmn-moddle's text, indented like the file. */
  private fresh(nextEl: XElement, indent: string): string {
    const { next } = this;
    const kids = elementChildren(nextEl);
    if (nextEl.selfClosing) return this.core(next, nextEl) + this.selfClose;
    if (!kids.length || hasCharacterData(next, nextEl)) return rawOf(next, nextEl);
    let out = next.text.slice(nextEl.start, nextEl.tagEnd);
    for (const child of kids) out += this.nl + indent + this.unit + this.fresh(child, indent + this.unit);
    return out + this.nl + indent + next.text.slice(nextEl.closeStart, nextEl.end);
  }

  /** A CDATA section stays one. */
  private restyle(origEl: XElement, content: string): string {
    const only = origEl.children.length === 1 ? origEl.children[0]! : undefined;
    if (only?.kind !== 'cdata' || content.includes('<![CDATA[')) return content;
    const text = decodeXml(content);
    return text.includes(']]>') ? content : `<![CDATA[${text}]]>`;
  }

  /**
   * The original start tag when the attributes did not change, else the original attribute
   * order with the new values, new attributes after the one they follow in `next`.
   */
  private startTag(origEl: XElement, n0: XElement, nextEl: XElement, name: string, selfClosing: boolean): string {
    const { original, baseline, next } = this;
    const raw = (doc: XDocument, span: { start: number; end: number }): string => doc.text.slice(span.start, span.end);
    let body: string;
    if (name === origEl.name && nextEl.name === n0.name && this.core(next, nextEl).slice(nextEl.name.length + 1) === this.core(baseline, n0).slice(n0.name.length + 1)) {
      body = this.core(original, origEl);
    } else {
      const before = new Map(n0.attrs.map((attr) => [attrKey(n0, attr), raw(baseline, attr)]));
      const after = nextEl.attrs.map((attr) => ({ key: attrKey(nextEl, attr), text: raw(next, attr) }));
      const afterByKey = new Map(after.map((entry) => [entry.key, entry.text]));
      const attrs: Array<{ key: string; ws: string; text: string }> = [];
      for (const attr of origEl.attrs) {
        const key = attrKey(origEl, attr);
        const now = afterByKey.get(key);
        if (now !== undefined) attrs.push({ key, ws: attr.ws, text: before.get(key) === now ? raw(original, attr) : now });
        else if (!before.has(key) || key.startsWith('xmlns')) attrs.push({ key, ws: attr.ws, text: raw(original, attr) });
      }
      const broken = origEl.attrs.map((attr) => attr.ws).filter((ws) => ws.includes('\n'));
      const ws = broken.length ? broken[broken.length - 1]! : ' ';
      after.forEach((entry, index) => {
        if (attrs.some((written) => written.key === entry.key)) return;
        let at = 0;
        for (let earlierIndex = index - 1; earlierIndex >= 0; earlierIndex--) {
          const found = attrs.findIndex((written) => written.key === after[earlierIndex]!.key);
          if (found >= 0) {
            at = found + 1;
            break;
          }
        }
        attrs.splice(at, 0, { key: entry.key, ws, text: entry.text });
      });
      body = `<${name}${attrs.map((written) => written.ws + written.text).join('')}`;
    }
    const multiline = origEl.tail.includes('\n');
    if (selfClosing) return body + (origEl.selfClosing || multiline ? `${origEl.tail}/>` : this.selfClose);
    return body + (!origEl.selfClosing || multiline ? origEl.tail : '') + '>';
  }

  private indentOf(at: number): string | undefined {
    const text = this.original.text;
    let cursor = at - 1;
    while (cursor >= 0 && (text[cursor] === ' ' || text[cursor] === '\t')) cursor--;
    if (cursor >= 0 && text[cursor] !== '\n') return undefined;
    return text.slice(cursor + 1, at);
  }

  /** The most frequent indentation step between an element and its first child. */
  private indentUnit(): string {
    const doc = this.original;
    const counts = new Map<string, number>();
    const visit = (el: XElement): void => {
      const kids = elementChildren(el);
      const own = this.indentOf(el.start);
      const first = kids[0] ? this.indentOf(kids[0].start) : undefined;
      if (own !== undefined && first !== undefined && first.length > own.length && first.startsWith(own)) {
        const step = first.slice(own.length);
        counts.set(step, (counts.get(step) ?? 0) + 1);
      }
      for (const kid of kids) visit(kid);
    };
    visit(doc.root);
    let best = '  ';
    let bestCount = 0;
    for (const [step, count] of counts) if (count > bestCount) [best, bestCount] = [step, count];
    return best;
  }

  private gapsOf(el: XElement, kids: XElement[]): Gaps {
    const text = this.original.text;
    const lead = new Map<XElement, string>();
    const trail = new Map<XElement, string>();
    let head = '';
    let closing = '';
    let inline = kids.length > 0;
    let from = el.tagEnd;
    for (let index = 0; index <= kids.length; index++) {
      const to = index < kids.length ? kids[index]!.start : el.closeStart;
      const gap = text.slice(from, to);
      const lf = gap.indexOf('\n');
      // the line break starts at its \r (CRLF files)
      const br = lf > 0 && gap[lf - 1] === '\r' ? lf - 1 : lf;
      if (br >= 0) inline = false;
      const before = br >= 0 ? gap.slice(0, br) : '';
      const after = br >= 0 ? gap.slice(br) : gap;
      if (index === 0) head = before;
      else trail.set(kids[index - 1]!, before);
      if (index < kids.length) {
        lead.set(kids[index]!, after);
        from = kids[index]!.end;
      } else closing = after;
    }
    return { head, lead, trail, closing, inline };
  }

  private core(doc: XDocument, el: XElement): string {
    return doc.text.slice(el.start, el.attrs.length ? el.attrs[el.attrs.length - 1]!.end : el.start + 1 + el.name.length);
  }
}
