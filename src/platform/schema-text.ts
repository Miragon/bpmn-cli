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
import type { BpmnModdle } from 'bpmn-moddle';
import { BPMN_NS } from '../model.js';
import { decodeXml, elementChildren, readXmlText, XmlTextError, type XElement } from '../xmltext.js';

const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';

/** Children the schema keeps in one place (a choice) or bpmn-moddle orders differently from the XSD. */
const SAME_SLOT = [
  ['timeDate', 'timeDuration', 'timeCycle'],
  ['source', 'target'],
  ['supportedInterfaceRef', 'ioSpecification', 'ioBinding'],
  ['auditing', 'monitoring', 'categoryValueRef', 'dataState'],
  ['resourceRef', 'resourceParameterBinding', 'resourceAssignmentExpression'],
  ['dataOutputRefs', 'optionalOutputRefs', 'whileExecutingOutputRefs', 'inputSetRefs'],
  ['participantMultiplicity', 'endPointRef', 'endPointRefs'],
];

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

/** XML NCName (XML 1.0 fifth edition: no colon, no leading digit, . or -): what the schema's xsd:ID allows. */
const NCNAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
export const NCNAME = new RegExp(`^[${NCNAME_START}][${NCNAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, 'u');

export interface SchemaTextIssue {
  /** order: child order; idref: a reference to no id; id: an id that is no NCName (owner and value: the id) */
  kind: 'order' | 'idref' | 'id';
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

interface Descriptor {
  name: string;
  allTypes?: Array<{ name: string }>;
  properties: Array<{ name: string; type: string; isAttr?: boolean; isBody?: boolean; isVirtual?: boolean; isReference?: boolean }>;
}

interface Registry {
  typeMap: Record<string, unknown>;
  getEffectiveDescriptor(name: string): Descriptor;
}

class Schema {
  private readonly registry: Registry;
  private readonly bpmnTypes: string[];
  private readonly slots = new Map<string, Map<string, number>>();
  private readonly descriptors = new Map<string, Descriptor | undefined>();

  constructor(moddle: BpmnModdle) {
    this.registry = (moddle as unknown as { registry: Registry }).registry;
    this.bpmnTypes = Object.keys(this.registry.typeMap).filter((t) => t.startsWith('bpmn:'));
  }

  descriptor(type: string): Descriptor | undefined {
    if (!this.descriptors.has(type)) {
      let d: Descriptor | undefined;
      try {
        d = this.registry.typeMap[type] ? this.registry.getEffectiveDescriptor(type) : undefined;
      } catch {
        d = undefined;
      }
      this.descriptors.set(type, d);
    }
    return this.descriptors.get(type);
  }

  isA(type: string, base: string): boolean {
    return type === base || !!this.descriptor(type)?.allTypes?.some((a) => a.name === base);
  }

  /** The moddle type of a child element: its own type name, else the type of the parent's property of that name. */
  typeOf(local: string, uri: string, parentType: string | undefined): string | undefined {
    const prefix = uri === BPMN_NS ? 'bpmn' : uri === BPMNDI_NS ? 'bpmndi' : undefined;
    if (!prefix) return undefined;
    const own = `${prefix}:${local.charAt(0).toUpperCase()}${local.slice(1)}`;
    if (this.descriptor(own)) return own;
    const p = parentType ? this.descriptor(parentType)?.properties.find((x) => x.name === local) : undefined;
    return p && !p.isReference && this.descriptor(p.type) ? p.type : undefined;
  }

  /** child local name -> place in the type's sequence (-1: the name fits two places, not checked) */
  slotsOf(type: string): Map<string, number> {
    let out = this.slots.get(type);
    if (out) return out;
    out = new Map();
    const d = this.descriptor(type);
    d?.properties.forEach((p, i) => {
      if (p.isAttr || p.isBody || p.isVirtual) return;
      const names = new Set([p.name]);
      if (!p.isReference && p.type.startsWith('bpmn:')) {
        for (const t of this.bpmnTypes) if (this.isA(t, p.type)) names.add(t.charAt(5).toLowerCase() + t.slice(6));
      }
      if (!p.isReference && p.type.startsWith('bpmndi:')) names.add(p.type.slice('bpmndi:'.length));
      for (const n of names) out!.set(n, out!.has(n) && out!.get(n) !== i ? -1 : i);
    });
    for (const group of SAME_SLOT) {
      const at = group.map((n) => out!.get(n)).filter((s): s is number => s !== undefined && s >= 0);
      if (at.length < 2) continue;
      const first = Math.min(...at);
      for (const n of group) if ((out.get(n) ?? -1) >= 0) out.set(n, first);
    }
    this.slots.set(type, out);
    return out;
  }
}

function attr(el: XElement, name: string): string | undefined {
  const a = el.attrs.find((x) => x.name === name);
  return a ? decodeXml(a.raw) : undefined;
}

function text(doc: string, el: XElement): string {
  return decodeXml(doc.slice(el.tagEnd, el.closeStart)).trim();
}

/** Child order and IDREF issues of a file's text; [] when the text cannot be read (the model is then all there is). */
export function schemaTextIssues(xml: string, moddle: BpmnModdle): SchemaTextIssue[] {
  let root: XElement;
  try {
    root = readXmlText(xml).root;
  } catch (err) {
    if (err instanceof XmlTextError) return [];
    throw err;
  }
  const schema = new Schema(moddle);
  const ids = new Set<string>();
  const out: SchemaTextIssue[] = [];
  const collect = (el: XElement): void => {
    if (el.uri.startsWith('http://www.omg.org/spec/')) {
      const id = attr(el, 'id');
      if (id !== undefined) {
        ids.add(id.trim());
        // xsd:ID collapses white space around the value
        if (!NCNAME.test(id.trim())) out.push({ kind: 'id', owner: id.trim(), element: el.local, value: id.trim() });
      }
    }
    for (const c of elementChildren(el)) collect(c);
  };
  collect(root);

  const visit = (el: XElement, type: string, owner: string | undefined): void => {
    const here = attr(el, 'id') ?? owner;
    // IDREFs
    for (const [base, names] of IDREF_ATTRS) {
      if (!schema.isA(type, base)) continue;
      for (const n of names) {
        const v = attr(el, n)?.trim();
        if (v && !ids.has(v)) out.push({ kind: 'idref', owner: here, element: el.local, ref: n, value: v, attribute: true });
      }
    }
    const kids = elementChildren(el);
    for (const [base, names] of IDREF_CHILDREN) {
      if (!schema.isA(type, base)) continue;
      for (const k of kids) {
        if (k.uri !== BPMN_NS || !names.includes(k.local)) continue;
        const v = text(xml, k);
        if (v && !ids.has(v)) out.push({ kind: 'idref', owner: here, element: el.local, ref: k.local, value: v });
      }
    }
    // child order
    const slots = schema.slotsOf(type);
    let last = -1;
    let lastName = '';
    for (const k of kids) {
      if (k.uri !== BPMN_NS && k.uri !== BPMNDI_NS) continue;
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
      if (k.uri !== BPMN_NS || OPAQUE.has(k.local)) continue;
      const t = schema.typeOf(k.local, k.uri, type);
      if (t) visit(k, t, here);
    }
  };
  if (root.uri === BPMN_NS && root.local === 'definitions') visit(root, 'bpmn:Definitions', undefined);
  return out;
}
