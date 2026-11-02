import * as z from 'zod/mini';
import { FieldRefusal } from './FieldRefusal.js';
import { FieldValues } from './FieldValues.js';
import type { OperationLocation } from './OperationLocation.js';

export interface FieldItem {
  readonly name: string;
  read(input: unknown, location: OperationLocation): unknown;
}

interface FieldTraits {
  required?: boolean;
  batchOnly?: boolean;
  definesAlias?: boolean;
  itemsOf?: FieldItem;
}

export class OperationField<TValue = unknown, TRequired extends boolean = boolean> {
  declare readonly value: TValue;
  declare readonly requiredInType: TRequired;

  private constructor(
    private readonly schema: z.ZodMiniType,
    readonly help: string,
    readonly traits: FieldTraits,
  ) {}

  static required<TValue>(schema: z.ZodMiniType<TValue>, help: string): OperationField<TValue, true> {
    return new OperationField(schema, help, { required: true });
  }

  static optional<TValue>(schema: z.ZodMiniType<TValue>, help: string): OperationField<TValue, false> {
    return new OperationField(schema, help, {});
  }

  static batchOnly<TValue>(schema: z.ZodMiniType<TValue>, help: string): OperationField<TValue, false> {
    return new OperationField(schema, help, { batchOnly: true });
  }

  static alias(help: string): OperationField<string, false> {
    return new OperationField(FieldValues.alias, `${help} Later ops of the batch use it wherever an element id goes ("after": "$check", "ids": ["$check"]); the result lists it with the final id.`, { batchOnly: true, definesAlias: true });
  }

  static items<TItem>(definition: FieldItem, minItems: number, help: string): OperationField<TItem[], true> {
    return new OperationField(FieldValues.items(minItems, definition.name), help, { required: true, itemsOf: definition });
  }

  read(key: string, input: unknown, location: OperationLocation): unknown {
    const result = this.schema.safeParse(input, { reportInput: true });
    if (!result.success) {
      throw new FieldRefusal(key, result.error.issues[0]!).at(location);
    }
    const items = this.traits.itemsOf;
    return items ? (result.data as unknown[]).map((item, index) => items.read(item, location.inside(`${key}[${index}]`))) : result.data;
  }

  jsonSchema(): Record<string, unknown> {
    const { $schema: _dialect, ...schema } = z.toJSONSchema(this.schema, { io: 'input' });
    const { itemsOf, batchOnly } = this.traits;
    return { ...schema, ...(itemsOf ? { items: { $ref: `#/$defs/${itemsOf.name}` } } : {}), description: this.help, ...(batchOnly ? { 'x-batch-only': true } : {}) };
  }
}
