import { EditDistance } from '../../model/index.js';
import { FieldRefusal } from './FieldRefusal.js';
import { OperationCheck } from './OperationCheck.js';
import type { OperationField } from './OperationField.js';
import type { OperationLocation } from './OperationLocation.js';

export type FieldMap = Record<string, OperationField>;

type RequiredKeys<TFields> = { [TKey in keyof TFields]: TFields[TKey] extends OperationField<unknown, true> ? TKey : never }[keyof TFields];

type ValueOf<TField> = TField extends OperationField<infer TValue> ? TValue : never;

export type ValuesOf<TFields> = { [TKey in RequiredKeys<TFields>]: ValueOf<TFields[TKey]> } & { [TKey in Exclude<keyof TFields, RequiredKeys<TFields>>]?: ValueOf<TFields[TKey]> };

export type OperationOf<TDefinition extends OperationDefinition> = { op: TDefinition['name'] } & ValuesOf<TDefinition['fields']>;

export abstract class OperationDefinition {
  private static readonly ID_LIKE: ReadonlySet<string> = new Set(['flowId', 'flow', 'elementId', 'element', 'nodeId', 'node', 'target', 'ref']);

  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly fields: FieldMap;
  readonly referenceKeys: readonly string[] = [];
  readonly aliasKeyOfNewId: Readonly<Record<string, string>> = {};
  readonly schemaRules: readonly unknown[] = [];

  protected check(_operation: OperationCheck): void {}

  read(input: unknown, location: OperationLocation): Record<string, unknown> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw location.refusal(`expected an object, got ${FieldRefusal.describe(input)}`);
    }
    const fields = this.readFields(input as Record<string, unknown>, location);
    this.check(new OperationCheck(location, fields));
    return fields;
  }

  private readFields(input: Record<string, unknown>, location: OperationLocation): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(input)) {
      const field = this.fields[key];
      if (key !== 'op' && !field) {
        throw this.unknownKey(key, input, location);
      }
      if (key !== 'op' && raw !== undefined && raw !== null) {
        values[key] = field!.read(key, raw, location);
      }
    }
    for (const [key, field] of Object.entries(this.fields)) {
      if (field.traits.required && values[key] === undefined) {
        throw location.refusal((word) => `missing required key ${word(key)} (${field.help})`);
      }
    }
    return values;
  }

  private unknownKey(key: string, input: Record<string, unknown>, location: OperationLocation) {
    const allowed = Object.keys(this.fields);
    const repaired = this.repairOf(key, input);
    const alternative = repaired?.key ?? EditDistance.closestKey(key, allowed);
    const offer = alternative ? ` (did you mean "${alternative}"?)` : '';
    const hint = repaired?.hint ?? 'Keys are the CLI flags in lowerCamelCase (--flow-name -> flowName). `bpmn guide ops` lists every operation with its fields.';
    return location.refusal(`unknown key "${key}"${offer}; allowed keys: ${allowed.join(', ') || 'none'}`, hint, alternative ? [alternative] : []);
  }

  private repairOf(key: string, input: Record<string, unknown>): { key: string; hint: string } | undefined {
    const known = (entries: [string, unknown][]) => Object.fromEntries(entries.filter(([fieldKey]) => fieldKey === 'op' || this.fields[fieldKey]));
    const { [key]: value, ...rest } = input;
    if (this.fields['id'] && input['id'] === undefined && OperationDefinition.ID_LIKE.has(key)) {
      return { key: 'id', hint: `${this.name} names its element with "id": ${JSON.stringify({ ...known(Object.entries(rest)), id: value })}.` };
    }
    if (this.fields['set'] && typeof value !== 'object') {
      const set = { ...(rest['set'] as object | undefined), [key]: value };
      return { key: 'set', hint: `What the element holds goes under "set": ${JSON.stringify({ ...known(Object.entries(rest)), set })}.` };
    }
    return undefined;
  }
}
