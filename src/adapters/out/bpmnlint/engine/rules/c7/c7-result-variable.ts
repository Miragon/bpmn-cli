import { defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7ExecutableRule } from './implementation/C7ExecutableRule.js';
import { ImplementationHost } from './implementation/ImplementationHost.js';
import { nonEmpty } from './implementation/utils/values.js';

/**
 * Reports `camunda:resultVariable` next to `camunda:class` or `camunda:delegateExpression`: Camunda 7
 * supports a result variable only with `camunda:expression` and refuses the file.
 */
class C7ResultVariable extends C7ExecutableRule {
  protected checkExecutable(node: ModdleElement, reporter: Reporter): void {
    for (const host of ImplementationHost.forElement(node)) {
      const delegate = this.delegateOf(host);
      if (
        host.hasUnsupportedType ||
        delegate === undefined ||
        host.attributes.defined('resultVariable') === undefined
      ) {
        continue;
      }
      const { prefix, command } = host;
      reportErrors(node, reporter, {
        message: `${host.label} combines ${prefix}:resultVariable with ${prefix}:${delegate}; the engines support a result variable only with ${prefix}:expression and refuse the file`,
        path: host.pathTo('resultVariable'),
        data: {
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node: host.element,
          parentNode: host.parentNode,
          property: 'resultVariable',
          hint: `Remove it: ${command.of(`${prefix}:resultVariable=`)} (or switch to ${prefix}:expression=\${...}).`,
        },
      });
    }
  }

  private delegateOf(host: ImplementationHost): string | undefined {
    return ['class', 'delegateExpression'].find((local) =>
      nonEmpty(host.attributes.defined(local)),
    );
  }
}

export default defineRule(
  { ruleName: 'c7-result-variable', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7ResultVariable,
);
