import type { ImportWarning } from 'bpmn-moddle';
import type { Doc } from '../../document/Doc.js';
import { is } from '../../document/utils/moddle.js';

export function isDecisionLinkWarning(warning: ImportWarning): boolean {
  return warning.property === 'calledDecision' && is(warning.element, 'bpmn:BusinessRuleTask');
}

/**
 * Without an engine, an unprefixed calledDecision is bpmn-cli's decision link, not unknown
 * content. In a Camunda 7 / 8 file it stays a warning because the engines refuse it.
 */
export function reportedImportWarnings(doc: Doc): ImportWarning[] {
  if (!doc.importWarnings.some(isDecisionLinkWarning) || doc.platform() !== 'none') {
    return doc.importWarnings;
  }
  return doc.importWarnings.filter((warning) => !isDecisionLinkWarning(warning));
}
