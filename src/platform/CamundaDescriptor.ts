/**
 * The Camunda 7 descriptor (`camunda-bpmn-moddle`, resources/camunda.json,
 * inlined as camunda-descriptor.ts; see VendorDescriptor). It describes the
 * camunda namespace and Operaton's copy of it by local name.
 *
 *  - attr(name)                 -> { name, type, owners } for a camunda ATTRIBUTE of a
 *                                  BPMN element (owners = BPMN types that carry it, with
 *                                  camunda mixins such as AsyncCapable resolved), or undefined
 *  - attrAppliesTo(name, el)    -> true / false (undefined: not a known camunda attribute)
 *  - attrsFor(el)               -> the camunda attributes a BPMN element may carry
 *  - type(name)                 -> { name, type, allowedIn, properties, bpmnSuperTypes } of a
 *                                  camunda EXTENSION ELEMENT type (inputOutput, formField, ...)
 *  - allowedOn(name, el)        -> whether that extension element may sit in el's extensionElements
 *  - allowedParents(name)       -> where an extension element may appear: BPMN types (in
 *                                  bpmn:extensionElements), '*' (anywhere) or camunda element
 *                                  types (as a child, e.g. camunda:connector); [] = only nested
 *  - containersOf(name)         -> camunda element types that hold this one as a child
 *                                  (camunda:inputParameter -> camunda:inputOutput)
 *  - idReferenceAttrs()         -> id-valued attributes of camunda extension elements
 *                                  (camunda:errorEventDefinition@errorRef -> bpmn:Error)
 *
 * Two placement lists of the descriptor are corrected to what the engines
 * accept (ALLOWED_IN_OVERRIDES): camunda:executionListener and camunda:potentialStarter.
 */
import type { El } from '../model/utils/moddle.js';
import { CAMUNDA_DESCRIPTOR } from './camunda-descriptor.js';
import { VendorDescriptor, type RawType, type VendorAttr, type VendorElementType, type VendorIndex } from './VendorDescriptor.js';

export const CAMUNDA_URI = 'http://camunda.org/schema/1.0/bpmn';
/**
 * Operaton's own namespace. Its element and attribute types are the camunda
 * ones under another URI. Operaton 2.1 reads it first and falls back to the
 * camunda namespace; Camunda 7 and CIB seven ignore it (engine-checked).
 */
export const OPERATON_URI = 'http://operaton.org/schema/1.0/bpmn';
/** Namespaces whose content this descriptor describes, by local name (the Camunda 7 family). */
export const C7_URIS: ReadonlySet<string> = new Set([CAMUNDA_URI, OPERATON_URI]);

/** History time to live Camunda Modeler writes on new C7 processes (days). */
export const C7_DEFAULT_TTL = '180';
/** modeler:executionPlatformVersion written by `new --target camunda7` (the Modeler's current C7 default). */
export const C7_PLATFORM_VERSION = '7.24.0';

export interface CamundaProperty {
  name: string;
  /** prefixed type: primitive (String, Boolean, Integer), `camunda:<Type>` or `bpmn:<Type>` */
  type: string;
  isAttr: boolean;
  isMany: boolean;
  isReference: boolean;
  isBody: boolean;
}

/** A camunda extension element type (`camunda:inputOutput`). */
export interface CamundaElementType extends VendorElementType {
  /** own properties plus those inherited from camunda super types */
  properties: CamundaProperty[];
  /** BPMN super types (camunda:errorEventDefinition is a bpmn:ErrorEventDefinition) */
  bpmnSuperTypes: string[];
}

/** An id-valued attribute of a camunda extension element. */
export interface VendorIdRef {
  /** element type in XML spelling, e.g. `camunda:errorEventDefinition` */
  element: string;
  /** attribute name on that element, e.g. `errorRef` */
  attr: string;
  /** BPMN type of the referenced element, e.g. `bpmn:Error` */
  target: string;
}

/**
 * Corrections of `meta.allowedIn` where the descriptor is narrower than what
 * the engines (Camunda 7, CIB seven, Operaton) accept, so a lookup never
 * flags valid content: execution listeners work on every flow node, sequence
 * flow and process (the list lacks sendTask, transaction, adHocSubProcess);
 * potential starters (no allowedIn at all) belong to processes and start events.
 */
const ALLOWED_IN_OVERRIDES: Record<string, string[]> = {
  'camunda:ExecutionListener': ['bpmn:FlowNode', 'bpmn:SequenceFlow', 'bpmn:Process'],
  'camunda:PotentialStarter': ['bpmn:Process', 'bpmn:StartEvent'],
};

