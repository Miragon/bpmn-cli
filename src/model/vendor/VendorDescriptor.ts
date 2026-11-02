import type { BpmnElement } from '../document/BpmnElement.js';
import { ModdleParser, type BpmnModdle } from '../xml/ModdleParser.js';

export interface VendorAttr {
  name: string;
  type: string;
  owners: string[];
}

export interface VendorElementType {
  name: string;
  type: string;
  allowedIn: string[];
}

interface RawProperty {
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

export interface VendorIndex<TElementType extends VendorElementType> {
  elements: Map<string, TElementType>;
  attrs: Map<string, VendorAttr>;
}

export abstract class VendorDescriptor<TElementType extends VendorElementType = VendorElementType> {
  private static readonly PRIMITIVES = new Set(['String', 'Boolean', 'Integer', 'Real', 'Element']);
  private static probeModdle: BpmnModdle | undefined;
  private static readonly subtypeCache = new Map<string, boolean>();
  private cached: VendorIndex<TElementType> | undefined;
  private readonly singleNames: ReadonlySet<string>;

  constructor(
    readonly prefix: string,
    readonly uri: string,
    readonly uris: ReadonlySet<string>,
    readonly singles: readonly string[],
  ) {
    this.singleNames = new Set(singles);
  }

  static typeIs(type: string, superType: string): boolean {
    if (superType === '*') {
      return true;
    }
    const key = `${type}<${superType}`;
    const hit = VendorDescriptor.subtypeCache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    let result = false;
    try {
      result = VendorDescriptor.probe().create(type).$instanceOf(superType);
    } catch {
      result = false;
    }
    VendorDescriptor.subtypeCache.set(key, result);
    return result;
  }

  protected static probe(): BpmnModdle {
    VendorDescriptor.probeModdle ??= ModdleParser.moddle();
    return VendorDescriptor.probeModdle;
  }

  reads(uri: string | undefined): boolean {
    return uri !== undefined && this.uris.has(uri);
  }

  attr(name: string): VendorAttr | undefined {
    if (name.includes(':') && !name.startsWith(`${this.prefix}:`)) {
      return undefined;
    }
    return this.index().attrs.get(this.attrKey(name));
  }

  attrs(): VendorAttr[] {
    return [...this.index().attrs.values()];
  }

  type(name: string): TElementType | undefined {
    if (name.includes(':') && !name.startsWith(`${this.prefix}:`)) {
      return undefined;
    }
    return this.index().elements.get(this.typeKey(name));
  }

  typeNames(): string[] {
    return [...this.index().elements.values()].map((element) => element.name);
  }

  isSingle(name: string): boolean {
    return this.singleNames.has(name.startsWith(`${this.prefix}:`) ? name : `${this.prefix}:${name}`);
  }

  abstract allowedOn(name: string, el: BpmnElement | string): boolean | undefined;

  abstract containersOf(name: string): string[];

  protected abstract buildIndex(): VendorIndex<TElementType>;

  protected index(): VendorIndex<TElementType> {
    this.cached ??= this.buildIndex();
    return this.cached;
  }

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

  protected firstVisit(types: Map<string, RawType>, key: string, seen: Set<string>): RawType | undefined {
    if (seen.has(key)) {
      return undefined;
    }
    seen.add(key);
    return types.get(key);
  }

  protected qualify(type: string): string {
    if (type.includes(':') || VendorDescriptor.PRIMITIVES.has(type)) {
      return type;
    }
    return `${this.prefix}:${type}`;
  }
}
