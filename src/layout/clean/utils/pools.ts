import { is, type El } from '../../../model/utils/moddle.js';
import type { PoolLayout } from '../PoolStacker.js';

/** The pool an element is drawn in: the participant itself, or the one whose process contains it. */
export function poolOf(pools: PoolLayout[], el: El): PoolLayout | undefined {
  if (is(el, 'bpmn:Participant')) return pools.find((p) => p.participant === el);
  let parent: El | undefined = el.$parent as El | undefined;
  while (parent && !is(parent, 'bpmn:Process')) parent = parent.$parent as El | undefined;
  return parent ? pools.find((p) => p.process === parent) : undefined;
}

export function isContainerShape(d: El, el: El): boolean {
  return is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || d.get<boolean | undefined>('isExpanded') === true;
}
