import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8CheckedElement } from './extensions/C8CheckedElement.js';
import { CAMUNDA_7_PREFIX_BY_URI } from './extensions/namespaces.js';
import type { ZeebeHint } from './extensions/ZeebeHint.js';
import { DiagramNamespaces } from '../DiagramNamespaces.js';

/** The zeebe content Camunda 8 reads in place of a Camunda 7 attribute or element, as `bpmn ext add` takes it. */
const CAMUNDA_8_EQUIVALENT = new Map(
  Object.entries({
    assignee: 'assignmentDefinition assignee=<assignee>',
    candidateGroups: 'assignmentDefinition candidateGroups=<groups>',
    candidateUsers: 'assignmentDefinition candidateUsers=<users>',
    dueDate: 'taskSchedule dueDate=<date>',
    followUpDate: 'taskSchedule followUpDate=<date>',
    priority: 'priorityDefinition priority=<0..100>',
    formKey: 'formDefinition formId=<formId>',
    topic: 'taskDefinition type=<jobType>',
    type: 'taskDefinition type=<jobType>',
    class: 'taskDefinition type=<jobType>',
    delegateExpression: 'taskDefinition type=<jobType>',
    expression: 'taskDefinition type=<jobType>',
    decisionRef: 'calledDecision decisionId=<decisionId> resultVariable=<variable>',
    inputOutput: 'input source==<expression> target=<variable>',
    versionTag: 'versionTag value=<tag>',
  }),
);

/**
 * Reports Camunda 7 content (`camunda:` and `operaton:` attributes and extension elements) in a
 * Camunda 8 diagram: Camunda 8 ignores it, so the setting it carries does not happen.
 */
class C8ForeignContent extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    const checked = C8CheckedElement.forNode(node);
    if (!checked) {
      return;
    }

    const namespaces = DiagramNamespaces.forElement(node);
    const hint = checked.hint();
    for (const key of Object.keys(node.$attrs ?? {})) {
      if (!CAMUNDA_7_PREFIX_BY_URI.has(namespaces.uriOf(key) ?? '')) {
        continue;
      }
      checked.report(
        reporter,
        `${checked.describe()} carries the Camunda 7 attribute ${key}, which Camunda 8 ignores`,
        checked.path(key),
        {
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node,
          property: key,
          hint: this.removeHint(hint, key, hint ? hint.unset(key) : 'edit the XML'),
        },
      );
    }

    checked.extensionValues().forEach((value, index) => {
      const type = String(value.$type ?? '');
      if (!value.$descriptor?.isGeneric || !CAMUNDA_7_PREFIX_BY_URI.has(namespaces.uriOf(type) ?? '')) {
        return;
      }
      checked.report(
        reporter,
        `${checked.describe()} contains the Camunda 7 extension ${type}, which Camunda 8 ignores`,
        checked.extensionPath(index),
        {
          type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
          node,
          extensionElement: value,
          hint: this.removeHint(hint, type, hint ? hint.extRemove(index) : 'remove it from the XML'),
        },
      );
    });
  }

  /** `Remove it: <remove>`, and the zeebe content Camunda 8 reads instead, if there is one. */
  private removeHint(hint: ZeebeHint | undefined, name: string, remove: string): string {
    const equivalent = CAMUNDA_8_EQUIVALENT.get(name.slice(name.indexOf(':') + 1));
    if (!equivalent) {
      return `Remove it: ${remove}.`;
    }
    return `Remove it: ${remove}; Camunda 8 reads ${hint ? hint.extAdd(hint.name(equivalent)) : 'edit the XML'}.`;
  }
}

export default defineRule(
  { ruleName: 'c8-foreign-content', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-foreign-content': ['W_C8_FOREIGN_CONTENT', 'runtime'] } },
  C8ForeignContent,
);
