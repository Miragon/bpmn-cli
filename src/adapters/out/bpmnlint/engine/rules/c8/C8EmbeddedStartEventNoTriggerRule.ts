import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';

/**
 * A start event with a trigger in an embedded sub-process.
 * Camunda 8 enters an embedded sub-process through a none start event only and refuses the file;
 * triggered starts belong in an event sub-process.
 *
 * @example a message start event in an embedded sub-process
 * <bpmn:subProcess id="Review">
 *   <bpmn:startEvent id="Begin"><bpmn:messageEventDefinition messageRef="Go" /></bpmn:startEvent>  <!-- none start -->
 * </bpmn:subProcess>
 */
class C8EmbeddedStartEventNoTriggerRule extends C8Rule {
  protected visit(start: ModdleElement): void {
    if (!EngineScope.C8.contains(start) || !C8EventDefinitions.isEmbeddedSubProcessStart(start)) {
      return;
    }
    const definitions = start.get('eventDefinitions');
    const [definition] = definitions;
    if (definitions.length !== 1 || is(definition, 'bpmn:CancelEventDefinition')) {
      return;
    }
    this.report(start, `Start event ${start.id} of sub-process ${start.$parent.id} has a ${ElementKinds.trigger(definition)} trigger; Camunda 8 allows only a none start event in an embedded sub-process and refuses the file`, { path: ['eventDefinitions', 0], type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED, eventDefinition: definition, hint: `\`bpmn set <file> ${start.id} trigger=none\` (an event sub-process takes triggered starts: \`bpmn add <file> eventSubProcess:${ElementKinds.trigger(definition)} ... --in ${start.$parent.id}\`).` });
  }
}

export default defineRule({ ruleName: 'c8-embedded-start-event-no-trigger', code: 'W_C8_DEPLOY_START_EVENT', impact: 'deploy' }, C8EmbeddedStartEventNoTriggerRule);
