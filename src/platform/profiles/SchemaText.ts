import type { BpmnModdle } from 'bpmn-moddle';
import type { XElement } from '../../xml/utils/text-reader.js';
import { BpmnSchema, BPMNDI_NS } from './BpmnSchema.js';
import type { RuleKit } from './rule-kit.js';

/** Children with any content (not checked inside). */
const OPAQUE = new Set(['extensionElements', 'documentation']);

/** IDREF attributes (XSD xsd:IDREF) by the type that holds them. */
const IDREF_ATTRS: Array<[string, string[]]> = [
  ['bpmn:Activity', ['default']],
  ['bpmn:ExclusiveGateway', ['default']],
  ['bpmn:InclusiveGateway', ['default']],
  ['bpmn:ComplexGateway', ['default']],
  ['bpmn:DataObjectReference', ['dataObjectRef']],
  ['bpmn:InputOutputBinding', ['inputDataRef', 'outputDataRef']],
];

/** Child elements whose text is an IDREF. */
const IDREF_CHILDREN: Array<[string, string[]]> = [
  ['bpmn:Lane', ['flowNodeRef']],
  ['bpmn:DataAssociation', ['sourceRef', 'targetRef']],
  ['bpmn:InputSet', ['dataInputRefs', 'optionalInputRefs', 'whileExecutingInputRefs', 'outputSetRefs']],
  ['bpmn:OutputSet', ['dataOutputRefs', 'optionalOutputRefs', 'whileExecutingOutputRefs', 'inputSetRefs']],
];

/** xsd:boolean: true, false, 1 or 0, white space around it collapsed (not TRUE, yes, maybe). */
const XSD_BOOLEAN = /^[ \t\r\n]*(?:true|false|1|0)[ \t\r\n]*$/;

/** XML NCName (XML 1.0 fifth edition: no colon, no leading digit, . or -): what the schema's xsd:ID allows. */
const NCNAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
export const NCNAME = new RegExp(`^[${NCNAME_START}][${NCNAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, 'u');

export interface SchemaTextIssue {
  /** order: child order; idref: a reference to no id; id: an id that is no NCName (owner and value: the id); boolean: an xsd:boolean attribute of another value (ref: the attribute) */
  kind: 'order' | 'idref' | 'id' | 'boolean';
  /** id of the element the issue is in (the nearest one with an id), as written */
  owner: string | undefined;
  /** local name of the element whose children / attribute it is (`serviceTask`, `lane`) */
  element: string;
  /** order: the child that comes too late, and the child it should come before */
  child?: string;
  before?: string;
  /** idref: the attribute or child element and the id it names */
  ref?: string;
  value?: string;
  /** idref: `ref` is an attribute (default="...") rather than a child element (<flowNodeRef>) */
  attribute?: boolean;
}

/**
 * BPMN schema rules the model cannot see, read from a file's text: the order
 * of child elements (the BPMN XSD's sequences), IDREF values that name no
 * id of the file and ids that are no NCName. bpmn-moddle reads children in
 * any order, drops an unresolved IDREF and an element whose id it cannot
 * read (import warnings), so the model never shows them; an engine that
 * validates the file against the schema refuses them (Camunda 8.9:
 * cvc-complex-type.2.4.a, cvc-id.1, cvc-datatype-valid, engine-checked).
 *
 * The child order comes from bpmn-moddle's descriptor (its property order
 * is the XSD's sequence order, inherited properties first); where the two
 * differ, or the XSD has a choice, the names count as one place (SAME_SLOT,
 * from a comparison with the BPMN 2.0 Semantic.xsd), so the check never
 * reports an order the schema allows. A sequence flow's sourceRef /
 * targetRef is left to the structural check (E_DANGLING_REF).
 */
export class SchemaText {
  constructor(private readonly kit: RuleKit) {}

  /** Child order and IDREF issues of a file's text; [] when the text cannot be read (the model is then all there is). */
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
          // xsd:ID collapses white space around the value
          if (!NCNAME.test(id.trim())) out.push({ kind: 'id', owner: id.trim(), element: el.local, value: id.trim() });
          here = id.trim();
        }
        // xsd:boolean attributes (cancelActivity, isInterrupting, isExecutable, isExpanded, ...): bpmn-moddle reads any other value as false
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
      // IDREFs
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
      // child order
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
