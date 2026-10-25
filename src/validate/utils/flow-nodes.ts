import { is, type El, peek, list } from '../../model/utils/moddle.js';

export function isEventSubProcess(el: El): boolean {
  return is(el, 'bpmn:SubProcess') && peek<boolean>(el, 'triggeredByEvent') === true;
}

export function linkNameOf(el: El): string | undefined {
  const def = list(el, 'eventDefinitions').find((d) => is(d, 'bpmn:LinkEventDefinition'));
  const name = def ? peek<unknown>(def, 'name') : undefined;
  return typeof name === 'string' && name ? name : undefined;
}
