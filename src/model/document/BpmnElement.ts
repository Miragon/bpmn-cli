export interface PropertyDescriptor {
  name: string;
  type: string;
  isAttr?: boolean;
  isReference?: boolean;
  isMany?: boolean;
  isBody?: boolean;
  default?: unknown;
}

export interface TypeDescriptor {
  isGeneric?: boolean;
  properties?: PropertyDescriptor[];
  propertiesByName?: Record<string, PropertyDescriptor>;
  ns?: { prefix?: string; localName?: string; uri?: string };
}

export interface ModdleObject {
  $type: string;
  $parent?: ModdleObject;
  $attrs?: Record<string, unknown>;
  $descriptor: TypeDescriptor;
  $model: { getPackage(prefix: string): unknown };
  $instanceOf(type: string): boolean;
  get(property: string): unknown;
  set(property: string, value: unknown): void;
}

export type ReadCopy<TValue> = TValue extends readonly (infer TItem)[] ? readonly TItem[] : TValue;

export class BpmnElement {
  private static readonly wrappers = new WeakMap<ModdleObject, BpmnElement>();
  private static readonly DETACHED_ATTRS: Record<string, unknown> = Object.freeze({});
  private static readonly BPMN_TYPE = /^(bpmn|bpmndi|dc|di):/;
  private static readonly DRAWING_TYPE = /^(bpmndi|dc|di):/;

  readonly type: string;
  readonly descriptor: TypeDescriptor;
  readonly attrs: Record<string, unknown>;
  readonly isGeneric: boolean;
  readonly isBpmn: boolean;
  readonly isDrawingPart: boolean;

  private constructor(readonly raw: ModdleObject) {
    this.type = raw.$type;
    this.descriptor = raw.$descriptor;
    this.attrs = raw.$attrs ?? BpmnElement.DETACHED_ATTRS;
    this.isGeneric = !!raw.$descriptor.isGeneric;
    this.isBpmn = !this.isGeneric && BpmnElement.BPMN_TYPE.test(raw.$type);
    this.isDrawingPart = BpmnElement.DRAWING_TYPE.test(raw.$type);
  }

  static of(raw: ModdleObject): BpmnElement {
    let wrapper = BpmnElement.wrappers.get(raw);
    if (!wrapper) {
      wrapper = new BpmnElement(raw);
      BpmnElement.wrappers.set(raw, wrapper);
    }
    return wrapper;
  }

  private static isModdle(value: unknown): value is ModdleObject {
    return !!value && typeof value === 'object' && typeof (value as ModdleObject).$type === 'string' && '$descriptor' in value;
  }

  private static wrapped(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(BpmnElement.wrapped);
    }
    return BpmnElement.isModdle(value) ? BpmnElement.of(value) : value;
  }

  private static unwrapped(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(BpmnElement.unwrapped);
    }
    return value instanceof BpmnElement ? value.raw : value;
  }

  get id(): string {
    return this.raw.get('id') as string;
  }

  get name(): string | undefined {
    if (this.is('bpmn:Group')) {
      return this.get<BpmnElement | undefined>('categoryValueRef')?.get<string | undefined>('value') || undefined;
    }
    return this.get<string | undefined>('name');
  }

  get parent(): BpmnElement | undefined {
    return this.raw.$parent && BpmnElement.of(this.raw.$parent);
  }

  set parent(parent: BpmnElement | undefined) {
    this.raw.$parent = parent?.raw;
  }

  is(type: string): boolean {
    return this.raw.$instanceOf(type);
  }

  get<TValue = unknown>(property: string): ReadCopy<TValue> {
    return BpmnElement.wrapped(this.raw.get(property)) as ReadCopy<TValue>;
  }

  peek<TValue = unknown>(property: string): ReadCopy<TValue> | undefined {
    return BpmnElement.wrapped((this.raw as unknown as Record<string, unknown>)[property]) as ReadCopy<TValue> | undefined;
  }

  list<TItem = BpmnElement>(property: string): readonly TItem[] {
    const value = this.peek<TItem[]>(property);
    return Array.isArray(value) ? (value as readonly TItem[]) : [];
  }

  set(property: string, value: unknown): void {
    this.raw.set(property, BpmnElement.unwrapped(value));
  }

  add(property: string, ...children: BpmnElement[]): void {
    const stored = this.stored(property);
    const contained = !this.isReference(property);
    for (const child of children) {
      if (!stored.includes(child.raw)) {
        stored.push(child.raw);
      }
      if (contained) {
        child.raw.$parent = this.raw;
      }
    }
  }

  insert(property: string, index: number, ...children: BpmnElement[]): void {
    const stored = this.stored(property);
    const at = Math.max(0, Math.min(index, stored.length));
    stored.splice(at, 0, ...children.map((child) => child.raw));
    if (!this.isReference(property)) {
      for (const child of children) {
        child.raw.$parent = this.raw;
      }
    }
  }

  remove(property: string, child: BpmnElement): boolean {
    const stored = this.raw.get(property) as ModdleObject[] | undefined;
    const index = stored?.indexOf(child.raw) ?? -1;
    if (index === -1) {
      return false;
    }
    stored!.splice(index, 1);
    return true;
  }

  private stored(property: string): ModdleObject[] {
    return this.raw.get(property) as ModdleObject[];
  }

  private isReference(property: string): boolean {
    return !!this.descriptor.propertiesByName?.[property]?.isReference;
  }
}
