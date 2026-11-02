import type { BpmnElement } from '../document/BpmnElement.js';
import { VendorDescriptor, type RawType, type VendorAttr, type VendorElementType, type VendorIndex } from './VendorDescriptor.js';
import { ZeebeSchema } from './ZeebeSchema.js';

interface ZeebeProperty {
  name: string;
  type: string;
  isAttr: boolean;
  isMany: boolean;
  isBody: boolean;
}

interface MixinTables {
  mixinAttrs: Map<string, ZeebeProperty[]>;
  hostsOfMixin: Map<string, string[]>;
  attrs: Map<string, VendorAttr>;
}

export interface ZeebeElementType extends VendorElementType {
  attributes: ZeebeProperty[];
  children: string[];
  body: boolean;
}

const EXTRA_TYPES: RawType[] = [
  {
    name: 'PublishMessage',
    superClass: ['Element'],
    properties: [
      { name: 'correlationKey', isAttr: true, type: 'String' },
      { name: 'messageId', isAttr: true, type: 'String' },
      { name: 'timeToLive', isAttr: true, type: 'String' },
    ],
    meta: { allowedIn: ['bpmn:SendTask', 'bpmn:MessageEventDefinition'] },
  },
];

const ALLOWED_IN_OVERRIDES: Record<string, string[]> = {
  'zeebe:Subscription': ['bpmn:Message'],
  'zeebe:Properties': ['*'],
};

const SINGLES = [
  'zeebe:ioMapping',
  'zeebe:taskHeaders',
  'zeebe:properties',
  'zeebe:taskDefinition',
  'zeebe:formDefinition',
  'zeebe:assignmentDefinition',
  'zeebe:priorityDefinition',
  'zeebe:taskSchedule',
  'zeebe:calledElement',
  'zeebe:calledDecision',
  'zeebe:loopCharacteristics',
  'zeebe:subscription',
  'zeebe:script',
  'zeebe:userTask',
  'zeebe:versionTag',
  'zeebe:executionListeners',
  'zeebe:taskListeners',
  'zeebe:linkedResources',
  'zeebe:adHoc',
  'zeebe:conditionalFilter',
  'zeebe:publishMessage',
];

export class ZeebeDescriptor extends VendorDescriptor<ZeebeElementType> {
  static readonly URI = 'http://camunda.org/schema/zeebe/1.0';
  static readonly PLATFORM_VERSION = '8.9.0';

  constructor() {
    super('zeebe', ZeebeDescriptor.URI, new Set([ZeebeDescriptor.URI]), SINGLES);
  }

  override allowedOn(name: string, element: BpmnElement | string): boolean | undefined {
    const type = this.type(name);
    if (!type) {
      return undefined;
    }
    if (this.nestedOnly(name)) {
      return false;
    }
    const bpmn = type.allowedIn.filter((allowed) => allowed === '*' || allowed.startsWith('bpmn:'));
    if (!bpmn.length) {
      return undefined;
    }
    return bpmn.some((allowed) => this.elementIs(element, allowed));
  }

  override containersOf(name: string): string[] {
    const type = this.type(name);
    if (!type) {
      return [];
    }
    return [...this.index().elements.values()].filter((element) => element.children.includes(type.name)).map((element) => element.name);
  }

  nestedOnly(name: string): boolean {
    const containers = this.containersOf(name);
    return containers.length > 0 && containers.every((container) => (this.type(container)?.attributes.length ?? 1) === 0);
  }

  nestedHomes(): Record<string, string> {
    return Object.fromEntries(this.typeNames().flatMap((typeName) => (this.nestedOnly(typeName) ? [[typeName, this.containersOf(typeName)[0]!]] : [])));
  }

  protected override buildIndex(): VendorIndex<ZeebeElementType> {
    const raw = [...((ZeebeSchema.DESCRIPTOR as unknown as { types: RawType[] }).types ?? []), ...EXTRA_TYPES];
    const types = new Map<string, RawType>(raw.map((rawType) => [this.typeKey(rawType.name), rawType]));
    const mixins = this.mixinsOf(types);
    const elements = this.elementsOf(types, mixins);
    for (const element of elements.values()) {
      element.children = element.children.filter((child) => child !== element.name);
    }
    return { elements, attrs: mixins.attrs };
  }

  private qualifiedList(names: readonly string[] | undefined, prefix: string): string[] {
    return (names ?? []).map((name) => this.qualify(name)).filter((name) => name.startsWith(prefix));
  }

