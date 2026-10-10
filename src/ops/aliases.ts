/**
 * Batch aliases: an op of an `apply` batch names an element it creates
 * (`"as": "$check"`; add also `"flowAs"`: the flow into the new node; split
 * `"joinAs"`: its join gateway; the nodes of a split branch take `as` /
 * `flowAs` too), and later ops of the batch use the alias wherever an
 * element id goes (`"after": "$check"`, `"ids": ["$check", "$f"]`, the id of
 * set / ext / retype / order (and its flows, lanes, pools) and of the format
 * ops with their selectors (`path`, `via`, `branch`), `values.default` /
 * `source` / `target` / `lane` of set and the same keys of the `set` map of
 * add and of split nodes, the `lane` of split nodes). Generated ids need not
 * be guessed.
 *
 * CONTRACT
 *  - An alias is `$` + a letter or `_` + letters, digits, `_`, `-`. A value
 *    of an id field that starts with `$` is an alias (BPMN ids cannot
 *    contain `$`); `${...}` expressions are not ids.
 *  - checkAliases(ops) (parseOps, before anything runs): every alias is
 *    defined once (E_DUPLICATE_ALIAS) and used only after the op that
 *    defines it (E_UNKNOWN_ALIAS: the message lists the aliases defined so
 *    far); an alias in a field that names a new id (`id`, `flowId`,
 *    `joinId`) is a usage error that points to `as`.
 *  - AliasTable binds an alias to the element itself, so it follows a
 *    rename later in the batch (ops/flows.ts followEnds); resolveOp(op)
 *    returns a copy of the op with every alias replaced by the element's
 *    current id (an alias of a removed element is E_NOT_FOUND). The format
 *    ops run after the layout: runBatch (ops/index.ts) resolves them with
 *    the ids at the end of the batch.
 *  - The result lists every alias with its element's final id
 *    (MutationResult.aliases, the `aliases:` line).
 */
import type { Doc } from '../document.js';
import { CliError, usageError } from '../errors.js';
import { editDistance, typoTolerance } from '../ids.js';
import type { El } from '../model.js';
import type { Op } from './types.js';

export const ALIAS = /^\$[A-Za-z_][A-Za-z0-9_-]*$/;

/** A value that is meant as an alias (`$check`; not an expression like `${ok}`). */
export function isAlias(value: unknown): value is string {
  return typeof value === 'string' && ALIAS.test(value);
}

/** Keys that hold an element id (or a list of them) per op: where an alias may stand. */
export const REF_KEYS: Record<Op['op'], readonly string[]> = {
  add: ['after', 'before', 'flow', 'in', 'on', 'to', 'lane', 'process', 'members'],
  connect: ['source', 'target'],
  set: ['id'],
  remove: ['ids'],
  retype: ['id'],
  move: ['ids', 'after', 'before', 'flow', 'in', 'lane'],
  order: ['id', 'flows', 'lanes', 'pools'],
  ext: ['id'],
  split: ['after'],
  // the selectors of place / align / color / tidy (diagram/select.ts) name elements too: path, via, branch
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
export const SET_REF_KEYS: readonly string[] = ['default', 'source', 'target', 'lane'];

/** Keys that name the id of a new element: an alias there is a mistake (`as` gives one). */
const NEW_ID_KEYS: Partial<Record<Op['op'], readonly string[]>> = { add: ['id', 'flowId'], connect: ['id'], split: ['id', 'joinId'] };

/** Keys that define an alias, per op. */
const DEF_KEYS: Partial<Record<Op['op'], readonly string[]>> = { add: ['as', 'flowAs'], connect: ['as'], split: ['as', 'joinAs'] };

const NODE_DEF_KEYS = ['as', 'flowAs'] as const;

type Raw = Record<string, unknown>;

/** The aliases an op defines (a split: also its branch nodes'). */
export function definedBy(op: Op): string[] {
  const raw = op as unknown as Raw;
  const out = (DEF_KEYS[op.op] ?? []).map((k) => raw[k]).filter((v): v is string => typeof v === 'string');
  if (op.op === 'split') for (const b of op.branches ?? []) for (const n of b.nodes ?? []) for (const k of NODE_DEF_KEYS) if (typeof n[k] === 'string') out.push(n[k]!);
  return out;
}

/** Where an op may hold aliases: [key path, read, write] (top-level id keys, set maps, the lane of split nodes). */
function slots(op: Op): Array<{ key: string; get: () => unknown; put: (v: unknown) => void; holder: Raw; name: string }> {
  const out: Array<{ key: string; get: () => unknown; put: (v: unknown) => void; holder: Raw; name: string }> = [];
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
    (op.branches ?? []).forEach((b, i) =>
      (b.nodes ?? []).forEach((n, j) => {
        slot(n as unknown as Raw, 'lane', `branches[${i}].nodes[${j}].lane`);
        map(n as unknown as Raw, 'set', `branches[${i}].nodes[${j}].set`);
      }),
    );
  }
  return out;
}

/** Every element id an op names in its id keys (REF_KEYS; after resolveOp: no aliases left). */
export function referencedIds(op: Op): string[] {
  const out: string[] = [];
  for (const s of slots(op)) {
    const v = s.get();
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
  }
  return out;
}

/** Every alias an op refers to, with the key it stands in (`ids[1]`, `values.default`). */
export function referencesOf(op: Op): Array<{ key: string; alias: string }> {
  const out: Array<{ key: string; alias: string }> = [];
  for (const s of slots(op)) {
    const v = s.get();
    if (isAlias(v)) out.push({ key: s.key, alias: v });
    else if (Array.isArray(v)) v.forEach((x, i) => isAlias(x) && out.push({ key: `${s.key}[${i}]`, alias: x }));
  }
  return out;
}

