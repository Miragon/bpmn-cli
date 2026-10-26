import { is, type El } from '../utils/moddle.js';
import { VendorDescriptor, type RawType, type VendorAttr, type VendorElementType, type VendorIndex } from './VendorDescriptor.js';
import { ZEEBE_DESCRIPTOR } from './zeebe-descriptor.js';

export const ZEEBE_URI = 'http://camunda.org/schema/zeebe/1.0';
/** The Camunda 8 version the profile was checked against. */
export const C8_PLATFORM_VERSION = '8.9.0';

export interface ZeebeProperty {
  name: string;
  type: string;
  isAttr: boolean;
  isMany: boolean;
  isBody: boolean;
}

export interface ZeebeElementType extends VendorElementType {
  /** including those of mixins (bindingType / versionTag of zeebe:calledDecision) */
  attributes: ZeebeProperty[];
  children: string[];
  body: boolean;
}

/** Camunda 8.9 accepts zeebe:publishMessage but does not execute it yet. */
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

/**
 * The Zeebe model reads one element of each; Camunda 8.9 refuses a second
 * zeebe:adHoc, zeebe:conditionalFilter or zeebe:publishMessage (engine-checked).
 */
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

/**
 * The Camunda 8 descriptor (zeebe-bpmn-moddle 2.0.0), corrected where Camunda 8.9 reads more:
 * zeebe:subscription on bpmn:Message, zeebe:properties anywhere, and zeebe:publishMessage.
 */
export class ZeebeDescriptor extends VendorDescriptor<ZeebeElementType> {
  constructor() {
    super('zeebe', ZEEBE_URI, new Set([ZEEBE_URI]), SINGLES);
  }

  override allowedOn(name: string, el: El | string): boolean | undefined {
    const type = this.type(name);
    if (!type) return undefined;
    if (this.nestedOnly(name)) return false;
    const bpmn = type.allowedIn.filter((allowed) => allowed === '*' || allowed.startsWith('bpmn:'));
    if (!bpmn.length) return undefined;
    return bpmn.some((allowed) => this.elementIs(el, allowed));
  }

  override containersOf(name: string): string[] {
    const type = this.type(name);
    if (!type) return [];
    return [...this.index().elements.values()].filter((element) => element.children.includes(type.name)).map((element) => element.name);
  }

  /**
   * Every container of the type lacks attributes of its own (zeebe:input in zeebe:ioMapping);
   * zeebe:taskHeaders is not nested only, it also sits in extensionElements.
   */
  nestedOnly(name: string): boolean {
    const containers = this.containersOf(name);
    return containers.length > 0 && containers.every((container) => (this.type(container)?.attributes.length ?? 1) === 0);
  }

  nestedHomes(): Record<string, string> {
    return Object.fromEntries(this.typeNames().flatMap((typeName) => (this.nestedOnly(typeName) ? [[typeName, this.containersOf(typeName)[0]!]] : [])));
  }

  protected override buildIndex(): VendorIndex<ZeebeElementType> {
    const prefix = this.prefix;
    const raw = [...((ZEEBE_DESCRIPTOR as unknown as { types: RawType[] }).types ?? []), ...EXTRA_TYPES];
    const types = new Map<string, RawType>();
    for (const rawType of raw) types.set(this.typeKey(rawType.name), rawType);

    // mixins: types that `extends` others. Extending BPMN types adds attributes to BPMN elements
    // (zeebe:modelerTemplate); extending zeebe types adds attributes to those (bindingType)
    const mixinAttrs = new Map<string, ZeebeProperty[]>();
    const hostsOfMixin = new Map<string, string[]>();
    const attrs = new Map<string, VendorAttr>();
    for (const [key, rawType] of types) {
      if (!rawType.extends?.length) continue;
      const bpmn = rawType.extends.map((extended) => this.qualify(extended)).filter((extended) => extended.startsWith('bpmn:'));
      hostsOfMixin.set(key, bpmn);
      for (const property of rawType.properties ?? []) {
        if (!property.isAttr) continue;
        if (bpmn.length) {
          const prev = attrs.get(property.name);
          if (prev) {
            for (const owner of bpmn) if (!prev.owners.includes(owner)) prev.owners.push(owner);
          } else {
            attrs.set(property.name, { name: `${prefix}:${property.name}`, type: property.type ?? 'String', owners: [...bpmn] });
          }
        }
        for (const extendedType of rawType.extends.map((extended) => this.qualify(extended)).filter((extended) => extended.startsWith(`${prefix}:`))) {
          const extendedKey = this.typeKey(extendedType);
          mixinAttrs.set(extendedKey, [...(mixinAttrs.get(extendedKey) ?? []), { name: property.name, type: this.qualify(property.type ?? 'String'), isAttr: true, isMany: false, isBody: false }]);
        }
      }
    }

    const ownProps = (key: string, seen = new Set<string>()): ZeebeProperty[] => {
      if (seen.has(key)) return [];
      seen.add(key);
      const rawType = types.get(key);
      if (!rawType) return [];
      const inherited = (rawType.superClass ?? [])
        .map((superName) => this.qualify(superName))
        .filter((superName) => superName.startsWith(`${prefix}:`))
        .flatMap((superName) => ownProps(this.typeKey(superName), seen));
      const own = (rawType.properties ?? []).map((property) => ({ name: property.name, type: this.qualify(property.type ?? 'String'), isAttr: !!property.isAttr, isMany: !!property.isMany, isBody: !!property.isBody }));
      return [...inherited, ...own, ...(mixinAttrs.get(key) ?? [])];
    };

    // abstract super types (zeebe:InputOutputParameter) are no elements either
    const supers = new Set(
      [...types.values()].flatMap((rawType) =>
        (rawType.superClass ?? [])
          .map((superName) => this.qualify(superName))
          .filter((superName) => superName.startsWith(`${prefix}:`))
          .map((superName) => this.typeKey(superName)),
      ),
    );
    const elements = new Map<string, ZeebeElementType>();
    for (const [key, rawType] of types) {
      if (rawType.extends?.length) continue; // a mixin, not an element type
      if (supers.has(key) && !rawType.meta?.allowedIn) continue;
      const props = ownProps(key);
      const allowedIn: string[] = [];
      for (const allowed of ALLOWED_IN_OVERRIDES[key] ?? rawType.meta?.allowedIn ?? []) {
        if (allowed === '*') allowedIn.push('*');
        else if (allowed.startsWith('bpmn:')) allowedIn.push(allowed);
        else {
          const allowedKey = this.typeKey(this.qualify(allowed));
          const hosts = hostsOfMixin.get(allowedKey);
          if (hosts) allowedIn.push(...hosts);
          else allowedIn.push(this.xmlName(allowedKey));
        }
      }
      elements.set(key, {
        name: this.xmlName(key),
        type: key,
        allowedIn: [...new Set(allowedIn)],
        attributes: props.filter((property) => property.isAttr),
        children: [...new Set(props.filter((property) => !property.isAttr && !property.isBody && property.type.startsWith(`${prefix}:`)).map((property) => this.xmlName(this.typeKey(property.type))))],
        body: props.some((property) => property.isBody),
      });
    }
    // a self-referencing property (zeebe:IoMapping.ioMapping) is no child element
    for (const element of elements.values()) element.children = element.children.filter((child) => child !== element.name);
    return { elements, attrs };
  }

  private elementIs(el: El | string, type: string): boolean {
    if (type === '*') return true;
    return typeof el === 'string' ? VendorDescriptor.typeIs(el, type) : is(el, type);
  }
}

export const ZEEBE = new ZeebeDescriptor();
