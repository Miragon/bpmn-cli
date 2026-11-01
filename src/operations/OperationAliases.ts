import { BpmnError, EditDistance } from '../model/index.js';
import { FieldValues } from './fields/FieldValues.js';
import { OperationCatalog, type Operation } from './OperationCatalog.js';
import { SplitNodeDefinition } from './model/SplitNodeDefinition.js';

type Holder = Record<string, unknown>;

type Slot = { key: string; holder: Holder; name: string };

export class OperationAliases {
  private static readonly HOW_TO_DEFINE = 'An op defines an alias with "as": "$name" (add, connect, split and the nodes of a split branch), "flowAs" (add: the flow into the new node), "outAs" (add: the flow it creates out of the new node), "joinAs" (split: the join gateway) or "refAs" (add, connect, set, retype: the message / error / signal / escalation the element references); only the ops after it can use it.';
  private static readonly ID_KEYS_OF_SET = ['default', 'source', 'target', 'lane'];
  private static readonly DEFINED_BY_NODE = Object.entries(new SplitNodeDefinition().fields).flatMap(([key, field]) => (field.traits.definesAlias ? [key] : []));

  constructor(private readonly operation: Operation) {}

  static isAlias(value: unknown): value is string {
    return typeof value === 'string' && FieldValues.ALIAS.test(value);
  }

  static unknown(index: number, operation: Operation, key: string, alias: string, defined: ReadonlyMap<string, number>, later?: number): BpmnError {
    const distance = (candidate: string): number => EditDistance.transposing(candidate.toLowerCase(), alias.toLowerCase());
    const candidates = [...defined.keys()].sort((left, right) => distance(left) - distance(right));
    const closest = candidates[0];
    const close = closest !== undefined && later === undefined && distance(closest) <= Math.max(1, EditDistance.typoTolerance(alias.length)) ? ` (did you mean ${closest}?)` : '';
    const listing = defined.size ? `defined so far: ${[...defined].map(([name, opIndex]) => `${name} (ops[${opIndex}])`).join(', ')}` : 'no op before it defines one';
    const message = `ops[${index}] (${operation.op}): "${key}": alias ${alias} is not defined${OperationAliases.whereDefined(later, index)}${close}; ${listing}`;
    return new BpmnError('E_UNKNOWN_ALIAS', message, 'usage', { op: index, candidates, hint: OperationAliases.HOW_TO_DEFINE });
  }

  static assertBatch(operations: readonly Operation[]): void {
    const firstUse = new Map<string, number>();
    operations.forEach((operation, index) => {
      new OperationAliases(operation).defined().forEach((alias) => firstUse.set(alias, firstUse.get(alias) ?? index));
    });
    const defined = new Map<string, number>();
    operations.forEach((operation, index) => {
      new OperationAliases(operation).assertUse(index, defined, firstUse);
    });
  }

  private static whereDefined(later: number | undefined, index: number): string {
    if (later === undefined || later < index) {
      return '';
    }
    return later === index ? ' yet (this op defines it: only the ops after it can use it)' : ` before this op (ops[${later}] defines it)`;
  }

  defined(): string[] {
    const operation = this.operation as unknown as Holder;
    const keys = Object.entries(this.definition().fields).flatMap(([key, field]) => (field.traits.definesAlias ? [key] : []));
    const ofNodes = this.nodes().flatMap(({ node }) => OperationAliases.DEFINED_BY_NODE.map((key) => node[key]));
    return [...keys.map((key) => operation[key]), ...ofNodes].filter((alias): alias is string => typeof alias === 'string');
  }

  referencedIds(): string[] {
    return this.slots(this.operation).flatMap(({ holder, name }) => holder[name]).filter((value): value is string => typeof value === 'string');
  }

  references(): Array<{ key: string; alias: string }> {
    return this.slots(this.operation).flatMap(({ key, holder, name }) => {
      const value = holder[name];
      if (Array.isArray(value)) {
        return value.flatMap((entry, index) => (OperationAliases.isAlias(entry) ? [{ key: `${key}[${index}]`, alias: entry }] : []));
      }
      return OperationAliases.isAlias(value) ? [{ key, alias: value }] : [];
    });
  }

  resolve(idOf: (alias: string, key: string) => string): Operation {
    if (!this.references().length) {
      return this.operation;
    }
    const copy = structuredClone(this.operation);
    const resolved = (value: unknown, key: string): unknown => (OperationAliases.isAlias(value) ? idOf(value, key) : value);
    for (const { key, holder, name } of this.slots(copy)) {
      const value = holder[name];
      if (Array.isArray(value)) {
        holder[name] = value.map((entry, entryIndex) => resolved(entry, `${key}[${entryIndex}]`));
      } else if (value !== undefined) {
        holder[name] = resolved(value, key);
      }
    }
    return copy;
  }

  private definition() {
    return OperationCatalog.find(this.operation.op)!;
  }

  private assertUse(index: number, defined: Map<string, number>, firstUse: ReadonlyMap<string, number>): void {
    const { operation } = this;
    for (const [key, aliasKey] of Object.entries(this.definition().aliasKeyOfNewId)) {
      const newId = (operation as unknown as Holder)[key];
      if (typeof newId === 'string' && newId.startsWith('$')) {
        throw BpmnError.usage(`ops[${index}] (${operation.op}): "${key}" is the id of the new element, not an alias; give the alias with "${aliasKey}": "${newId}"`, { op: index });
      }
    }
    for (const { key, alias } of this.references()) {
      if (!defined.has(alias)) {
        throw OperationAliases.unknown(index, operation, key, alias, defined, firstUse.get(alias));
      }
    }
    for (const alias of this.defined()) {
      if (defined.has(alias)) {
        throw new BpmnError('E_DUPLICATE_ALIAS', `ops[${index}] (${operation.op}): alias ${alias} is already defined by ops[${defined.get(alias)}]`, 'usage', { op: index, hint: 'Every alias names one element of the batch: pick another name.' });
      }
      defined.set(alias, index);
    }
  }

  private nodes(from: Operation = this.operation): Array<{ node: Holder; path: string }> {
    const branches = ((from as unknown as Holder)['branches'] ?? []) as Array<{ nodes: Holder[] }>;
    return branches.flatMap((branch, branchIndex) => branch.nodes.map((node, nodeIndex) => ({ node, path: `branches[${branchIndex}].nodes[${nodeIndex}]` })));
  }

  private slots(operation: Operation): Slot[] {
    const holder = operation as unknown as Holder;
    const keysOf = (owner: Holder, path: string): Slot[] => {
      const set = owner['set'] as Holder | undefined;
      return set ? OperationAliases.ID_KEYS_OF_SET.map((name) => ({ key: `${path}set.${name}`, holder: set, name })) : [];
    };
    return [
      ...this.definition().referenceKeys.map((key) => ({ key, holder, name: key })),
      ...keysOf(holder, ''),
      ...this.nodes(operation).flatMap(({ node, path }) => [{ key: `${path}.lane`, holder: node, name: 'lane' }, ...keysOf(node, `${path}.`)]),
    ];
  }
}
