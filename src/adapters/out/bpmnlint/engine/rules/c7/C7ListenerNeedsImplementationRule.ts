import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { Values } from '../support/Values.js';
import { C7ListenerRule, type Listener } from './C7ListenerRule.js';

const LISTENER_IMPLEMENTATIONS = ['class', 'expression', 'delegateExpression'];

/**
 * An execution or task listener without class, expression, delegate expression or script.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a listener that runs nothing
 * <camunda:executionListener event="start" />  <!-- no class, expression or script -->
 */
class C7ListenerNeedsImplementationRule extends C7ListenerRule {
  protected checkListener(listener: Listener): void {
    const { value } = listener.extension;
    if (LISTENER_IMPLEMENTATIONS.some((name) => Values.nonEmpty(value.get(name))) || value.script !== undefined) {
      return;
    }
    this.reportListener(listener, `${listener.label} has no class, expression, delegateExpression or script; the engines refuse the file`, [], ERROR_TYPES.PROPERTY_REQUIRED, { requiredProperty: [...LISTENER_IMPLEMENTATIONS, 'script'], hint: listener.host.rebuild(listener.extension, { expression: '${...}' }) });
  }
}

export default defineRule({ ruleName: 'c7-listener-needs-implementation', code: 'W_C7_DEPLOY_LISTENER', impact: 'deploy' }, C7ListenerNeedsImplementationRule);
