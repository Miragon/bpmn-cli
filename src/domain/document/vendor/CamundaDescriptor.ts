import type { El } from '../utils/moddle.js';
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

interface CamundaProperty {
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
    return attr.owners.some((owner) => this.elementIs(el, owner));
  }

  attrsFor(el: El | string): VendorAttr[] {
    return this.attrs().filter((attribute) => attribute.owners.some((owner) => this.elementIs(el, owner)));
  }

  /** [] when the type is unknown or only appears nested inside another vendor element */
  allowedParents(name: string): string[] {
    return this.type(name)?.allowedIn ?? [];
  }

  override allowedOn(name: string, el: El | string): boolean | undefined {
    const type = this.type(name);
    if (!type || !type.allowedIn.length) return undefined;
    return type.allowedIn.some((allowed) => allowed === '*' || (allowed.startsWith('bpmn:') && this.elementIs(el, allowed)));
  }

  /** The types that can hold `name`; a child slot typed with a super type accepts the subtype too. */
  override containersOf(name: string): string[] {
    const target = this.type(name);
    if (!target) return [];
    const { types, elements } = this.index() as CamundaIndex;
    const accepted = new Set<string>([target.type]);
    const addSupers = (key: string): void => {
      for (const sup of types.get(key)?.superClass ?? []) {
        const qualified = this.qualify(sup);
        if (!qualified.startsWith(`${this.prefix}:`)) continue;
        const superKey = this.typeKey(qualified);
        if (!accepted.has(superKey)) {
          accepted.add(superKey);
          addSupers(superKey);
        }
      }
    };
    addSupers(target.type);
    const out: string[] = [];
    for (const element of elements.values()) {
      if (element.properties.some((property) => !property.isAttr && !property.isReference && property.type.startsWith(`${this.prefix}:`) && accepted.has(this.typeKey(property.type)))) out.push(element.name);
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
    for (const element of this.index().elements.values()) {
      for (const property of element.properties) {
        if (property.isReference && property.isAttr) out.push({ element: element.name, attr: property.name, target: property.type });
      }
      for (const sup of element.bpmnSuperTypes) {
        let descriptor: { properties?: Array<{ name: string; type: string; isReference?: boolean; isAttr?: boolean }> } | undefined;
        try {
          descriptor = probe.getElementDescriptor(probe.getType(sup)) as typeof descriptor;
        } catch {
          descriptor = undefined;
        }
        for (const superProperty of descriptor?.properties ?? []) {
          if (!superProperty.isReference || !superProperty.isAttr) continue;
          if (!out.some((idRef) => idRef.element === element.name && idRef.attr === superProperty.name)) out.push({ element: element.name, attr: superProperty.name, target: superProperty.type.includes(':') ? superProperty.type : `bpmn:${superProperty.type}` });
        }
      }
    }
    this.idRefs = out;
    return out;
  }

  /**
   * Indexes the camunda types. A type's hosts also receive the properties of the types it
   * inherits from; every type that is not a pure mixin (no `extends`) is an extension element.
   */
  protected override buildIndex(): CamundaIndex {
    const prefix = this.prefix;
    const raw = CAMUNDA_DESCRIPTOR as unknown as { types: RawType[] };
    const types = new Map<string, RawType>();
    for (const rawType of raw.types) types.set(this.typeKey(rawType.name), rawType);

    const subTypes = new Map<string, string[]>();
    for (const [key, rawType] of types) {
      for (const sup of rawType.superClass ?? []) {
        const qualified = this.qualify(sup);
        if (!qualified.startsWith(`${prefix}:`)) continue;
        const superKey = this.typeKey(qualified);
        subTypes.set(superKey, [...(subTypes.get(superKey) ?? []), key]);
      }
    }

    const hosts = new Map<string, string[]>();
    const hostsOf = (key: string, seen: Set<string>): string[] => {
      const known = hosts.get(key);
      if (known) return known;
      if (seen.has(key)) return [];
      seen.add(key);
      const rawType = types.get(key);
      const out = new Set<string>();
      for (const ext of rawType?.extends ?? []) {
        const qualified = this.qualify(ext);
        if (qualified.startsWith('bpmn:')) out.add(qualified);
        else if (qualified.startsWith(`${prefix}:`)) for (const host of hostsOf(this.typeKey(qualified), seen)) out.add(host);
      }
      for (const sub of subTypes.get(key) ?? []) for (const host of hostsOf(sub, seen)) out.add(host);
      const list = [...out];
      hosts.set(key, list);
      return list;
    };
    for (const key of types.keys()) hostsOf(key, new Set());

    const attrs = new Map<string, VendorAttr>();
    for (const [key, rawType] of types) {
      const owners = hosts.get(key) ?? [];
      if (!owners.length) continue;
      for (const property of rawType.properties ?? []) {
        if (!property.isAttr) continue;
        const local = this.attrKey(property.name);
        const prev = attrs.get(local);
        if (prev) {
          for (const owner of owners) if (!prev.owners.includes(owner)) prev.owners.push(owner);
        } else {
          attrs.set(local, { name: `${prefix}:${local}`, type: property.type ?? 'String', owners: [...owners] });
        }
      }
    }

    const elements = new Map<string, CamundaElementType>();
    const propsOf = (key: string, seen: Set<string>): CamundaProperty[] => {
      if (seen.has(key)) return [];
      seen.add(key);
      const rawType = types.get(key);
      if (!rawType) return [];
      const inherited = (rawType.superClass ?? [])
        .map((superName) => this.qualify(superName))
        .filter((superName) => superName.startsWith(`${prefix}:`))
        .flatMap((superName) => propsOf(this.typeKey(superName), seen));
      const own = (rawType.properties ?? []).map((property) => ({
        name: this.attrKey(property.name),
        type: this.qualify(property.type ?? 'String'),
        isAttr: !!property.isAttr,
        isMany: !!property.isMany,
        isReference: !!property.isReference,
        isBody: !!property.isBody,
      }));
      const byName = new Map<string, CamundaProperty>();
      for (const property of [...inherited, ...own]) byName.set(property.name, property);
      return [...byName.values()];
    };
    for (const [key, rawType] of types) {
      const mixinOfBpmnElementAttributes = !!rawType.extends?.length;
      if (mixinOfBpmnElementAttributes) continue;
      const allowedIn: string[] = [];
      for (const allowed of ALLOWED_IN_OVERRIDES[key] ?? rawType.meta?.allowedIn ?? []) {
        const qualified = this.qualify(allowed);
        if (qualified === '*' || allowed === '*') allowedIn.push('*');
        else if (qualified.startsWith('bpmn:')) allowedIn.push(qualified);
        else {
          const allowedKey = this.typeKey(qualified);
          const allowedHosts = hosts.get(allowedKey) ?? [];
          if (allowedHosts.length) allowedIn.push(...allowedHosts);
          else allowedIn.push(this.xmlName(allowedKey));
        }
      }
      elements.set(key, {
        name: this.xmlName(key),
        type: key,
        allowedIn: [...new Set(allowedIn)],
        properties: propsOf(key, new Set()),
        bpmnSuperTypes: (rawType.superClass ?? []).map((superName) => this.qualify(superName)).filter((superName) => superName.startsWith('bpmn:')),
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
