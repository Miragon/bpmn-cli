import { usageError } from '../document/utils/errors.js';
import { CliError } from '../document/CliError.js';
import { closestKey } from '../document/utils/fuzzy.js';
import { CommandFieldCheck } from './CommandFieldCheck.js';
import { EditCommandDefinitions } from './definitions/EditCommandDefinitions.js';
import { OpAliases } from './OpAliases.js';
import { ALIAS, unknownAlias } from './utils/aliases.js';
import { commandUsageError, type CommandLocation } from './utils/command-location.js';
import { OP_NAMES } from './utils/op-names.js';
import { parseSpaceAmount } from './utils/space-amount.js';
import type { FieldSpec, SplitNode } from './utils/field-specs.js';
import { BRANCH_FIELDS, NODE_FIELDS } from './utils/op-fields.js';
import type { EditCommand, InsertSpace, SplitBranch } from './types.js';

/** Keys people write for the element where the op says "id". */
const ID_LIKE = new Set(['flowId', 'flow', 'elementId', 'element', 'nodeId', 'node', 'target', 'ref']);

/**
 * Validates the JSON ops format of `bpmn apply` by walking the op field specs, without a schema
 * library. Every problem is a usage error naming `ops[<index>] (<op>)`.
 */
export class CommandParser {
  private fail(ctx: CommandLocation, message: string, hint?: string, candidates?: string[]): CliError {
    return commandUsageError(ctx, message, hint, candidates);
  }

  private isPlainObject(candidate: unknown): candidate is Record<string, unknown> {
    return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
  }

  private describe(input: unknown): string {
    if (input === null) return 'null';
    if (Array.isArray(input)) return 'an array';
    if (typeof input === 'object') return 'an object';
    return `${typeof input} ${JSON.stringify(input)}`;
  }

  private checkString(ctx: CommandLocation, key: string, spec: FieldSpec, value: unknown): string {
    if (typeof value !== 'string') {
      throw this.fail(ctx, `"${key}" must be a string, got ${this.describe(value)}`, `Write it as a JSON string, e.g. "${key}": "...".`);
    }
    if (spec.ref && !value.trim()) throw this.fail(ctx, `"${key}" must not be empty`);
    if (spec.alias && !ALIAS.test(value)) throw this.fail(ctx, `"${key}" must be an alias like "$check" ($ and a letter, then letters, digits, _ or -), got "${value}"`, `Example: "${key}": "$check", then "after": "$check" in a later op.`);
    if (spec.values && !spec.values.includes(value)) {
      throw this.fail(ctx, `"${key}" must be one of ${spec.values.map((allowedValue) => `"${allowedValue}"`).join(', ')}, got "${value}"`);
    }
    return value;
  }

  private checkBoolean(ctx: CommandLocation, key: string, value: unknown): boolean {
    if (typeof value !== 'boolean') {
      const hint = value === 'true' || value === 'false' ? `Use the JSON literal ${value}, not the string "${value}".` : `Write "${key}": true or false.`;
      throw this.fail(ctx, `"${key}" must be a boolean, got ${this.describe(value)}`, hint);
    }
    return value;
  }

