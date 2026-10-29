import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { defineRule } from '../CamundaRule.js';
import { UnprefixedAttributesRule } from '../UnprefixedAttributesRule.js';

/**
 * Attributes without a namespace prefix that the BPMN schema does not define.
 * Camunda 8 validates the file against the schema and refuses it. The typed parse reads some of
 * them as the zeebe attribute of that name, so the rule reads the attributes as the file writes
 * them.
 * Any element of the file is checked, the diagram's included.
 *
 * @example a service task with an unprefixed retries
 * <bpmn:serviceTask id="Charge" retries="3" />  <!-- zeebe:taskDefinition retries -->
 */
class C8BpmnAttributeKnownRule extends UnprefixedAttributesRule {
  protected readonly engine: Engine = 'c8';
}

export default defineRule({ ruleName: 'c8-bpmn-attribute-known', code: 'W_C8_DEPLOY_SCHEMA', impact: 'deploy' }, C8BpmnAttributeKnownRule);
