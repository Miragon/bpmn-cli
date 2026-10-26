import { is, type El, peek, list } from '../../model/utils/moddle.js';

export function linkNameOf(el: El): string | undefined {
  const def = list(el, 'eventDefinitions').find((d) => is(d, 'bpmn:LinkEventDefinition'));
  const name = def ? peek<unknown>(def, 'name') : undefined;
  return typeof name === 'string' && name ? name : undefined;
}
