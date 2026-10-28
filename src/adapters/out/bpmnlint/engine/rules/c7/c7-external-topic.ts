import { defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7ExecutableRule } from './implementation/C7ExecutableRule.js';
import { ImplementationHost } from './implementation/ImplementationHost.js';

/** Reports an external task, or external message throw or end event, without `camunda:topic`, which Camunda 7 refuses to deploy. */
class C7ExternalTopic extends C7ExecutableRule {
  protected checkExecutable(node: ModdleElement, reporter: Reporter): void {
    for (const host of ImplementationHost.forElement(node)) {
      if (!host.isExternal || host.attributes.defined('topic') !== undefined) {
        continue;
      }
      reportErrors(node, reporter, {
        message: `${host.label} is an external task without ${host.prefix}:topic; the engines refuse the file`,
        path: host.pathTo('topic'),
        data: {
          type: ERROR_TYPES.PROPERTY_REQUIRED,
          node: host.element,
          parentNode: host.parentNode,
          requiredProperty: 'topic',
          hint: `${host.command.of(`${host.prefix}:topic=<topic>`)}.`,
        },
      });
    }
  }
}

export default defineRule(
  { ruleName: 'c7-external-topic', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7ExternalTopic,
);
