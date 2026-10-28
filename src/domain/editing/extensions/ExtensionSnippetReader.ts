import { modelError } from '../../document/utils/errors.js';
import type { El } from '../../document/utils/moddle.js';
import { decodeXml } from '../../document/utils/text-reader.js';
import type { NestedHosts } from '../properties/NestedHosts.js';
import { SnippetError } from './SnippetError.js';
import type { VendorElements } from '../properties/VendorElements.js';

interface RawNode {
  name: string;
  attrs: Record<string, string>;
  children: RawNode[];
  text: string;
}

type Raw = Record<string, unknown>;

/**
 * Parses an --xml extension snippet synchronously (moddle's fromXML is async, ops are not)
 * into exactly the generic elements moddle would create.
 */
export class ExtensionSnippetReader {
  constructor(
    private readonly names: VendorElements,
    private readonly hosts: NestedHosts,
  ) {}

  /** `nested`: the roots go inside a vendor element, where bpmn: roots are allowed. */
  parse(el: El, xml: string, nested = false): El[] {
    let roots: RawNode[];
    try {
      roots = this.read(xml);
    } catch (err) {
      if (err instanceof SnippetError) {
        throw modelError('E_INVALID_XML', `Cannot parse the extension snippet: ${err.message}`, {
          element: this.hosts.idOf(el),
          hint: 'Pass well-formed XML with prefixed elements, e.g. --xml \'<zeebe:ioMapping><zeebe:input source="=x" target="y"/></zeebe:ioMapping>\'.',
        });
      }
      throw err;
    }
    if (!roots.length) throw modelError('E_INVALID_XML', 'The extension snippet contains no elements', { element: this.hosts.idOf(el) });
    return roots.map((root) => this.toAny(el, root, {}, nested));
  }

  private read(xml: string): RawNode[] {
    const roots: RawNode[] = [];
    const stack: RawNode[] = [];
    const nameRe = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
    const attrRe = /\s*([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
    const wsRe = /\s*/y;
    const push = (node: RawNode): void => {
      const top = stack[stack.length - 1];
      (top ? top.children : roots).push(node);
    };
    let cursor = 0;
    while (cursor < xml.length) {
      const lt = xml.indexOf('<', cursor);
      const text = xml.slice(cursor, lt === -1 ? xml.length : lt);
      const top = stack[stack.length - 1];
      if (top) top.text += decodeXml(text);
      else if (text.trim()) throw new SnippetError(`text "${text.trim().slice(0, 20)}" outside of an element`);
      if (lt === -1) break;
      if (xml.startsWith('<!--', lt)) {
        const end = xml.indexOf('-->', lt + 4);
        if (end === -1) throw new SnippetError('unterminated comment');
        cursor = end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', lt)) {
        const end = xml.indexOf(']]>', lt + 9);
        if (end === -1) throw new SnippetError('unterminated CDATA section');
        if (!top) throw new SnippetError('CDATA outside of an element');
        top.text += xml.slice(lt + 9, end);
        cursor = end + 3;
        continue;
      }
      if (xml.startsWith('<?', lt)) {
        const end = xml.indexOf('?>', lt + 2);
        if (end === -1) throw new SnippetError('unterminated processing instruction');
        cursor = end + 2;
        continue;
      }
      if (xml.startsWith('<!', lt)) throw new SnippetError('declarations (<!DOCTYPE ...>) are not allowed in a snippet');
      if (xml.startsWith('</', lt)) {
        const end = xml.indexOf('>', lt);
        if (end === -1) throw new SnippetError('unterminated closing tag');
        const name = xml.slice(lt + 2, end).trim();
        const open = stack.pop();
        if (!open || open.name !== name) throw new SnippetError(`unexpected closing tag </${name}>${open ? `, expected </${open.name}>` : ''}`);
        cursor = end + 1;
        continue;
      }
      nameRe.lastIndex = lt + 1;
      const nm = nameRe.exec(xml);
      if (!nm || nm.index !== lt + 1) throw new SnippetError(`invalid tag at offset ${lt}`);
      const node: RawNode = { name: nm[0], attrs: {}, children: [], text: '' };
      let nameEnd = nameRe.lastIndex;
      for (;;) {
        attrRe.lastIndex = nameEnd;
        const am = attrRe.exec(xml);
        if (am && am.index === nameEnd) {
          node.attrs[am[1]!] = decodeXml(am[2] ?? am[3] ?? '');
          nameEnd = attrRe.lastIndex;
          continue;
        }
        wsRe.lastIndex = nameEnd;
        wsRe.exec(xml);
        nameEnd = wsRe.lastIndex;
        if (xml.startsWith('/>', nameEnd)) {
          push(node);
          cursor = nameEnd + 2;
          break;
        }
        if (xml[nameEnd] === '>') {
          push(node);
          stack.push(node);
          cursor = nameEnd + 1;
          break;
        }
        throw new SnippetError(`invalid attribute syntax in <${node.name}>`);
      }
    }
    const open = stack[stack.length - 1];
    if (open) throw new SnippetError(`unclosed element <${open.name}>`);
    return roots;
  }

  private toAny(el: El, node: RawNode, scope: Record<string, string>, nested: boolean): El {
    const local = { ...scope };
    const attrs: Record<string, string> = {};
    for (const [attrName, attrValue] of Object.entries(node.attrs)) {
      if (attrName === 'xmlns') throw modelError('E_INVALID_XML', `<${node.name}> declares a default namespace; extension elements must use a prefix`, { element: this.hosts.idOf(el) });
      if (attrName.startsWith('xmlns:')) local[attrName.slice(6)] = attrValue;
      else attrs[attrName] = attrValue;
    }
    const any = this.names.createGeneric(el, node.name, attrs, node.text.trim() ? node.text : undefined, local, nested);
    const children = node.children.map((child) => this.toAny(el, child, local, true));
    if (children.length) {
      (any as unknown as Raw)['$children'] = children;
      for (const child of children) child.$parent = any;
    }
    return any;
  }
}
