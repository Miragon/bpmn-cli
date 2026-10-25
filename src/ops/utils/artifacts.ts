import { is, type El } from '../../model/utils/moddle.js';

/** The references are what the user addresses as "data", not the backing elements. */
export function isDataReference(el: El): boolean {
  return is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference');
}

export function artifactContainerOf(el: El): El | undefined {
  let p: El | undefined = el;
  while (p) {
    if (is(p, 'bpmn:Process') || is(p, 'bpmn:SubProcess') || is(p, 'bpmn:Collaboration')) return p;
    p = p.$parent as El | undefined;
  }
  return undefined;
}
