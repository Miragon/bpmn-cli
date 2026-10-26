import { CliError } from '../../../shared/CliError.js';
import { editDistance, typoTolerance } from '../../../shared/utils/fuzzy.js';
import type { Op } from '../../types.js';

export const ALIAS = /^\$[A-Za-z_][A-Za-z0-9_-]*$/;

/** `$check` is an alias, `${ok}` an expression. */
export function isAlias(value: unknown): value is string {
  return typeof value === 'string' && ALIAS.test(value);
}

function listing(defined: ReadonlyMap<string, number>): string {
  return defined.size ? `defined so far: ${[...defined].map(([aliasName, opIndex]) => `${aliasName} (ops[${opIndex}])`).join(', ')}` : 'no op before it defines one';
}

export function unknownAlias(index: number, op: Op, key: string, alias: string, defined: ReadonlyMap<string, number>, later?: number): CliError {
  const where = later === undefined ? '' : later === index ? ' yet (this op defines it: only the ops after it can use it)' : later > index ? ` before this op (ops[${later}] defines it)` : '';
  const distance = (candidate: string): number => editDistance(candidate.toLowerCase(), alias.toLowerCase());
  const candidates = [...defined.keys()].sort((left, right) => distance(left) - distance(right));
  const close = candidates[0] !== undefined && later === undefined && distance(candidates[0]) <= Math.max(1, typoTolerance(alias.length)) ? ` (did you mean ${candidates[0]}?)` : '';
  return new CliError('E_UNKNOWN_ALIAS', `ops[${index}] (${op.op}): "${key}": alias ${alias} is not defined${where}${close}; ${listing(defined)}`, 'usage', {
    op: index,
    candidates,
    hint: 'An op defines an alias with "as": "$name" (add, connect, split and the nodes of a split branch), "flowAs" (add: the flow into the new node), "outAs" (add: the flow it creates out of the new node), "joinAs" (split: the join gateway) or "refAs" (add, connect, set, retype: the message / error / signal / escalation the element references); only the ops after it can use it.',
  });
}
