import { ElementAligner } from './ElementAligner.js';
import { attrKey, decodeXml, elementChildren, hasCharacterData, rawOf, type XDocument, type XElement } from './utils/text-reader.js';

interface Gaps {
  /** text after the start tag up to the first line break: belongs to the parent */
  head: string;
  /** per child: what precedes it from the line break on, and what follows it up to the next line break */
  lead: Map<XElement, string>;
  trail: Map<XElement, string>;
  /** text before the end tag from the last line break on */
  closing: string;
  /** whether the children are written on one line */
  inline: boolean;
}

/** Writes `next` with the unchanged parts and the style of `original` (see TextPreservation). */
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
    /** keep the original order of children where the change did not reorder them (see childOrder) */
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

  /** The text of an element of `next`; `indent` is the indentation of its line. */
  private element(n: XElement, indent: string): string {
    const n0 = this.toBase.get(n);
    const o = n0 && this.toOriginal.get(n0);
    if (!n0 || !o) return this.fresh(n, indent);
    const { original, baseline, next } = this;
    if (rawOf(next, n) === rawOf(baseline, n0)) return rawOf(original, o);
    const name = o.name === n.name ? o.name : n.name;
    const close = !o.selfClosing && name === o.name ? original.text.slice(o.closeStart, o.end) : `</${name}>`;
    const nKids = elementChildren(n);
    const oKids = elementChildren(o);
    const nData = hasCharacterData(next, n);
    const oData = hasCharacterData(original, o);
    if (nData || oData) {
      // mixed content is not merged: bpmn-moddle's text of the element
      if (nKids.length || oKids.length) return rawOf(next, n);
      const content = next.text.slice(n.tagEnd, n.closeStart);
      if (!content) return this.startTag(o, n0, n, name, true);
      return this.startTag(o, n0, n, name, false) + this.restyle(o, content) + close;
    }
    if (!nKids.length) {
      if (oKids.length || o.selfClosing) return this.startTag(o, n0, n, name, true);
      return this.startTag(o, n0, n, name, false) + original.text.slice(o.tagEnd, o.closeStart) + close;
    }
    const gaps = this.gapsOf(o, oKids);
    const lined = oKids.map((k) => this.indentOf(k.start)).find((x) => x !== undefined);
    const childIndent = lined ?? indent + this.unit;
    let out = this.startTag(o, n0, n, name, false) + gaps.head;
    for (const c of this.childOrder(o, n0, nKids)) {
      const c0 = this.toBase.get(c);
      const oc = c0 && this.toOriginal.get(c0);
      if (oc && oc.parent === o && gaps.lead.has(oc)) {
        out += gaps.lead.get(oc)! + this.element(c, this.indentOf(oc.start) ?? childIndent) + (gaps.trail.get(oc) ?? '');
      } else {
        out += (gaps.inline ? '' : this.nl + childIndent) + this.fresh(c, childIndent);
      }
    }
    out += oKids.length ? gaps.closing : this.nl + indent;
    return out + close;
  }

  /**
   * The order the children of a changed element are written in:
   * bpmn-moddle's, unless `keepOrder` is set and the change kept the order of
   * the children that were there before (it only added or removed some);
   * then the original order (bpmn-moddle groups children by property, a file
   * may not), each new child after the child it follows in bpmn-moddle's
   * order.
   */
  private childOrder(o: XElement, n0: XElement, kids: XElement[]): XElement[] {
    if (!this.keepOrder) return kids;
    const basePos = new Map(elementChildren(n0).map((c, i) => [c, i]));
    const origPos = new Map(elementChildren(o).map((c, i) => [c, i]));
    const kept: Array<{ kid: XElement; at: number }> = [];
    let last = -1;
    for (const kid of kids) {
      const c0 = this.toBase.get(kid);
      const oc = c0 && this.toOriginal.get(c0);
      const p = c0 && basePos.get(c0);
      const at = oc && origPos.get(oc);
      if (p === undefined || at === undefined) continue;
      if (p < last) return kids;
      last = p;
      kept.push({ kid, at });
    }
    if (kept.every((k, i) => i === 0 || kept[i - 1]!.at < k.at)) return kids;
    const keptSet = new Set(kept.map((k) => k.kid));
    const following = new Map<XElement | undefined, XElement[]>();
    let anchor: XElement | undefined;
    for (const kid of kids) {
      if (keptSet.has(kid)) anchor = kid;
      else following.set(anchor, [...(following.get(anchor) ?? []), kid]);
    }
    const out = [...(following.get(undefined) ?? [])];
    for (const k of [...kept].sort((a, b) => a.at - b.at)) out.push(k.kid, ...(following.get(k.kid) ?? []));
    return out;
  }

  /** An element without a counterpart in the original: bpmn-moddle's text, indented like the file. */
  private fresh(n: XElement, indent: string): string {
    const { next } = this;
    const kids = elementChildren(n);
    if (n.selfClosing) return this.core(next, n) + this.selfClose;
    if (!kids.length || hasCharacterData(next, n)) return rawOf(next, n);
    let out = next.text.slice(n.start, n.tagEnd);
    for (const c of kids) out += this.nl + indent + this.unit + this.fresh(c, indent + this.unit);
    return out + this.nl + indent + next.text.slice(n.closeStart, n.end);
  }

  /** New text content in the original's style: a CDATA section stays one. */
  private restyle(o: XElement, content: string): string {
    const only = o.children.length === 1 ? o.children[0]! : undefined;
    if (only?.kind !== 'cdata' || content.includes('<![CDATA[')) return content;
    const text = decodeXml(content);
    return text.includes(']]>') ? content : `<![CDATA[${text}]]>`;
  }

  /**
   * The start tag of a changed element: the original one when bpmn-moddle
   * writes the same attributes before and after the change, else the
   * original attributes in their order (changed values from `next`, removed
   * ones left out, ones bpmn-moddle does not write and namespace
   * declarations kept) and the new ones after the attribute they follow in
   * `next`.
   */
  private startTag(o: XElement, n0: XElement, n: XElement, name: string, selfClosing: boolean): string {
    const { original, baseline, next } = this;
    const raw = (doc: XDocument, a: { start: number; end: number }): string => doc.text.slice(a.start, a.end);
    let body: string;
    if (name === o.name && n.name === n0.name && this.core(next, n).slice(n.name.length + 1) === this.core(baseline, n0).slice(n0.name.length + 1)) {
      body = this.core(original, o);
    } else {
      const before = new Map(n0.attrs.map((a) => [attrKey(n0, a), raw(baseline, a)]));
      const after = n.attrs.map((a) => ({ key: attrKey(n, a), text: raw(next, a) }));
      const afterByKey = new Map(after.map((a) => [a.key, a.text]));
      const attrs: Array<{ key: string; ws: string; text: string }> = [];
      for (const a of o.attrs) {
        const key = attrKey(o, a);
        const now = afterByKey.get(key);
        if (now !== undefined) attrs.push({ key, ws: a.ws, text: before.get(key) === now ? raw(original, a) : now });
        else if (!before.has(key) || key.startsWith('xmlns')) attrs.push({ key, ws: a.ws, text: raw(original, a) });
      }
      const broken = o.attrs.map((a) => a.ws).filter((ws) => ws.includes('\n'));
      const ws = broken.length ? broken[broken.length - 1]! : ' ';
      after.forEach((a, i) => {
        if (attrs.some((x) => x.key === a.key)) return;
        let at = 0;
        for (let k = i - 1; k >= 0; k--) {
          const found = attrs.findIndex((x) => x.key === after[k]!.key);
          if (found >= 0) {
            at = found + 1;
            break;
          }
        }
        attrs.splice(at, 0, { key: a.key, ws, text: a.text });
      });
      body = `<${name}${attrs.map((a) => a.ws + a.text).join('')}`;
    }
    const multiline = o.tail.includes('\n');
    if (selfClosing) return body + (o.selfClosing || multiline ? `${o.tail}/>` : this.selfClose);
    return body + (!o.selfClosing || multiline ? o.tail : '') + '>';
  }

  /** The indentation of the line an element starts on, or undefined when something else precedes it on that line. */
  private indentOf(at: number): string | undefined {
    const text = this.original.text;
    let k = at - 1;
    while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k--;
    if (k >= 0 && text[k] !== '\n') return undefined;
    return text.slice(k + 1, at);
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
      for (const k of kids) visit(k);
    };
    visit(doc.root);
    let best = '  ';
    let n = 0;
    for (const [step, c] of counts) if (c > n) [best, n] = [step, c];
    return best;
  }

  /** Splits the text between the children of an element at the first line break of each gap. */
  private gapsOf(el: XElement, kids: XElement[]): Gaps {
    const text = this.original.text;
    const lead = new Map<XElement, string>();
    const trail = new Map<XElement, string>();
    let head = '';
    let closing = '';
    let inline = kids.length > 0;
    let from = el.tagEnd;
    for (let i = 0; i <= kids.length; i++) {
      const to = i < kids.length ? kids[i]!.start : el.closeStart;
      const gap = text.slice(from, to);
      const lf = gap.indexOf('\n');
      // the line break starts at its \r (CRLF files)
      const br = lf > 0 && gap[lf - 1] === '\r' ? lf - 1 : lf;
      if (br >= 0) inline = false;
      const before = br >= 0 ? gap.slice(0, br) : '';
      const after = br >= 0 ? gap.slice(br) : gap;
      if (i === 0) head = before;
      else trail.set(kids[i - 1]!, before);
      if (i < kids.length) {
        lead.set(kids[i]!, after);
        from = kids[i]!.end;
      } else closing = after;
    }
    return { head, lead, trail, closing, inline };
  }

  /** A start tag without its closing `>` / `/>` and the whitespace before it. */
  private core(doc: XDocument, el: XElement): string {
    return doc.text.slice(el.start, el.attrs.length ? el.attrs[el.attrs.length - 1]!.end : el.start + 1 + el.name.length);
  }
}
