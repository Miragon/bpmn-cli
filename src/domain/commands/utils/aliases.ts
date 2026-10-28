import { BpmnError } from '../../document/BpmnError.js';
import { editDistance, typoTolerance } from '../../document/utils/fuzzy.js';
import { EditCommandDefinitions } from '../definitions/EditCommandDefinitions.js';
import type { EditCommand } from '../types.js';

export const ALIAS = /^\$[A-Za-z_][A-Za-z0-9_-]*$/;

/** `$check` is an alias, `${ok}` an expression. */
export function isAlias(value: unknown): value is string {
  return typeof value === 'string' && ALIAS.test(value);
}

function opsDefining(key: string): string {
  return EditCommandDefinitions.all().filter((definition) => key in definition.fields).map((definition) => definition.name).join(', ');
}

function listing(defined: ReadonlyMap<string, number>): string {
  return defined.size ? `defined so far: ${[...defined].map(([aliasName, commandIndex]) => `${aliasName} (ops[${commandIndex}])`).join(', ')}` : 'no op before it defines one';
}

export function unknownAlias(index: number, command: EditCommand, key: string, alias: string, defined: ReadonlyMap<string, number>, later?: number): BpmnError {
  const where = later === undefined ? '' : later === index ? ' yet (this op defines it: only the ops after it can use it)' : later > index ? ` before this op (ops[${later}] defines it)` : '';
  const distance = (candidate: string): number => editDistance(candidate.toLowerCase(), alias.toLowerCase());
  const candidates = [...defined.keys()].sort((left, right) => distance(left) - distance(right));
  const close = candidates[0] !== undefined && later === undefined && distance(candidates[0]) <= Math.max(1, typoTolerance(alias.length)) ? ` (did you mean ${candidates[0]}?)` : '';
  return new BpmnError('E_UNKNOWN_ALIAS', `ops[${index}] (${command.op}): "${key}": alias ${alias} is not defined${where}${close}; ${listing(defined)}`, 'usage', {
    op: index,
    candidates,
    hint: `An op defines an alias with "as": "$name" (${opsDefining('as')} and the nodes of a split branch), "flowAs" (${opsDefining('flowAs')}: the flow into the new node), "outAs" (${opsDefining('outAs')}: the flow it creates out of the new node), "joinAs" (${opsDefining('joinAs')}: the join gateway) or "refAs" (${opsDefining('refAs')}: the message / error / signal / escalation the element references); only the ops after it can use it.`,
  });
}
