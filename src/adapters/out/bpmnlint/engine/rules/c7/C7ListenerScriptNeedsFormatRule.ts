import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { Values } from '../support/Values.js';
import { C7ListenerRule, type Listener } from './C7ListenerRule.js';

/**
 * The script of an execution or task listener without scriptFormat.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a listener script without format
 * <camunda:executionListener event="start"><camunda:script>log()</camunda:script></camunda:executionListener>  <!-- scriptFormat="groovy" -->
 */
class C7ListenerScriptNeedsFormatRule extends C7ListenerRule {
  protected checkListener(listener: Listener): void {
    const { script } = listener.extension.value;
    if (!script || Values.nonEmpty(script.get('scriptFormat'))) return;
    this.reportListener(listener, `The script of ${listener.label} has no scriptFormat; the engines refuse the file`, ['script', 'scriptFormat'], ERROR_TYPES.PROPERTY_REQUIRED, { requiredProperty: 'scriptFormat', hint: listener.host.rebuild(listener.extension) });
  }
}

export default defineRule({ ruleName: 'c7-listener-script-needs-format', code: 'W_C7_DEPLOY_LISTENER', impact: 'deploy' }, C7ListenerScriptNeedsFormatRule);
