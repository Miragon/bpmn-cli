import { type BpmnModdle, DeclaredNamespaces, type XElement, XmlTextReader } from '../../../model/index.js';
import { BpmnSchema } from './BpmnSchema.js';

export interface SchemaTextIssue {
  kind: 'order' | 'idref' | 'id' | 'boolean';
  owner: string | undefined;
  element: string;
  child?: string;
  before?: string;
  ref?: string;
  value?: string;
  attribute?: boolean;
}

export class SchemaText {
  private static readonly OPAQUE = new Set(['extensionElements', 'documentation']);
  private static readonly IDREF_ATTRS: Array<[string, string[]]> = [
  ['bpmn:Activity', ['default']],
  ['bpmn:ExclusiveGateway', ['default']],
  ['bpmn:InclusiveGateway', ['default']],
  ['bpmn:ComplexGateway', ['default']],
  ['bpmn:DataObjectReference', ['dataObjectRef']],
  ['bpmn:InputOutputBinding', ['inputDataRef', 'outputDataRef']],
];
  private static readonly IDREF_CHILDREN: Array<[string, string[]]> = [
  ['bpmn:Lane', ['flowNodeRef']],
  ['bpmn:DataAssociation', ['sourceRef', 'targetRef']],
  ['bpmn:InputSet', ['dataInputRefs', 'optionalInputRefs', 'whileExecutingInputRefs', 'outputSetRefs']],
  ['bpmn:OutputSet', ['dataOutputRefs', 'optionalOutputRefs', 'whileExecutingOutputRefs', 'inputSetRefs']],
];
  private static readonly XSD_BOOLEAN = /^[ \t\r\n]*(?:true|false|1|0)[ \t\r\n]*$/;
  private static readonly NCNAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
  static readonly NCNAME = new RegExp(`^[${SchemaText.NCNAME_START}][${SchemaText.NCNAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, 'u');

  issues(xml: string, moddle: BpmnModdle): SchemaTextIssue[] {
    let root: XElement;
    try {
      root = XmlTextReader.read(xml).root;
    } catch (err) {
      if (err instanceof Error && err.name === 'XmlTextError') {
        return [];
      }
      throw err;
    }
    const schema = new BpmnSchema(moddle, DeclaredNamespaces.BPMN);
    const ids = new Set<string>();
    const out: SchemaTextIssue[] = [];
    const collect = (el: XElement, owner: string | undefined): void => {
      let here = owner;
      if (el.uri.startsWith('http://www.omg.org/spec/')) {
        const id = this.attr(el, 'id');
        if (id !== undefined) {
          ids.add(id.trim());
          if (!SchemaText.NCNAME.test(id.trim())) {
            out.push({ kind: 'id', owner: id.trim(), element: el.local, value: id.trim() });
          }
          here = id.trim();
        }
        const type = schema.typeOf(el.local, el.uri, undefined);
        const booleans = type ? schema.booleanAttrs(type) : undefined;
        for (const attribute of booleans?.size ? el.attrs : []) {
          if (!booleans!.has(attribute.name)) {
            continue;
          }
          const decoded = XmlTextReader.decode(attribute.raw);
          if (!SchemaText.XSD_BOOLEAN.test(decoded)) {
            out.push({ kind: 'boolean', owner: el.uri === DeclaredNamespaces.BPMN ? here : (this.attr(el, 'bpmnElement')?.trim() ?? owner), element: el.local, ref: attribute.name, value: decoded, attribute: true });
          }
        }
      }
      for (const child of XmlTextReader.elementChildren(el)) {
        collect(child, here);
      }
    };
    collect(root, undefined);

    const visit = (el: XElement, type: string, owner: string | undefined): void => {
      const here = this.attr(el, 'id') ?? owner;
      for (const [base, names] of SchemaText.IDREF_ATTRS) {
        if (!schema.isA(type, base)) {
          continue;
        }
        for (const attrName of names) {
          const idref = this.attr(el, attrName)?.trim();
          if (idref && !ids.has(idref)) {
            out.push({ kind: 'idref', owner: here, element: el.local, ref: attrName, value: idref, attribute: true });
          }
        }
      }
      const kids = XmlTextReader.elementChildren(el);
      for (const [base, names] of SchemaText.IDREF_CHILDREN) {
        if (!schema.isA(type, base)) {
          continue;
        }
        for (const kid of kids) {
          if (kid.uri !== DeclaredNamespaces.BPMN || !names.includes(kid.local)) {
            continue;
          }
          const idref = this.text(xml, kid);
          if (idref && !ids.has(idref)) {
            out.push({ kind: 'idref', owner: here, element: el.local, ref: kid.local, value: idref });
          }
        }
      }
      const slots = schema.slotsOf(type);
      let last = -1;
      let lastName = '';
      for (const kid of kids) {
        if (kid.uri !== DeclaredNamespaces.BPMN && kid.uri !== BpmnSchema.BPMNDI_NS) {
          continue;
        }
        const slot = slots.get(kid.local);
        if (slot === undefined || slot < 0) {
          continue;
        }
        if (slot < last) {
          out.push({ kind: 'order', owner: here, element: el.local, child: kid.local, before: lastName });
          break;
        }
        if (slot > last) {
          last = slot;
          lastName = kid.local;
        }
      }
      for (const kid of kids) {
        if (kid.uri !== DeclaredNamespaces.BPMN || SchemaText.OPAQUE.has(kid.local)) {
          continue;
        }
        const kidType = schema.typeOf(kid.local, kid.uri, type);
        if (kidType) {
          visit(kid, kidType, here);
        }
      }
    };
    if (root.uri === DeclaredNamespaces.BPMN && root.local === 'definitions') {
      visit(root, 'bpmn:Definitions', undefined);
    }
    return out;
  }

  private attr(el: XElement, name: string): string | undefined {
    const attribute = el.attrs.find((candidate) => candidate.name === name);
    return attribute ? XmlTextReader.decode(attribute.raw) : undefined;
  }

  private text(source: string, el: XElement): string {
    return XmlTextReader.decode(source.slice(el.tagEnd, el.closeStart)).trim();
  }
}
