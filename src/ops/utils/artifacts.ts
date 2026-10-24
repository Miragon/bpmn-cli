import { is, type El } from '../../model/utils/moddle.js';

/** True for the elements the AI addresses as "data": data object / data store references. */
export function isDataReference(el: El): boolean {
  return is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference');
}

/** The nearest ancestor (or the element itself) that owns an `artifacts` collection. */
export function artifactContainerOf(el: El): El | undefined {
  let p: El | undefined = el;
  while (p) {
    if (is(p, 'bpmn:Process') || is(p, 'bpmn:SubProcess') || is(p, 'bpmn:Collaboration')) return p;
    p = p.$parent as El | undefined;
  }
  return undefined;
}