/**
 * Types that occur at most once in bpmn:extensionElements: a second one makes
 * Camunda 7.24, CIB seven 2.2 and Operaton 2.1 reject the deployment
 * (ENGINE-01009 "multiple elements with tag name ... found"); the engines
 * accept two camunda:properties, but the Camunda Modeler and the C7 model API
 * read only one, so merging them loses nothing.
 */
const SINGLES = ['camunda:inputOutput', 'camunda:formData', 'camunda:connector', 'camunda:failedJobRetryTimeCycle', 'camunda:properties'];

interface CamundaIndex extends VendorIndex<CamundaElementType> {
  /** key: `camunda:<Type>` */
  types: Map<string, RawType>;
}

export class CamundaDescriptor extends VendorDescriptor<CamundaElementType> {
  private idRefs: VendorIdRef[] | undefined;

  constructor() {
    super('camunda', CAMUNDA_URI, C7_URIS, SINGLES);
  }

  /**
   * Whether the camunda attribute may be written on `el` (an element or a BPMN
   * type name); undefined when `name` is not a known camunda attribute.
   */
  attrAppliesTo(name: string, el: El | string): boolean | undefined {
    const attr = this.attr(name);
    if (!attr) return undefined;
    return attr.owners.some((o) => this.elementIs(el, o));
  }

  /** The camunda attributes `el` (an element or a BPMN type name) may carry. */
  attrsFor(el: El | string): VendorAttr[] {
    return this.attrs().filter((a) => a.owners.some((o) => this.elementIs(el, o)));
  }

  /**
   * Where an extension element of type `name` may appear: BPMN types (inside
   * their bpmn:extensionElements; camunda mixins resolved, e.g.
   * camunda:connector -> bpmn:ServiceTask, bpmn:BusinessRuleTask, bpmn:SendTask,
   * bpmn:MessageEventDefinition), '*' (any element), or camunda element types in
   * XML spelling (as a child of that vendor element). [] = the type only appears
   * nested inside another vendor element (see containersOf) or is unknown.
   */
  allowedParents(name: string): string[] {
    return this.type(name)?.allowedIn ?? [];
  }

  /**
   * Whether an extension element of type `name` may sit in the extensionElements
   * of `el` (BPMN element or type name). undefined when `name` is not a camunda
   * element type or the descriptor says nothing about its placement.
   */
  override allowedOn(name: string, el: El | string): boolean | undefined {
    const t = this.type(name);
    if (!t || !t.allowedIn.length) return undefined;
    return t.allowedIn.some((a) => a === '*' || (a.startsWith('bpmn:') && this.elementIs(el, a)));
  }

  /** Camunda element types (XML spelling) that hold `name` as a child property (camunda:inputParameter -> camunda:inputOutput). */
  override containersOf(name: string): string[] {
    const target = this.type(name);
    if (!target) return [];
    const { types, elements } = this.index() as CamundaIndex;
    // a child slot typed with a super type accepts the subtype too (camunda:value in a list's items)
    const accepted = new Set<string>([target.type]);
    const addSupers = (key: string): void => {
      for (const sup of types.get(key)?.superClass ?? []) {
        const q = this.qualify(sup);
        if (!q.startsWith(`${this.prefix}:`)) continue;
        const k = this.typeKey(q);
        if (!accepted.has(k)) {
          accepted.add(k);
          addSupers(k);
        }
      }
    };
    addSupers(target.type);
    const out: string[] = [];
    for (const e of elements.values()) {
      if (e.properties.some((p) => !p.isAttr && !p.isReference && p.type.startsWith(`${this.prefix}:`) && accepted.has(this.typeKey(p.type)))) out.push(e.name);
    }
    return out;
  }

  /**
   * Id-valued attributes of camunda extension elements: attribute references
   * they declare or inherit from their BPMN super type (camunda:errorEventDefinition
   * extends bpmn:ErrorEventDefinition, so its `errorRef` names a bpmn:Error).
   * In a file these elements are generic, so the reference is a plain string
   * that has to be kept in sync by hand (rename, remove).
   */
  idReferenceAttrs(): VendorIdRef[] {
    if (this.idRefs) return this.idRefs;
    const out: VendorIdRef[] = [];
    const probe = VendorDescriptor.probe();
    for (const e of this.index().elements.values()) {
      for (const p of e.properties) {
        if (p.isReference && p.isAttr) out.push({ element: e.name, attr: p.name, target: p.type });
      }
      for (const sup of e.bpmnSuperTypes) {
        let descriptor: { properties?: Array<{ name: string; type: string; isReference?: boolean; isAttr?: boolean }> } | undefined;
        try {
          descriptor = probe.getElementDescriptor(probe.getType(sup)) as typeof descriptor;
        } catch {
          descriptor = undefined;
        }
        for (const p of descriptor?.properties ?? []) {
          if (!p.isReference || !p.isAttr) continue;
          if (!out.some((r) => r.element === e.name && r.attr === p.name)) out.push({ element: e.name, attr: p.name, target: p.type.includes(':') ? p.type : `bpmn:${p.type}` });
        }
      }
    }
    this.idRefs = out;
    return out;
  }

