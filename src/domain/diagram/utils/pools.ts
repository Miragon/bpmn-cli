import { is, type El } from '../../document/utils/moddle.js';
import type { PoolLayout } from '../layout/clean/PoolStacker.js';

export function poolOf(pools: PoolLayout[], el: El): PoolLayout | undefined {
  if (is(el, 'bpmn:Participant')) return pools.find((pool) => pool.participant === el);
  let parent: El | undefined = el.$parent as El | undefined;
  while (parent && !is(parent, 'bpmn:Process')) parent = parent.$parent as El | undefined;
  return parent ? pools.find((pool) => pool.process === parent) : undefined;
}

export function isContainerShape(diElement: El, el: El): boolean {
  return is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || diElement.get<boolean | undefined>('isExpanded') === true;
}
