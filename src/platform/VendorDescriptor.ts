import { createModdle, type El } from '../model/utils/moddle.js';

export interface VendorAttr {
  name: string;
  type: string;
  /** BPMN types, tested with `is(el, owner)` */
  owners: string[];
}

export interface VendorElementType {
  /** XML spelling `camunda:inputOutput`; `type` is the descriptor spelling `camunda:InputOutput` */
  name: string;
  type: string;
  /** BPMN types (in their extensionElements), '*', or the vendor element types it is a child of */
  allowedIn: string[];
}

export interface RawProperty {
  name: string;
  type?: string;
  isAttr?: boolean;
  isMany?: boolean;
  isReference?: boolean;
  isBody?: boolean;
}

export interface RawType {
  name: string;
  extends?: string[];
  superClass?: string[];
  isAbstract?: boolean;
  properties?: RawProperty[];
  meta?: { allowedIn?: string[] };
}

export interface VendorIndex<T extends VendorElementType> {
  elements: Map<string, T>;
  attrs: Map<string, VendorAttr>;
}

const PRIMITIVES = new Set(['String', 'Boolean', 'Integer', 'Real', 'Element']);

/**
 * Read-only lookup over an engine's moddle descriptor. The descriptor is data, never registered
 * with a BpmnModdle: typed vendor content would break the byte-stable roundtrip, so vendor
 * content stays generic and the descriptor only answers questions about it.
 */
export abstract class VendorDescriptor<T extends VendorElementType = VendorElementType> {
  private static probeModdle: ReturnType<typeof createModdle> | undefined;
  private static readonly subtypeCache = new Map<string, boolean>();
  private cached: VendorIndex<T> | undefined;
  private readonly singleNames: ReadonlySet<string>;

  constructor(
    readonly prefix: string,
    readonly uri: string,
    /** namespaces whose content this descriptor describes, by local name */
    readonly uris: ReadonlySet<string>,
    /** in the order `bpmn guide` lists them */
    readonly singles: readonly string[],
  ) {
    this.singleNames = new Set(singles);
  }

  static typeIs(type: string, superType: string): boolean {
    if (superType === '*') return true;
    const key = `${type}<${superType}`;
    const hit = VendorDescriptor.subtypeCache.get(key);
    if (hit !== undefined) return hit;
    let result = false;
    try {
      result = VendorDescriptor.probe().create(type).$instanceOf(superType);
    } catch {
      result = false;
    }
    VendorDescriptor.subtypeCache.set(key, result);
    return result;
  }

  protected static probe(): ReturnType<typeof createModdle> {
    VendorDescriptor.probeModdle ??= createModdle();
    return VendorDescriptor.probeModdle;
  }

  /** Operaton's copy counts: operaton:asyncBefore is camunda:asyncBefore. */
  reads(uri: string | undefined): boolean {
    return uri !== undefined && this.uris.has(uri);
  }

  attr(name: string): VendorAttr | undefined {
    if (name.includes(':') && !name.startsWith(`${this.prefix}:`)) return undefined;
    return this.index().attrs.get(this.attrKey(name));
  }

  attrs(): VendorAttr[] {
    return [...this.index().attrs.values()];
  }

  /** Mixins such as camunda:AsyncCapable are no element types. */
  type(name: string): T | undefined {
    if (name.includes(':') && !name.startsWith(`${this.prefix}:`)) return undefined;
    return this.index().elements.get(this.typeKey(name));
  }

  typeNames(): string[] {
    return [...this.index().elements.values()].map((e) => e.name);
  }

  isSingle(name: string): boolean {
    return this.singleNames.has(name.startsWith(`${this.prefix}:`) ? name : `${this.prefix}:${name}`);
  }

  /** undefined when the type is unknown or the descriptor says nothing about its placement */
  abstract allowedOn(name: string, el: El | string): boolean | undefined;

  abstract containersOf(name: string): string[];

  protected abstract buildIndex(): VendorIndex<T>;

  protected index(): VendorIndex<T> {
    this.cached ??= this.buildIndex();
    return this.cached;
  }

  /** `inputOutput` / `camunda:inputOutput` -> `camunda:InputOutput` */
  protected typeKey(name: string): string {
    const local = name.startsWith(`${this.prefix}:`) ? name.slice(this.prefix.length + 1) : name;
    return `${this.prefix}:${local.charAt(0).toUpperCase()}${local.slice(1)}`;
  }

  protected xmlName(key: string): string {
    const local = key.slice(this.prefix.length + 1);
    return `${this.prefix}:${local.charAt(0).toLowerCase()}${local.slice(1)}`;
  }

  protected attrKey(name: string): string {
    return name.startsWith(`${this.prefix}:`) ? name.slice(this.prefix.length + 1) : name;
  }

  protected qualify(type: string): string {
    if (type.includes(':') || PRIMITIVES.has(type)) return type;
    return `${this.prefix}:${type}`;
  }
}
