import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { defineRule } from '../CamundaRule.js';
import { UnprefixedAttributesRule } from '../UnprefixedAttributesRule.js';

/**
 * Attributes without a namespace prefix that the BPMN schema does not define.
 * Camunda 7 validates the file against the schema and refuses it (cvc-complex-type.3.2.2). The
 * typed parse reads some of them as the camunda attribute of that name (`assignee` on a user task as
 * `camunda:assignee`), so the rule reads the attributes as the file writes them.
 * Any element of the file is checked, the diagram's included.
 *
 * @example a user task with an unprefixed assignee
 * <bpmn:userTask id="Review" assignee="demo" />  <!-- camunda:assignee -->
 */
class C7BpmnAttributeKnownRule extends UnprefixedAttributesRule {
  protected readonly engine: Engine = 'c7';
}

export default defineRule({ ruleName: 'c7-bpmn-attribute-known', code: 'W_C7_DEPLOY_SCHEMA', impact: 'deploy' }, C7BpmnAttributeKnownRule);
