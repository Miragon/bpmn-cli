import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { defineRule } from '../CamundaRule.js';
import { UnknownVendorElementsRule } from '../UnknownVendorElementsRule.js';

/**
 * camunda extension elements of an executable process that the camunda descriptor does not know,
 * directly in the extension elements or inside a known one.
 * The engines ignore them. The typed parse drops them with an import warning that names neither the
 * element nor where it sat, so the rule reads the extension elements as the file writes them.
 *
 * @example a misspelled extension element
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><camunda:inputOutputs /></bpmn:extensionElements>  <!-- camunda:inputOutput -->
 * </bpmn:serviceTask>
 */
class C7CamundaElementKnownRule extends UnknownVendorElementsRule {
  protected readonly engine: Engine = 'c7';
}

export default defineRule({ ruleName: 'c7-camunda-element-known', code: 'W_C7_UNKNOWN_ELEMENT', impact: 'runtime' }, C7CamundaElementKnownRule);
