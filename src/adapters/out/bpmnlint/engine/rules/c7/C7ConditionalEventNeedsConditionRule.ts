import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { Shell } from '../support/Shell.js';
import { C7EventDefinitionSchemaRule } from './C7EventDefinitionSchemaRule.js';

/**
 * A conditional event definition without condition element, also one the engines ignore.
 * The BPMN schema requires the condition: Camunda 7 refuses to deploy the file.
 *
 * @example a conditional event without condition
 * <bpmn:intermediateCatchEvent id="Ready"><bpmn:conditionalEventDefinition /></bpmn:intermediateCatchEvent>
 */
class C7ConditionalEventNeedsConditionRule extends C7EventDefinitionSchemaRule {
  protected checkDefinition(definition: ModdleElement): void {
    if (!is(definition, 'bpmn:ConditionalEventDefinition') || definition.condition) {
      return;
    }
    this.reportSchema(definition, `${this.subjectName(definition, 'Conditional event')} has no condition element, which the BPMN schema requires; the engines refuse the file`, { path: this.subjectPath(definition, 'condition'), type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'condition', hint: this.subjectHint(definition, Shell.quote('when=${expression}')) });
  }
}

export default defineRule({ ruleName: 'c7-conditional-event-needs-condition', code: 'W_C7_DEPLOY_EVENT_DEFINITION', impact: 'deploy' }, C7ConditionalEventNeedsConditionRule);
