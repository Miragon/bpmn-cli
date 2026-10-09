/**
 * Text-preserving output: a change rewrites only the elements it changed.
 *
 * bpmn-moddle serialises a whole model in its own style: namespace
 * declarations and vendor attributes in its order, entities instead of CDATA,
 * no comments, two-space indentation. Written as is, every edit would rewrite
 * large parts of a file that was saved by another tool (or by hand), and a
 * host that stores BPMN in git or syncs one text region (design-iq) would see
 * churn far away from the edit.
 *
 * preserveText compares three texts:
 *
 *  - `original`: the file as read;
 *  - `baseline`: bpmn-moddle's serialisation of the model as read;
 *  - `next`: bpmn-moddle's serialisation of the model after the change.
 *
 * `baseline` and `next` are written in the same style, so an element whose
 * text is identical in both is unchanged by the edit, whatever bpmn-moddle
 * normalised; its text is copied from `original` (attribute order, quoting,
 * entities, CDATA, comments, whitespace and indentation inside it included).
 * The elements of the three texts are paired top-down: by `id` among siblings,
 * the others by name and position (between baseline and next also by equal
 * text). A changed element keeps its start tag from `original` when its
 * attributes did not change, otherwise the original attribute order with the
 * changed values, new attributes after the attribute bpmn-moddle writes them
 * after; its children follow bpmn-moddle's order, each with the whitespace and
 * comments written before it, and new children get the file's indentation
 * (unit, line break and `/>` style detected from the original). A text-only
 * element whose content changed keeps a CDATA section when the original used
 * one. The prolog (XML declaration, comments before the root) and everything
 * after the root element are kept.
 *
 * Comments next to an element the change removed (or inside it) are dropped;
 * the result counts them (`droppedComments`) so the caller can say so.
 *
 * Safety: the result must read back, with bpmn-moddle, as exactly the model
 * `next` describes (parsed and serialised again, it must equal `next`) and be
 * well-formed for the reader in xmltext.ts. If not, or if anything is
 * ambiguous or unsupported (a DOCTYPE, differing root elements), the result
 * is `next` itself (`mode: 'plain'` with a reason).
 */
import { createModdle } from './model.js';
import { attrKey, decodeXml, elementChildren, hasCharacterData, idOf, readXmlText, type XDocument, type XElement } from './xmltext.js';

export interface PreservedText {
  xml: string;
  /**
   * `unchanged`: the change left the model as read, `xml` is the original
   * text; `preserved`: unchanged parts were copied from the original;
   * `plain`: bpmn-moddle's serialisation (see `reason`).
   */
  mode: 'unchanged' | 'preserved' | 'plain';
  /** comments of the original text that the result no longer has */
  droppedComments: number;
  /** why the plain serialisation was written */
  reason?: string;
}

/** Comments in a text, without parsing it (for a text the reader cannot read). */
function roughCommentCount(text: string): number {
  return text.split('<!--').length - 1;
}

/** The plain serialisation `next` as the result, counting the comments of `original` it drops. */
export function plainText(original: string, next: string, reason: string): PreservedText {
  return { xml: next, mode: 'plain', droppedComments: roughCommentCount(original), reason };
}

/** See the module header. */
export async function preserveText(original: string, baseline: string, next: string): Promise<PreservedText> {
  if (next === baseline) return { xml: original, mode: 'unchanged', droppedComments: 0 };
  let docs: [XDocument, XDocument, XDocument];
  try {
    docs = [readXmlText(original), readXmlText(baseline), readXmlText(next)];
  } catch (err) {
    return plainText(original, next, firstLine(err));
  }
  // the original order of children first; bpmn-moddle's order when that does not read back as the same model
  let reason = '';
  for (const keepOrder of [true, false]) {
    let xml: string;
    let kept: number;
    try {
      xml = new Writer(...docs, keepOrder).write();
      kept = readXmlText(xml).comments;
    } catch (err) {
      reason = firstLine(err);
      continue;
    }
    if (xml === original) return { xml, mode: 'unchanged', droppedComments: 0 };
    if (await readsAs(xml, next)) return { xml, mode: 'preserved', droppedComments: Math.max(0, docs[0].comments - kept) };
    reason = 'the preserved text does not read back as the changed model';
  }
  return plainText(original, next, reason);
}

