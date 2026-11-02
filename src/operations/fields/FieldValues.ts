import * as z from 'zod/mini';
import { SpaceAmount } from './SpaceAmount.js';

export type SpaceSize = number | string;

export class FieldValues {
  static readonly ALIAS = /^\$[A-Za-z_][A-Za-z0-9_-]*$/;
  private static readonly SIZE = /^\s*-?\s*(\d*\s*(cols?|columns?|rows?)|0*[1-9]\d*\s*px|0*[1-9]\d*)\s*$/i;
  private static readonly SIZE_DEMAND = 'must be "column", "row", a number of them ("2col", "3rows") or pixels (an integer, "80px"); negative ("-column", "-2col", -80) closes space';

  static readonly text = z.string('must be a string');
  static readonly reference = z.string('must be a string').check(z.regex(/\S/, 'must not be empty'));
  static readonly flag = z.boolean('must be a boolean');
  static readonly index = z.int('must be a non-negative integer').check(z.gte(0, 'must be a non-negative integer'));
  static readonly alias = z.string('must be a string').check(z.regex(FieldValues.ALIAS, 'must be an alias like "$check" ($ and a letter, then letters, digits, _ or -)'));
  static readonly keys = z.record(
    z.string().check(z.regex(/\S/)),
    z.pipe(z.union([z.string(), z.number(), z.boolean()], 'must be a string (numbers and booleans are converted)'), z.transform(String)),
    { error: (issue) => (issue.code === 'invalid_key' ? 'contains an empty key' : 'must be an object of key/value pairs') },
  );
  static readonly unsetKeys = z
    .array(z.string('must be a string').check(z.regex(/^[^=]*[^=\s][^=]*$/, 'must be a key without "=", e.g. "name"')), 'must be an array of keys')
    .check(z.minLength(1, 'needs at least 1 key'));
  static readonly size = z.pipe(
    z.union([z.string().check(z.regex(FieldValues.SIZE, FieldValues.SIZE_DEMAND)), z.int()], FieldValues.SIZE_DEMAND).check(z.refine((value) => SpaceAmount.parse(value) !== undefined, FieldValues.SIZE_DEMAND)),
    z.transform((value): SpaceSize => (typeof value === 'string' && /^\s*-?\d+\s*$/.test(value) ? Number(value) : value)),
  );

  static choice<const TValue extends string>(values: readonly TValue[]): z.ZodMiniType<TValue> {
    const demand = `must be one of ${values.map((value) => `"${value}"`).join(', ')}`;
    return z.enum(values as readonly [TValue, ...TValue[]], demand) as unknown as z.ZodMiniType<TValue>;
  }

  static references(minItems: number): z.ZodMiniType<string[]> {
    return z.array(FieldValues.reference, 'must be an array').check(z.minLength(minItems, `needs at least ${minItems} ${minItems === 1 ? 'entry' : 'entries'}`));
  }

  static items(minItems: number, itemName: string): z.ZodMiniType<unknown[]> {
    return z.array(z.unknown(), `must be an array of ${itemName} objects`).check(z.minLength(minItems, `needs at least ${minItems} ${itemName}`));
  }
}
