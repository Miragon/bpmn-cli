import { usageError } from '../document/utils/errors.js';
import { CliError } from '../document/CliError.js';
import { closestKey } from '../document/utils/fuzzy.js';
import { FLOW_NODE_FAMILIES, kindByName, gatewayKindList, normalizeTrigger, parseKind, type Family } from '../document/utils/kinds.js';
import { KindError } from '../document/KindError.js';
import { OpAliases } from './OpAliases.js';
import { ALIAS, unknownAlias } from './utils/aliases.js';
import { defaultWithConditionViolation, groupViolation, placementViolation } from './utils/op-rules.js';
import { OP_NAMES } from './utils/op-names.js';
import { parseSpaceAmount } from './utils/space-amount.js';
import type { FieldSpec, SplitNode } from './utils/field-specs.js';
import { BRANCH_FIELDS, FLOW_KEYS, NODE_FIELDS, OP_FIELDS, PLACE_GROUPS, PLACEMENT_KEYS, TRIGGER_KEYS } from './utils/op-fields.js';
import type { EditCommand, InsertSpace, SplitBranch } from './types.js';

interface Ctx {
  index: number;
  /** e.g. `ops[2] (split) branches[0].nodes[1]` */
  path: string;
}

/** Keys people write for the element where the op says "id". */
const ID_LIKE = new Set(['flowId', 'flow', 'elementId', 'element', 'nodeId', 'node', 'target', 'ref']);

/** An alias in a new-id key is a mistake: `as` defines one. */
const NEW_ID_KEYS: Partial<Record<EditCommand['op'], readonly string[]>> = { add: ['id', 'flowId'], connect: ['id'], split: ['id', 'joinId'] };


/**
 * Validates the JSON ops format of `bpmn apply` by walking the op field specs, without a schema
 * library. Every problem is a usage error naming `ops[<index>] (<op>)`.
 */
