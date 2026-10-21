/**
 * A small XML reader that keeps positions: every element knows where its
 * start tag, its content and its end tag are in the text, every attribute
 * where it is written and which whitespace precedes it. The text-preserving
 * writer (preserve.ts) uses it to copy unchanged parts of a file verbatim.
 *
 * It reads well-formed XML as BPMN files use it: an optional prolog (XML
 * declaration, comments, processing instructions), one root element, text,
 * CDATA sections, comments and processing instructions inside it. Anything
 * else (a DOCTYPE, an unbound prefix, mismatched tags, a duplicate
 * attribute) throws XmlTextError; the caller then falls back to the plain
 * serialisation. Entities are not expanded: values are compared as written.
 */

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export interface XAttr {
  /** the qualified name as written */
  name: string;
  /** whitespace written before the attribute */
  ws: string;
  /** offsets of `name="value"` in the text */
  start: number;
  end: number;
  /** the value between the quotes, as written (entities not expanded) */
  raw: string;
}

export interface XElement {
  kind: 'element';
  /** the qualified name as written */
  name: string;
  /** namespace URI ('' for none) and local name */
  uri: string;
  local: string;
  attrs: XAttr[];
  /** whitespace between the last attribute (or the name) and `>` / `/>` */
  tail: string;
  /** offset of `<` */
  start: number;
  /** offset after the start tag's `>` */
  tagEnd: number;
  /** offset of the end tag (= tagEnd for a self-closing element) */
  closeStart: number;
  /** offset after the end tag (= tagEnd for a self-closing element) */
  end: number;
  selfClosing: boolean;
  children: XNode[];
  parent: XElement | undefined;
  /** namespace bindings in scope (prefix -> URI, '' = default namespace) */
  ns: ReadonlyMap<string, string>;
}

export interface XLeaf {
  kind: 'text' | 'cdata' | 'comment' | 'pi';
  start: number;
  end: number;
}

export type XNode = XElement | XLeaf;

export interface XDocument {
  text: string;
  root: XElement;
  /** comments anywhere in the text (prolog and epilog included) */
  comments: number;
}

export class XmlTextError extends Error {
  constructor(message: string, at: number) {
    super(`${message} at offset ${at}`);
    this.name = 'XmlTextError';
  }
}

const isWs = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r';

