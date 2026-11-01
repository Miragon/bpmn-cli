interface ModdleObject {
  $type: string;
  $parent?: unknown;
  $descriptor: { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean }> };
  $instanceOf?: (type: string) => boolean;
  get?: (key: string) => unknown;
  [property: string]: unknown;
}

export class BpmnNode {
  private constructor(private readonly object: ModdleObject) {}

  static of(value: unknown): BpmnNode | undefined {
    return value && typeof value === 'object' ? new BpmnNode(value as ModdleObject) : undefined;
  }

  get id(): string | undefined {
    return this.text('id');
  }

  get type(): string {
    return this.object.$type;
  }

  get parent(): BpmnNode | undefined {
    return BpmnNode.of(this.object.$parent);
  }

  is(type: string): boolean {
    return typeof this.object.$instanceOf === 'function' && this.object.$instanceOf(type);
  }

  sameAs(other: BpmnNode | undefined): boolean {
    return this.object === other?.object;
  }

  value(property: string): unknown {
    return this.object[property];
  }

  text(property: string): string | undefined {
    return this.object[property] as string | undefined;
  }

  ref(property: string): BpmnNode | undefined {
    return BpmnNode.of(this.object[property]);
  }

  list(property: string): BpmnNode[] {
    const values = (this.object[property] ?? []) as unknown[];
    return values.flatMap((value) => BpmnNode.of(value) ?? []);
  }

  attribute(key: string): unknown {
    return typeof this.object.get === 'function' ? this.object.get(key) : undefined;
  }

  *tree(skip: (node: BpmnNode) => boolean): Generator<BpmnNode> {
    const stack: ModdleObject[] = [this.object];
    const seen = new Set<ModdleObject>();
    while (stack.length) {
      const object = stack.pop() as ModdleObject;
      const node = new BpmnNode(object);
      if (seen.has(object) || skip(node)) {
        seen.add(object);
        continue;
      }
      seen.add(object);
      yield node;
      stack.push(...node.children());
    }
  }

  private children(): ModdleObject[] {
    const { isGeneric, properties = [] } = this.object.$descriptor;
    if (isGeneric) {
      return [];
    }
    const owned = properties.filter((property) => !property.isReference).flatMap((property) => this.object[property.name]);
    return owned.filter((value): value is ModdleObject => !!value && typeof value === 'object' && '$type' in value);
  }
}
