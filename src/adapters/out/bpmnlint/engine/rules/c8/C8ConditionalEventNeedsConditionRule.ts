import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';

/**
 * A conditional event definition without condition element, anywhere in the file.
 * The BPMN schema requires one, and Camunda 8 refuses the file.
 *
 * @example a conditional start event without condition
 * <bpmn:startEvent id="LowStock">
 *   <bpmn:conditionalEventDefinition />  <!-- no bpmn:condition -->
 * </bpmn:startEvent>
 */
class C8ConditionalEventNeedsConditionRule extends C8Rule {
  protected visit(definition: ModdleElement): void {
    if (!is(definition, 'bpmn:ConditionalEventDefinition') || definition.get('condition')) {
      return;
    }
    const { owner, path } = C8EventDefinitions.definitionOwner(definition);
    this.report(owner, `The conditional event definition of ${owner === definition ? definition.$type : ElementKinds.describe(owner)} has no condition element, which the BPMN schema requires; Camunda 8 refuses the file`, { path: [...path, 'condition'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: definition, requiredProperty: 'condition', hint: owner.id ? `\`bpmn set <file> ${owner.id} 'when== <expression>'\`.` : 'Fix it in the XML.' });
  }
}

export default defineRule({ ruleName: 'c8-conditional-event-needs-condition', code: 'W_C8_DEPLOY_EVENT_DEFINITION', impact: 'deploy' }, C8ConditionalEventNeedsConditionRule);
