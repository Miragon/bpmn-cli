import { is, type El } from '../../document/utils/moddle.js';

/** The references are what the user addresses as "data", not the backing elements. */
export function isDataReference(el: El): boolean {
  return is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference');
}

export function artifactContainerOf(el: El): El | undefined {
  let ancestor: El | undefined = el;
  while (ancestor) {
    if (is(ancestor, 'bpmn:Process') || is(ancestor, 'bpmn:SubProcess') || is(ancestor, 'bpmn:Collaboration')) {
      return ancestor;
    }
    ancestor = ancestor.$parent as El | undefined;
  }
  return undefined;
}