  private checkInteger(ctx: CommandLocation, key: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw this.fail(ctx, `"${key}" must be a non-negative integer, got ${this.describe(value)}`);
    }
    return value;
  }

  private checkStringList(ctx: CommandLocation, key: string, spec: FieldSpec, value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw this.fail(ctx, `"${key}" must be an array of strings, got ${this.describe(value)}`, `Write "${key}": ["Id_1", "Id_2"].`);
    }
    const out: string[] = [];
    value.forEach((item, index) => {
      if (typeof item !== 'string' || !item.trim()) throw this.fail(ctx, `"${key}[${index}]" must be a non-empty string, got ${this.describe(item)}`);
      out.push(item);
    });
    if (spec.minItems && out.length < spec.minItems) {
      throw this.fail(ctx, `"${key}" needs at least ${spec.minItems} ${spec.minItems === 1 ? 'entry' : 'entries'}`);
    }
    return out;
  }

  private checkSize(ctx: CommandLocation, key: string, value: unknown): InsertSpace['by'] & {} {
    if (!parseSpaceAmount(value)) {
      throw this.fail(ctx, `"${key}" must be "column", "row", a number of them ("2col", "3rows") or pixels (an integer, "80px"); negative ("-column", "-2col", -80) closes space; got ${this.describe(value)}`);
    }
    return typeof value === 'string' && /^\s*-?\d+\s*$/.test(value) ? Number(value) : (value as InsertSpace['by'] & {});
  }

  private checkMap(ctx: CommandLocation, key: string, value: unknown): Record<string, string> {
    if (!this.isPlainObject(value)) {
      throw this.fail(ctx, `"${key}" must be an object of key/value pairs, got ${this.describe(value)}`, `Write "${key}": {"name": "..."}.`);
    }
    const out: Record<string, string> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (!entryKey.trim()) throw this.fail(ctx, `"${key}" contains an empty key`);
      if (typeof entryValue === 'string') out[entryKey] = entryValue;
      else if (typeof entryValue === 'number' || typeof entryValue === 'boolean') out[entryKey] = String(entryValue);
      else {
        throw this.fail(ctx, `"${key}.${entryKey}" must be a string (numbers and booleans are converted), got ${this.describe(entryValue)}`, entryValue === null ? `Use "" to remove a property (or "unset": ["${entryKey}"] in a set op).` : undefined);
      }
    }
    return out;
  }

  /** A common wrong shape is never accepted silently: the hint shows the op rewritten. */
  private shapeHint(value: Record<string, unknown>, key: string, fields: Record<string, FieldSpec>): { key: string; hint: string } | undefined {
    const op = typeof value['op'] === 'string' ? value['op'] : undefined;
    const show = (shown: Record<string, unknown>): string => JSON.stringify(shown);
    if (fields['id'] && value['id'] === undefined && ID_LIKE.has(key)) {
      const { [key]: id, ...rest } = value;
      return { key: 'id', hint: `${op ?? 'This op'} names its ${op === 'route' ? 'flow' : 'element'} with "id": ${show({ ...(op ? { op } : {}), id, ...Object.fromEntries(Object.entries(rest).filter(([fieldKey]) => fieldKey !== 'op' && fields[fieldKey])) })}.` };
    }
    if (fields['values'] && fields['unset']) {
      const props = Object.fromEntries(Object.entries(value).filter(([fieldKey]) => fieldKey !== 'op' && !fields[fieldKey]));
      const values = { ...(this.isPlainObject(value['values']) ? (value['values'] as Record<string, unknown>) : {}), ...props };
      const known = Object.fromEntries(Object.entries(value).filter(([fieldKey]) => fieldKey !== 'op' && fieldKey !== 'values' && fields[fieldKey]));
      return { key: 'values', hint: `${op ?? 'set'} takes the properties to set in "values" (an object): ${show({ ...(op ? { op } : {}), ...known, values })}.` };
    }
    return undefined;
  }

  private checkFields(ctx: CommandLocation, value: unknown, fields: Record<string, FieldSpec>): Record<string, unknown> {
    if (!this.isPlainObject(value)) throw this.fail(ctx, `expected an object, got ${this.describe(value)}`);
    const allowed = Object.keys(fields);
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (key === 'op') continue;
      const spec = fields[key];
      if (!spec) {
        const shape = this.shapeHint(value, key, fields);
        const alt = shape?.key ?? closestKey(key, allowed);
        throw this.fail(
          ctx,
          `unknown key "${key}"${alt ? ` (did you mean "${alt}"?)` : ''}; allowed keys: ${allowed.join(', ')}`,
          shape?.hint ?? 'Keys are the CLI flags in lowerCamelCase (--flow-name -> flowName). See `bpmn kinds --json` for the schema.',
          alt ? [alt] : [],
        );
      }
      if (raw === undefined || raw === null) continue;
      switch (spec.type) {
        case 'string':
          out[key] = this.checkString(ctx, key, spec, raw);
          break;
        case 'boolean':
          out[key] = this.checkBoolean(ctx, key, raw);
          break;
        case 'integer':
          out[key] = this.checkInteger(ctx, key, raw);
          break;
        case 'string[]':
          out[key] = this.checkStringList(ctx, key, spec, raw);
          break;
        case 'map':
          out[key] = this.checkMap(ctx, key, raw);
          break;
        case 'branches':
          out[key] = this.checkBranches(ctx, key, spec, raw);
          break;
        case 'nodes':
          out[key] = this.checkNodes(ctx, key, raw);
          break;
        case 'size':
          out[key] = this.checkSize(ctx, key, raw);
          break;
      }
    }
    for (const [key, spec] of Object.entries(fields)) {
      if (spec.required && out[key] === undefined) {
        throw this.fail(ctx, `missing required key "${key}" (${spec.description})`);
      }
    }
    return out;
  }

  private checkNodes(ctx: CommandLocation, key: string, value: unknown): SplitNode[] {
    if (!Array.isArray(value)) throw this.fail(ctx, `"${key}" must be an array of node objects, got ${this.describe(value)}`, 'An empty array is allowed: the branch is then a direct gateway -> join flow.');
    return value.map((node, index) => {
      const nctx: CommandLocation = { index: ctx.index, path: `${ctx.path}.${key}[${index}]` };
      const out = this.checkFields(nctx, node, NODE_FIELDS);
      const check = new CommandFieldCheck(nctx, out);
      check.kind();
      check.flowOptions(false);
      return out as unknown as SplitNode;
    });
  }

  private checkBranches(ctx: CommandLocation, key: string, spec: FieldSpec, value: unknown): SplitBranch[] {
    if (!Array.isArray(value)) throw this.fail(ctx, `"${key}" must be an array of branch objects, got ${this.describe(value)}`, 'Write "branches": [{"flowName": "yes", "nodes": [{"kind": "userTask", "name": "..."}]}].');
    if (spec.minItems && value.length < spec.minItems) throw this.fail(ctx, `"${key}" needs at least ${spec.minItems} branch`);
    return value.map((branch, index) => {
      const bctx: CommandLocation = { index: ctx.index, path: `${ctx.path} ${key}[${index}]` };
      const out = this.checkFields(bctx, branch, BRANCH_FIELDS);
      new CommandFieldCheck(bctx, out).flowOptions(false);
      return out as unknown as SplitBranch;
    });
  }

  private checkOp(ctx: CommandLocation, name: EditCommand['op'], raw: Record<string, unknown>): EditCommand {
    const definition = EditCommandDefinitions.of(name);
    const out = this.checkFields(ctx, raw, definition.fields);
    definition.check(new CommandFieldCheck(ctx, out));
    return { op: name, ...out } as unknown as EditCommand;
  }

  private parseOne(raw: unknown, index: number): EditCommand {
    const base: CommandLocation = { index, path: `ops[${index}]` };
    if (!this.isPlainObject(raw)) throw this.fail(base, `expected an op object, got ${this.describe(raw)}`, 'Every entry looks like {"op": "add", ...}.');
    const name = raw['op'];
    if (name === undefined) throw this.fail(base, `missing "op"; one of: ${OP_NAMES.join(', ')}`);
    if (typeof name !== 'string' || !(OP_NAMES as string[]).includes(name)) {
      const alt = typeof name === 'string' ? closestKey(name, OP_NAMES) : undefined;
      throw this.fail(base, `unknown op ${JSON.stringify(name)}${alt ? ` (did you mean "${alt}"?)` : ''}; one of: ${OP_NAMES.join(', ')}`, undefined, alt ? [alt] : []);
    }
    return this.checkOp({ index, path: `ops[${index}] (${name})` }, name as EditCommand['op'], raw);
  }

  /** Validates the ops JSON (an array or `{ ops: [...] }`) and returns typed ops. */
  parse(input: unknown): EditCommand[] {
    let ops: unknown;
    if (Array.isArray(input)) ops = input;
    else if (this.isPlainObject(input) && Array.isArray(input['ops'])) {
      const extra = Object.keys(input).filter((inputKey) => inputKey !== 'ops' && inputKey !== '$schema');
      if (extra.length) throw usageError(`Unknown top-level key${extra.length > 1 ? 's' : ''} ${extra.map((extraKey) => `"${extraKey}"`).join(', ')}; expected only "ops"`, { hint: 'The ops file is {"ops": [...]} or a plain array of ops.' });
      ops = input['ops'];
    } else {
      throw usageError(`Expected an array of ops or an object {"ops": [...]}, got ${this.describe(input)}`, {
        hint: 'Run `bpmn guide` for the format and `bpmn kinds --json` for the JSON schema (key "ops").',
      });
    }
    const list = ops as unknown[];
    if (!list.length) throw usageError('The ops list is empty', { hint: 'Add at least one op, e.g. {"op": "add", "kind": "userTask", "name": "Check invoice", "after": "Event_Start"}.' });
    const parsed = list.map((raw, index) => this.parseOne(raw, index));
    this.checkAliases(parsed);
    return parsed;
  }

  /** Before anything runs: every alias defined once and used only after the op defining it. */
  private checkAliases(ops: readonly EditCommand[]): void {
    const defined = new Map<string, number>();
    const all = new Map<string, number>();
    ops.forEach((op, opIndex) => {
      for (const alias of new OpAliases(op).defined()) if (!all.has(alias)) all.set(alias, opIndex);
    });
    ops.forEach((op, opIndex) => {
      const raw = op as unknown as Record<string, unknown>;
      for (const [key, aliasKey] of Object.entries(EditCommandDefinitions.of(op.op).aliasKeyOfNewId)) {
        if (typeof raw[key] === 'string' && (raw[key] as string).startsWith('$')) {
          throw usageError(`ops[${opIndex}] (${op.op}): "${key}" is the id of the new element, not an alias; give the alias with "${aliasKey}": "${raw[key]}"`, { op: opIndex });
        }
      }
      for (const { key, alias } of new OpAliases(op).references()) {
        if (!defined.has(alias)) throw unknownAlias(opIndex, op, key, alias, defined, all.get(alias));
      }
      for (const alias of new OpAliases(op).defined()) {
        if (!ALIAS.test(alias)) throw usageError(`ops[${opIndex}] (${op.op}): alias "${alias}" must look like $name ($ and a letter, then letters, digits, _ or -)`, { op: opIndex, hint: 'Example: "as": "$check", then "after": "$check".' });
        if (defined.has(alias)) {
          throw new CliError('E_DUPLICATE_ALIAS', `ops[${opIndex}] (${op.op}): alias ${alias} is already defined by ops[${defined.get(alias)}]`, 'usage', { op: opIndex, hint: 'Every alias names one element of the batch: pick another name.' });
        }
        defined.set(alias, opIndex);
      }
    });
  }
}
