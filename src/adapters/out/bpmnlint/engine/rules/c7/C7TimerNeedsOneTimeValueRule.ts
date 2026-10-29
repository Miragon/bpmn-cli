import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { C7EventDefinitionSchemaRule } from './C7EventDefinitionSchemaRule.js';
import { C7EventDefinitions } from './support/C7EventDefinitions.js';

const TIMER_ELEMENTS = ['timeDate', 'timeCycle', 'timeDuration'];

/**
 * A timer without date, duration or cycle that the engines run, or a timer with more than one of
 * them, also one the engines ignore.
 * Camunda 7 refuses to deploy the file; the BPMN schema allows only one of the three.
 *
 * @example a timer without value
 * <bpmn:intermediateCatchEvent id="Wait"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>  <!-- timeDuration PT1H -->
 */
class C7TimerNeedsOneTimeValueRule extends C7EventDefinitionSchemaRule {
  protected override checkEvent(event: ModdleElement): void {
    if (!EngineScope.C7.contains(event)) return;
    const definitions = new C7EventDefinitions(event);
    for (const definition of definitions.actedOn()) {
      if (is(definition, 'bpmn:TimerEventDefinition') && !TIMER_ELEMENTS.some((timeElement) => definition[timeElement])) {
        this.report(event, `Timer of ${ElementKinds.describe(event)} has no date, cycle or duration; the engines refuse the file`, { path: definitions.pathTo(definition), type: ERROR_TYPES.PROPERTY_REQUIRED, node: definition, requiredProperty: TIMER_ELEMENTS, hint: `\`bpmn set <file> ${event.id} timer=PT1H\` (or R/PT1H, or a date).` });
      }
    }
  }

  protected checkDefinition(definition: ModdleElement): void {
    const timeElements = TIMER_ELEMENTS.filter((timeElement) => definition[timeElement]);
    if (!is(definition, 'bpmn:TimerEventDefinition') || timeElements.length < 2) {
      return;
    }
    this.reportSchema(definition, `${this.subjectName(definition, 'Timer event')} has ${timeElements.join(' and ')}; the BPMN schema allows only one of timeDate, timeCycle and timeDuration, and the engines refuse the file`, { path: this.subjectPath(definition), type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, hint: this.subjectHint(definition, 'timer=<value>', 'R/PT1H is a cycle, PT1H a duration, else a date; the other elements go') });
  }
}

export default defineRule({ ruleName: 'c7-timer-needs-one-time-value', code: 'W_C7_DEPLOY_EVENT_DEFINITION', impact: 'deploy' }, C7TimerNeedsOneTimeValueRule);
