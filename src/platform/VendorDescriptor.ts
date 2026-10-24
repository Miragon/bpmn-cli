/**
 * Read-only lookup over an engine's moddle descriptor (CamundaDescriptor for
 * camunda-bpmn-moddle, ZeebeDescriptor for zeebe-bpmn-moddle, inlined as
 * camunda-descriptor.ts / zeebe-descriptor.ts), used for validation and for
 * placing vendor attributes and extension elements on the right element.
 *
 * The descriptor is DATA here: it is never registered with a BpmnModdle
 * instance. Registering it would make vendor content typed, which changes
 * how files are parsed and serialised (attribute order, defaults, dropped
 * unknown content) and breaks the byte-stable roundtrip. Vendor content
 * therefore stays generic in the model (`el.$attrs['camunda:assignee']`,
 * generic `zeebe:taskDefinition` elements); a descriptor only answers
 * questions about it.
 *
 * Names: every lookup accepts prefixed or bare names in either spelling
 * (`camunda:assignee` / `assignee`; `zeebe:taskDefinition` / `TaskDefinition`).
 * Results use the XML spelling: attributes `<prefix>:<name>`, element types
 * `<prefix>:<lowerCamel>` (what generic elements carry as `$type`). BPMN
 * types are `bpmn:<Type>` (what `is(el, type)` takes).
 *
 * Engine facts next to the descriptor: the namespaces it describes by local
 * name (`uris`, `reads`) and the extension element types an element holds
 * at most once (`singles`, `isSingle`).
 */
import { createModdle, type El } from '../model/utils/moddle.js';

/** A vendor attribute that BPMN elements carry (`camunda:assignee` on a userTask). */
export interface VendorAttr {
  /** XML name, e.g. `camunda:assignee` */
  name: string;
  /** descriptor type: String | Boolean | Integer */
  type: string;
  /** BPMN types that may carry it (test with `is(el, owner)`), e.g. ['bpmn:UserTask'] */
  owners: string[];
}

/** A vendor extension element type (`camunda:inputOutput`, `zeebe:taskDefinition`). */
export interface VendorElementType {
  /** XML spelling, e.g. `camunda:inputOutput` */
  name: string;
  /** descriptor spelling, e.g. `camunda:InputOutput` */
  type: string;
  /** where it may appear: BPMN types (in their extensionElements), '*', or vendor element types (XML spelling) it is a child of */
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
  /** key: `<prefix>:<Type>` */
  elements: Map<string, T>;
  /** key: local attribute name */
  attrs: Map<string, VendorAttr>;
}

const PRIMITIVES = new Set(['String', 'Boolean', 'Integer', 'Real', 'Element']);

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
    /** extension element types an element holds at most once (XML spelling, in the order `bpmn guide` lists them) */
    readonly singles: readonly string[],
  ) {
    this.singleNames = new Set(singles);
  }

  /** True when BPMN type `type` is `superType` or a subtype of it (`bpmn:UserTask` is a `bpmn:Activity`). */
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

  /** True for a namespace this descriptor describes (camunda and Operaton's copy of it: operaton:asyncBefore is camunda:asyncBefore). */
  reads(uri: string | undefined): boolean {
    return uri !== undefined && this.uris.has(uri);
  }

  /** The vendor attribute `name` (`camunda:assignee` or `assignee`) of BPMN elements, or undefined. */
  attr(name: string): VendorAttr | undefined {
    if (name.includes(':') && !name.startsWith(`${this.prefix}:`)) return undefined;
    return this.index().attrs.get(this.attrKey(name));
  }

  /** Every vendor attribute of BPMN elements. */
  attrs(): VendorAttr[] {
    return [...this.index().attrs.values()];
  }

  /** The vendor extension element type `name`, or undefined (mixins such as camunda:AsyncCapable are no element types). */
  type(name: string): T | undefined {
    if (name.includes(':') && !name.startsWith(`${this.prefix}:`)) return undefined;
    return this.index().elements.get(this.typeKey(name));
  }

  /** Every vendor extension element type, XML spelling. */
  typeNames(): string[] {
    return [...this.index().elements.values()].map((e) => e.name);
  }

  /** True for a type an element holds at most once (`inputOutput` or `camunda:inputOutput`). */
  isSingle(name: string): boolean {
    return this.singleNames.has(name.startsWith(`${this.prefix}:`) ? name : `${this.prefix}:${name}`);
  }

  /**
   * Whether an extension element of type `name` may sit in the extensionElements
   * of `el` (BPMN element or type name); undefined when the type is unknown or
   * the descriptor says nothing about its placement.
   */
  abstract allowedOn(name: string, el: El | string): boolean | undefined;

  /** Vendor element types (XML spelling) that hold `name` as a child (camunda:inputParameter -> camunda:inputOutput). */
  abstract containersOf(name: string): string[];

  protected abstract buildIndex(): VendorIndex<T>;

  protected index(): VendorIndex<T> {
    this.cached ??= this.buildIndex();
    return this.cached;
  }

  /** `InputOutput` / `inputOutput` / `camunda:inputOutput` -> `camunda:InputOutput` (descriptor key). */
  protected typeKey(name: string): string {
    const local = name.startsWith(`${this.prefix}:`) ? name.slice(this.prefix.length + 1) : name;
    return `${this.prefix}:${local.charAt(0).toUpperCase()}${local.slice(1)}`;
  }

  /** `camunda:InputOutput` -> `camunda:inputOutput` (XML / generic $type spelling). */
  protected xmlName(key: string): string {
    const local = key.slice(this.prefix.length + 1);
    return `${this.prefix}:${local.charAt(0).toLowerCase()}${local.slice(1)}`;
  }

  /** `camunda:assignee` / `assignee` -> `assignee`. */
  protected attrKey(name: string): string {
    return name.startsWith(`${this.prefix}:`) ? name.slice(this.prefix.length + 1) : name;
  }

  /** Prefixes a descriptor type reference: bare names are vendor types, primitives stay. */
  protected qualify(type: string): string {
    if (type.includes(':') || PRIMITIVES.has(type)) return type;
    return `${this.prefix}:${type}`;
  }
}
