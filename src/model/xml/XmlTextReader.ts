import { XmlTextError } from './XmlTextError.js';

export interface XAttr {
  name: string;
  ws: string;
  start: number;
  end: number;
  raw: string;
}

export interface XElement {
  kind: 'element';
  name: string;
  uri: string;
  local: string;
  attrs: XAttr[];
  tail: string;
  start: number;
  tagEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
  children: XNode[];
  parent: XElement | undefined;
  ns: ReadonlyMap<string, string>;
}

type XNode = XElement | { kind: 'text' | 'cdata' | 'comment' | 'pi'; start: number; end: number };

export interface XDocument {
  text: string;
  root: XElement;
  comments: number;
}

export class XmlTextReader {
  private static readonly XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
  private static readonly ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g;
  private static readonly NAMED_ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

  private readonly stack: XElement[] = [];
  private root: XElement | undefined;
  private comments = 0;
  private position = 0;

  private constructor(private readonly text: string) {}

  static read(text: string): XDocument {
    return new XmlTextReader(text).document();
  }

  static elementChildren(element: XElement): XElement[] {
    return element.children.filter((child): child is XElement => child.kind === 'element');
  }

  static hasCharacterData(document: XDocument, element: XElement): boolean {
    return element.children.some((child) => child.kind === 'cdata' || (child.kind === 'text' && document.text.slice(child.start, child.end).trim() !== ''));
  }

  static attrKey(element: XElement, attr: XAttr): string {
    const { name } = attr;
    const colon = name.indexOf(':');
    return name.startsWith('xmlns') || colon < 0 ? name : `{${element.ns.get(name.slice(0, colon)) ?? ''}}${name.slice(colon + 1)}`;
  }

  static idOf(element: XElement): string | undefined {
    return element.attrs.filter((attr) => attr.name === 'id').map((attr) => XmlTextReader.decode(attr.raw))[0];
  }

