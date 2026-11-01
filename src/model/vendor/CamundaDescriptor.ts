import type { BpmnElement } from '../document/BpmnElement.js';
import { CamundaSchema } from './CamundaSchema.js';
import { VendorDescriptor, type RawType, type VendorAttr, type VendorElementType, type VendorIndex } from './VendorDescriptor.js';

interface CamundaProperty {
  name: string;
  type: string;
  isAttr: boolean;
  isMany: boolean;
  isReference: boolean;
  isBody: boolean;
}

export interface CamundaElementType extends VendorElementType {
  properties: CamundaProperty[];
  bpmnSuperTypes: string[];
}

export interface VendorIdRef {
  element: string;
  attr: string;
  target: string;
}

const ALLOWED_IN_OVERRIDES: Record<string, string[]> = {
  'camunda:ExecutionListener': ['bpmn:FlowNode', 'bpmn:SequenceFlow', 'bpmn:Process'],
  'camunda:PotentialStarter': ['bpmn:Process', 'bpmn:StartEvent'],
};

const SINGLES = ['camunda:inputOutput', 'camunda:formData', 'camunda:connector', 'camunda:failedJobRetryTimeCycle', 'camunda:properties'];

interface RawDescriptorProperty {
  name: string;
  type: string;
  isReference?: boolean;
  isAttr?: boolean;
}

interface CamundaIndex extends VendorIndex<CamundaElementType> {
  types: Map<string, RawType>;
}

export class CamundaDescriptor extends VendorDescriptor<CamundaElementType> {
  static readonly URI = 'http://camunda.org/schema/1.0/bpmn';
  static readonly OPERATON_URI = 'http://operaton.org/schema/1.0/bpmn';
  static readonly C7_URIS: ReadonlySet<string> = new Set([CamundaDescriptor.URI, CamundaDescriptor.OPERATON_URI]);
  static readonly DEFAULT_TTL = '180';
  static readonly PLATFORM_VERSION = '7.24.0';

  private idRefs: VendorIdRef[] | undefined;

  constructor() {
    super('camunda', CamundaDescriptor.URI, CamundaDescriptor.C7_URIS, SINGLES);
  }

  attrAppliesTo(name: string, element: BpmnElement | string): boolean | undefined {
    const attr = this.attr(name);
    if (!attr) {
      return undefined;
    }
    return attr.owners.some((owner) => this.elementIs(element, owner));
  }

  attrsFor(element: BpmnElement | string): VendorAttr[] {
    return this.attrs().filter((attribute) => attribute.owners.some((owner) => this.elementIs(element, owner)));
  }

  allowedParents(name: string): string[] {
    return this.type(name)?.allowedIn ?? [];
  }

  override allowedOn(name: string, element: BpmnElement | string): boolean | undefined {
    const type = this.type(name);
    if (!type || !type.allowedIn.length) {
      return undefined;
    }
    return type.allowedIn.some((allowed) => allowed === '*' || (allowed.startsWith('bpmn:') && this.elementIs(element, allowed)));
  }

