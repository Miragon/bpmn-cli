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

interface SchemaScan {
  xml: string;
  schema: BpmnSchema;
  ids: Set<string>;
  found: SchemaTextIssue[];
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
    const root = SchemaText.rootOf(xml);
    if (!root) {
      return [];
    }
    const scan: SchemaScan = { xml, schema: new BpmnSchema(moddle, DeclaredNamespaces.BPMN), ids: new Set<string>(), found: [] };
    this.collect(root, undefined, scan);
    if (root.uri === DeclaredNamespaces.BPMN && root.local === 'definitions') {
      this.visit(root, 'bpmn:Definitions', undefined, scan);
    }
    return scan.found;
  }

  private static rootOf(xml: string): XElement | undefined {
    try {
      return XmlTextReader.read(xml).root;
    } catch (err) {
      if (err instanceof Error && err.name === 'XmlTextError') {
        return undefined;
      }
      throw err;
    }
  }

  private collect(el: XElement, owner: string | undefined, scan: SchemaScan): void {
    const here = el.uri.startsWith('http://www.omg.org/spec/') ? this.collectSpecElement(el, owner, scan) : owner;
    for (const child of XmlTextReader.elementChildren(el)) {
      this.collect(child, here, scan);
    }
  }

  private collectSpecElement(el: XElement, owner: string | undefined, scan: SchemaScan): string | undefined {
    const id = SchemaText.attr(el, 'id')?.trim();
    if (id !== undefined) {
      scan.ids.add(id);
      if (!SchemaText.NCNAME.test(id)) {
        scan.found.push({ kind: 'id', owner: id, element: el.local, value: id });
      }
    }
    const here = id ?? owner;
    const type = scan.schema.typeOf(el.local, el.uri, undefined);
    const booleans = type ? scan.schema.booleanAttrs(type) : undefined;
    for (const attribute of el.attrs.filter(({ name }) => booleans?.has(name))) {
      const decoded = XmlTextReader.decode(attribute.raw);
      if (!SchemaText.XSD_BOOLEAN.test(decoded)) {
        scan.found.push({ kind: 'boolean', owner: el.uri === DeclaredNamespaces.BPMN ? here : (SchemaText.attr(el, 'bpmnElement')?.trim() ?? owner), element: el.local, ref: attribute.name, value: decoded, attribute: true });
      }
    }
    return here;
  }

  private visit(el: XElement, type: string, owner: string | undefined, scan: SchemaScan): void {
    const here = SchemaText.attr(el, 'id') ?? owner;
    const kids = XmlTextReader.elementChildren(el);
    this.checkIdrefAttrs(el, type, here, scan);
    this.checkIdrefChildren(el, type, here, kids, scan);
    SchemaText.checkChildOrder(el, type, here, kids, scan);
    for (const kid of kids) {
      if (kid.uri !== DeclaredNamespaces.BPMN || SchemaText.OPAQUE.has(kid.local)) {
        continue;
      }
      const kidType = scan.schema.typeOf(kid.local, kid.uri, type);
      if (kidType) {
        this.visit(kid, kidType, here, scan);
      }
    }
  }

  private checkIdrefAttrs(el: XElement, type: string, here: string | undefined, { schema, ids, found }: SchemaScan): void {
    for (const [, names] of SchemaText.IDREF_ATTRS.filter(([base]) => schema.isA(type, base))) {
      for (const attrName of names) {
        const idref = SchemaText.attr(el, attrName)?.trim();
        if (idref && !ids.has(idref)) {
          found.push({ kind: 'idref', owner: here, element: el.local, ref: attrName, value: idref, attribute: true });
        }
      }
    }
  }

  private checkIdrefChildren(el: XElement, type: string, here: string | undefined, kids: XElement[], { xml, schema, ids, found }: SchemaScan): void {
    for (const [, names] of SchemaText.IDREF_CHILDREN.filter(([base]) => schema.isA(type, base))) {
      for (const kid of kids.filter(({ uri, local }) => uri === DeclaredNamespaces.BPMN && names.includes(local))) {
        const idref = SchemaText.text(xml, kid);
        if (idref && !ids.has(idref)) {
          found.push({ kind: 'idref', owner: here, element: el.local, ref: kid.local, value: idref });
        }
      }
    }
  }

  private static checkChildOrder(el: XElement, type: string, here: string | undefined, kids: XElement[], { schema, found }: SchemaScan): void {
    const slots = schema.slotsOf(type);
    let last = -1;
    let lastName = '';
    for (const kid of kids) {
      const slot = kid.uri === DeclaredNamespaces.BPMN || kid.uri === BpmnSchema.BPMNDI_NS ? slots.get(kid.local) : undefined;
      if (slot === undefined || slot < 0) {
        continue;
      }
      if (slot < last) {
        found.push({ kind: 'order', owner: here, element: el.local, child: kid.local, before: lastName });
        return;
      }
      if (slot > last) {
        last = slot;
        lastName = kid.local;
      }
    }
  }

  private static attr(el: XElement, name: string): string | undefined {
    const attribute = el.attrs.find((candidate) => candidate.name === name);
    return attribute ? XmlTextReader.decode(attribute.raw) : undefined;
  }

  private static text(source: string, el: XElement): string {
    return XmlTextReader.decode(source.slice(el.tagEnd, el.closeStart)).trim();
  }
}
