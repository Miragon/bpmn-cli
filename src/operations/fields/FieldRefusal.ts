import type * as z from 'zod/mini';
import type { BpmnError } from '../../model/index.js';
import { FieldValues } from './FieldValues.js';
import type { OperationLocation } from './OperationLocation.js';

export class FieldRefusal {
  private static readonly HINTS: Readonly<Record<string, (key: string, input: unknown) => string>> = {
    string: (key) => `Write it as a JSON string, e.g. "${key}": "...".`,
    boolean: (key, input) => (input === 'true' || input === 'false' ? `Use the JSON literal ${input}, not the string "${input}".` : `Write "${key}": true or false.`),
    array: (key) => `Write "${key}" as a JSON array, e.g. "${key}": [...].`,
    record: (key) => `Write "${key}": {"name": "..."}.`,
    [String(FieldValues.ALIAS)]: (key) => `Example: "${key}": "$check", then "after": "$check" in a later op.`,
  };

  constructor(
    private readonly key: string,
    private readonly issue: z.core.$ZodIssue,
  ) {}

  static describe(input: unknown): string {
    if (input === null) {
      return 'null';
    }
    if (Array.isArray(input)) {
      return 'an array';
    }
    return typeof input === 'object' ? 'an object' : `${typeof input} ${JSON.stringify(input)}`;
  }

  at(location: OperationLocation): BpmnError {
    return location.refusal(`"${this.place()}" ${this.issue.message}, got ${FieldRefusal.describe(this.issue.input)}`, this.hint());
  }

  private place(): string {
    const [first, ...rest] = this.issue.path;
    if (first === undefined) {
      return this.key;
    }
    return typeof first === 'number' ? `${this.key}[${first}]` : `${this.key}.${[String(first), ...rest].join('.')}`;
  }

  private hint(): string | undefined {
    const { expected, pattern, input, path } = this.issue as { expected?: string; pattern?: string; input?: unknown; path: unknown[] };
    return path.length ? undefined : FieldRefusal.HINTS[expected ?? pattern ?? '']?.(this.key, input);
  }
}
