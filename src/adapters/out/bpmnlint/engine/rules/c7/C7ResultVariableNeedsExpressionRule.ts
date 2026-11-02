import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { Values } from '../support/Values.js';
import { C7ImplementationHostRule } from './C7ImplementationHostRule.js';
import type { ImplementationHost } from './support/ImplementationHost.js';

/**
 * A camunda:resultVariable next to a camunda:class or delegateExpression.
 * Camunda 7 supports a result variable only with camunda:expression and refuses to deploy the
 * file.
 *
 * @example a delegate with a result variable
 * <bpmn:serviceTask id="Charge" camunda:class="org.acme.Charge" camunda:resultVariable="receipt" />
 */
class C7ResultVariableNeedsExpressionRule extends C7ImplementationHostRule {
  protected checkHost(node: ModdleElement, host: ImplementationHost): void {
    const delegate = ['class', 'delegateExpression'].find((local) => Values.nonEmpty(host.attributes.defined(local)));
    if (!delegate || host.attributes.defined('resultVariable') === undefined) {
      return;
    }
    const { prefix, command, label } = host;
    this.report(node, `${label} combines ${prefix}:resultVariable with ${prefix}:${delegate}; the engines support a result variable only with ${prefix}:expression and refuse the file`, { path: host.pathTo('resultVariable'), type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: host.element, property: 'resultVariable', hint: `Remove it: ${command.of(`${prefix}:resultVariable=`)} (or switch to ${prefix}:expression=\${...}).` });
  }
}

export default defineRule({ ruleName: 'c7-result-variable-needs-expression', code: 'W_C7_DEPLOY_RESULT_VARIABLE', impact: 'deploy' }, C7ResultVariableNeedsExpressionRule);
