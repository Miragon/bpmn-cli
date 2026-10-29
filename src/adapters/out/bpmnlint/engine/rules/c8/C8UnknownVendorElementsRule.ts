import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { defineRule } from '../CamundaRule.js';
import { UnknownVendorElementsRule } from '../UnknownVendorElementsRule.js';

/**
 * zeebe extension elements of an executable process that the zeebe descriptor does not know, or
 * known ones the typed parse drops where they sit.
 * Camunda 8 ignores them. The typed parse drops them with an import warning that names neither the
 * element nor where it sat, so the rule reads the extension elements as the file writes them.
 *
 * - `c8-unknown-element`: an unknown zeebe element, directly in the extension elements or inside a
 *   known one.
 * - `c8-misplaced-element`: a zeebe element that belongs inside a container (a loose zeebe:input),
 *   or zeebe:publishMessage on an element Camunda 8 does not read it on.
 *
 * @example a misspelled extension element
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><zeebe:taskDefinitions type="charge" /></bpmn:extensionElements>  <!-- zeebe:taskDefinition -->
 * </bpmn:serviceTask>
 */
class C8UnknownVendorElementsRule extends UnknownVendorElementsRule {
  protected readonly engine: Engine = 'c8';
}

export default defineRule(
  {
    ruleName: 'c8-unknown-vendor-elements',
    kind: 'engine-specific',
    targetEngine: 'c8',
    findings: { 'c8-unknown-element': ['W_C8_UNKNOWN_ELEMENT', 'runtime'], 'c8-misplaced-element': ['W_C8_MISPLACED_EXTENSION', 'runtime'] },
  },
  C8UnknownVendorElementsRule,
);