function firstLine(err: unknown): string {
  return String((err as Error)?.message ?? err).split('\n')[0]!;
}

/** Whether bpmn-moddle reads `xml` as the model `next` was serialised from. */
async function readsAs(xml: string, next: string): Promise<boolean> {
  const write = async (text: string): Promise<string | undefined> => {
    try {
      const moddle = createModdle();
      const { rootElement } = await moddle.fromXML(text);
      return (await moddle.toXML(rootElement, { format: true })).xml;
    } catch {
      return undefined;
    }
  };
  const written = await write(xml);
  if (written === undefined) return false;
  // `next` is normally a fixed point of read + write; compare with its own round trip when it is not
  return written === next || written === (await write(next));
}

/* ------------------------------------------------------------------ */
/* pairing elements                                                     */
/* ------------------------------------------------------------------ */

const rawOf = (doc: XDocument, el: XElement): string => doc.text.slice(el.start, el.end);

/** A start tag without its closing `>` / `/>` and the whitespace before it. */
const core = (doc: XDocument, el: XElement): string => doc.text.slice(el.start, el.attrs.length ? el.attrs[el.attrs.length - 1]!.end : el.start + 1 + el.name.length);

/** Children with an id that no sibling shares, by id. */
function uniqueIds(els: XElement[]): Map<string, XElement> {
  const seen = new Map<string, XElement | null>();
  for (const el of els) {
    const id = idOf(el);
    if (id === undefined) continue;
    seen.set(id, seen.has(id) ? null : el);
  }
  const out = new Map<string, XElement>();
  for (const [id, el] of seen) if (el) out.set(id, el);
  return out;
}

