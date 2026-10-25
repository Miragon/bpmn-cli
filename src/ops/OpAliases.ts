import type { Op } from './types.js';
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

type Slot = { key: string; get: () => unknown; put: (v: unknown) => void; holder: Raw; name: string };

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
    const out = (DEF_KEYS[op.op] ?? []).map((k) => raw[k]).filter((v): v is string => typeof v === 'string');
    if (op.op === 'split') {
      this.eachObject(op.branches, (b) =>
        this.eachObject(b['nodes'], (n) => {
          for (const k of NODE_DEF_KEYS) if (typeof n[k] === 'string') out.push(n[k] as string);
        }),
      );
    }
    return out;
  }

  referencedIds(): string[] {
    const out: string[] = [];
    for (const s of this.slots(this.op)) {
      const v = s.get();
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
    }
    return out;
  }

  /** Every alias the op refers to, with the key it stands in (`ids[1]`, `values.default`). */
  references(): Array<{ key: string; alias: string }> {
    const out: Array<{ key: string; alias: string }> = [];
    for (const s of this.slots(this.op)) {
      const v = s.get();
      if (isAlias(v)) out.push({ key: s.key, alias: v });
      else if (Array.isArray(v)) v.forEach((x, i) => isAlias(x) && out.push({ key: `${s.key}[${i}]`, alias: x }));
    }
    return out;
  }

  resolve(table: AliasTable, index: number): Op {
    const op = this.op;
    if (!this.references().length) return op;
    const copy = JSON.parse(JSON.stringify(op)) as Op;
    const id = (alias: string, key: string): string => table.idOf(alias, index, op, key);
    for (const s of this.slots(copy)) {
      const v = s.get();
      if (isAlias(v)) s.put(id(v, s.key));
      else if (Array.isArray(v)) s.put(v.map((x, i) => (isAlias(x) ? id(x, `${s.key}[${i}]`) : x)));
    }
    return copy;
  }

  private slots(op: Op): Slot[] {
    const out: Slot[] = [];
    const slot = (holder: Raw, name: string, key: string): void => {
      out.push({ key, holder, name, get: () => holder[name], put: (v) => (holder[name] = v) });
    };
    const raw = op as unknown as Raw;
    for (const key of REF_KEYS[op.op] ?? []) slot(raw, key, key);
    const map = (holder: Raw, name: string, path: string): void => {
      const m = holder[name];
      if (m && typeof m === 'object') for (const k of SET_REF_KEYS) slot(m as Raw, k, `${path}.${k}`);
    };
    if (op.op === 'set') map(raw, 'values', 'values');
    if (op.op === 'add') map(raw, 'set', 'set');
    if (op.op === 'split') {
      this.eachObject(op.branches, (b, i) =>
        this.eachObject(b['nodes'], (n, j) => {
          slot(n, 'lane', `branches[${i}].nodes[${j}].lane`);
          map(n, 'set', `branches[${i}].nodes[${j}].set`);
        }),
      );
    }
    return out;
  }

  /** Typed library ops skip parsing: a malformed split list must reach splitFlow's own check. */
  private eachObject(list: unknown, fn: (item: Raw, i: number) => void): void {
    if (Array.isArray(list)) list.forEach((item, i) => item && typeof item === 'object' && fn(item as Raw, i));
  }
}
