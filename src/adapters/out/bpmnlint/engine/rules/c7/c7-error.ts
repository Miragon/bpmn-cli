import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7EventDefinitions } from './events/C7EventDefinitions.js';
import { C7ExecutableScope } from './events/C7ExecutableScope.js';

/** Reports an error end event that throws no error, or an error without an errorCode, which Camunda 7 refuses to deploy. */
class C7Error extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:EndEvent') || !C7ExecutableScope.contains(node)) {
      return;
    }

    const definitions = new C7EventDefinitions(node);
    const label = describeElement(node);
    for (const definition of definitions.actedOn()) {
      if (!is(definition, 'bpmn:ErrorEventDefinition')) {
        continue;
      }
      const error = definition.errorRef;
      if (!error) {
        reportErrors(node, reporter, {
          message: `${label} throws no error (no errorRef); the engines refuse the file`,
          path: definitions.pathTo(definition, 'errorRef'),
          data: {
            type: ERROR_TYPES.PROPERTY_REQUIRED,
            node: definition,
            parentNode: node,
            requiredProperty: 'errorRef',
            hint: `\`bpmn set <file> ${node.id} error=<ErrorName> errorCode=<CODE>\`.`,
          },
        });
      } else if (!String(error.errorCode ?? '').trim()) {
        reportErrors(node, reporter, {
          message: `Error ${error.id} thrown by ${label} has no errorCode; the engines refuse the file`,
          path: definitions.pathTo(definition, 'errorRef', 'errorCode'),
          data: {
            type: ERROR_TYPES.PROPERTY_REQUIRED,
            node: error,
            parentNode: node,
            requiredProperty: 'errorCode',
            hint: `\`bpmn set <file> ${node.id} errorCode=<CODE>\`.`,
          },
        });
      }
    }
  }
}

export default defineRule(
  { ruleName: 'c7-error', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7Error,
);
