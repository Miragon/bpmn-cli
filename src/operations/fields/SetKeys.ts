import { BpmnElement, BpmnError, type KindDefinition, KindParser, Kinds, ModdleParser, PropertyCatalog } from '../../model/index.js';

export class SetKeys {
  private constructor(private readonly keys: ReadonlySet<string>) {}

  static ofKind(kind: unknown): SetKeys {
    const known = SetKeys.definitionOf(kind);
    const probe = ModdleParser.moddle();
    const catalogs = (known ? [known] : Kinds.ALL).map((definition) => PropertyCatalog.of(BpmnElement.of(probe.create(definition.type, definition.props))));
    const keys = catalogs.flatMap((catalog) => catalog.settableKeys());
    return new SetKeys(new Set(known ? keys : [...keys, ...PropertyCatalog.DOCS.map((doc) => doc.key)]));
  }

  private static definitionOf(kind: unknown): KindDefinition | undefined {
    if (typeof kind !== 'string') {
      return undefined;
    }
    try {
      return KindParser.parseToAdd(kind).def;
    } catch (error) {
      if (error instanceof BpmnError) {
        return undefined;
      }
      throw error;
    }
  }

  takes(key: string): boolean {
    return this.keys.has(key) || key.includes(':');
  }
}