function listing(defined: ReadonlyMap<string, number>): string {
  return defined.size ? `defined so far: ${[...defined].map(([a, i]) => `${a} (ops[${i}])`).join(', ')}` : 'no op before it defines one';
}

function unknownAlias(index: number, op: Op, key: string, alias: string, defined: ReadonlyMap<string, number>, later?: number): CliError {
  const where = later === undefined ? '' : later === index ? ' yet (this op defines it: only the ops after it can use it)' : later > index ? ` before this op (ops[${later}] defines it)` : '';
  // the defined aliases, the closest spelling first (case and typos: $chek -> $check)
  const distance = (a: string): number => editDistance(a.toLowerCase(), alias.toLowerCase());
  const candidates = [...defined.keys()].sort((a, b) => distance(a) - distance(b));
  const close = candidates[0] !== undefined && later === undefined && distance(candidates[0]) <= Math.max(1, typoTolerance(alias.length)) ? ` (did you mean ${candidates[0]}?)` : '';
  return new CliError('E_UNKNOWN_ALIAS', `ops[${index}] (${op.op}): "${key}": alias ${alias} is not defined${where}${close}; ${listing(defined)}`, 'usage', {
    op: index,
    candidates,
    hint: 'An op defines an alias with "as": "$name" (add, connect, split and the nodes of a split branch), "flowAs" (add: the flow into the new node) or "joinAs" (split: the join gateway); only the ops after it can use it.',
  });
}

/**
 * Checks the aliases of a batch before anything runs (see the module
 * contract). Throws a usage error naming the op.
 */
export function checkAliases(ops: readonly Op[]): void {
  const defined = new Map<string, number>();
  const all = new Map<string, number>();
  ops.forEach((op, i) => {
    for (const a of definedBy(op)) if (!all.has(a)) all.set(a, i);
  });
  ops.forEach((op, i) => {
    const raw = op as unknown as Raw;
    for (const key of NEW_ID_KEYS[op.op] ?? []) {
      if (typeof raw[key] === 'string' && (raw[key] as string).startsWith('$')) {
        throw usageError(`ops[${i}] (${op.op}): "${key}" is the id of the new element, not an alias; give the alias with "${key === 'flowId' ? 'flowAs' : key === 'joinId' ? 'joinAs' : 'as'}": "${raw[key]}"`, { op: i });
      }
    }
    for (const { key, alias } of referencesOf(op)) {
      if (!defined.has(alias)) throw unknownAlias(i, op, key, alias, defined, all.get(alias));
    }
    for (const a of definedBy(op)) {
      if (!ALIAS.test(a)) throw usageError(`ops[${i}] (${op.op}): alias "${a}" must look like $name ($ and a letter, then letters, digits, _ or -)`, { op: i, hint: 'Example: "as": "$check", then "after": "$check".' });
      if (defined.has(a)) {
        throw new CliError('E_DUPLICATE_ALIAS', `ops[${i}] (${op.op}): alias ${a} is already defined by ops[${defined.get(a)}]`, 'usage', { op: i, hint: 'Every alias names one element of the batch: pick another name.' });
      }
      defined.set(a, i);
    }
  });
}

/** The aliases of a running batch: alias -> the element (it follows renames) and the op that defined it. */
export class AliasTable {
  private readonly map = new Map<string, { el: El; op: number }>();

  constructor(private readonly doc: Doc) {}

  get size(): number {
    return this.map.size;
  }

  define(alias: string, el: El, op: number): void {
    const prev = this.map.get(alias);
    if (prev) throw new CliError('E_DUPLICATE_ALIAS', `ops[${op}]: alias ${alias} is already defined by ops[${prev.op}]`, 'usage', { op, hint: 'Every alias names one element of the batch: pick another name.' });
    if (!isAlias(alias)) throw usageError(`ops[${op}]: alias "${alias}" must look like $name ($ and a letter, then letters, digits, _ or -)`, { op });
    this.map.set(alias, { el, op });
  }

  /** The current id of the aliased element. */
  idOf(alias: string, index: number, op: Op, key: string): string {
    const entry = this.map.get(alias);
    if (!entry) throw unknownAlias(index, op, key, alias, new Map([...this.map].map(([a, e]) => [a, e.op])));
    const id = entry.el.get<string | undefined>('id');
    if (!id || this.doc.get(id) !== entry.el) {
      throw new CliError('E_NOT_FOUND', `ops[${index}] (${op.op}): "${key}": ${alias} named ${id ?? 'an element'}, which an op before this one removed`, 'model', { op: index, element: id, hint: 'Refer to an element that still exists.' });
    }
    return id;
  }

  /** alias -> final id, in definition order (elements removed later in the batch are left out). */
  toRecord(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [alias, { el }] of this.map) {
      const id = el.get<string | undefined>('id');
      if (id && this.doc.get(id) === el) out[alias] = id;
    }
    return out;
  }
}

/** A copy of `op` with every alias replaced by the current id of its element (the op itself when it has none). */
export function resolveOp(op: Op, table: AliasTable, index: number): Op {
  if (!referencesOf(op).length) return op;
  const copy = JSON.parse(JSON.stringify(op)) as Op;
  const id = (alias: string, key: string): string => table.idOf(alias, index, op, key);
  for (const s of slots(copy)) {
    const v = s.get();
    if (isAlias(v)) s.put(id(v, s.key));
    else if (Array.isArray(v)) s.put(v.map((x, i) => (isAlias(x) ? id(x, `${s.key}[${i}]`) : x)));
  }
  return copy;
}
