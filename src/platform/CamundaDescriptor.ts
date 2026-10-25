import type { El } from '../model/utils/moddle.js';
import { CAMUNDA_DESCRIPTOR } from './camunda-descriptor.js';
import { VendorDescriptor, type RawType, type VendorAttr, type VendorElementType, type VendorIndex } from './VendorDescriptor.js';

export const CAMUNDA_URI = 'http://camunda.org/schema/1.0/bpmn';
/**
 * The camunda types under another URI. Operaton 2.1 reads it first and falls back to camunda;
 * Camunda 7 and CIB seven ignore it (engine-checked).
 */
export const OPERATON_URI = 'http://operaton.org/schema/1.0/bpmn';
export const C7_URIS: ReadonlySet<string> = new Set([CAMUNDA_URI, OPERATON_URI]);

/** Days, as Camunda Modeler writes on new C7 processes. */
export const C7_DEFAULT_TTL = '180';
/** The Modeler's current C7 default. */
export const C7_PLATFORM_VERSION = '7.24.0';

export interface CamundaProperty {
  name: string;
  type: string;
  isAttr: boolean;
  isMany: boolean;
  isReference: boolean;
  isBody: boolean;
}

export interface CamundaElementType extends VendorElementType {
  /** including those inherited from camunda super types */
  properties: CamundaProperty[];
  bpmnSuperTypes: string[];
}

export interface VendorIdRef {
  element: string;
  attr: string;
  target: string;
}

/**
 * Where the descriptor's `meta.allowedIn` is narrower than what the C7 engines accept:
 * it lacks sendTask, transaction and adHocSubProcess for listeners, and has none for starters.
 */
const ALLOWED_IN_OVERRIDES: Record<string, string[]> = {
  'camunda:ExecutionListener': ['bpmn:FlowNode', 'bpmn:SequenceFlow', 'bpmn:Process'],
  'camunda:PotentialStarter': ['bpmn:Process', 'bpmn:StartEvent'],
};

/**
 * A second one fails the deployment (ENGINE-01009). Two camunda:properties deploy,
 * but the Modeler and the C7 model API read only one, so merging them loses nothing.
 */
const SINGLES = ['camunda:inputOutput', 'camunda:formData', 'camunda:connector', 'camunda:failedJobRetryTimeCycle', 'camunda:properties'];

interface CamundaIndex extends VendorIndex<CamundaElementType> {
  types: Map<string, RawType>;
}

/**
 * The Camunda 7 descriptor (camunda-bpmn-moddle), describing the camunda namespace
 * and Operaton's copy of it by local name.
 */
export class CamundaDescriptor extends VendorDescriptor<CamundaElementType> {
  private idRefs: VendorIdRef[] | undefined;

  constructor() {
    super('camunda', CAMUNDA_URI, C7_URIS, SINGLES);
  }

  /** undefined when `name` is not a known camunda attribute */
  attrAppliesTo(name: string, el: El | string): boolean | undefined {
    const attr = this.attr(name);
    if (!attr) return undefined;
    return attr.owners.some((o) => this.elementIs(el, o));
  }

  attrsFor(el: El | string): VendorAttr[] {
    return this.attrs().filter((a) => a.owners.some((o) => this.elementIs(el, o)));
  }

  /** [] when the type is unknown or only appears nested inside another vendor element */
  allowedParents(name: string): string[] {
    return this.type(name)?.allowedIn ?? [];
  }

  override allowedOn(name: string, el: El | string): boolean | undefined {
    const t = this.type(name);
    if (!t || !t.allowedIn.length) return undefined;
    return t.allowedIn.some((a) => a === '*' || (a.startsWith('bpmn:') && this.elementIs(el, a)));
  }

  override containersOf(name: string): string[] {
    const target = this.type(name);
    if (!target) return [];
    const { types, elements } = this.index() as CamundaIndex;
    // a child slot typed with a super type accepts the subtype too
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
   * These elements are generic in a file, so a reference such as the `errorRef` of
   * camunda:errorEventDefinition is a plain string that rename and remove keep in sync by hand.
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
