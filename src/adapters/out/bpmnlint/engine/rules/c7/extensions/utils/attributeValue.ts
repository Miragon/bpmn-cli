import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { UnresolvedReferences } from '../UnresolvedReferences.js';

/**
 * An attribute of a camunda element as the file writes it: a typed property (a reference as the
 * id it names, also one the parse could not resolve), else one the moddle left in `$attrs`.
 */
export function attributeValue(element: ModdleElement, name: string): string | undefined {
  const value = Object.prototype.hasOwnProperty.call(element, name)
    ? element[name]
    : (element.$attrs?.[name] ?? UnresolvedReferences.of(element, name));
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === 'object' ? value.id : String(value);
}
