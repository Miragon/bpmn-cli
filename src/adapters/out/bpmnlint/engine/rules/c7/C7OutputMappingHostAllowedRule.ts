import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C7ExtensionContentRule } from './C7ExtensionContentRule.js';
import type { C7Host } from './support/C7Host.js';

/**
 * Output parameters of camunda:inputOutput on an end event or a multi-instance activity; mappings
 * where the engines take none at all are the input/output host rule's.
 * Camunda 7 refuses output mappings there and does not deploy the file.
 *
 * @example an output mapping on an end event
 * <bpmn:endEvent id="Done">
 *   <bpmn:extensionElements><camunda:inputOutput><camunda:outputParameter name="result">ok</camunda:outputParameter></camunda:inputOutput></bpmn:extensionElements>
 * </bpmn:endEvent>
 */
class C7OutputMappingHostAllowedRule extends C7ExtensionContentRule {
  protected checkHost(host: C7Host): void {
    const node = host.node;
    const withOutputs = host.camundaExtensions('inputOutput').find(({ value }) => (value.get('outputParameters') ?? []).length);
    if (!is(node, 'bpmn:FlowNode') || !withOutputs || host.unsupportedMappingHost()) {
      return;
    }
    const mapping = host.typeName('inputOutput');
    const parameter = host.typeName('outputParameter');
    const dropOutputs = `Remove the output parameters: rebuild the mapping without them (\`bpmn ext list <file> ${node.id} --json\`, then \`bpmn ext add <file> ${node.id} ${mapping} --replace --xml '...'\`).`;
    const loop = node.loopCharacteristics;
    const report = (message: string, hint: string) => this.reportOn(host, message, { hint, path: host.extensionPath(withOutputs.index, 'outputParameters'), type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: withOutputs.value, property: 'outputParameters' });
    if (is(node, 'bpmn:EndEvent')) {
      report(`${parameter} on end event ${node.id}: the engines refuse output mappings on end events`, dropOutputs);
    } else if (loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) {
      report(`${parameter} on multi-instance ${host.describe()}: the engines refuse output mappings on multi-instance activities`, `${dropOutputs} Collect results in an activity inside the loop instead.`);
    }
  }
}

export default defineRule({ ruleName: 'c7-output-mapping-host-allowed', code: 'W_C7_DEPLOY_INPUT_OUTPUT', impact: 'deploy' }, C7OutputMappingHostAllowedRule);
