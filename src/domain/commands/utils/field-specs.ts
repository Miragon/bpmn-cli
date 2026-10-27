import type { SplitBranch } from '../types.js';

type FieldType = 'string' | 'boolean' | 'integer' | 'string[]' | 'map' | 'branches' | 'nodes' | 'size';

export interface FieldSpec {
  type: FieldType;
  description: string;
  required?: boolean;
  values?: readonly string[];
  /** ids, references and kinds: must not be empty */
  ref?: boolean;
  minItems?: number;
  /** defines a batch alias: `$name` */
  alias?: boolean;
}

export type FieldsOf<TOp> = { [TKey in Exclude<keyof TOp, 'op'>]-?: FieldSpec };

export type SplitNode = SplitBranch['nodes'][number];

export function str(description: string, extra: Partial<FieldSpec> = {}): FieldSpec {
  return { type: 'string', description, ...extra };
}

export function ref(description: string, extra: Partial<FieldSpec> = {}): FieldSpec {
  return str(description, { ref: true, ...extra });
}

export function bool(description: string): FieldSpec {
  return { type: 'boolean', description };
}

export function list(description: string, extra: Partial<FieldSpec> = {}): FieldSpec {
  return { type: 'string[]', description, ...extra };
}

export function map(description: string, extra: Partial<FieldSpec> = {}): FieldSpec {
  return { type: 'map', description, ...extra };
}

export function alias(description: string): FieldSpec {
  return str(`${description} Later ops of the batch use it wherever an element id goes ("after": "$check", "ids": ["$check"]); the result lists it with the final id.`, { alias: true });
}
