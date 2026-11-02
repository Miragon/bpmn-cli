import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C7ExtensionContentRule } from './C7ExtensionContentRule.js';
import type { C7Host } from './support/C7Host.js';

/**
 * camunda:inputOutput on a start or boundary event, a gateway or an event sub-process.
 * Camunda 7 does not support input/output mappings there and refuses to deploy the file.
 *
 * @example mappings on a start event
 * <bpmn:startEvent id="Received">
 *   <bpmn:extensionElements><camunda:inputOutput /></bpmn:extensionElements>
 * </bpmn:startEvent>
 */
class C7IoMappingHostAllowedRule extends C7ExtensionContentRule {
  protected checkHost(host: C7Host): void {
    const [first] = host.camundaExtensions('inputOutput');
    const unsupported = host.unsupportedMappingHost();
    if (!is(host.node, 'bpmn:FlowNode') || !first || !unsupported) return;
    const mapping = host.typeName('inputOutput');
    this.reportOn(host, `${mapping} on ${host.describe()}: the engines do not support input/output mappings on ${unsupported} and refuse the file`, { path: host.extensionPath(first.index), type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, node: first.value, extensionElement: first.value, hint: `Move the mappings to the next activity and remove them here: \`bpmn ext remove <file> ${host.node.id} ${mapping}\`.` });
  }
}

export default defineRule({ ruleName: 'c7-io-mapping-host-allowed', code: 'W_C7_DEPLOY_INPUT_OUTPUT', impact: 'deploy' }, C7IoMappingHostAllowedRule);
