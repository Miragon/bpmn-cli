
import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

interface RawProperty {
  name: string;
  type?: string;
  isAttr?: boolean;
  isBody?: boolean;
}

interface RawType {
  name: string;
  extends?: string[];
  superClass?: string[];
  properties?: RawProperty[];
  meta?: { allowedIn?: string[] };
}

/** A zeebe extension element as Camunda 8 reads it. */
export interface ZeebeElementType {
  /** The XML spelling, `zeebe:taskDefinition`. */
  name: string;
  /** The BPMN types whose extension elements it is read in, or `*` for any. */
  hosts: string[];
  /** Its attributes, those of its mixins included (`bindingType` of `zeebe:calledDecision`). */
  attributes: string[];
  /** The XML spellings of the zeebe elements it contains. */
  children: string[];
}

/** Where the descriptor says less than Camunda 8 reads. */
const HOSTS_OVERRIDE: Record<string, string[]> = {
  Subscription: ['bpmn:Message'],
  Properties: ['*'],
};

/** The zeebe elements Camunda 8 reads once per element; it refuses a file with a second one. */
const SINGLES = new Set([
  'IoMapping',
  'TaskHeaders',
  'Properties',
  'TaskDefinition',
  'FormDefinition',
  'AssignmentDefinition',
  'PriorityDefinition',
  'TaskSchedule',
  'CalledElement',
  'CalledDecision',
  'LoopCharacteristics',
  'Subscription',
  'Script',
  'UserTask',
  'VersionTag',
  'ExecutionListeners',
  'TaskListeners',
  'LinkedResources',
  'AdHoc',
  'ConditionalFilter',
]);

/**
 * The zeebe descriptor (`zeebe-bpmn-moddle`) as Camunda 8 reads it: which BPMN elements read a
 * zeebe extension element, which zeebe elements only live inside another one, and which zeebe
 * attributes a BPMN element carries.
 */
export class ZeebeSchema {
  private static loaded: ZeebeSchema | undefined;
  private static descriptor: { types: unknown[] } | undefined;

  /** The zeebe descriptor (zeebe-bpmn-moddle) the engine run hands over before it lints. */
  static use(descriptor: { types: unknown[] }): void {
    if (ZeebeSchema.descriptor === descriptor) return;
    ZeebeSchema.descriptor = descriptor;
    ZeebeSchema.loaded = new ZeebeSchema(descriptor.types as RawType[]);
  }

  static get instance(): ZeebeSchema {
    if (!ZeebeSchema.loaded) throw new Error('ZeebeSchema.use(descriptor) runs before the Camunda 8 rules');
    return ZeebeSchema.loaded;
  }

  private readonly rawTypes = new Map<string, RawType>();
  private readonly elements = new Map<string, ZeebeElementType>();
  private readonly ownersByHostAttribute = new Map<string, string[]>();
  private readonly mixinAttributes = new Map<string, string[]>();
  private readonly hostsOfMixin = new Map<string, string[]>();

  private constructor(types: RawType[]) {
    for (const rawType of types) {
      this.rawTypes.set(rawType.name, rawType);
    }
    this.indexMixins();
    this.indexElements();
  }

  /** The element type of a typed zeebe element (`$type` `zeebe:TaskDefinition`). */
  typeOf(value: ModdleElement): ZeebeElementType | undefined {
    const type = String(value?.$type ?? '');
    return type.startsWith('zeebe:') ? this.elements.get(type.slice('zeebe:'.length)) : undefined;
  }

  /** Whether `host` reads `type` in its extension elements; undefined when the descriptor does not say. */
  isReadOn(type: ZeebeElementType, host: ModdleElement): boolean | undefined {
    if (this.isNestedOnly(type)) {
      return false;
    }
    if (!type.hosts.length) {
      return undefined;
    }
    return type.hosts.some((hostType) => hostType === '*' || host.$instanceOf(hostType));
  }

  /** The zeebe elements `type` sits in, `zeebe:ioMapping` for `zeebe:input`. */
  containersOf(type: ZeebeElementType): ZeebeElementType[] {
    return [...this.elements.values()].filter((element) => element.children.includes(type.name));
  }

  /** Whether `type` only lives inside containers without attributes of their own (`zeebe:input`). */
  isNestedOnly(type: ZeebeElementType): boolean {
    const containers = this.containersOf(type);
    return (
      containers.length > 0 && containers.every((container) => container.attributes.length === 0)
    );
  }