  static decode(source: string): string {
    if (!source.includes('&')) {
      return source;
    }
    return source.replace(XmlTextReader.ENTITY, (_reference, entity: string) => {
      return XmlTextReader.NAMED_ENTITIES[entity] ?? String.fromCodePoint(entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10));
    });
  }

  static rawOf(document: XDocument, element: XElement): string {
    return document.text.slice(element.start, element.end);
  }

  private static isSpace(character: string | undefined): boolean {
    return character !== undefined && ' \n\t\r'.includes(character);
  }

  private document(): XDocument {
    const { text } = this;
    while (this.position < text.length) {
      const open = text.indexOf('<', this.position);
      this.readText(open < 0 ? text.length : open);
      if (open < 0) {
        break;
      }
      this.readMarkup(open);
    }
    if (this.stack.length) {
      throw new XmlTextError(`unclosed element <${this.top()!.name}>`, text.length);
    }
    if (!this.root) {
      throw new XmlTextError('no root element', 0);
    }
    return { text, root: this.root, comments: this.comments };
  }

  private top(): XElement | undefined {
    return this.stack.at(-1);
  }

  private leaf(kind: 'text' | 'cdata' | 'comment' | 'pi', start: number, end: number): void {
    this.top()?.children.push({ kind, start, end });
    this.position = end;
  }

  private until(token: string, from: number, what: string): number {
    const at = this.text.indexOf(token, from);
    if (at < 0) {
      throw new XmlTextError(`unterminated ${what}`, from);
    }
    return at;
  }

  private readText(end: number): void {
    const start = this.position;
    if (end <= start) {
      return;
    }
    if (this.stack.length) {
      this.leaf('text', start, end);
    } else if (this.text.slice(start, end).replace(/^﻿/, '').trim()) {
      throw new XmlTextError('text outside the root element', start);
    }
  }

  private readMarkup(open: number): void {
    const { text } = this;
    if (text.startsWith('<!--', open)) {
      this.comments++;
      this.leaf('comment', open, this.until('-->', open + 4, 'comment') + 3);
    } else if (text.startsWith('<![CDATA[', open)) {
      if (!this.stack.length) {
        throw new XmlTextError('CDATA outside the root element', open);
      }
      this.leaf('cdata', open, this.until(']]>', open + 9, 'CDATA section') + 3);
    } else if (text.startsWith('<?', open)) {
      this.leaf('pi', open, this.until('?>', open + 2, 'processing instruction') + 2);
    } else if (text.startsWith('<!', open)) {
      throw new XmlTextError('DOCTYPE and other declarations are not supported', open);
    } else if (text.startsWith('</', open)) {
      this.readEndTag(open);
    } else {
      this.readStartTag(open);
    }
  }

  private readEndTag(open: number): void {
    const end = this.until('>', open + 2, 'end tag');
    const name = this.text.slice(open + 2, end).trimEnd();
    const element = this.stack.pop();
    if (!element || element.name !== name) {
      throw new XmlTextError(`end tag </${name}> does not match <${element?.name ?? ''}>`, open);
    }
    element.closeStart = open;
    element.end = end + 1;
    this.position = end + 1;
  }

  private readStartTag(open: number): void {
    const { name, cursor } = this.tagName(open);
    if (!this.stack.length && this.root) {
      throw new XmlTextError('a second root element', open);
    }
    const { attrs, tail, selfClosing, end } = this.attributes(open, cursor);
    const parent = this.top();
    const ns = this.scope(parent, attrs);
    const element: XElement = { kind: 'element', name, ...this.resolveName(name, ns, attrs, open), attrs, tail, start: open, tagEnd: end, closeStart: end, end, selfClosing, children: [], parent, ns };
    if (parent) {
      parent.children.push(element);
    } else {
      this.root = element;
    }
    if (!selfClosing) {
      this.stack.push(element);
    }
    this.position = end;
  }

  private tagName(open: number): { name: string; cursor: number } {
    const { text } = this;
    let cursor = open + 1;
    while (cursor < text.length && !XmlTextReader.isSpace(text[cursor]) && text[cursor] !== '/' && text[cursor] !== '>') {
      cursor++;
    }
    const name = text.slice(open + 1, cursor);
    if (!name || /[<=]/.test(name)) {
      throw new XmlTextError('malformed start tag', open);
    }
    return { name, cursor };
  }

  private skipSpace(from: number): number {
    let cursor = from;
    while (cursor < this.text.length && XmlTextReader.isSpace(this.text[cursor])) {
      cursor++;
    }
    return cursor;
  }

  private attributes(open: number, from: number): { attrs: XAttr[]; tail: string; selfClosing: boolean; end: number } {
    const { text } = this;
    const attrs: XAttr[] = [];
    let cursor = from;
    for (;;) {
      const spaceStart = cursor;
      cursor = this.skipSpace(cursor);
      const ws = text.slice(spaceStart, cursor);
      if (text[cursor] === '>') {
        return { attrs, tail: ws, selfClosing: false, end: cursor + 1 };
      }
      if (text.startsWith('/>', cursor)) {
        return { attrs, tail: ws, selfClosing: true, end: cursor + 2 };
      }
      if (cursor >= text.length) {
        throw new XmlTextError('unterminated start tag', open);
      }
      if (!ws) {
        throw new XmlTextError('missing whitespace before an attribute', cursor);
      }
      const attr = this.attribute(cursor, ws, attrs);
      attrs.push(attr);
      cursor = attr.end;
    }
  }

  private attribute(start: number, ws: string, earlier: readonly XAttr[]): XAttr {
    const { text } = this;
    let cursor = start;
    while (cursor < text.length && !XmlTextReader.isSpace(text[cursor]) && text[cursor] !== '=' && text[cursor] !== '/' && text[cursor] !== '>') {
      cursor++;
    }
    const name = text.slice(start, cursor);
    if (!name) {
      throw new XmlTextError('malformed attribute', start);
    }
    cursor = this.skipSpace(cursor);
    if (text[cursor] !== '=') {
      throw new XmlTextError(`attribute ${name} without a value`, cursor);
    }
    return this.attributeValue(this.skipSpace(cursor + 1), name, start, ws, earlier);
  }

  private attributeValue(cursor: number, name: string, start: number, ws: string, earlier: readonly XAttr[]): XAttr {
    const quote = this.text[cursor];
    if (quote !== '"' && quote !== "'") {
      throw new XmlTextError(`unquoted value of ${name}`, cursor);
    }
    const close = this.until(quote, cursor + 1, 'attribute value');
    const raw = this.text.slice(cursor + 1, close);
    if (raw.includes('<')) {
      throw new XmlTextError(`"<" in the value of ${name}`, cursor);
    }
    if (earlier.some((attr) => attr.name === name)) {
      throw new XmlTextError(`duplicate attribute ${name}`, start);
    }
    return { name, ws, start, end: close + 1, raw };
  }

  private scope(parent: XElement | undefined, attrs: readonly XAttr[]): ReadonlyMap<string, string> {
    const inherited: ReadonlyMap<string, string> = parent?.ns ?? new Map([['xml', XmlTextReader.XML_NAMESPACE]]);
    const declarations = attrs.filter((attr) => attr.name === 'xmlns' || attr.name.startsWith('xmlns:'));
    if (!declarations.length) {
      return inherited;
    }
    const own = new Map(inherited);
    for (const attr of declarations) {
      own.set(attr.name === 'xmlns' ? '' : attr.name.slice(6), XmlTextReader.decode(attr.raw));
    }
    return own;
  }

  private resolveName(name: string, ns: ReadonlyMap<string, string>, attrs: readonly XAttr[], open: number): { uri: string; local: string } {
    const colon = name.indexOf(':');
    const prefix = colon < 0 ? '' : name.slice(0, colon);
    const uri = ns.get(prefix);
    if (prefix && uri === undefined) {
      throw new XmlTextError(`unbound prefix ${prefix}`, open);
    }
    for (const attr of attrs) {
      const attrColon = attr.name.indexOf(':');
      const attrPrefix = attr.name.slice(0, Math.max(attrColon, 0));
      if (attrColon > 0 && attrPrefix !== 'xmlns' && !ns.has(attrPrefix)) {
        throw new XmlTextError(`unbound prefix ${attrPrefix}`, attr.start);
      }
    }
    return { uri: uri ?? '', local: colon < 0 ? name : name.slice(colon + 1) };
  }
}