  private mixinsOf(types: Map<string, RawType>): MixinTables {
    const tables: MixinTables = { mixinAttrs: new Map(), hostsOfMixin: new Map(), attrs: new Map() };
    for (const [key, rawType] of types) {
      if (rawType.extends?.length) {
        const bpmn = this.qualifiedList(rawType.extends, 'bpmn:');
        tables.hostsOfMixin.set(key, bpmn);
        for (const property of (rawType.properties ?? []).filter((candidate) => candidate.isAttr)) {
          this.addMixinProperty(tables, rawType, property, bpmn);
        }
      }
    }
    return tables;
  }

  private addMixinProperty({ attrs, mixinAttrs }: MixinTables, rawType: RawType, property: NonNullable<RawType['properties']>[number], bpmn: string[]): void {
    const known = attrs.get(property.name);
    if (bpmn.length && known) {
      known.owners.push(...bpmn.filter((owner) => !known.owners.includes(owner)));
    } else if (bpmn.length) {
      attrs.set(property.name, { name: `${this.prefix}:${property.name}`, type: property.type ?? 'String', owners: [...bpmn] });
    }
    for (const extendedType of this.qualifiedList(rawType.extends, `${this.prefix}:`)) {
      const extendedKey = this.typeKey(extendedType);
      mixinAttrs.set(extendedKey, [...(mixinAttrs.get(extendedKey) ?? []), { name: property.name, type: this.qualify(property.type ?? 'String'), isAttr: true, isMany: false, isBody: false }]);
    }
  }

  private propertiesOf(types: Map<string, RawType>, mixinAttrs: Map<string, ZeebeProperty[]>, key: string, seen = new Set<string>()): ZeebeProperty[] {
    const rawType = this.firstVisit(types, key, seen);
    if (!rawType) {
      return [];
    }
    const inherited = this.qualifiedList(rawType.superClass, `${this.prefix}:`).flatMap((superName) => this.propertiesOf(types, mixinAttrs, this.typeKey(superName), seen));
    const own = (rawType.properties ?? []).map((property) => ({ name: property.name, type: this.qualify(property.type ?? 'String'), isAttr: !!property.isAttr, isMany: !!property.isMany, isBody: !!property.isBody }));
    return [...inherited, ...own, ...(mixinAttrs.get(key) ?? [])];
  }

  private allowedInOf(key: string, rawType: RawType, hostsOfMixin: Map<string, string[]>): string[] {
    const allowedIn = (ALLOWED_IN_OVERRIDES[key] ?? rawType.meta?.allowedIn ?? []).flatMap((allowed) => {
      if (allowed === '*' || allowed.startsWith('bpmn:')) {
        return [allowed];
      }
      const allowedKey = this.typeKey(this.qualify(allowed));
      return hostsOfMixin.get(allowedKey) ?? [this.xmlName(allowedKey)];
    });
    return [...new Set(allowedIn)];
  }

  private elementsOf(types: Map<string, RawType>, { mixinAttrs, hostsOfMixin }: MixinTables): Map<string, ZeebeElementType> {
    const supers = new Set([...types.values()].flatMap((rawType) => this.qualifiedList(rawType.superClass, `${this.prefix}:`).map((superName) => this.typeKey(superName))));
    const elements = new Map<string, ZeebeElementType>();
    for (const [key, rawType] of types) {
      if (!rawType.extends?.length && (!supers.has(key) || rawType.meta?.allowedIn)) {
        const properties = this.propertiesOf(types, mixinAttrs, key);
        const children = properties.filter((property) => !property.isAttr && !property.isBody && property.type.startsWith(`${this.prefix}:`)).map((property) => this.xmlName(this.typeKey(property.type)));
        elements.set(key, {
          name: this.xmlName(key),
          type: key,
          allowedIn: this.allowedInOf(key, rawType, hostsOfMixin),
          attributes: properties.filter((property) => property.isAttr),
          children: [...new Set(children)],
          body: properties.some((property) => property.isBody),
        });
      }
    }
    return elements;
  }

  private elementIs(element: BpmnElement | string, type: string): boolean {
    if (type === '*') {
      return true;
    }
    return typeof element === 'string' ? VendorDescriptor.typeIs(element, type) : element.is(type);
  }
}

export const ZEEBE = new ZeebeDescriptor();
