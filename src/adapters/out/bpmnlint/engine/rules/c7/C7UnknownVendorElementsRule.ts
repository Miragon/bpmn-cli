import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { defineRule } from '../CamundaRule.js';
import { UnknownVendorElementsRule } from '../UnknownVendorElementsRule.js';

/**
 * camunda extension elements of an executable process that the camunda descriptor does not know,
 * or that sit outside the element they belong in.
 * The engines ignore them. The typed parse drops them with an import warning that names neither the
 * element nor where it sat, so the rule reads the extension elements as the file writes them.
 *
 * - `c7-unknown-element`: an unknown camunda element, directly in the extension elements or inside
 *   a known one.
 * - `c7-loose-parameter`: a camunda:inputParameter or outputParameter outside camunda:inputOutput.
 *
 * @example a misspelled extension element
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><camunda:inputOutputs /></bpmn:extensionElements>  <!-- camunda:inputOutput -->
 * </bpmn:serviceTask>
 */
class C7UnknownVendorElementsRule extends UnknownVendorElementsRule {
  protected readonly engine: Engine = 'c7';
}

export default defineRule(
  {
    ruleName: 'c7-unknown-vendor-elements',
    kind: 'engine-specific',
    targetEngine: 'c7',
    findings: { 'c7-unknown-element': ['W_C7_UNKNOWN_ELEMENT', 'runtime'], 'c7-loose-parameter': ['W_C7_MISPLACED_EXTENSION', 'runtime'] },
  },
  C7UnknownVendorElementsRule,
);
