import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { SetCommand } from '../support/SetCommand.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Diagram } from './support/C7Diagram.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

const DECISION_MAPPERS = ['singleEntry', 'singleResult', 'collectEntries', 'resultList'];

/**
 * A camunda:mapDecisionResult of a business rule task with a decision that is not singleEntry,
 * singleResult, collectEntries or resultList.
 * Camunda 7 refuses to deploy the file.
 *
 * @example an unknown result mapper
 * <bpmn:businessRuleTask id="Rate" camunda:decisionRef="rating" camunda:mapDecisionResult="first" />  <!-- singleEntry -->
 */
class C7DecisionResultMapperKnownRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    const attributes = new CamundaAttributes(node);
    const mapper = is(node, 'bpmn:BusinessRuleTask') && attributes.defined('decisionRef') !== undefined ? attributes.defined('mapDecisionResult') : undefined;
    if (mapper === undefined || DECISION_MAPPERS.includes(mapper)) return;
    const prefix = C7Diagram.of(node).prefix;
    this.report(node, `${prefix}:mapDecisionResult="${mapper}" on ${ElementKinds.describe(node)} is not one of ${DECISION_MAPPERS.join(', ')}; the engines refuse the file`, { path: ['mapDecisionResult'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'mapDecisionResult', hint: `${new SetCommand(node.id).of(`${prefix}:mapDecisionResult=singleEntry`)} (or another of the four).` });
  }
}

export default defineRule({ ruleName: 'c7-decision-result-mapper-known', code: 'W_C7_DEPLOY_BAD_VALUE', impact: 'deploy' }, C7DecisionResultMapperKnownRule);
