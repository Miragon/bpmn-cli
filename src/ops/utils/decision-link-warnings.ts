import type { ImportWarning } from 'bpmn-moddle';
import type { Doc } from '../../model/Doc.js';
import { is } from '../../model/utils/moddle.js';

export function isDecisionLinkWarning(w: ImportWarning): boolean {
  return w.property === 'calledDecision' && is(w.element, 'bpmn:BusinessRuleTask');
}

/**
 * Without an engine, an unprefixed calledDecision is bpmn-cli's decision link, not unknown
 * content. In a Camunda 7 / 8 file it stays a warning because the engines refuse it.
 */
export function reportedImportWarnings(doc: Doc): ImportWarning[] {
  if (!doc.importWarnings.some(isDecisionLinkWarning) || doc.platform() !== undefined) return doc.importWarnings;
  return doc.importWarnings.filter((w) => !isDecisionLinkWarning(w));
}