export class CommandParser {
  private fail(ctx: Ctx, message: string, hint?: string, candidates?: string[]): CliError {
    return usageError(`${ctx.path}: ${message}`, {
      op: ctx.index,
      ...(hint ? { hint } : {}),
      ...(candidates?.length ? { candidates } : {}),
    });
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

  private checkString(ctx: Ctx, key: string, spec: FieldSpec, value: unknown): string {
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

  private checkBoolean(ctx: Ctx, key: string, value: unknown): boolean {
    if (typeof value !== 'boolean') {
      const hint = value === 'true' || value === 'false' ? `Use the JSON literal ${value}, not the string "${value}".` : `Write "${key}": true or false.`;
      throw this.fail(ctx, `"${key}" must be a boolean, got ${this.describe(value)}`, hint);
    }
    return value;
  }

  private checkInteger(ctx: Ctx, key: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw this.fail(ctx, `"${key}" must be a non-negative integer, got ${this.describe(value)}`);
    }
    return value;
  }

  private checkStringList(ctx: Ctx, key: string, spec: FieldSpec, value: unknown): string[] {
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

  private checkSize(ctx: Ctx, key: string, value: unknown): InsertSpace['by'] & {} {
    if (!parseSpaceAmount(value)) {
      throw this.fail(ctx, `"${key}" must be "column", "row", a number of them ("2col", "3rows") or pixels (an integer, "80px"); negative ("-column", "-2col", -80) closes space; got ${this.describe(value)}`);
    }
    return typeof value === 'string' && /^\s*-?\d+\s*$/.test(value) ? Number(value) : (value as InsertSpace['by'] & {});
  }

  private checkMap(ctx: Ctx, key: string, value: unknown): Record<string, string> {
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

  private checkFields(ctx: Ctx, value: unknown, fields: Record<string, FieldSpec>): Record<string, unknown> {
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

  private quoted(field: string): string {
    return `"${field}"`;
  }

  private presentKeys(obj: Record<string, unknown>, keys: readonly string[]): string[] {
    return keys.filter((candidateKey) => obj[candidateKey] !== undefined);
  }

  private checkPlacement(ctx: Ctx, obj: Record<string, unknown>): void {
    const violation = placementViolation(this.presentKeys(obj, PLACEMENT_KEYS), this.quoted);
    if (violation) throw this.fail(ctx, violation.message, violation.hint);
  }

  /** Flow options describe the flow INTO the node: they need a placement that creates one. */
  private checkFlowOptions(ctx: Ctx, obj: Record<string, unknown>, needsPlacement: boolean): void {
    const conditionedDefault = defaultWithConditionViolation(obj['default'] === true, obj['condition'] !== undefined, this.quoted);
    if (conditionedDefault) throw this.fail(ctx, conditionedDefault.message, conditionedDefault.hint);
    if (!needsPlacement) return;
    const used = this.presentKeys(obj, [...FLOW_KEYS, 'flowAs']);
    const createsFlow = obj['after'] !== undefined || obj['before'] !== undefined || obj['flow'] !== undefined;
    if (used.length && !createsFlow) {
      throw this.fail(ctx, `${used.map((usedKey) => `"${usedKey}"`).join(', ')} describe the flow into the node and need "after", "before" or "flow"`, 'With "in" or "on" no sequence flow is created; connect the node afterwards with a connect op.');
    }
  }

  /** Trigger options are only meaningful on events. */
  private checkKind(ctx: Ctx, obj: Record<string, unknown>, expectFamily?: string): Family | undefined {
    const kind = obj['kind'];
    if (typeof kind !== 'string') return;
    let family: Family;
    // `eventSubProcess:<trigger>` creates the event sub-process together with its start event
    const eventSub = /^(eventSubProcess|eventSub|bpmn:eventSubProcess):(.+)$/i.exec(kind);
    if (eventSub) {
      const trigger = normalizeTrigger(eventSub[2]!);
      const allowed: string[] = (kindByName('startEvent')?.triggers ?? []).filter((startTrigger) => startTrigger !== 'none');
      if (!trigger || !allowed.includes(trigger)) {
        throw this.fail(ctx, `Trigger "${eventSub[2]}" is not allowed on eventSubProcess. Allowed: ${allowed.join(', ')}`, 'eventSubProcess:<trigger> creates the event sub-process with a startEvent:<trigger> inside, e.g. eventSubProcess:error with "error": "PaymentFailed".', allowed);
      }
      return 'subProcess'; // trigger options are meaningful here (they configure the start event)
    }
    try {
      family = parseKind(kind).def.family;
    } catch (err) {
      if (err instanceof KindError) throw this.fail(ctx, err.message, 'Run `bpmn kinds` for the list of kinds and triggers.', err.candidates);
      throw err;
    }
    if (expectFamily && family !== expectFamily) {
      throw this.fail(ctx, `"kind" must be a ${expectFamily} kind, "${kind}" is a ${family}`, expectFamily === 'gateway' ? `Use ${gatewayKindList()}.` : undefined);
    }
    // send and receive tasks reference a message too
    const messageTask = ['sendTask', 'receiveTask'].includes(parseKind(kind).def.kind);
    const triggers = this.presentKeys(obj, TRIGGER_KEYS).filter((triggerKey) => !(messageTask && triggerKey === 'message'));
    if (triggers.length && family !== 'event') {
      throw this.fail(ctx, `${triggers.map((triggerKey) => `"${triggerKey}"`).join(', ')} only apply to events, but "${kind}" is a ${family}`, 'Use an event kind such as startEvent:timer or boundaryEvent:message, or drop the trigger options.');
    }
    return family;
  }

  /** Refused up front where neither the kind nor the keys create a flow out of the new node. */
  private checkOutAs(ctx: Ctx, out: Record<string, unknown>, family: Family | undefined): void {
    if (out['outAs'] === undefined) return;
    if (family && !FLOW_NODE_FAMILIES.has(family)) {
      throw this.fail(ctx, `"outAs": add ${out['kind']} creates no sequence flow out of it`, 'Drop "outAs"; name a connection with a connect op that has "as".');
    }
    if (out['after'] === undefined && out['before'] === undefined && out['flow'] === undefined && out['to'] === undefined) {
      throw this.fail(ctx, '"outAs" names the flow out of the node and needs "after", "before", "flow" or "to"', 'With "in" or "on" alone no sequence flow leaves the node; give "to", or connect the node with a connect op that has "as".');
    }
  }

  private checkNodes(ctx: Ctx, key: string, value: unknown): SplitNode[] {
    if (!Array.isArray(value)) throw this.fail(ctx, `"${key}" must be an array of node objects, got ${this.describe(value)}`, 'An empty array is allowed: the branch is then a direct gateway -> join flow.');
    return value.map((node, index) => {
      const nctx: Ctx = { index: ctx.index, path: `${ctx.path}.${key}[${index}]` };
      const out = this.checkFields(nctx, node, NODE_FIELDS);
      this.checkKind(nctx, out);
      this.checkFlowOptions(nctx, out, false);
      return out as unknown as SplitNode;
    });
  }

  private checkBranches(ctx: Ctx, key: string, spec: FieldSpec, value: unknown): SplitBranch[] {
    if (!Array.isArray(value)) throw this.fail(ctx, `"${key}" must be an array of branch objects, got ${this.describe(value)}`, 'Write "branches": [{"flowName": "yes", "nodes": [{"kind": "userTask", "name": "..."}]}].');
    if (spec.minItems && value.length < spec.minItems) throw this.fail(ctx, `"${key}" needs at least ${spec.minItems} branch`);
    return value.map((branch, index) => {
      const bctx: Ctx = { index: ctx.index, path: `${ctx.path} ${key}[${index}]` };
      const out = this.checkFields(bctx, branch, BRANCH_FIELDS);
      this.checkFlowOptions(bctx, out, false);
      return out as unknown as SplitBranch;
    });
  }

  private checkExt(ctx: Ctx, obj: Record<string, unknown>): void {
    const addOnly = ['attrs', 'body', 'xml', 'replace'];
    if (obj['action'] === 'add') {
      if (obj['type'] === undefined && obj['xml'] === undefined) throw this.fail(ctx, 'ext add needs "type" (plus optional "attrs"/"body") or "xml"', 'Example: {"op":"ext","id":"Activity_X","action":"add","type":"zeebe:taskDefinition","attrs":{"type":"my-worker"}}.');
      if (obj['index'] !== undefined) throw this.fail(ctx, '"index" only applies to action "remove"');
      if (obj['xml'] !== undefined && (obj['attrs'] !== undefined || obj['body'] !== undefined)) throw this.fail(ctx, '"xml" cannot be combined with "attrs" or "body"', 'Put everything into the XML snippet, or use type + attrs + body.');
    } else {
      const bad = this.presentKeys(obj, addOnly);
      if (bad.length) throw this.fail(ctx, `${bad.map((badKey) => `"${badKey}"`).join(', ')} only apply to action "add"`);
      const hasType = obj['type'] !== undefined;
      const hasIndex = obj['index'] !== undefined;
      if (hasType === hasIndex) throw this.fail(ctx, 'ext remove needs exactly one of "type" or "index"', 'Run `bpmn ext list <file> <id>` to see types and indexes.');
    }
  }

  private checkGroups(ctx: Ctx, obj: Record<string, unknown>, groups: string[][], atLeastOne: string): void {
    const violation = groupViolation(this.presentKeys(obj, groups.flat()), groups, this.quoted);
    if (violation) throw this.fail(ctx, violation.message, violation.hint);
    if (!this.presentKeys(obj, groups.flat()).length) throw this.fail(ctx, atLeastOne);
  }

  private hasSelector(obj: Record<string, unknown>): boolean {
    return this.presentKeys(obj, ['path', 'kind', 'branch']).length > 0;
  }

  private checkSelection(ctx: Ctx, obj: Record<string, unknown>, needed: boolean): void {
    if (needed && obj['ids'] === undefined && !this.hasSelector(obj)) throw this.fail(ctx, 'give "ids" and / or a selector ("path", "kind", "branch")', 'Example: {"op":"color","path":["Event_Start","Event_Done"],"color":"green"}.');
    const path = obj['path'] as string[] | undefined;
    if (path && path.length !== 2) throw this.fail(ctx, `"path" takes exactly two ids (from and to), got ${path.length}`, 'Example: "path": ["Event_Start", "Event_Done"], "via": ["Flow_Yes"].');
    if (obj['via'] !== undefined && !path) throw this.fail(ctx, '"via" needs "path"');
  }

  private checkOp(ctx: Ctx, name: EditCommand['op'], raw: Record<string, unknown>): EditCommand {
    const out = this.checkFields(ctx, raw, OP_FIELDS[name]);
    switch (name) {
      case 'add':
        this.checkOutAs(ctx, out, this.checkKind(ctx, out));
        this.checkPlacement(ctx, out);
        this.checkFlowOptions(ctx, out, true);
        if (out['ifAbsent'] === true && out['id'] === undefined) throw this.fail(ctx, '"ifAbsent" needs an explicit "id" to check for', 'Add "id": "<Prefix>_<Name>" or drop ifAbsent.');
        break;
      case 'connect':
        this.checkFlowOptions(ctx, out, false);
        break;
      case 'set': {
        const values = (out['values'] as Record<string, string> | undefined) ?? {};
        const unset = (out['unset'] as string[] | undefined) ?? [];
        if (!Object.keys(values).length && !unset.length) throw this.fail(ctx, 'nothing to do: "values" is empty and "unset" is missing', 'Example: {"op":"set","id":"Activity_X","values":{"name":"New name"}}.');
        out['values'] = values;
        break;
      }
      case 'retype':
        this.checkKind(ctx, out);
        break;
      case 'move':
        this.checkPlacement(ctx, out);
        this.checkFlowOptions(ctx, out, true);
        if (!this.presentKeys(out, PLACEMENT_KEYS).length && out['lane'] === undefined) throw this.fail(ctx, 'nothing to do: give a placement (after/before/flow/in) and/or "lane"');
        break;
      case 'ext':
        this.checkExt(ctx, out);
        break;
      case 'split':
        this.checkKind(ctx, out, 'gateway');
        break;
      case 'order': {
        const given = ['flows', 'lanes', 'pools'].filter((givenKey) => out[givenKey] !== undefined);
        if (given.length !== 1) {
          throw this.fail(ctx, `give exactly one of "flows" (outgoing flows of a node), "lanes" (lanes of a pool / process / parent lane) or "pools" (participants of a collaboration)`, 'Example: {"op":"order","id":"Gateway_Ok","flows":["Flow_OkToFix","Flow_OkToBook"]}, {"op":"order","id":"Participant_X","lanes":["Lane_B","Lane_A"]} or {"op":"order","id":"Collaboration_X","pools":["Participant_Customer","Participant_X"]}.');
        }
        break;
      }
      case 'place':
        this.checkSelection(ctx, out, true);
        if (out['side'] !== undefined) {
          const with_ = PLACE_GROUPS.flat().filter((placeKey) => out[placeKey] !== undefined);
          if (with_.length) throw this.fail(ctx, `"side" moves a boundary event to a border of its host; it cannot be combined with ${with_.map((placeKey) => `"${placeKey}"`).join(', ')}`, 'Example: {"op":"place","ids":["Event_Overdue"],"side":"top"}.');
          if (this.hasSelector(out) || (out['ids'] as string[] | undefined)?.length !== 1) throw this.fail(ctx, '"side" takes exactly one id (the boundary event)', 'Example: {"op":"place","ids":["Event_Overdue"],"side":"top"}.');
          break;
        }
        this.checkGroups(ctx, out, PLACE_GROUPS, 'nothing to do: give a row ("rowOf", "below" or "above") and/or a column ("columnOf", "after" or "before"), or "side" for a boundary event');
        break;
      case 'align':
        this.checkSelection(ctx, out, true);
        if (!this.hasSelector(out) && (out['ids'] as string[]).length < 2 && out['to'] === undefined) throw this.fail(ctx, 'align needs two ids, or one id and "to"', 'Example: {"op":"align","ids":["Event_A","Event_B"],"axis":"column"}.');
        break;
      case 'color':
        this.checkSelection(ctx, out, true);
        break;
      case 'tidy':
        this.checkSelection(ctx, out, false);
        break;
      case 'space':
        this.checkGroups(ctx, out, [['after', 'below']], 'give "after" (horizontal space right of an element) or "below" (vertical space below it)');
        break;
      case 'remove':
      case 'label':
      case 'route':
      case 'compact':
        break;
    }
    return { op: name, ...out } as unknown as EditCommand;
  }

  private parseOne(raw: unknown, index: number): EditCommand {
    const base: Ctx = { index, path: `ops[${index}]` };
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
      for (const key of NEW_ID_KEYS[op.op] ?? []) {
        if (typeof raw[key] === 'string' && (raw[key] as string).startsWith('$')) {
          throw usageError(`ops[${opIndex}] (${op.op}): "${key}" is the id of the new element, not an alias; give the alias with "${key === 'flowId' ? 'flowAs' : key === 'joinId' ? 'joinAs' : 'as'}": "${raw[key]}"`, { op: opIndex });
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