/** Pairs of equal texts in order (longest common subsequence), then the rest in order. */
function sequencePairs(xs: XElement[], ys: XElement[], a: XDocument, b: XDocument): Array<[XElement, XElement]> {
  const m = xs.length;
  const k = ys.length;
  const used = { x: new Set<number>(), y: new Set<number>() };
  const pairs: Array<[XElement, XElement]> = [];
  if (m * k <= 250_000) {
    const tx = xs.map((x) => rawOf(a, x));
    const ty = ys.map((y) => rawOf(b, y));
    const w = k + 1;
    const dp = new Uint32Array((m + 1) * w);
    for (let i = m - 1; i >= 0; i--) {
      for (let j = k - 1; j >= 0; j--) {
        dp[i * w + j] = tx[i] === ty[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
      }
    }
    for (let i = 0, j = 0; i < m && j < k; ) {
      if (tx[i] === ty[j]) {
        pairs.push([xs[i]!, ys[j]!]);
        used.x.add(i);
        used.y.add(j);
        i++;
        j++;
      } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
      else j++;
    }
  }
  const restX = xs.filter((_, i) => !used.x.has(i));
  const restY = ys.filter((_, j) => !used.y.has(j));
  for (let i = 0; i < Math.min(restX.length, restY.length); i++) pairs.push([restX[i]!, restY[i]!]);
  return pairs;
}

/**
 * Pairs the element children of `x` (in `a`) with those of `y` (in `b`):
 * by unique id (also across a change of the element name: a retype), the
 * children without one by name, in order (with `byText`: equal texts first).
 */
function pairChildren(a: XDocument, b: XDocument, x: XElement, y: XElement, byText: boolean): Array<[XElement, XElement]> {
  const xs = elementChildren(x);
  const ys = elementChildren(y);
  if (!xs.length || !ys.length) return [];
  const xIds = uniqueIds(xs);
  const yIds = uniqueIds(ys);
  const pairs: Array<[XElement, XElement]> = [];
  const keyed = (el: XElement, ids: Map<string, XElement>): boolean => {
    const id = idOf(el);
    return id !== undefined && ids.get(id) === el;
  };
  for (const c of xs) {
    if (!keyed(c, xIds)) continue;
    const d = yIds.get(idOf(c)!);
    if (d) pairs.push([c, d]);
  }
  const groups = new Map<string, { xs: XElement[]; ys: XElement[] }>();
  const group = (el: XElement): { xs: XElement[]; ys: XElement[] } => {
    const key = `${el.uri} ${el.local}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { xs: [], ys: [] }));
    return g;
  };
  for (const c of xs) if (!keyed(c, xIds) && idOf(c) === undefined) group(c).xs.push(c);
  for (const d of ys) if (!keyed(d, yIds) && idOf(d) === undefined) group(d).ys.push(d);
  for (const g of groups.values()) {
    if (!g.xs.length || !g.ys.length) continue;
    if (byText) pairs.push(...sequencePairs(g.xs, g.ys, a, b));
    else for (let i = 0; i < Math.min(g.xs.length, g.ys.length); i++) pairs.push([g.xs[i]!, g.ys[i]!]);
  }
  return pairs;
}

/** Element of `a` -> its counterpart in `b`, from the roots down (empty when the roots differ). */
function align(a: XDocument, b: XDocument, byText: boolean): Map<XElement, XElement> {
  const map = new Map<XElement, XElement>();
  if (a.root.uri !== b.root.uri || a.root.local !== b.root.local) return map;
  const stack: Array<[XElement, XElement]> = [[a.root, b.root]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    map.set(x, y);
    stack.push(...pairChildren(a, b, x, y, byText));
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* style of the original                                                */
/* ------------------------------------------------------------------ */

/** The indentation of the line an element starts on, or undefined when something else precedes it on that line. */
function indentOf(text: string, at: number): string | undefined {
  let k = at - 1;
  while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k--;
  if (k >= 0 && text[k] !== '\n') return undefined;
  return text.slice(k + 1, at);
}

/** The most frequent indentation step between an element and its first child. */
function indentUnit(doc: XDocument): string {
  const counts = new Map<string, number>();
  const visit = (el: XElement): void => {
    const kids = elementChildren(el);
    const own = indentOf(doc.text, el.start);
    const first = kids[0] ? indentOf(doc.text, kids[0].start) : undefined;
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

/* ------------------------------------------------------------------ */
/* writing                                                              */
/* ------------------------------------------------------------------ */

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

/** Splits the text between the children of an element at the first line break of each gap. */
function gapsOf(doc: XDocument, el: XElement, kids: XElement[]): Gaps {
  const text = doc.text;
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

class Writer {
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
    this.toOriginal = align(baseline, original, false);
    this.toBase = align(next, baseline, true);
    const text = original.text;
    this.nl = text.includes('\r\n') ? '\r\n' : '\n';
    this.unit = indentUnit(original);
    const spaced = (text.match(/\s\/>/g) ?? []).length;
    const tight = (text.match(/[^\s]\/>/g) ?? []).length;
    this.selfClose = tight > spaced ? '/>' : ' />';
  }

  write(): string {
    const { original, next } = this;
    const base = this.toBase.get(next.root);
    if (!base || !this.toOriginal.has(base)) throw new Error('the root elements differ');
    const text = original.text;
    return text.slice(0, original.root.start) + this.element(next.root, indentOf(text, original.root.start) ?? '') + text.slice(original.root.end);
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
    const gaps = gapsOf(original, o, oKids);
    const lined = oKids.map((k) => indentOf(original.text, k.start)).find((x) => x !== undefined);
    const childIndent = lined ?? indent + this.unit;
    let out = this.startTag(o, n0, n, name, false) + gaps.head;
    for (const c of this.childOrder(o, n0, nKids)) {
      const c0 = this.toBase.get(c);
      const oc = c0 && this.toOriginal.get(c0);
      if (oc && oc.parent === o && gaps.lead.has(oc)) {
        out += gaps.lead.get(oc)! + this.element(c, indentOf(original.text, oc.start) ?? childIndent) + (gaps.trail.get(oc) ?? '');
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
    if (n.selfClosing) return core(next, n) + this.selfClose;
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
    if (name === o.name && n.name === n0.name && core(next, n).slice(n.name.length + 1) === core(baseline, n0).slice(n0.name.length + 1)) {
      body = core(original, o);
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
}
