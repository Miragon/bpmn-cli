import { is } from 'bpmnlint-utils';
import { defineRule, type ModdleElement } from '../CamundaRule.js';
import { C8StartNameRule } from './C8StartNameRule.js';

/**
 * A process start event whose message name is a FEEL expression.
 * Camunda 8 subscribes to a process start message at deploy, before any variable exists, and
 * refuses the file.
 *
 * @example a message start event with a FEEL name
 * <bpmn:message id="Order" name="=orderMessage" />  <!-- a static name -->
 */
class C8MessageStartNeedsStaticNameRule extends C8StartNameRule {
  protected readonly trigger = 'message';
  protected readonly starts = 'process start events';

  protected applies(start: ModdleElement): boolean {
    return is(start.$parent, 'bpmn:Process');
  }
}

export default defineRule({ ruleName: 'c8-message-start-needs-static-name', code: 'W_C8_DEPLOY_MESSAGE', impact: 'deploy' }, C8MessageStartNeedsStaticNameRule);
