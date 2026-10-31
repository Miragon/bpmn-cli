import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host } from './support/C8Host.js';

/**
 * Execution listeners on a sequence flow.
 * Camunda 8 supports execution listeners on processes, activities, events and gateways only and
 * refuses the file.
 *
 * @example execution listeners on a flow
 * <bpmn:sequenceFlow id="ToShip" sourceRef="Pack" targetRef="Ship">
 *   <bpmn:extensionElements><zeebe:executionListeners>...</zeebe:executionListeners></bpmn:extensionElements>
 * </bpmn:sequenceFlow>
 */
class C8SequenceFlowNoExecutionListenersRule extends C8HostRule {
  protected checkHost(host: C8Host): void {
    const hint = host.hint();
    for (const { value, index, placement } of host.zeebeValues()) {
      if (placement === 'flowListeners') {
        this.reportOn(host, `${host.describe()} has execution listeners; Camunda 8 supports them on processes, activities, events and gateways, not on sequence flows, and refuses the file`, { path: host.extensionPath(index), type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, node: host.node, extensionElement: value, hint: `Remove them (${hint ? hint.extRemove(index) : 'remove it from the XML'}) and put them on the flow's source or target.` });
      }
    }
  }
}

export default defineRule({ ruleName: 'c8-sequence-flow-no-execution-listeners', code: 'W_C8_DEPLOY_LISTENER', impact: 'deploy' }, C8SequenceFlowNoExecutionListenersRule);