  isSingle(type: ZeebeElementType): boolean {
    return SINGLES.has(this.keyOf(type));
  }

  /** The BPMN types a zeebe attribute of a BPMN element belongs on (`modelerTemplate`), if it is one. */
  ownersOfHostAttribute(localName: string): string[] | undefined {
    return this.ownersByHostAttribute.get(localName);
  }

  hostAttributeNames(): string[] {
    return [...this.ownersByHostAttribute.keys()];
  }

  /** The first zeebe element `host` reads that has the attribute `localName` (`assignee`). */
  homeOfAttribute(localName: string, host: ModdleElement): ZeebeElementType | undefined {
    return [...this.elements.values()].find(
      (element) => this.isReadOn(element, host) === true && element.attributes.includes(localName),
    );
  }

  private keyOf(type: ZeebeElementType): string {
    const local = type.name.slice('zeebe:'.length);
    return local.charAt(0).toUpperCase() + local.slice(1);
  }

  private indexMixins(): void {
    for (const rawType of this.rawTypes.values()) {
      if (!rawType.extends?.length) {
        continue;
      }
      const bpmnHosts = rawType.extends.filter((extended) => extended.startsWith('bpmn:'));
      const zeebeTypes = rawType.extends
        .filter((extended) => extended.startsWith('zeebe:'))
        .map((extended) => extended.slice('zeebe:'.length));
      this.hostsOfMixin.set(rawType.name, bpmnHosts);
      for (const property of rawType.properties ?? []) {
        if (!property.isAttr) {
          continue;
        }
        if (bpmnHosts.length) {
          const owners = this.ownersByHostAttribute.get(property.name) ?? [];
          this.ownersByHostAttribute.set(property.name, [
            ...owners,
            ...bpmnHosts.filter((host) => !owners.includes(host)),
          ]);
        }
        for (const zeebeType of zeebeTypes) {
          this.mixinAttributes.set(zeebeType, [
            ...(this.mixinAttributes.get(zeebeType) ?? []),
            property.name,
          ]);
        }
      }
    }
  }

  private indexElements(): void {
    const superTypes = new Set(
      [...this.rawTypes.values()].flatMap((rawType) =>
        (rawType.superClass ?? []).filter((superName) => this.rawTypes.has(superName)),
      ),
    );
    for (const rawType of this.rawTypes.values()) {
      if (rawType.extends?.length) {
        continue;
      }
      if (superTypes.has(rawType.name) && !rawType.meta?.allowedIn) {
        continue;
      }
      const properties = this.propertiesOf(rawType.name, new Set());
      const name = this.xmlName(rawType.name);
      this.elements.set(rawType.name, {
        name,
        hosts: this.hostsOf(rawType),
        attributes: properties.filter((property) => property.isAttr).map(({ name: attr }) => attr),
        children: [
          ...new Set(
            properties
              .filter((property) => !property.isAttr && !property.isBody)
              .filter((property) => this.rawTypes.has(property.type ?? ''))
              .map((property) => this.xmlName(property.type ?? '')),
          ),
        ].filter((child) => child !== name),
      });
    }
  }

  private propertiesOf(typeName: string, seen: Set<string>): RawProperty[] {
    const rawType = this.rawTypes.get(typeName);
    if (!rawType || seen.has(typeName)) {
      return [];
    }
    seen.add(typeName);
    const inherited = (rawType.superClass ?? []).flatMap((superName) =>
      this.propertiesOf(superName, seen),
    );
    const mixins = (this.mixinAttributes.get(typeName) ?? []).map((name) => ({
      name,
      isAttr: true,
    }));
    return [...inherited, ...(rawType.properties ?? []), ...mixins];
  }

  private hostsOf(rawType: RawType): string[] {
    const allowedIn = HOSTS_OVERRIDE[rawType.name] ?? rawType.meta?.allowedIn ?? [];
    const hosts = allowedIn.flatMap((allowed) => {
      if (allowed === '*' || allowed.startsWith('bpmn:')) {
        return [allowed];
      }
      return this.hostsOfMixin.get(allowed.slice('zeebe:'.length)) ?? [];
    });
    return [...new Set(hosts)];
  }

  private xmlName(typeName: string): string {
    return `zeebe:${typeName.charAt(0).toLowerCase()}${typeName.slice(1)}`;
  }
}
