import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { FirstOfKey } from '../support/FirstOfKey.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7EventGateway } from './support/C7EventGateway.js';

const REFERENCE_BY_TRIGGER: Record<string, string> = { message: 'messageRef', signal: 'signalRef' };

/**
 * Two branches of an event-based gateway that wait for one message or signal name.
 * Camunda 7 refuses to deploy the file. A branch the engines refuse as a target is the target
 * rule's; the finding is on the later branch, no property of the gateway: the path is null.
 *
 * @example two branches waiting for the same message
 * <bpmn:intermediateCatchEvent id="Paid"><bpmn:messageEventDefinition messageRef="Payment" /></bpmn:intermediateCatchEvent>
 * <bpmn:intermediateCatchEvent id="PaidLate"><bpmn:messageEventDefinition messageRef="Payment" /></bpmn:intermediateCatchEvent>
 */
class C7EventGatewayBranchesUniqueRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:EventBasedGateway')) return;
    const firsts = new FirstOfKey<ModdleElement>();
    for (const { target, definitions } of C7EventGateway.branches(node)) {
      if (!definitions || !C7EventGateway.waits(definitions)) continue;
      const trigger = ElementKinds.trigger(definitions[0]);
      const referenceProperty = REFERENCE_BY_TRIGGER[trigger];
      const name = referenceProperty ? definitions[0].get(referenceProperty)?.name : undefined;
      const first = referenceProperty && name ? firsts.repeats(`${trigger}\u0000${name}`, target) : undefined;
      if (first) {
        this.report(node, `Branches ${first.id} and ${target.id} of event-based gateway ${node.id} wait for the same ${trigger} "${name}"; the engines refuse the file`, { path: null, type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED, first, node: target, duplicatedProperty: referenceProperty, duplicatedPropertyValue: name, hint: `\`bpmn set <file> ${target.id} ${trigger}=<OtherName>\`, or remove one branch.` });
      }
    }
  }
}

export default defineRule({ ruleName: 'c7-event-gateway-branches-unique', code: 'W_C7_DEPLOY_EVENT_GATEWAY', impact: 'deploy' }, C7EventGatewayBranchesUniqueRule);
