import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { defineRule } from '../CamundaRule.js';
import { UnprefixedAttributesRule } from '../UnprefixedAttributesRule.js';

/**
 * Attributes without a namespace prefix that the BPMN schema does not define.
 * Camunda 7 validates the file against the schema and refuses it (cvc-complex-type.3.2.2). The
 * typed parse reads some of them as the camunda attribute of that name (`assignee` on a user task as
 * `camunda:assignee`), so the rule reads the attributes as the file writes them.
 *
 * - `c7-unprefixed-attributes`: an unprefixed attribute the schema does not define, on any element
 *   of the file, the diagram's included.
 *
 * @example a user task with an unprefixed assignee
 * <bpmn:userTask id="Review" assignee="demo" />  <!-- camunda:assignee -->
 */
class C7UnprefixedAttributesRule extends UnprefixedAttributesRule {
  protected readonly engine: Engine = 'c7';
}

export default defineRule({ ruleName: 'c7-unprefixed-attributes', kind: 'engine-specific', targetEngine: 'c7', findings: { 'c7-unprefixed-attributes': ['W_C7_DEPLOY_SCHEMA', 'deploy'] } }, C7UnprefixedAttributesRule);
