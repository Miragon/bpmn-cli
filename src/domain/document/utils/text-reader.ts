/**
 * A small XML reader that keeps the text positions of elements and attributes, so unchanged
 * parts can be copied verbatim. A DOCTYPE or anything malformed throws XmlTextError.
 * Entities are not expanded: values are compared as written.
 */
import { XmlTextError } from '../xml/XmlTextError.js';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export interface XAttr {
  name: string;
  ws: string;
  /** offsets of `name="value"` in the text */
  start: number;
  end: number;
  /** entities not expanded */
  raw: string;
}

export interface XElement {
  kind: 'element';
  name: string;
  uri: string;
  local: string;
  attrs: XAttr[];
  /** whitespace between the last attribute (or the name) and `>` / `/>` */
  tail: string;
  start: number;
  /** offset after the start tag's `>` */
  tagEnd: number;
  /** = tagEnd for a self-closing element, like `end` */
  closeStart: number;
  end: number;
  selfClosing: boolean;
  children: XNode[];
  parent: XElement | undefined;
  /** prefix -> URI in scope, '' = default namespace */
  ns: ReadonlyMap<string, string>;
}

interface XLeaf {
  kind: 'text' | 'cdata' | 'comment' | 'pi';
  start: number;
  end: number;
}

type XNode = XElement | XLeaf;

export interface XDocument {
  text: string;
  root: XElement;
  comments: number;
}

const isWs = (char: string | undefined): boolean => char === ' ' || char === '\n' || char === '\t' || char === '\r';

