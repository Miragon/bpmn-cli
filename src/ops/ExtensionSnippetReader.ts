import { modelError } from '../shared/utils/errors.js';
import type { El } from '../model/utils/moddle.js';
import { decodeXml } from '../xml/utils/text-reader.js';
import type { NestedHosts } from './NestedHosts.js';
import { SnippetError } from './SnippetError.js';
import type { VendorElements } from './VendorElements.js';

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
    return roots.map((r) => this.toAny(el, r, {}, nested));
  }

  private read(xml: string): RawNode[] {
    const roots: RawNode[] = [];
    const stack: RawNode[] = [];
    const nameRe = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
    const attrRe = /\s*([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
    const wsRe = /\s*/y;
    const push = (n: RawNode): void => {
      const top = stack[stack.length - 1];
      (top ? top.children : roots).push(n);
    };
    let i = 0;
    while (i < xml.length) {
      const lt = xml.indexOf('<', i);
      const text = xml.slice(i, lt === -1 ? xml.length : lt);
      const top = stack[stack.length - 1];
      if (top) top.text += decodeXml(text);
      else if (text.trim()) throw new SnippetError(`text "${text.trim().slice(0, 20)}" outside of an element`);
      if (lt === -1) break;
      if (xml.startsWith('<!--', lt)) {
        const end = xml.indexOf('-->', lt + 4);
        if (end === -1) throw new SnippetError('unterminated comment');
        i = end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', lt)) {
        const end = xml.indexOf(']]>', lt + 9);
        if (end === -1) throw new SnippetError('unterminated CDATA section');
        if (!top) throw new SnippetError('CDATA outside of an element');
        top.text += xml.slice(lt + 9, end);
        i = end + 3;
        continue;
      }
      if (xml.startsWith('<?', lt)) {
        const end = xml.indexOf('?>', lt + 2);
        if (end === -1) throw new SnippetError('unterminated processing instruction');
        i = end + 2;
        continue;
      }
      if (xml.startsWith('<!', lt)) throw new SnippetError('declarations (<!DOCTYPE ...>) are not allowed in a snippet');
      if (xml.startsWith('</', lt)) {
        const end = xml.indexOf('>', lt);
        if (end === -1) throw new SnippetError('unterminated closing tag');
        const name = xml.slice(lt + 2, end).trim();
        const open = stack.pop();
        if (!open || open.name !== name) throw new SnippetError(`unexpected closing tag </${name}>${open ? `, expected </${open.name}>` : ''}`);
        i = end + 1;
        continue;
      }
      nameRe.lastIndex = lt + 1;
      const nm = nameRe.exec(xml);
      if (!nm || nm.index !== lt + 1) throw new SnippetError(`invalid tag at offset ${lt}`);
      const node: RawNode = { name: nm[0], attrs: {}, children: [], text: '' };
      let j = nameRe.lastIndex;
      for (;;) {
        attrRe.lastIndex = j;
        const am = attrRe.exec(xml);
        if (am && am.index === j) {
          node.attrs[am[1]!] = decodeXml(am[2] ?? am[3] ?? '');
          j = attrRe.lastIndex;
          continue;
        }
        wsRe.lastIndex = j;
        wsRe.exec(xml);
        j = wsRe.lastIndex;
        if (xml.startsWith('/>', j)) {
          push(node);
          i = j + 2;
          break;
        }
        if (xml[j] === '>') {
          push(node);
          stack.push(node);
          i = j + 1;
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
    for (const [k, v] of Object.entries(node.attrs)) {
      if (k === 'xmlns') throw modelError('E_INVALID_XML', `<${node.name}> declares a default namespace; extension elements must use a prefix`, { element: this.hosts.idOf(el) });
      if (k.startsWith('xmlns:')) local[k.slice(6)] = v;
      else attrs[k] = v;
    }
    const any = this.names.createGeneric(el, node.name, attrs, node.text.trim() ? node.text : undefined, local, nested);
    const children = node.children.map((c) => this.toAny(el, c, local, true));
    if (children.length) {
      (any as unknown as Raw)['$children'] = children;
      for (const c of children) c.$parent = any;
    }
    return any;
  }
}
