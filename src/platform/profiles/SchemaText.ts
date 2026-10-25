import type { BpmnModdle } from 'bpmn-moddle';
import type { XElement } from '../../xml/utils/text-reader.js';
import { BpmnSchema, BPMNDI_NS } from './BpmnSchema.js';
import type { RuleKit } from './rule-kit.js';

const OPAQUE = new Set(['extensionElements', 'documentation']);

const IDREF_ATTRS: Array<[string, string[]]> = [
  ['bpmn:Activity', ['default']],
  ['bpmn:ExclusiveGateway', ['default']],
  ['bpmn:InclusiveGateway', ['default']],
  ['bpmn:ComplexGateway', ['default']],
  ['bpmn:DataObjectReference', ['dataObjectRef']],
  ['bpmn:InputOutputBinding', ['inputDataRef', 'outputDataRef']],
];

const IDREF_CHILDREN: Array<[string, string[]]> = [
  ['bpmn:Lane', ['flowNodeRef']],
  ['bpmn:DataAssociation', ['sourceRef', 'targetRef']],
  ['bpmn:InputSet', ['dataInputRefs', 'optionalInputRefs', 'whileExecutingInputRefs', 'outputSetRefs']],
  ['bpmn:OutputSet', ['dataOutputRefs', 'optionalOutputRefs', 'whileExecutingOutputRefs', 'inputSetRefs']],
];

const XSD_BOOLEAN = /^[ \t\r\n]*(?:true|false|1|0)[ \t\r\n]*$/;

/** XML 1.0 fifth edition: what the schema's xsd:ID allows. */
const NCNAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
export const NCNAME = new RegExp(`^[${NCNAME_START}][${NCNAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, 'u');

export interface SchemaTextIssue {
  kind: 'order' | 'idref' | 'id' | 'boolean';
  /** the nearest element with an id, as written */
  owner: string | undefined;
  element: string;
  /** order: the child that comes too late */
  child?: string;
  before?: string;
  ref?: string;
  value?: string;
  attribute?: boolean;
}

/**
 * BPMN schema rules the model cannot see, read from a file's text: child order, dangling
 * IDREFs, ids that are no NCName, bad xsd:booleans. bpmn-moddle hides them on import,
 * but an engine that validates against the XSD refuses them (Camunda 8.9, engine-checked).
 */
export class SchemaText {
  constructor(private readonly kit: RuleKit) {}

  /** [] when the text cannot be read: the model is then all there is. */
  issues(xml: string, moddle: BpmnModdle): SchemaTextIssue[] {
    let root: XElement;
    try {
      root = this.kit.readXmlText(xml).root;
    } catch (err) {
      if (err instanceof this.kit.XmlTextError) return [];
      throw err;
    }
    const schema = new BpmnSchema(moddle, this.kit.BPMN_NS);
    const ids = new Set<string>();
    const out: SchemaTextIssue[] = [];
    const collect = (el: XElement, owner: string | undefined): void => {
      let here = owner;
      if (el.uri.startsWith('http://www.omg.org/spec/')) {
        const id = this.attr(el, 'id');
        if (id !== undefined) {
          ids.add(id.trim());
          if (!NCNAME.test(id.trim())) out.push({ kind: 'id', owner: id.trim(), element: el.local, value: id.trim() });
          here = id.trim();
        }
        // bpmn-moddle reads any other xsd:boolean value as false
        const type = schema.typeOf(el.local, el.uri, undefined);
        const booleans = type ? schema.booleanAttrs(type) : undefined;
        for (const a of booleans?.size ? el.attrs : []) {
          if (!booleans!.has(a.name)) continue;
          const v = this.kit.decodeXml(a.raw);
          // a diagram element's issue is its BPMN element's
          if (!XSD_BOOLEAN.test(v)) out.push({ kind: 'boolean', owner: el.uri === this.kit.BPMN_NS ? here : (this.attr(el, 'bpmnElement')?.trim() ?? owner), element: el.local, ref: a.name, value: v, attribute: true });
        }
      }
      for (const c of this.kit.elementChildren(el)) collect(c, here);
    };
    collect(root, undefined);

    const visit = (el: XElement, type: string, owner: string | undefined): void => {
      const here = this.attr(el, 'id') ?? owner;
      for (const [base, names] of IDREF_ATTRS) {
        if (!schema.isA(type, base)) continue;
        for (const n of names) {
          const v = this.attr(el, n)?.trim();
          if (v && !ids.has(v)) out.push({ kind: 'idref', owner: here, element: el.local, ref: n, value: v, attribute: true });
        }
      }
      const kids = this.kit.elementChildren(el);
      for (const [base, names] of IDREF_CHILDREN) {
        if (!schema.isA(type, base)) continue;
        for (const k of kids) {
          if (k.uri !== this.kit.BPMN_NS || !names.includes(k.local)) continue;
          const v = this.text(xml, k);
          if (v && !ids.has(v)) out.push({ kind: 'idref', owner: here, element: el.local, ref: k.local, value: v });
        }
      }
      const slots = schema.slotsOf(type);
      let last = -1;
      let lastName = '';
      for (const k of kids) {
        if (k.uri !== this.kit.BPMN_NS && k.uri !== BPMNDI_NS) continue;
        const s = slots.get(k.local);
        if (s === undefined || s < 0) continue;
        if (s < last) {
          out.push({ kind: 'order', owner: here, element: el.local, child: k.local, before: lastName });
          break;
        }
        if (s > last) {
          last = s;
          lastName = k.local;
        }
      }
      for (const k of kids) {
        if (k.uri !== this.kit.BPMN_NS || OPAQUE.has(k.local)) continue;
        const t = schema.typeOf(k.local, k.uri, type);
        if (t) visit(k, t, here);
      }
    };
    if (root.uri === this.kit.BPMN_NS && root.local === 'definitions') visit(root, 'bpmn:Definitions', undefined);
    return out;
  }

  private attr(el: XElement, name: string): string | undefined {
    const a = el.attrs.find((x) => x.name === name);
    return a ? this.kit.decodeXml(a.raw) : undefined;
  }

  private text(doc: string, el: XElement): string {
    return this.kit.decodeXml(doc.slice(el.tagEnd, el.closeStart)).trim();
  }
}