export function readXmlText(text: string): XDocument {
  const length = text.length;
  const stack: XElement[] = [];
  let root: XElement | undefined;
  let comments = 0;
  let pos = 0;
  const top = (): XElement | undefined => stack[stack.length - 1];
  const leaf = (kind: XLeaf['kind'], start: number, end: number): void => {
    top()?.children.push({ kind, start, end });
  };
  const until = (token: string, from: number, what: string): number => {
    const at = text.indexOf(token, from);
    if (at < 0) throw new XmlTextError(`unterminated ${what}`, from);
    return at;
  };
  while (pos < length) {
    const lt = text.indexOf('<', pos);
    const textEnd = lt < 0 ? length : lt;
    if (textEnd > pos) {
      if (stack.length) leaf('text', pos, textEnd);
      else if (text.slice(pos, textEnd).replace(/^﻿/, '').trim()) throw new XmlTextError('text outside the root element', pos);
    }
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      const end = until('-->', lt + 4, 'comment') + 3;
      comments++;
      leaf('comment', lt, end);
      pos = end;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      if (!stack.length) throw new XmlTextError('CDATA outside the root element', lt);
      const end = until(']]>', lt + 9, 'CDATA section') + 3;
      leaf('cdata', lt, end);
      pos = end;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = until('?>', lt + 2, 'processing instruction') + 2;
      leaf('pi', lt, end);
      pos = end;
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
      pos = end + 1;
      continue;
    }
    let cursor = lt + 1;
    while (cursor < length && !isWs(text[cursor]) && text[cursor] !== '/' && text[cursor] !== '>') cursor++;
    const name = text.slice(lt + 1, cursor);
    if (!name || name.includes('<') || name.includes('=')) throw new XmlTextError('malformed start tag', lt);
    if (!stack.length && root) throw new XmlTextError('a second root element', lt);
    const attrs: XAttr[] = [];
    let tail = '';
    let selfClosing = false;
    for (;;) {
      const wsStart = cursor;
      while (cursor < length && isWs(text[cursor])) cursor++;
      const ws = text.slice(wsStart, cursor);
      if (text[cursor] === '>') {
        tail = ws;
        cursor++;
        break;
      }
      if (text.startsWith('/>', cursor)) {
        tail = ws;
        selfClosing = true;
        cursor += 2;
        break;
      }
      if (cursor >= length) throw new XmlTextError('unterminated start tag', lt);
      if (!ws) throw new XmlTextError('missing whitespace before an attribute', cursor);
      const aStart = cursor;
      while (cursor < length && !isWs(text[cursor]) && text[cursor] !== '=' && text[cursor] !== '/' && text[cursor] !== '>') cursor++;
      const aName = text.slice(aStart, cursor);
      if (!aName) throw new XmlTextError('malformed attribute', aStart);
      while (cursor < length && isWs(text[cursor])) cursor++;
      if (text[cursor] !== '=') throw new XmlTextError(`attribute ${aName} without a value`, cursor);
      cursor++;
      while (cursor < length && isWs(text[cursor])) cursor++;
      const quote = text[cursor];
      if (quote !== '"' && quote !== "'") throw new XmlTextError(`unquoted value of ${aName}`, cursor);
      const close = until(quote, cursor + 1, 'attribute value');
      const raw = text.slice(cursor + 1, close);
      if (raw.includes('<')) throw new XmlTextError(`"<" in the value of ${aName}`, cursor);
      if (attrs.some((attr) => attr.name === aName)) throw new XmlTextError(`duplicate attribute ${aName}`, aStart);
      attrs.push({ name: aName, ws, start: aStart, end: close + 1, raw });
      cursor = close + 1;
    }
    const parent = top();
    let ns: ReadonlyMap<string, string> = parent?.ns ?? new Map([['xml', XML_NS]]);
    let own: Map<string, string> | undefined;
    for (const attr of attrs) {
      if (attr.name !== 'xmlns' && !attr.name.startsWith('xmlns:')) continue;
      own ??= new Map(ns);
      own.set(attr.name === 'xmlns' ? '' : attr.name.slice(6), decodeXml(attr.raw));
      ns = own;
    }
    const colon = name.indexOf(':');
    const prefix = colon < 0 ? '' : name.slice(0, colon);
    const uri = ns.get(prefix);
    if (prefix && uri === undefined) throw new XmlTextError(`unbound prefix ${prefix}`, lt);
    for (const attr of attrs) {
      const attrColon = attr.name.indexOf(':');
      if (attrColon > 0 && attr.name.slice(0, attrColon) !== 'xmlns' && !ns.has(attr.name.slice(0, attrColon))) throw new XmlTextError(`unbound prefix ${attr.name.slice(0, attrColon)}`, attr.start);
    }
    const el: XElement = {
      kind: 'element',
      name,
      uri: uri ?? '',
      local: colon < 0 ? name : name.slice(colon + 1),
      attrs,
      tail,
      start: lt,
      tagEnd: cursor,
      closeStart: cursor,
      end: cursor,
      selfClosing,
      children: [],
      parent,
      ns,
    };
    if (parent) parent.children.push(el);
    else root = el;
    if (!selfClosing) stack.push(el);
    pos = cursor;
  }
  if (stack.length) throw new XmlTextError(`unclosed element <${top()!.name}>`, length);
  if (!root) throw new XmlTextError('no root element', 0);
  return { text, root, comments };
}

export function elementChildren(el: XElement): XElement[] {
  return el.children.filter((child): child is XElement => child.kind === 'element');
}

export function hasCharacterData(doc: XDocument, el: XElement): boolean {
  return el.children.some((child) => child.kind === 'cdata' || (child.kind === 'text' && doc.text.slice(child.start, child.end).trim() !== ''));
}

/** `xmlns` / `xmlns:p` for declarations, `{uri}local` for a prefixed name, else the name. */
export function attrKey(el: XElement, attr: XAttr): string {
  const name = attr.name;
  if (name === 'xmlns' || name.startsWith('xmlns:')) return name;
  const colon = name.indexOf(':');
  if (colon < 0) return name;
  return `{${el.ns.get(name.slice(0, colon)) ?? ''}}${name.slice(colon + 1)}`;
}

/** The unprefixed `id`, entities expanded. */
export function idOf(el: XElement): string | undefined {
  const idAttr = el.attrs.find((attr) => attr.name === 'id');
  return idAttr ? decodeXml(idAttr.raw) : undefined;
}

/** Unknown entities stay as written. */
export function decodeXml(source: string): string {
  if (!source.includes('&')) return source;
  return source.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_reference, entity: string) => {
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'amp') return '&';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

export function rawOf(doc: XDocument, el: XElement): string {
  return doc.text.slice(el.start, el.end);
}