  protected override buildIndex(): CamundaIndex {
    const prefix = this.prefix;
    const raw = CAMUNDA_DESCRIPTOR as unknown as { types: RawType[] };
    const types = new Map<string, RawType>();
    for (const t of raw.types) types.set(this.typeKey(t.name), t);

    // camunda types that inherit from T (their hosts receive T's properties too)
    const subTypes = new Map<string, string[]>();
    for (const [key, t] of types) {
      for (const sup of t.superClass ?? []) {
        const q = this.qualify(sup);
        if (!q.startsWith(`${prefix}:`)) continue;
        const k = this.typeKey(q);
        subTypes.set(k, [...(subTypes.get(k) ?? []), key]);
      }
    }

    const hosts = new Map<string, string[]>();
    const hostsOf = (key: string, seen: Set<string>): string[] => {
      const known = hosts.get(key);
      if (known) return known;
      if (seen.has(key)) return [];
      seen.add(key);
      const t = types.get(key);
      const out = new Set<string>();
      for (const ext of t?.extends ?? []) {
        const q = this.qualify(ext);
        if (q.startsWith('bpmn:')) out.add(q);
        else if (q.startsWith(`${prefix}:`)) for (const h of hostsOf(this.typeKey(q), seen)) out.add(h);
      }
      for (const sub of subTypes.get(key) ?? []) for (const h of hostsOf(sub, seen)) out.add(h);
      const list = [...out];
      hosts.set(key, list);
      return list;
    };
    for (const key of types.keys()) hostsOf(key, new Set());

    // attributes of BPMN elements: properties of types that have hosts
    const attrs = new Map<string, VendorAttr>();
    for (const [key, t] of types) {
      const owners = hosts.get(key) ?? [];
      if (!owners.length) continue;
      for (const p of t.properties ?? []) {
        if (!p.isAttr) continue;
        const local = this.attrKey(p.name);
        const prev = attrs.get(local);
        if (prev) {
          for (const o of owners) if (!prev.owners.includes(o)) prev.owners.push(o);
        } else {
          attrs.set(local, { name: `${prefix}:${local}`, type: p.type ?? 'String', owners: [...owners] });
        }
      }
    }

    // extension element types: everything that is not a pure mixin (no `extends`)
    const elements = new Map<string, CamundaElementType>();
    const propsOf = (key: string, seen: Set<string>): CamundaProperty[] => {
      if (seen.has(key)) return [];
      seen.add(key);
      const t = types.get(key);
      if (!t) return [];
      const inherited = (t.superClass ?? [])
        .map((s) => this.qualify(s))
        .filter((s) => s.startsWith(`${prefix}:`))
        .flatMap((s) => propsOf(this.typeKey(s), seen));
      const own = (t.properties ?? []).map((p) => ({
        name: this.attrKey(p.name),
        type: this.qualify(p.type ?? 'String'),
        isAttr: !!p.isAttr,
        isMany: !!p.isMany,
        isReference: !!p.isReference,
        isBody: !!p.isBody,
      }));
      const byName = new Map<string, CamundaProperty>();
      for (const p of [...inherited, ...own]) byName.set(p.name, p);
      return [...byName.values()];
    };
    for (const [key, t] of types) {
      if (t.extends?.length) continue; // mixin: its properties are attributes of BPMN elements
      const allowedIn: string[] = [];
      for (const a of ALLOWED_IN_OVERRIDES[key] ?? t.meta?.allowedIn ?? []) {
        const q = this.qualify(a);
        if (q === '*' || a === '*') allowedIn.push('*');
        else if (q.startsWith('bpmn:')) allowedIn.push(q);
        else {
          const k = this.typeKey(q);
          const h = hosts.get(k) ?? [];
          if (h.length) allowedIn.push(...h);
          else allowedIn.push(this.xmlName(k));
        }
      }
      elements.set(key, {
        name: this.xmlName(key),
        type: key,
        allowedIn: [...new Set(allowedIn)],
        properties: propsOf(key, new Set()),
        bpmnSuperTypes: (t.superClass ?? []).map((s) => this.qualify(s)).filter((s) => s.startsWith('bpmn:')),
      });
    }
    return { types, attrs, elements };
  }

  private elementIs(el: El | string, superType: string): boolean {
    if (typeof el === 'string') return VendorDescriptor.typeIs(el, superType);
    return superType === '*' || (typeof el.$instanceOf === 'function' && el.$instanceOf(superType));
  }
}

export const CAMUNDA = new CamundaDescriptor();
