import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { RuleKit } from '../RuleKit.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host } from './support/C8Host.js';

/**
 * A zeebe extension element on an element that does not read it, or directly in the extension
 * elements instead of inside its container.
 * Camunda 8 deploys the file and silently ignores the element.
 *
 * @example a task definition on a user task
 * <bpmn:userTask id="Review">
 *   <bpmn:extensionElements><zeebe:taskDefinition type="review" /></bpmn:extensionElements>  <!-- read on service tasks -->
 * </bpmn:userTask>
 */
class C8ZeebeExtensionPlacementRule extends C8HostRule {
  protected checkHost(host: C8Host): void {
    const hint = host.hint();
    for (const { value, index, type, placement } of host.zeebeValues()) {
      const finding = { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement: value, path: host.extensionPath(index), node: host.node };
      if (placement === 'loose') {
        this.reportContent(host, `${host.spell(type.name)} sits directly in the extension elements of ${host.describe()}, but belongs inside ${host.spell(RuleKit.kit.ZEEBE.containersOf(type.name)[0] ?? '')}; Camunda 8 ignores it`, { ...finding, hint: hint ? `Remove it (${hint.extRemove(index)}) and add it again, \`bpmn ext add\` files it into its container: ${hint.extAdd(`${hint.nameOf(value)} ...`)}.` : 'Remove it (remove it from the XML) and add it again, `bpmn ext add` files it into its container: edit the XML.' });
      }
      if (placement === 'misplaced') {
        this.reportContent(host, `${host.spell(type.name)} on ${host.describe()} has no effect: Camunda 8 reads it on ${ElementKinds.list(type.allowedIn.filter((allowed) => allowed.startsWith('bpmn:')), 5)} only`, { ...finding, hint: `Remove it: ${hint ? hint.extRemove(index) : 'remove it from the XML'}.` });
      }
    }
  }
}

export default defineRule({ ruleName: 'c8-zeebe-extension-placement', code: 'W_C8_MISPLACED_EXTENSION', impact: 'runtime' }, C8ZeebeExtensionPlacementRule);
