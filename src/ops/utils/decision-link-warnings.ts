import type { ImportWarning } from 'bpmn-moddle';
import type { Doc } from '../../model/Doc.js';
import { is } from '../../model/utils/moddle.js';

/** An import warning about an unprefixed calledDecision on a business rule task: bpmn-cli's decision link in a model without an engine. */
export function isDecisionLinkWarning(w: ImportWarning): boolean {
  return w.property === 'calledDecision' && is(w.element, 'bpmn:BusinessRuleTask');
}

/**
 * The import warnings worth reporting: in a model without an engine an
 * unprefixed calledDecision on a business rule task is bpmn-cli's spelling
 * of the decision link, not content the reader does not know. In a
 * Camunda 7 / 8 file it stays a warning (the engines refuse it).
 */
export function reportedImportWarnings(doc: Doc): ImportWarning[] {
  if (!doc.importWarnings.some(isDecisionLinkWarning) || doc.platform() !== undefined) return doc.importWarnings;
  return doc.importWarnings.filter((w) => !isDecisionLinkWarning(w));
}
