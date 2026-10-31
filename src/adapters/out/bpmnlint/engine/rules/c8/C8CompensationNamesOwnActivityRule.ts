import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';

/**
 * A compensation throw event whose activityRef names an activity outside its own scope.
 * Camunda 8 compensates only activities of the throw event's scope and refuses the file.
 *
 * @example a compensation throw naming an activity of another sub-process
 * <bpmn:intermediateThrowEvent id="Undo">
 *   <bpmn:compensateEventDefinition activityRef="ChargeInSub" />  <!-- not in Undo's scope -->
 * </bpmn:intermediateThrowEvent>
 */
class C8CompensationNamesOwnActivityRule extends C8Rule {
  protected visit(event: ModdleElement): void {
    if (!is(event, 'bpmn:ThrowEvent') || !EngineScope.C8.contains(event)) return;
    const definition = C8EventDefinitions.definitionOf(event);
    if (!definition || !is(definition, 'bpmn:CompensateEventDefinition')) return;
    const activity = definition.get('activityRef');
    const scope = EngineScope.scopeOf(event);
    if (!activity || EngineScope.scopeOf(activity) === scope) return;
    this.report(event, `Compensation event ${event.id} names ${activity.id}, which is not in its own scope ${scope?.id}; Camunda 8 refuses the file`, { path: ['eventDefinitions', 0, 'activityRef'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: definition, property: 'activityRef', activityRef: activity, hint: `\`bpmn set <file> ${event.id} definition.activityRef=<activityId>\` (an activity of ${scope?.id}), or \`definition.activityRef=\` to compensate the whole scope.` });
  }
}

export default defineRule({ ruleName: 'c8-compensation-names-own-activity', code: 'W_C8_DEPLOY_EVENT_DEFINITION', impact: 'deploy' }, C8CompensationNamesOwnActivityRule);
