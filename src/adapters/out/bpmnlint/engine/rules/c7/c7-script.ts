import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7ExecutableRule } from './implementation/C7ExecutableRule.js';
import { CamundaAttributes } from './implementation/CamundaAttributes.js';
import { nonEmpty } from './implementation/utils/values.js';
import { C7Diagram } from './C7Diagram.js';

/** Reports a script task with neither a script nor `camunda:resource`, which Camunda 7 refuses to deploy. */
class C7Script extends C7ExecutableRule {
  protected checkExecutable(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:ScriptTask')) {
      return;
    }
    if (
      nonEmpty(node.get('script')) ||
      new CamundaAttributes(node).defined('resource') !== undefined
    ) {
      return;
    }
    const prefix = C7Diagram.of(node).prefix;
    reportErrors(node, reporter, {
      message: `Script task ${node.id} has neither a script nor ${prefix}:resource; the engines refuse the file`,
      path: ['script'],
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node,
        parentNode: null,
        requiredProperty: ['script', 'resource'],
        hint: `\`bpmn set <file> ${node.id} scriptFormat=groovy script=...\` (or ${prefix}:resource=deployment://<file>).`,
      },
    });
  }
}

export default defineRule(
  { ruleName: 'c7-script', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7Script,
);