  override containersOf(name: string): string[] {
    const target = this.type(name);
    if (!target) {
      return [];
    }
    const { types, elements } = this.index() as CamundaIndex;
    const accepted = new Set<string>([target.type]);
    const addSupers = (key: string): void => {
      for (const sup of types.get(key)?.superClass ?? []) {
        const qualified = this.qualify(sup);
        if (!qualified.startsWith(`${this.prefix}:`)) {
          continue;
        }
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
      if (element.properties.some((property) => !property.isAttr && !property.isReference && property.type.startsWith(`${this.prefix}:`) && accepted.has(this.typeKey(property.type)))) {
        out.push(element.name);
      }
    }
    return out;
  }

  idReferenceAttrs(): VendorIdRef[] {
    if (!this.idRefs) {
      this.idRefs = [...this.index().elements.values()].flatMap((element) => this.idRefsOf(element));
    }
    return this.idRefs;
  }

  private idRefsOf(element: CamundaElementType): VendorIdRef[] {
    const own = element.properties.filter((property) => property.isReference && property.isAttr).map((property) => ({ element: element.name, attr: property.name, target: property.type }));
    const refs = [...own];
    for (const inherited of element.bpmnSuperTypes.flatMap((superType) => CamundaDescriptor.bpmnProperties(superType))) {
      if (inherited.isReference && inherited.isAttr && !refs.some((ref) => ref.attr === inherited.name)) {
        refs.push({ element: element.name, attr: inherited.name, target: inherited.type.includes(':') ? inherited.type : `bpmn:${inherited.type}` });
      }
    }
    return refs;
  }

  private static bpmnProperties(superType: string): RawDescriptorProperty[] {
    const probe = VendorDescriptor.probe();
    try {
      return (probe.getElementDescriptor(probe.getType(superType)) as { properties?: RawDescriptorProperty[] }).properties ?? [];
    } catch {
      return [];
    }
  }

  protected override buildIndex(): CamundaIndex {
    const types = new Map<string, RawType>((CamundaSchema.DESCRIPTOR as unknown as { types: RawType[] }).types.map((rawType) => [this.typeKey(rawType.name), rawType]));
    const hosts = this.hostsOf(types);
    return { types, attrs: this.attrsOf(types, hosts), elements: this.elementsOf(types, hosts) };
  }

  private qualifiedSupers(rawType: RawType | undefined, prefix: string): string[] {
    return (rawType?.superClass ?? []).map((superName) => this.qualify(superName)).filter((superName) => superName.startsWith(prefix));
  }

  private subTypesOf(types: Map<string, RawType>): Map<string, string[]> {
    const subTypes = new Map<string, string[]>();
    for (const [key, rawType] of types) {
      for (const qualified of this.qualifiedSupers(rawType, `${this.prefix}:`)) {
        const superKey = this.typeKey(qualified);
        subTypes.set(superKey, [...(subTypes.get(superKey) ?? []), key]);
      }
    }
    return subTypes;
  }

  private hostsOf(types: Map<string, RawType>): Map<string, string[]> {
    const subTypes = this.subTypesOf(types);
    const hosts = new Map<string, string[]>();
    const collect = (key: string, seen: Set<string>): string[] => {
      if (hosts.has(key) || seen.has(key)) {
        return hosts.get(key) ?? [];
      }
      seen.add(key);
      const extended = (types.get(key)?.extends ?? []).map((name) => this.qualify(name));
      const direct = extended.filter((name) => name.startsWith('bpmn:'));
      const inherited = extended.filter((name) => name.startsWith(`${this.prefix}:`)).map((name) => this.typeKey(name));
      const found = [...direct, ...[...inherited, ...(subTypes.get(key) ?? [])].flatMap((other) => collect(other, seen))];
      hosts.set(key, [...new Set(found)]);
      return hosts.get(key)!;
    };
    for (const key of types.keys()) {
      collect(key, new Set());
    }
    return hosts;
  }

  private attrsOf(types: Map<string, RawType>, hosts: Map<string, string[]>): Map<string, VendorAttr> {
    const attrs = new Map<string, VendorAttr>();
    for (const [key, rawType] of types) {
      const owners = hosts.get(key) ?? [];
      const attributes = owners.length ? (rawType.properties ?? []).filter((property) => property.isAttr) : [];
      for (const property of attributes) {
        const local = this.attrKey(property.name);
        const known = attrs.get(local);
        if (known) {
          known.owners.push(...owners.filter((owner) => !known.owners.includes(owner)));
        } else {
          attrs.set(local, { name: `${this.prefix}:${local}`, type: property.type ?? 'String', owners: [...owners] });
        }
      }
    }
    return attrs;
  }

  private propertiesOf(types: Map<string, RawType>, key: string, seen: Set<string>): CamundaProperty[] {
    const rawType = this.firstVisit(types, key, seen);
    if (!rawType) {
      return [];
    }
    const inherited = this.qualifiedSupers(rawType, `${this.prefix}:`).flatMap((superName) => this.propertiesOf(types, this.typeKey(superName), seen));
    const own = (rawType.properties ?? []).map((property) => ({
      name: this.attrKey(property.name),
      type: this.qualify(property.type ?? 'String'),
      isAttr: !!property.isAttr,
      isMany: !!property.isMany,
      isReference: !!property.isReference,
      isBody: !!property.isBody,
    }));
    return [...new Map([...inherited, ...own].map((property) => [property.name, property])).values()];
  }

  private allowedInOf(key: string, rawType: RawType, hosts: Map<string, string[]>): string[] {
    const allowedIn = (ALLOWED_IN_OVERRIDES[key] ?? rawType.meta?.allowedIn ?? []).flatMap((allowed) => {
      const qualified = this.qualify(allowed);
      if (qualified === '*' || allowed === '*') {
        return ['*'];
      }
      if (qualified.startsWith('bpmn:')) {
        return [qualified];
      }
      const allowedKey = this.typeKey(qualified);
      const allowedHosts = hosts.get(allowedKey) ?? [];
      return allowedHosts.length ? allowedHosts : [this.xmlName(allowedKey)];
    });
    return [...new Set(allowedIn)];
  }

  private elementsOf(types: Map<string, RawType>, hosts: Map<string, string[]>): Map<string, CamundaElementType> {
    const elements = new Map<string, CamundaElementType>();
    for (const [key, rawType] of types) {
      if (!rawType.extends?.length) {
        elements.set(key, {
          name: this.xmlName(key),
          type: key,
          allowedIn: this.allowedInOf(key, rawType, hosts),
          properties: this.propertiesOf(types, key, new Set()),
          bpmnSuperTypes: this.qualifiedSupers(rawType, 'bpmn:'),
        });
      }
    }
    return elements;
  }

  private elementIs(element: BpmnElement | string, superType: string): boolean {
    if (typeof element === 'string') {
      return VendorDescriptor.typeIs(element, superType);
    }
    return superType === '*' || element.is(superType);
  }
}

export const CAMUNDA = new CamundaDescriptor();
