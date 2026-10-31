import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { defineRule } from '../CamundaRule.js';
import { UnknownVendorElementsRule } from '../UnknownVendorElementsRule.js';

/**
 * zeebe extension elements of an executable process that the zeebe descriptor does not know,
 * directly in the extension elements or inside a known one.
 * Camunda 8 ignores them. The typed parse drops them with an import warning that names neither the
 * element nor where it sat, so the rule reads the extension elements as the file writes them.
 *
 * @example a misspelled extension element
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><zeebe:taskDefinitions type="charge" /></bpmn:extensionElements>  <!-- zeebe:taskDefinition -->
 * </bpmn:serviceTask>
 */
class C8ZeebeElementKnownRule extends UnknownVendorElementsRule {
  protected readonly engine: Engine = 'c8';
}

export default defineRule({ ruleName: 'c8-zeebe-element-known', code: 'W_C8_UNKNOWN_ELEMENT', impact: 'runtime' }, C8ZeebeElementKnownRule);