/** Reads `text` into a tree with positions; throws XmlTextError for anything it does not support. */
export function readXmlText(text: string): XDocument {
  const n = text.length;
  const stack: XElement[] = [];
  let root: XElement | undefined;
  let comments = 0;
  let i = 0;
  const top = (): XElement | undefined => stack[stack.length - 1];
  const leaf = (kind: XLeaf['kind'], start: number, end: number): void => {
    top()?.children.push({ kind, start, end });
  };
  const until = (token: string, from: number, what: string): number => {
    const at = text.indexOf(token, from);
    if (at < 0) throw new XmlTextError(`unterminated ${what}`, from);
    return at;
  };
  while (i < n) {
    const lt = text.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      if (stack.length) leaf('text', i, textEnd);
      else if (text.slice(i, textEnd).replace(/^﻿/, '').trim()) throw new XmlTextError('text outside the root element', i);
    }
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      const end = until('-->', lt + 4, 'comment') + 3;
      comments++;
      leaf('comment', lt, end);
      i = end;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      if (!stack.length) throw new XmlTextError('CDATA outside the root element', lt);
      const end = until(']]>', lt + 9, 'CDATA section') + 3;
      leaf('cdata', lt, end);
      i = end;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = until('?>', lt + 2, 'processing instruction') + 2;
      leaf('pi', lt, end);
      i = end;
      continue;
    }
    if (text.startsWith('<!', lt)) throw new XmlTextError('DOCTYPE and other declarations are not supported', lt);
    if (text.startsWith('</', lt)) {
      const end = until('>', lt + 2, 'end tag');
      const name = text.slice(lt + 2, end).trimEnd();
      const el = stack.pop();
      if (!el || el.name !== name) throw new XmlTextError(`end tag </${name}> does not match <${el?.name ?? ''}>`, lt);
      el.closeStart = lt;
      el.end = end + 1;
      i = end + 1;
      continue;
    }
    // a start tag
    let j = lt + 1;
    while (j < n && !isWs(text[j]) && text[j] !== '/' && text[j] !== '>') j++;
    const name = text.slice(lt + 1, j);
    if (!name || name.includes('<') || name.includes('=')) throw new XmlTextError('malformed start tag', lt);
    if (!stack.length && root) throw new XmlTextError('a second root element', lt);
    const attrs: XAttr[] = [];
    let tail = '';
    let selfClosing = false;
    for (;;) {
      const wsStart = j;
      while (j < n && isWs(text[j])) j++;
      const ws = text.slice(wsStart, j);
      if (text[j] === '>') {
        tail = ws;
        j++;
        break;
      }
      if (text.startsWith('/>', j)) {
        tail = ws;
        selfClosing = true;
        j += 2;
        break;
      }
      if (j >= n) throw new XmlTextError('unterminated start tag', lt);
      if (!ws) throw new XmlTextError('missing whitespace before an attribute', j);
      const aStart = j;
      while (j < n && !isWs(text[j]) && text[j] !== '=' && text[j] !== '/' && text[j] !== '>') j++;
      const aName = text.slice(aStart, j);
      if (!aName) throw new XmlTextError('malformed attribute', aStart);
      while (j < n && isWs(text[j])) j++;
      if (text[j] !== '=') throw new XmlTextError(`attribute ${aName} without a value`, j);
      j++;
      while (j < n && isWs(text[j])) j++;
      const quote = text[j];
      if (quote !== '"' && quote !== "'") throw new XmlTextError(`unquoted value of ${aName}`, j);
      const close = until(quote, j + 1, 'attribute value');
      const raw = text.slice(j + 1, close);
      if (raw.includes('<')) throw new XmlTextError(`"<" in the value of ${aName}`, j);
      if (attrs.some((a) => a.name === aName)) throw new XmlTextError(`duplicate attribute ${aName}`, aStart);
      attrs.push({ name: aName, ws, start: aStart, end: close + 1, raw });
      j = close + 1;
    }
    const parent = top();
    let ns: ReadonlyMap<string, string> = parent?.ns ?? new Map([['xml', XML_NS]]);
    let own: Map<string, string> | undefined;
    for (const a of attrs) {
      if (a.name !== 'xmlns' && !a.name.startsWith('xmlns:')) continue;
      own ??= new Map(ns);
      own.set(a.name === 'xmlns' ? '' : a.name.slice(6), decodeXml(a.raw));
      ns = own;
    }
    const colon = name.indexOf(':');
    const prefix = colon < 0 ? '' : name.slice(0, colon);
    const uri = ns.get(prefix);
    if (prefix && uri === undefined) throw new XmlTextError(`unbound prefix ${prefix}`, lt);
    for (const a of attrs) {
      const c = a.name.indexOf(':');
      if (c > 0 && a.name.slice(0, c) !== 'xmlns' && !ns.has(a.name.slice(0, c))) throw new XmlTextError(`unbound prefix ${a.name.slice(0, c)}`, a.start);
    }
    const el: XElement = {
      kind: 'element',
      name,
      uri: uri ?? '',
      local: colon < 0 ? name : name.slice(colon + 1),
      attrs,
      tail,
      start: lt,
      tagEnd: j,
      closeStart: j,
      end: j,
      selfClosing,
      children: [],
      parent,
      ns,
    };
    if (parent) parent.children.push(el);
    else root = el;
    if (!selfClosing) stack.push(el);
    i = j;
  }
  if (stack.length) throw new XmlTextError(`unclosed element <${top()!.name}>`, n);
  if (!root) throw new XmlTextError('no root element', 0);
  return { text, root, comments };
}

/** The element children of an element, in document order. */
export function elementChildren(el: XElement): XElement[] {
  return el.children.filter((c): c is XElement => c.kind === 'element');
}

/** True when the element has character data: non-whitespace text or a CDATA section. */
export function hasCharacterData(doc: XDocument, el: XElement): boolean {
  return el.children.some((c) => c.kind === 'cdata' || (c.kind === 'text' && doc.text.slice(c.start, c.end).trim() !== ''));
}

/**
 * A namespace-resolved key for an attribute: `xmlns` / `xmlns:p` for
 * declarations, `{uri}local` for a prefixed name, the plain name otherwise.
 */
export function attrKey(el: XElement, attr: XAttr): string {
  const name = attr.name;
  if (name === 'xmlns' || name.startsWith('xmlns:')) return name;
  const c = name.indexOf(':');
  if (c < 0) return name;
  return `{${el.ns.get(name.slice(0, c)) ?? ''}}${name.slice(c + 1)}`;
}

/** The value of the unprefixed `id` attribute (entities expanded), if any. */
export function idOf(el: XElement): string | undefined {
  const a = el.attrs.find((x) => x.name === 'id');
  return a ? decodeXml(a.raw) : undefined;
}

/** Expands the five predefined entities and character references; unknown entities stay as written. */
export function decodeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'amp') return '&';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return String.fromCodePoint(code);
  });
}
