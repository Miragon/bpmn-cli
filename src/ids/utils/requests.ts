import type { KindDef } from '../../model/kinds.js';
import { lcfirst, localName } from './id-words.js';

/**
 * Names a type-named prefix of the kind could use: the kind and its BPMN
 * type (`userTask`; `eventSubProcess`, `subProcess`). A data reference's
 * kind is the type of the element it stands for (`dataObject`, whose
 * bpmn:DataObject a file names `dataObject_`), so its own type comes first
 * (`dataObjectReference_invoice` next to `dataObject_invoice`).
 */
export function kindTypeNames(def: KindDef): string[] {
  const type = lcfirst(localName(def.type));
  return [...new Set(type === `${def.kind}Reference` ? [type, def.kind] : [def.kind, type])];
}
