import { defineRule } from '../CamundaRule.js';
import { C8StartNameRule } from './C8StartNameRule.js';

/**
 * A start event whose signal name is a FEEL expression.
 * Camunda 8 subscribes to a start signal at deploy, before any variable exists, and refuses the
 * file.
 *
 * @example a signal start event with a FEEL name
 * <bpmn:signal id="Go" name="=signalName" />  <!-- a static name -->
 */
class C8SignalStartNeedsStaticNameRule extends C8StartNameRule {
  protected readonly trigger = 'signal';
  protected readonly starts = 'start events';

  protected applies(): boolean {
    return true;
  }
}

export default defineRule({ ruleName: 'c8-signal-start-needs-static-name', code: 'W_C8_DEPLOY_SIGNAL', impact: 'deploy' }, C8SignalStartNeedsStaticNameRule);
