import { is, isAny } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { SetCommand } from '../support/SetCommand.js';
import { Shell } from '../support/Shell.js';
import { C7EventDefinitions } from './support/C7EventDefinitions.js';

/**
 * A compensation throw or end event whose activityRef names an activity outside its own
 * (sub-)process, for an event sub-process outside it and its parent scope, or no flow node at all.
 * Camunda 7 compensates only activities of the throw event's own scope and refuses to deploy the
 * file.
 *
 * @example a compensation of an activity in another sub-process
 * <bpmn:endEvent id="Undo">
 *   <bpmn:compensateEventDefinition activityRef="Book" />  <!-- Book sits in another sub-process -->
 * </bpmn:endEvent>
 */
class C7CompensationNamesOwnActivityRule extends C7Rule {
  protected visit(node: ModdleElement): void {
    if (!isAny(node, ['bpmn:IntermediateThrowEvent', 'bpmn:EndEvent']) || !EngineScope.C7.contains(node)) {
      return;
    }
    const definitions = new C7EventDefinitions(node);
    for (const definition of definitions.actedOn()) {
      if (is(definition, 'bpmn:CompensateEventDefinition')) {
        this.checkCompensation(node, definition, definitions);
      }
    }
  }

  private checkCompensation(event: ModdleElement, definition: ModdleElement, definitions: C7EventDefinitions): void {
    const activity = definition.activityRef;
    const scope = EngineScope.scopeOf(event);
    if (!activity || !scope) return;
    const allowed = EngineScope.isEventSubProcess(scope) ? [scope, EngineScope.scopeOf(scope)] : [scope];
    const isFlowNode = is(activity, 'bpmn:FlowNode');
    if (isFlowNode && allowed.includes(EngineScope.scopeOf(activity))) return;
    const scopeId = scope.id ?? '<scopeId>';
    const named = isFlowNode ? `${ElementKinds.describe(activity)}, which is not in ${scopeId}` : `${activity.id}, which is not a flow node`;
    const key = `${SetCommand.forDefinition(event, definitions.all().indexOf(definition)).slot}activityRef`;
    const candidates = (scope.flowElements ?? []).filter((element: ModdleElement) => is(element, 'bpmn:Activity') && !EngineScope.isEventSubProcess(element) && element.id).map((element: ModdleElement) => element.id).slice(0, 5);
    const listed = candidates.length ? ` (in ${scopeId}: ${candidates.join(', ')})` : '';
    this.report(event, `Compensation event ${event.id} names activityRef ${named}; the engines compensate only activities of the throw event's own (sub-)process and refuse the file`, { path: definitions.pathTo(definition, 'activityRef'), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: definition, property: 'activityRef', activityRef: activity, hint: `\`bpmn set <file> ${event.id} ${Shell.quote(`${key}=<activityId>`)}\`${listed}, or compensate the whole scope: \`bpmn set <file> ${event.id} ${Shell.quote(`${key}=`)}\`.` });
  }
}

export default defineRule({ ruleName: 'c7-compensation-names-own-activity', code: 'W_C7_DEPLOY_EVENT_DEFINITION', impact: 'deploy' }, C7CompensationNamesOwnActivityRule);
