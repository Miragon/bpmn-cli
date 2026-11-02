import { type BpmnElement, BpmnError, XmlTextReader } from '../../model/index.js';
import type { NestedHosts } from './NestedHosts.js';
import { SnippetError } from './SnippetError.js';
import type { VendorElements } from './VendorElements.js';

interface RawNode {
  name: string;
  attrs: Record<string, string>;
  children: RawNode[];
  text: string;
}

interface SnippetScan {
  xml: string;
  roots: RawNode[];
  stack: RawNode[];
  cursor: number;
}

export class ExtensionSnippetReader {
  constructor(
    private readonly names: VendorElements,
    private readonly hosts: NestedHosts,
  ) {}

  parse(el: BpmnElement, xml: string, nested: boolean): BpmnElement[] {
    let roots: RawNode[];
    try {
      roots = this.read(xml);
    } catch (err) {
      if (err instanceof SnippetError) {
        throw BpmnError.model('E_INVALID_XML', `Cannot parse the extension snippet: ${err.message}`, {
          element: this.hosts.idOf(el),
          hint: 'Pass well-formed XML with prefixed elements, e.g. --xml \'<zeebe:ioMapping><zeebe:input source="=x" target="y"/></zeebe:ioMapping>\'.',
        });
      }
      throw err;
    }
    if (!roots.length) {
      throw BpmnError.model('E_INVALID_XML', 'The extension snippet contains no elements', { element: this.hosts.idOf(el) });
    }
    return roots.map((root) => this.toAny(el, root, {}, nested));
  }

  private read(xml: string): RawNode[] {
    const scan: SnippetScan = { xml, roots: [], stack: [], cursor: 0 };
    while (scan.cursor < xml.length) {
      const lt = xml.indexOf('<', scan.cursor);
      ExtensionSnippetReader.readText(scan, xml.slice(scan.cursor, lt === -1 ? xml.length : lt));
      if (lt === -1) {
        break;
      }
      ExtensionSnippetReader.readMarkup(scan, lt);
    }
    const open = scan.stack[scan.stack.length - 1];
    if (open) {
      throw new SnippetError(`unclosed element <${open.name}>`);
    }
    return scan.roots;
  }

  private static readText(scan: SnippetScan, text: string): void {
    const top = scan.stack[scan.stack.length - 1];
    if (top) {
      top.text += XmlTextReader.decode(text);
    } else if (text.trim()) {
      throw new SnippetError(`text "${text.trim().slice(0, 20)}" outside of an element`);
    }
  }

  private static readMarkup(scan: SnippetScan, lt: number): void {
    const { xml } = scan;
    if (xml.startsWith('<!--', lt)) {
      scan.cursor = ExtensionSnippetReader.endOf(xml, '-->', lt + 4, 'unterminated comment');
    } else if (xml.startsWith('<![CDATA[', lt)) {
      ExtensionSnippetReader.readCdata(scan, lt);
    } else if (xml.startsWith('<?', lt)) {
      scan.cursor = ExtensionSnippetReader.endOf(xml, '?>', lt + 2, 'unterminated processing instruction');
    } else if (xml.startsWith('<!', lt)) {
      throw new SnippetError('declarations (<!DOCTYPE ...>) are not allowed in a snippet');
    } else if (xml.startsWith('</', lt)) {
      ExtensionSnippetReader.readClosingTag(scan, lt);
    } else {
      ExtensionSnippetReader.readOpeningTag(scan, lt);
    }
  }

  private static endOf(xml: string, terminator: string, from: number, unterminated: string): number {
    const end = xml.indexOf(terminator, from);
    if (end === -1) {
      throw new SnippetError(unterminated);
    }
    return end + terminator.length;
  }

  private static readCdata(scan: SnippetScan, lt: number): void {
    const { xml } = scan;
    const after = ExtensionSnippetReader.endOf(xml, ']]>', lt + 9, 'unterminated CDATA section');
    const top = scan.stack[scan.stack.length - 1];
    if (!top) {
      throw new SnippetError('CDATA outside of an element');
    }
    top.text += xml.slice(lt + 9, after - 3);
    scan.cursor = after;
  }

  private static readClosingTag(scan: SnippetScan, lt: number): void {
    const { xml } = scan;
    const after = ExtensionSnippetReader.endOf(xml, '>', lt, 'unterminated closing tag');
    const name = xml.slice(lt + 2, after - 1).trim();
    const open = scan.stack.pop();
    if (!open || open.name !== name) {
      throw new SnippetError(`unexpected closing tag </${name}>${open ? `, expected </${open.name}>` : ''}`);
    }
    scan.cursor = after;
  }

  private static readOpeningTag(scan: SnippetScan, lt: number): void {
    const { xml } = scan;
    const nameRe = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
    nameRe.lastIndex = lt + 1;
    const nm = nameRe.exec(xml);
    if (!nm || nm.index !== lt + 1) {
      throw new SnippetError(`invalid tag at offset ${lt}`);
    }
    const node: RawNode = { name: nm[0], attrs: {}, children: [], text: '' };
    const tagEnd = ExtensionSnippetReader.readAttributes(xml, node, nameRe.lastIndex);
    const top = scan.stack[scan.stack.length - 1];
    (top ? top.children : scan.roots).push(node);
    if (xml.startsWith('/>', tagEnd)) {
      scan.cursor = tagEnd + 2;
    } else {
      scan.stack.push(node);
      scan.cursor = tagEnd + 1;
    }
  }

  private static readAttributes(xml: string, node: RawNode, from: number): number {
    const attrRe = /\s*([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
    const wsRe = /\s*/y;
    let nameEnd = from;
    for (;;) {
      attrRe.lastIndex = nameEnd;
      const am = attrRe.exec(xml);
      if (!am || am.index !== nameEnd) {
        break;
      }
      node.attrs[am[1]!] = XmlTextReader.decode(am[2] ?? am[3] ?? '');
      nameEnd = attrRe.lastIndex;
    }
    wsRe.lastIndex = nameEnd;
    wsRe.exec(xml);
    const tagEnd = wsRe.lastIndex;
    if (!xml.startsWith('/>', tagEnd) && xml[tagEnd] !== '>') {
      throw new SnippetError(`invalid attribute syntax in <${node.name}>`);
    }
    return tagEnd;
  }

  private toAny(el: BpmnElement, node: RawNode, scope: Record<string, string>, nested: boolean): BpmnElement {
    const local = { ...scope };
    const attrs: Record<string, string> = {};
    for (const [attrName, attrValue] of Object.entries(node.attrs)) {
      if (attrName === 'xmlns') {
        throw BpmnError.model('E_INVALID_XML', `<${node.name}> declares a default namespace; extension elements must use a prefix`, { element: this.hosts.idOf(el) });
      }
      if (attrName.startsWith('xmlns:')) {
        local[attrName.slice(6)] = attrValue;
      } else {
        attrs[attrName] = attrValue;
      }
    }
    const any = this.names.createGeneric(el, node.name, attrs, node.text.trim() ? node.text : undefined, local, nested);
    const children = node.children.map((child) => this.toAny(el, child, local, true));
    if (children.length) {
      any.set('$children', children);
      for (const child of children) {
        child.parent = any;
      }
    }
    return any;
  }
}
