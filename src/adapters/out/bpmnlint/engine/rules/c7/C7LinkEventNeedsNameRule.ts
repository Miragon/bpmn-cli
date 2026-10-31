import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7EventDefinitionSchemaRule } from './C7EventDefinitionSchemaRule.js';

/**
 * A link event definition without name, also one the engines ignore.
 * The BPMN schema requires the name: Camunda 7 refuses to deploy the file.
 *
 * @example a link event without name
 * <bpmn:intermediateThrowEvent id="GoOn"><bpmn:linkEventDefinition /></bpmn:intermediateThrowEvent>  <!-- name="Shipping" -->
 */
class C7LinkEventNeedsNameRule extends C7EventDefinitionSchemaRule {
  protected checkDefinition(definition: ModdleElement): void {
    if (!is(definition, 'bpmn:LinkEventDefinition') || (definition.name !== undefined && definition.name !== null)) {
      return;
    }
    this.reportSchema(definition, `${this.subjectName(definition, 'Link event')} has no link name, which the BPMN schema requires; the engines refuse the file`, { path: this.subjectPath(definition, 'name'), type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'name', hint: this.subjectHint(definition, 'link=<Name>', 'the throw and the catch event of a pair share the name') });
  }
}

export default defineRule({ ruleName: 'c7-link-event-needs-name', code: 'W_C7_DEPLOY_LINK', impact: 'deploy' }, C7LinkEventNeedsNameRule);
