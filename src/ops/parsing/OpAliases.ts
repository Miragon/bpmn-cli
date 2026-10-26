import type { Op } from '../types.js';
import type { AliasTable } from './AliasTable.js';
import { isAlias } from './utils/aliases.js';
import { NODE_FIELDS, OP_FIELDS } from './utils/op-fields.js';

/** Keys that hold an element id (or a list of them) per op: where an alias may stand. */
const REF_KEYS: Record<Op['op'], readonly string[]> = {
  add: ['after', 'before', 'flow', 'in', 'on', 'to', 'lane', 'process', 'members'],
  connect: ['source', 'target'],
  set: ['id'],
  remove: ['ids'],
  retype: ['id'],
  move: ['ids', 'after', 'before', 'flow', 'in', 'lane'],
  order: ['id', 'flows', 'lanes', 'pools'],
  ext: ['id'],
  split: ['after'],
  place: ['ids', 'path', 'via', 'branch', 'rowOf', 'below', 'above', 'columnOf', 'after', 'before'],
  align: ['ids', 'path', 'via', 'branch', 'to'],
  color: ['ids', 'path', 'via', 'branch'],
  label: ['id'],
  route: ['id'],
  space: ['after', 'below'],
  tidy: ['ids', 'path', 'via', 'branch'],
  compact: ['ids'],
};

/** `set` keys whose value is an element id. */
const SET_REF_KEYS: readonly string[] = ['default', 'source', 'target', 'lane'];

const DEF_KEYS = Object.fromEntries(Object.entries(OP_FIELDS).map(([name, fields]) => [name, Object.keys(fields).filter((key) => fields[key]!.alias)])) as Partial<Record<Op['op'], readonly string[]>>;

const NODE_DEF_KEYS = Object.keys(NODE_FIELDS).filter((key) => NODE_FIELDS[key as keyof typeof NODE_FIELDS].alias);

type Raw = Record<string, unknown>;

type Slot = { key: string; get: () => unknown; put: (slotValue: unknown) => void; holder: Raw; name: string };

/**
 * Batch aliases (`"as": "$check"`): later ops of an `apply` batch use them wherever an element
 * id goes, so generated ids need not be guessed. `$` cannot occur in a BPMN id; `${...}`
 * expressions are not ids.
 */
export class OpAliases {
  constructor(private readonly op: Op) {}

  /** The aliases the op defines (a split: also its branch nodes'). */
  defined(): string[] {
    const op = this.op;
    const raw = op as unknown as Raw;
    const out = (DEF_KEYS[op.op] ?? []).map((defKey) => raw[defKey]).filter((definedId): definedId is string => typeof definedId === 'string');
    if (op.op === 'split') {
      this.eachObject(op.branches, (branch) =>
        this.eachObject(branch['nodes'], (node) => {
          for (const defKey of NODE_DEF_KEYS) if (typeof node[defKey] === 'string') out.push(node[defKey] as string);
        }),
      );
    }
    return out;
  }

  referencedIds(): string[] {
    const out: string[] = [];
    for (const slot of this.slots(this.op)) {
      const slotValue = slot.get();
      if (typeof slotValue === 'string') out.push(slotValue);
      else if (Array.isArray(slotValue)) for (const entry of slotValue) if (typeof entry === 'string') out.push(entry);
    }
    return out;
  }

  /** Every alias the op refers to, with the key it stands in (`ids[1]`, `values.default`). */
  references(): Array<{ key: string; alias: string }> {
    const out: Array<{ key: string; alias: string }> = [];
    for (const slot of this.slots(this.op)) {
      const slotValue = slot.get();
      if (isAlias(slotValue)) out.push({ key: slot.key, alias: slotValue });
      else if (Array.isArray(slotValue)) slotValue.forEach((entry, index) => isAlias(entry) && out.push({ key: `${slot.key}[${index}]`, alias: entry }));
    }
    return out;
  }

  resolve(table: AliasTable, index: number): Op {
    const op = this.op;
    if (!this.references().length) return op;
    const copy = JSON.parse(JSON.stringify(op)) as Op;
    const id = (alias: string, key: string): string => table.idOf(alias, index, op, key);
    for (const slot of this.slots(copy)) {
      const slotValue = slot.get();
      if (isAlias(slotValue)) slot.put(id(slotValue, slot.key));
      else if (Array.isArray(slotValue)) slot.put(slotValue.map((entry, entryIndex) => (isAlias(entry) ? id(entry, `${slot.key}[${entryIndex}]`) : entry)));
    }
    return copy;
  }

  private slots(op: Op): Slot[] {
    const out: Slot[] = [];
    const slot = (holder: Raw, name: string, key: string): void => {
      out.push({ key, holder, name, get: () => holder[name], put: (slotValue) => (holder[name] = slotValue) });
    };
    const raw = op as unknown as Raw;
    for (const key of REF_KEYS[op.op] ?? []) slot(raw, key, key);
    const map = (holder: Raw, name: string, path: string): void => {
      const member = holder[name];
      if (member && typeof member === 'object') for (const refKey of SET_REF_KEYS) slot(member as Raw, refKey, `${path}.${refKey}`);
    };
    if (op.op === 'set') map(raw, 'values', 'values');
    if (op.op === 'add') map(raw, 'set', 'set');
    if (op.op === 'split') {
      this.eachObject(op.branches, (branch, branchIndex) =>
        this.eachObject(branch['nodes'], (node, nodeIndex) => {
          slot(node, 'lane', `branches[${branchIndex}].nodes[${nodeIndex}].lane`);
          map(node, 'set', `branches[${branchIndex}].nodes[${nodeIndex}].set`);
        }),
      );
    }
    return out;
  }

  /** Typed library ops skip parsing: a malformed split list must reach splitFlow's own check. */
  private eachObject(list: unknown, fn: (item: Raw, index: number) => void): void {
    if (Array.isArray(list)) list.forEach((item, index) => item && typeof item === 'object' && fn(item as Raw, index));
  }
}
