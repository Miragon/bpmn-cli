import { enclosingProcess, is, type El } from '../../document/utils/moddle.js';
import type { PoolLayout } from '../layout/clean/PoolStacker.js';

export function poolOf(pools: PoolLayout[], el: El): PoolLayout | undefined {
  if (is(el, 'bpmn:Participant')) {
    return pools.find((pool) => pool.participant === el);
  }
  const process = enclosingProcess(el.$parent as El | undefined);
  return process ? pools.find((pool) => pool.process === process) : undefined;
}

export function isContainerShape(diElement: El, el: El): boolean {
  return is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || diElement.get<boolean | undefined>('isExpanded') === true;
}
